use my_label_tool_lib::plugins::developer_tools::{plugin_validator_usage, validate_plugin_source};
use serde_json::json;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let Some(source) = args.next() else {
        eprintln!("{}", plugin_validator_usage());
        return ExitCode::from(2);
    };
    if args.next().is_some() {
        eprintln!("{}", plugin_validator_usage());
        return ExitCode::from(2);
    }
    let source = PathBuf::from(source);
    match validate_plugin_source(&source) {
        Ok(report) => {
            match serde_json::to_string_pretty(&report) {
                Ok(output) => println!("{output}"),
                Err(error) => {
                    eprintln!(
                        "{}",
                        json!({ "ok": false, "fatal": true, "message": error.to_string() })
                    );
                    return ExitCode::from(2);
                }
            }
            if report.ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        Err(message) => {
            eprintln!(
                "{}",
                json!({ "ok": false, "fatal": true, "message": message })
            );
            ExitCode::from(2)
        }
    }
}
