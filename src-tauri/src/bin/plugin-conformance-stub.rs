use my_label_tool_lib::plugins::protocol::{
    encode_message, ControlAction, EventKind, NdjsonDecoder, PluginMessage, ProtocolError,
    ProtocolErrorCode, ResponseOutcome, ALL_PROTOCOL_ERROR_CODES, PLUGIN_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::process::Command;
use std::time::Duration;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    match arguments.next().as_deref() {
        Some("--fixture") => {
            let fixture = arguments.next().ok_or("missing fixture name")?;
            run_fixture(&fixture)
        }
        Some("--sleep") => {
            std::thread::sleep(Duration::from_secs(30));
            Ok(())
        }
        Some("--early-exit-child") => {
            let child = Command::new(std::env::current_exe()?)
                .arg("--sleep")
                .spawn()?;
            std::process::exit(child.id() as i32);
        }
        Some(argument) => Err(format!("unknown argument: {argument}").into()),
        None => run_conformance(),
    }
}

fn run_conformance() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    let mut decoder = NdjsonDecoder::default();
    let mut pending = HashSet::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = input.read(&mut chunk)?;
        if read == 0 {
            for decoded in decoder.finish() {
                handle_decoded(decoded, &mut pending, &mut output)?;
            }
            return Ok(());
        }
        for decoded in decoder.push(&chunk[..read]) {
            handle_decoded(decoded, &mut pending, &mut output)?;
        }
    }
}

#[derive(Default)]
struct FixtureState {
    count: u64,
    pending_id: Option<String>,
    pending_params: Value,
}

fn run_fixture(fixture: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    let mut decoder = NdjsonDecoder::default();
    let mut state = FixtureState::default();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = input.read(&mut chunk)?;
        if read == 0 {
            return Ok(());
        }
        for decoded in decoder.push(&chunk[..read]) {
            let message = decoded.map_err(|error| format!("fixture protocol error: {error:?}"))?;
            handle_fixture_message(fixture, message, &mut state, &mut output)?;
        }
    }
}

fn handle_fixture_message(
    fixture: &str,
    message: PluginMessage,
    state: &mut FixtureState,
    output: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    match message {
        PluginMessage::Request {
            id: Some(id),
            method,
            ..
        } if method == "hello" => {
            if fixture == "garbage" {
                output.write_all(b"not-json\n")?;
                output.flush()?;
                return Ok(());
            }
            let exporter = fixture != "no-exporter";
            send_result(
                output,
                id,
                json!({
                    "protocolVersion": PLUGIN_PROTOCOL_VERSION,
                    "capabilities": {
                        "exporter": exporter,
                        "prelabel": true,
                        "batch": true,
                        "progress": true,
                        "cancel": true,
                        "configMigration": true
                    }
                }),
            )?;
            if fixture == "blocked-stdin" {
                eprintln!("hello-ready");
                std::thread::sleep(Duration::from_secs(30));
            }
            Ok(())
        }
        PluginMessage::Request {
            id: Some(id),
            method: _,
            params,
            ..
        } => handle_fixture_call(fixture, id, params, state, output),
        PluginMessage::Control {
            id: Some(id),
            action: ControlAction::Cancel,
            ..
        } if state.pending_id.as_deref() == Some(&id) => {
            state.pending_id = None;
            if fixture == "cancel-partial" {
                let image_path = state
                    .pending_params
                    .pointer("/imagePaths/0")
                    .and_then(Value::as_str)
                    .unwrap_or("images/a.jpg");
                send_result(
                    output,
                    id,
                    json!({
                        "shapes": [{
                            "imagePath": image_path,
                            "id": "partial",
                            "type": "rect",
                            "labelId": "vehicle",
                            "points": [1, 2, 3, 4]
                        }],
                        "cancelled": true,
                        "completedImagePaths": [image_path]
                    }),
                )
            } else {
                send_error(output, id, ProtocolErrorCode::Cancelled, "cancelled")
            }
        }
        response @ PluginMessage::Response { .. }
            if matches!(fixture, "file-proxy" | "prelabel-host") =>
        {
            let call_id = state
                .pending_id
                .take()
                .ok_or("missing pending proxy call")?;
            if fixture == "file-proxy" {
                let encoded = encode_message(&response)
                    .map_err(|error| format!("encode proxy response: {error:?}"))?;
                send_result(output, call_id, serde_json::from_str(&encoded)?)
            } else {
                let image_path = state
                    .pending_params
                    .pointer("/imagePaths/0")
                    .and_then(Value::as_str)
                    .unwrap_or("images/a.bin");
                let label_id = state
                    .pending_params
                    .pointer("/classMappings/0/labelId")
                    .and_then(Value::as_str)
                    .unwrap_or("vehicle");
                send_result(
                    output,
                    call_id,
                    json!({
                        "shapes": [{
                            "imagePath": image_path,
                            "id": "plugin-one",
                            "type": "rect",
                            "labelId": label_id,
                            "points": [1, 2, 3, 4],
                            "attributes": { "confidence": 0.9 },
                            "frameIndex": 0
                        }]
                    }),
                )
            }
        }
        _ => Err("unexpected fixture message".into()),
    }
}

