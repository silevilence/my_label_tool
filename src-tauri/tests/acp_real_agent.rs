//! Explicit opt-in real Agent acceptance. Never runs in normal CI or reads project data.
use label_script_host::protocol::{Limits, Snapshot};
use my_label_tool_lib::{
    acp::{client::run, registry::Control, Config},
    scripting::runner,
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::atomic::AtomicBool};

#[test]
#[ignore = "requires an explicitly selected, authenticated local ACP Agent"]
fn real_agent_generates_a_script_that_runs_in_the_real_lua_host() {
    let program = std::env::var_os("ACP_REAL_PROGRAM").expect("set ACP_REAL_PROGRAM");
    let args: Vec<String> = serde_json::from_str(
        &std::env::var("ACP_REAL_ARGS").unwrap_or_else(|_| "[\"acp\"]".into()),
    )
    .unwrap();
    let output = PathBuf::from(std::env::var_os("ACP_REAL_OUTPUT").expect("set ACP_REAL_OUTPUT"));
    let host = PathBuf::from(std::env::var_os("ACP_LUA_HOST").expect("set ACP_LUA_HOST"));
    let config = Config {
        executable: program.into(),
        args,
        timeout_seconds: 180,
    };
    let directory = tempfile::tempdir().unwrap();
    let docs = label_script_host::commands::COMMANDS
        .iter()
        .map(|command| {
            format!(
                "annotool.{}({}) -> {}",
                command.name, command.parameters, command.returns
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!("Write a Lua 5.4 script for an offline annotation app. Do not use any tools or read files. Reply with exactly one complete ```lua code block. Use only the supplied documentation. Enumerate annotool.images(), count the number of annotations using annotool.annotations({{imagePath=image.path}}), and log the total as a string using annotool.log({{message=tostring(total)}}). Do not submit changes. Lua has no print, io, os, require or load. Named parameters are passed in Lua tables. Commands:\n{docs}\nCurrent script:\nlocal images = annotool.images()\n");
    let control = Control::default();
    let mut reply = String::new();
    let mut agent_events = vec![];
    let outcome = run(
        &config,
        directory.path(),
        &prompt,
        &control,
        &mut |event: Value| {
            agent_events.push(event.clone());
            if event["event"] == "permission" {
                control
                    .respond(event["requestId"].as_str().unwrap(), None)
                    .unwrap();
            }
            if event["event"] == "update"
                && event["update"]["sessionUpdate"] == "agent_message_chunk"
            {
                if let Some(part) = event["update"]["content"]["text"].as_str() {
                    reply.push_str(part);
                }
            }
        },
    )
    .expect("real ACP request succeeds");
    std::fs::write(
        &output,
        serde_json::to_string_pretty(&json!({"reply":reply,"events":agent_events,"passed":false}))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(outcome.stop_reason, "end_turn");
    let source = reply
        .split_once("```lua")
        .and_then(|(_, content)| content.split_once("```"))
        .map(|(source, _)| source.trim())
        .expect("one Lua code block");
    let mut events = vec![];
    let results = runner::run(
        &host,
        Snapshot {
            labels: vec![],
            images: vec![json!({"path":"test.png","name":"test.png","annotations":[]})],
        },
        source.into(),
        Limits {
            max_memory_mi_b: 256,
            timeout_seconds: 10,
        },
        16,
        &AtomicBool::new(false),
        &mut |event| events.push(event),
    )
    .expect("generated Lua validates and runs");
    assert!(results.is_empty());
    assert!(events
        .iter()
        .any(|event| event["event"] == "log" && event["message"] == "0"));
    std::fs::write(
        output,
        serde_json::to_string_pretty(
            &json!({"agent":"omp","reply":reply,"source":source,"luaEvents":events,"passed":true}),
        )
        .unwrap(),
    )
    .unwrap();
}
