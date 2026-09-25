//! Test-only ACP peer. Never used as an application Agent.
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
fn emit(value: Value) {
    println!("{value}");
    io::stdout().flush().unwrap();
}
fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode == "orphan" {
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    let mut prompt_id = Value::Null;
    for line in io::stdin().lock().lines() {
        let value: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let id = &value["id"];
        match value["method"].as_str() {
            Some("initialize") => {
                if mode == "init-timeout" {
                    std::thread::sleep(std::time::Duration::from_secs(20));
                }
                emit(
                    json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":if mode == "version" {2} else {1},"agentCapabilities":{},"agentInfo":{"name":"stub","version":"1"}}}),
                );
            }
            Some("session/new") => {
                assert_eq!(value["params"]["mcpServers"], json!([]));
                assert!(
                    std::path::Path::new(value["params"]["cwd"].as_str().unwrap()).is_absolute()
                );
                emit(json!({"jsonrpc":"2.0","id":id,"result":{"sessionId":"test-session"}}));
            }
            Some("session/prompt") => {
                assert_eq!(value["params"]["sessionId"], "test-session");
                match mode.as_str() {
                    "orphan-crash" => {
                        let mut command =
                            std::process::Command::new(std::env::current_exe().unwrap());
                        command.arg("orphan");
                        #[cfg(windows)]
                        {
                            use std::os::windows::process::CommandExt;
                            command.creation_flags(0x08000000);
                        }
                        let _child = command.spawn().unwrap();
                        std::process::exit(17);
                    }
                    "crash" => std::process::exit(17),
                    "disconnect" => return,
                    "timeout" => continue,
                    "invalid" => {
                        println!("not-json");
                        continue;
                    }
                    "line-limit" => {
                        println!("{}", "x".repeat(1024 * 1024 + 1));
                        continue;
                    }
                    "wrong-session" => {
                        emit(
                            json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"wrong","update":{}}}),
                        );
                        continue;
                    }
                    "error" => {
                        emit(
                            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"test error"}}),
                        );
                        continue;
                    }
                    "permission" => {
                        prompt_id = id.clone();
                        emit(
                            json!({"jsonrpc":"2.0","id":"permission-1","method":"session/request_permission","params":{"sessionId":"test-session","toolCall":{"title":"test tool"},"options":[{"optionId":"yes","name":"allow","kind":"allow_once"},{"optionId":"no","name":"deny","kind":"reject_once"},{"optionId":"forever","name":"always","kind":"allow_always"}]}}),
                        );
                        continue;
                    }
                    "read" => {
                        prompt_id = id.clone();
                        emit(
                            json!({"jsonrpc":"2.0","id":"read-1","method":"fs/read_text_file","params":{"sessionId":"test-session","path":"private-file"}}),
                        );
                        continue;
                    }
                    _ => {}
                }
                for part in ["local images = ", "annotool.images()"] {
                    emit(
                        json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"test-session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":part}}}}),
                    );
                }
                emit(json!({"jsonrpc":"2.0","id":id,"result":{"stopReason":"end_turn"}}));
            }
            Some("session/cancel") => return,
            None if id == "permission-1" => {
                let outcome = &value["result"]["outcome"];
                assert!(
                    outcome["outcome"] == "cancelled"
                        || ["yes", "no"]
                            .contains(&outcome["optionId"].as_str().unwrap_or_default())
                );
                emit(json!({"jsonrpc":"2.0","id":prompt_id,"result":{"stopReason":"end_turn"}}));
            }
            None if id == "read-1" => {
                assert_eq!(value["error"]["code"], -32601);
                emit(json!({"jsonrpc":"2.0","id":prompt_id,"result":{"stopReason":"end_turn"}}));
            }
            _ => panic!("unexpected request"),
        }
    }
}
