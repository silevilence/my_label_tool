use crate::{
    commands::{Context, COMMANDS},
    protocol::{Failure, Limits, Result, Snapshot},
};
use mlua::{chunk::ChunkMode, HookTriggers, Lua, LuaOptions, LuaSerdeExt, StdLib, VmState};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    time::{Duration, Instant},
};

pub fn execute(
    snapshot: Snapshot,
    source: &str,
    limits: &Limits,
    emit: &mut dyn FnMut(Value) -> Result<()>,
) -> Result<Context> {
    crate::limits::validate(limits)?;
    let lua = Lua::new_with(
        StdLib::MATH | StdLib::STRING | StdLib::TABLE | StdLib::UTF8,
        LuaOptions::default(),
    )
    .map_err(lua_error)?;
    lua.set_memory_limit(limits.max_memory_mi_b as usize * 1024 * 1024 / 2)
        .map_err(lua_error)?;
    // Remove base-library escape routes and stdout writers as well as unsafe libraries.
    for name in [
        "dofile",
        "loadfile",
        "load",
        "print",
        "warn",
        "collectgarbage",
        "io",
        "os",
        "package",
        "require",
        "debug",
    ] {
        lua.globals()
            .set(name, mlua::Value::Nil)
            .map_err(lua_error)?;
    }
    let started = Instant::now();
    let timeout = Duration::from_secs(limits.timeout_seconds);
    lua.set_hook(
        HookTriggers::new().every_nth_instruction(10000),
        move |_, _| {
            if started.elapsed() >= timeout {
                Err(mlua::Error::RuntimeError("TIMEOUT".into()))
            } else {
                Ok(VmState::Continue)
            }
        },
    )
    .map_err(lua_error)?;
    let context = RefCell::new(Context::new(snapshot));
    let result = lua.scope(|scope| {
        let api = lua.create_table()?;
        api.set("API_VERSION", 1)?;
        let dispatch = scope.create_function_mut(|lua, mut arguments: mlua::MultiValue| {
            // Binding/conversion failures must be latched too: pcall may catch them.
            let converted = (|| {
                let name = match arguments.pop_front() {
                    Some(mlua::Value::String(name)) => name.to_str()?.to_owned(),
                    _ => {
                        return Err(mlua::Error::RuntimeError(
                            "command name must be a string".into(),
                        ))
                    }
                };
                let mut args = match arguments.pop_front() {
                    None | Some(mlua::Value::Nil) => json!({}),
                    Some(args) => lua.from_value::<Value>(args)?,
                };
                // Lua has one empty table literal for both maps and arrays.
                // At submit.annotations the contract unambiguously requires an array.
                if name == "submit"
                    && args["annotations"]
                        .as_object()
                        .is_some_and(|map| map.is_empty())
                {
                    args["annotations"] = json!([]);
                }
                Ok((name, args))
            })();
            let (name, args) = converted.inspect_err(|error| {
                context
                    .borrow_mut()
                    .failures
                    .push(Failure::new("INVALID_ARGUMENT", error));
            })?;
            let value = context
                .borrow_mut()
                .call(&name, args, emit)
                .map_err(|e| mlua::Error::RuntimeError(format!("{}: {}", e.code, e.message)))?;
            lua.to_value(&value).inspect_err(|error| {
                context.borrow_mut().failures.push(lua_error(error.clone()));
            })
        })?;
        api.set("call", dispatch.clone())?;
        // Bind the command name once; both entry points share validation and failure latching.
        for command in COMMANDS {
            api.set(command.name, dispatch.bind(command.name)?)?;
        }
        lua.globals().set("annotool", api)?;
        lua.load(source)
            .set_name("script")
            .set_mode(ChunkMode::Text)
            .exec()
    });
    let mut context = context.into_inner();
    if let Err(error) = result {
        context.failures.push(lua_error(error));
    }
    Ok(context)
}

