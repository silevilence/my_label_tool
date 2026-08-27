use my_label_tool_lib::plugins::protocol::{
    encode_message, ControlAction, EventKind, NdjsonDecoder, PluginMessage, ProtocolError,
    ProtocolErrorCode, ResponseOutcome, ALL_PROTOCOL_ERROR_CODES, PLUGIN_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{Read, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
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