fn handle_fixture_call(
    fixture: &str,
    id: String,
    params: Value,
    state: &mut FixtureState,
    output: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    match fixture {
        "reuse" => {
            state.count += 1;
            send_result(
                output,
                id,
                json!({
                    "count": state.count,
                    "pluginDir": std::env::var("MY_LABEL_TOOL_PLUGIN_DIR")?,
                    "value": params.get("value").cloned().unwrap_or(Value::Null)
                }),
            )
        }
        "timeout" | "long-call" => {
            if fixture == "long-call" {
                eprintln!("started");
            }
            std::thread::sleep(Duration::from_secs(30));
            Ok(())
        }
        "crash" => std::process::exit(7),
        "restart" => {
            send_result(output, id, json!({ "count": 1 }))?;
            std::process::exit(0);
        }
        "success" | "no-exporter" => send_result(output, id, json!({ "ok": true })),
        "business-error" => send_error(
            output,
            id,
            ProtocolErrorCode::InvalidArgument,
            "expected business error",
        ),
        "timeout-tree" => {
            let child = Command::new(std::env::current_exe()?)
                .arg("--sleep")
                .spawn()?;
            eprintln!("{}", std::process::id());
            eprintln!("{}", child.id());
            std::thread::sleep(Duration::from_secs(30));
            Ok(())
        }
        "cancel" | "cancel-partial" => {
            eprintln!("{}", std::process::id());
            send(
                output,
                PluginMessage::Event {
                    v: PLUGIN_PROTOCOL_VERSION,
                    id: Some(id.clone()),
                    event: EventKind::Progress,
                    payload: json!({ "percent": 25, "message": "working" }),
                },
            )?;
            state.pending_id = Some(id);
            state.pending_params = params;
            Ok(())
        }
        "file-proxy" | "prelabel-host" => {
            let path = if fixture == "file-proxy" {
                params.get("path").cloned().unwrap_or(Value::Null)
            } else {
                params
                    .pointer("/imagePaths/0")
                    .cloned()
                    .unwrap_or(Value::Null)
            };
            let proxy_params = if fixture == "prelabel-host" {
                json!({ "path": path, "encoding": "base64" })
            } else {
                json!({ "path": path })
            };
            send(
                output,
                PluginMessage::Request {
                    v: PLUGIN_PROTOCOL_VERSION,
                    id: Some("proxy-read".to_string()),
                    method: "fs.read".to_string(),
                    params: proxy_params,
                },
            )?;
            state.pending_id = Some(id);
            state.pending_params = params;
            Ok(())
        }
        "exporter-host" => send_result(
            output,
            id,
            json!({
                "files": [{
                    "relativePath": "a.json",
                    "contentUtf8": "{\"version\":\"5.5.0\",\"flags\":{},\"shapes\":[],\"imagePath\":\"images/a.jpg\",\"imageData\":null,\"imageHeight\":480,\"imageWidth\":640}"
                }]
            }),
        ),
        _ => Err(format!("unknown fixture: {fixture}").into()),
    }
}