fn lua_error(error: mlua::Error) -> Failure {
    let message = error.to_string();
    let code = if matches!(error, mlua::Error::MemoryError(_)) {
        "MEMORY_LIMIT"
    } else if message.contains("TIMEOUT") {
        "TIMEOUT"
    } else {
        "SCRIPT_ERROR"
    };
    Failure::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> Snapshot {
        Snapshot {
            labels: vec![
                json!({"id":"generated-a","name":"车辆"}),
                json!({"id":"generated-b","name":"汽车"}),
            ],
            images: vec![
                json!({"path":"a.png","name":"a.png","annotations":[{"id":"r","type":"rect","labelId":"generated-a","points":[-1,2,3,4]}]}),
                json!({"path":"b.png","name":"b.png","annotations":[]}),
            ],
        }
    }
    fn run(source: &str) -> Context {
        execute(
            snapshot(),
            source,
            &Limits {
                max_memory_mi_b: 64,
                timeout_seconds: 1,
            },
            &mut |_| Ok(()),
        )
        .unwrap()
    }
    #[test]
    fn examples_run_against_real_lua() {
        let result = run(include_str!("../../../examples/scripts/reassign.lua"));
        assert!(result.failures.is_empty(), "{:?}", result.failures);
        assert_eq!(result.results["a.png"][0]["labelId"], "generated-b");
        assert_eq!(
            run(include_str!("../../../examples/scripts/coordinates.lua")).results["a.png"][0]
                ["points"][0],
            0
        );
        assert_eq!(
            run(include_str!("../../../examples/scripts/numbering.lua")).results["a.png"][0]
                ["attributes"]["sequence"],
            1
        );
    }
    #[test]
    fn builtin_catalog_covers_every_command_and_all_examples_execute() {
        let catalog: Vec<Value> =
            serde_json::from_str(include_str!("../../../examples/scripts/catalog.json")).unwrap();
        for command in COMMANDS {
            assert!(
                catalog.iter().any(|entry| entry["command"] == command.name),
                "Missing example for {}",
                command.name
            );
        }
        let mut ids = std::collections::HashSet::new();
        for entry in catalog {
            let id = entry["id"].as_str().unwrap();
            assert!(ids.insert(id.to_owned()), "Duplicate example: {id}");
            if let Some(command) = entry["command"].as_str() {
                assert!(COMMANDS.iter().any(|registered| registered.name == command));
            }
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../examples/scripts")
                .join(format!("{id}.lua"));
            let source = std::fs::read_to_string(path).unwrap();
            let mut snapshot = snapshot();
            if entry["includeDimensions"].as_bool().unwrap() {
                for image in &mut snapshot.images {
                    image["size"] = json!({"width":100,"height":80});
                }
            }
            let mut events = vec![];
            let result = execute(
                snapshot,
                &source,
                &Limits {
                    max_memory_mi_b: 64,
                    timeout_seconds: 1,
                },
                &mut |event| {
                    events.push(event);
                    Ok(())
                },
            )
            .unwrap();
            assert!(result.failures.is_empty(), "{id}: {:?}", result.failures);
            match id {
                "submit" => assert_eq!(result.results["a.png"][0]["attributes"]["reviewed"], true),
                "reassign" | "coordinates" | "numbering" => assert_eq!(result.results.len(), 2),
                _ => {
                    assert!(
                        result.results.is_empty(),
                        "{id} must not modify annotations"
                    );
                    assert!(
                        !events.is_empty(),
                        "{id} must demonstrate observable output"
                    );
                }
            }
        }
    }
    #[test]
    fn direct_functions_and_legacy_calls_share_results_and_events() {
        let source = r#"
            local images = api.images()
            assert(#images == 2 and images[1].path == 'a.png')
            local target = api.label {name='汽车'}
            assert(api.label({id=target.id}).name == '汽车')
            local size = api.size {imagePath=images[1].path}
            assert(size.width == 100 and size.height == 80)
            local shapes = api.annotations {imagePath=images[1].path}
            shapes[1].labelId = target.id
            assert(api.submit {imagePath=images[1].path, annotations=shapes})
            assert(api.submit {imagePath=images[2].path, annotations={}})
            assert(api.progress {completed=2, total=2})
            assert(api.log {message='处理完成'})
        "#;
        let mut outputs = vec![];
        for direct in [true, false] {
            let mut snapshot = snapshot();
            snapshot.images[0]["size"] = json!({"width":100,"height":80});
            let mut events = vec![];
            let prelude = if direct {
                "local api = annotool"
            } else {
                "local api = setmetatable({}, {__index=function(_, name) return function(args) return annotool.call(name, args) end end})"
            };
            let result = execute(
                snapshot,
                &format!("{prelude}\n{source}"),
                &Limits {
                    max_memory_mi_b: 64,
                    timeout_seconds: 1,
                },
                &mut |event| {
                    events.push(event);
                    Ok(())
                },
            )
            .unwrap();
            assert!(result.failures.is_empty(), "{:?}", result.failures);
            assert_eq!(result.results["a.png"][0]["labelId"], "generated-b");
            assert_eq!(result.results["b.png"], json!([]));
            assert_eq!(
                events,
                vec![
                    json!({"event":"progress","completed":2,"total":2}),
                    json!({"event":"log","message":"处理完成"}),
                ]
            );
            outputs.push((result.results, events));
        }
        assert_eq!(outputs[0], outputs[1]);
        for command in COMMANDS {
            let result = run(&format!(
                "assert(type(annotool.{}) == 'function')",
                command.name
            ));
            assert!(result.failures.is_empty(), "{}", command.name);
        }
    }
    #[test]
    fn unsafe_libraries_bytecode_and_allocation_are_rejected() {
        for source in [
            "io.open('x')",
            "os.execute('whoami')",
            "require('socket')",
            "debug.getregistry()",
            "dofile('x')",
            "load('return 1')",
            "\u{1b}Lua",
        ] {
            assert!(!run(source).failures.is_empty(), "{source}");
        }
        assert_eq!(
            run("local x = string.rep('x', 100000000)").failures[0].code,
            "MEMORY_LIMIT"
        );
    }
    #[test]
    fn loops_time_out_and_caught_command_errors_still_abort() {
        assert_eq!(run("while true do end").failures[0].code, "TIMEOUT");
        assert!(
            !run("pcall(function() annotool.call('size', {imagePath='a.png'}) end)")
                .failures
                .is_empty()
        );
    }
    #[test]
    fn caught_binding_and_conversion_errors_invalidate_prior_submissions() {
        for call in [
            "annotool.submit {imagePath='a.png', annotations=function() end}",
            "annotool.submit()",
            "annotool.annotations(42)",
            "annotool.call('submit', {imagePath='a.png', annotations=function() end})",
            "annotool.call({}, {})",
            "annotool.call()",
        ] {
            let result = run(&format!(
                "annotool.call('submit', {{imagePath='a.png', annotations=annotool.call('annotations', {{imagePath='a.png'}})}}); pcall(function() {call} end)"
            ));
            assert_eq!(result.failures[0].code, "INVALID_ARGUMENT", "{call}");
        }
    }
    #[test]
    fn an_empty_lua_table_can_clear_an_image() {
        let result = run("annotool.call('submit', {imagePath='a.png', annotations={}})");
        assert!(result.failures.is_empty(), "{:?}", result.failures);
        assert_eq!(result.results["a.png"], json!([]));
    }
}
