use crate::{
    commands::Context,
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
        api.set(
            "call",
            scope.create_function_mut(|lua, (name, args): (String, Option<mlua::Value>)| {
                let args = match args {
                    None | Some(mlua::Value::Nil) => json!({}),
                    Some(args) => lua.from_value::<Value>(args)?,
                };
                let value = context
                    .borrow_mut()
                    .call(&name, args, emit)
                    .map_err(|e| mlua::Error::RuntimeError(format!("{}: {}", e.code, e.message)))?;
                lua.to_value(&value)
            })?,
        )?;
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
}