fn handle_decoded(
    decoded: Result<PluginMessage, ProtocolError>,
    pending: &mut HashSet<String>,
    output: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    match decoded {
        Ok(message) => handle_message(message, pending, output),
        Err(error) => send(
            output,
            PluginMessage::Response {
                v: PLUGIN_PROTOCOL_VERSION,
                id: Some("conformance-error".to_string()),
                outcome: ResponseOutcome::Error(error),
            },
        ),
    }
}

fn handle_message(
    message: PluginMessage,
    pending: &mut HashSet<String>,
    output: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    match message {
        PluginMessage::Request {
            id: Some(id),
            method,
            params,
            ..
        } => handle_request(id, &method, params, pending, output),
        PluginMessage::Control {
            id,
            action: ControlAction::Heartbeat,
            ..
        } => send(
            output,
            PluginMessage::Control {
                v: PLUGIN_PROTOCOL_VERSION,
                id,
                action: ControlAction::Heartbeat,
            },
        ),
        PluginMessage::Control {
            id: Some(id),
            action: ControlAction::Cancel,
            ..
        } if pending.remove(&id) => {
            send_error(output, id, ProtocolErrorCode::Cancelled, "cancelled")
        }
        _ => send_error(
            output,
            "conformance-error".to_string(),
            ProtocolErrorCode::ProtocolError,
            "unexpected message",
        ),
    }
}

fn handle_request(
    id: String,
    method: &str,
    params: Value,
    pending: &mut HashSet<String>,
    output: &mut impl Write,
) -> Result<(), Box<dyn std::error::Error>> {
    match method {
        "hello" => send_result(
            output,
            id,
            json!({
                "protocolVersion": PLUGIN_PROTOCOL_VERSION,
                "capabilities": {
                    "prelabel": true,
                    "progress": true,
                    "cancel": true
                }
            }),
        ),
        "prelabel.run" => {
            send(
                output,
                PluginMessage::Event {
                    v: PLUGIN_PROTOCOL_VERSION,
                    id: Some(id.clone()),
                    event: EventKind::Progress,
                    payload: json!({ "percent": 25, "message": "running" }),
                },
            )?;
            if params
                .get("waitForCancel")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                pending.insert(id);
                Ok(())
            } else {
                send_result(output, id, json!({ "annotations": [] }))
            }
        }
        "conformance.errorCodes" => send_result(
            output,
            id,
            Value::Array(
                ALL_PROTOCOL_ERROR_CODES
                    .map(|code| Value::String(code.as_str().to_string()))
                    .to_vec(),
            ),
        ),
        "conformance.raise" => {
            let requested = params.get("code").and_then(Value::as_str);
            let code = requested.and_then(|requested| {
                ALL_PROTOCOL_ERROR_CODES
                    .into_iter()
                    .find(|code| code.as_str() == requested)
            });
            match code {
                Some(code) => send_error(output, id, code, "conformance error"),
                None => send_error(
                    output,
                    id,
                    ProtocolErrorCode::InvalidArgument,
                    "unknown error code",
                ),
            }
        }
        _ => send_error(
            output,
            id,
            ProtocolErrorCode::MethodNotFound,
            "method not found",
        ),
    }
}

fn send_result(
    output: &mut impl Write,
    id: String,
    result: Value,
) -> Result<(), Box<dyn std::error::Error>> {
    send(
        output,
        PluginMessage::Response {
            v: PLUGIN_PROTOCOL_VERSION,
            id: Some(id),
            outcome: ResponseOutcome::Result(result),
        },
    )
}

fn send_error(
    output: &mut impl Write,
    id: String,
    code: ProtocolErrorCode,
    message: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    send(
        output,
        PluginMessage::Response {
            v: PLUGIN_PROTOCOL_VERSION,
            id: Some(id),
            outcome: ResponseOutcome::Error(ProtocolError::new(code, message)),
        },
    )
}

fn send(output: &mut impl Write, message: PluginMessage) -> Result<(), Box<dyn std::error::Error>> {
    let encoded =
        encode_message(&message).map_err(|error| std::io::Error::other(format!("{error:?}")))?;
    output.write_all(encoded.as_bytes())?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}
