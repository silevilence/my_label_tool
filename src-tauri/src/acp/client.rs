use super::{registry::Control, transport::Transport, Config, Outcome};
use crate::i18n::zh_cn as text;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

/// Creates a fresh ACP session in a caller-owned empty directory. No MCP servers,
/// file reads/writes or terminal operations are exposed by this client.
pub fn run(
    config: &Config,
    cwd: &Path,
    prompt: &str,
    control: &Control,
    emit: &mut impl FnMut(Value),
) -> Result<Outcome, String> {
    config.validate()?;
    if prompt.is_empty() || prompt.len() > 512 * 1024 {
        return Err(text::ACP_LIMIT.into());
    }
    if control.cancelled.load(Ordering::Acquire) {
        return Err(text::ACP_CANCELLED.into());
    }
    let started = Instant::now();
    let transport = Transport::spawn(config, cwd)?;
    let request = |id: u64, method: &str, params: Value| {
        transport.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
    };
    request(
        1,
        "initialize",
        json!({"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false},"clientInfo":{"name":"my-label-tool","version":env!("CARGO_PKG_VERSION")}}),
    )?;
    let mut expected = 1;
    let mut session = String::new();
    let mut agent = Value::Null;
    let mut capabilities = Value::Null;
    let mut pending: HashMap<String, (Value, Vec<Value>)> = HashMap::new();
    let mut permission_counter = 0u64;
    let mut bytes = 0usize;
    let mut permission_denied = false;
    loop {
        if control.cancelled.load(Ordering::Acquire) {
            if !session.is_empty() {
                let _ = transport.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}}));
                // Allow the notification to reach the child, then Drop enforces termination.
                std::thread::sleep(Duration::from_millis(30));
            }
            return Err(text::ACP_CANCELLED.into());
        }
        if started.elapsed() >= Duration::from_secs(config.timeout_seconds) {
            return Err(text::ACP_TIMEOUT.into());
        }
        for (token, selection) in control.take_responses()? {
            let (id, options) = pending.remove(&token).ok_or(text::ACP_PERMISSION_EXPIRED)?;
            let selected = selection.and_then(|selected| {
                options
                    .iter()
                    .find(|option| {
                        option["optionId"] == selected
                            && matches!(option["kind"].as_str(), Some("allow_once" | "reject_once"))
                    })
                    .cloned()
            });
            if selected
                .as_ref()
                .is_none_or(|option| option["kind"] != "allow_once")
            {
                permission_denied = true;
            }
            let outcome = match selected {
                Some(option) => json!({"outcome":"selected","optionId":option["optionId"]}),
                None => json!({"outcome":"cancelled"}),
            };
            transport.send(json!({"jsonrpc":"2.0","id":id,"result":{"outcome":outcome}}))?;
        }
        let Some(value) = transport.receive()? else {
            continue;
        };
        bytes = bytes.saturating_add(value.to_string().len());
        if bytes > 4 * 1024 * 1024 {
            return Err(text::ACP_LIMIT.into());
        }
        if value["jsonrpc"] != "2.0" {
            return Err(text::ACP_PROTOCOL.into());
        }
        if let Some(method) = value["method"].as_str() {
            let params = &value["params"];
            match method {
                "session/update"
                    if value.get("id").is_none()
                        && !session.is_empty()
                        && params["sessionId"] == session =>
                {
                    if !params["update"].is_object() {
                        return Err(text::ACP_PROTOCOL.into());
                    }
                    emit(json!({"event":"update","sessionId":session,"update":params["update"]}));
                }
                "session/request_permission"
                    if value.get("id").is_some()
                        && !session.is_empty()
                        && params["sessionId"] == session =>
                {
                    let id = value["id"].clone();
                    if !(id.is_string() || id.is_i64() || id.is_u64()) {
                        return Err(text::ACP_PROTOCOL.into());
                    }
                    if pending.values().any(|(pending_id, _)| pending_id == &id) {
                        return Err(text::ACP_PROTOCOL.into());
                    }
                    let options = params["options"]
                        .as_array()
                        .filter(|options| !options.is_empty() && options.len() <= 16)
                        .ok_or(text::ACP_PROTOCOL)?
                        .clone();
                    if options.iter().any(|option| {
                        option["optionId"].as_str().is_none()
                            || option["name"].as_str().is_none()
                            || !matches!(
                                option["kind"].as_str(),
                                Some(
                                    "allow_once" | "allow_always" | "reject_once" | "reject_always"
                                )
                            )
                    }) {
                        return Err(text::ACP_PROTOCOL.into());
                    }
                    let unique: std::collections::HashSet<_> = options
                        .iter()
                        .filter_map(|option| option["optionId"].as_str())
                        .collect();
                    if unique.len() != options.len() {
                        return Err(text::ACP_PROTOCOL.into());
                    }
                    permission_counter += 1;
                    let token = permission_counter.to_string();
                    control.register_permission(&token)?;
                    pending.insert(token.clone(), (id, options.clone()));
                    emit(
                        json!({"event":"permission","requestId":token,"title":params["toolCall"]["title"].as_str().unwrap_or(text::ACP_PERMISSION_TITLE),"options":options,"details":params["toolCall"]}),
                    );
                }
                _ if value.get("id").is_some() => {
                    // Even an approved tool request never grants host file/project access.
                    transport.send(json!({"jsonrpc":"2.0","id":value["id"],"error":{"code":-32601,"message":text::ACP_METHOD_DENIED}}))?;
                }
                "session/update" => return Err(text::ACP_PROTOCOL.into()),
                _ => {} // Unknown notifications are additive.
            }
            continue;
        }
        if value["id"] != expected || value.get("result").is_some() == value.get("error").is_some()
        {
            return Err(text::ACP_PROTOCOL.into());
        }
        if value.get("error").is_some() {
            return Err(text::acp_agent_error(&value["error"]));
        }
        let result = &value["result"];
        match expected {
            1 => {
                if result["protocolVersion"] != 1 {
                    return Err(text::ACP_VERSION.into());
                }
                capabilities = result["agentCapabilities"].clone();
                if !capabilities.is_object() {
                    return Err(text::ACP_PROTOCOL.into());
                }
                agent = result["agentInfo"].clone();
                expected = 2;
                request(2, "session/new", json!({"cwd":cwd,"mcpServers":[]}))?;
            }
            2 => {
                session = result["sessionId"]
                    .as_str()
                    .filter(|id| !id.is_empty() && id.len() <= 4096)
                    .ok_or(text::ACP_PROTOCOL)?
                    .into();
                emit(
                    json!({"event":"session","sessionId":session,"agentInfo":agent,"capabilities":capabilities}),
                );
                expected = 3;
                request(
                    3,
                    "session/prompt",
                    json!({"sessionId":session,"prompt":[{"type":"text","text":prompt}]}),
                )?;
            }
            3 => {
                if !pending.is_empty() {
                    return Err(text::ACP_PROTOCOL.into());
                }
                if permission_denied {
                    return Err(text::ACP_PERMISSION_REJECTED.into());
                }
                let stop_reason = result["stopReason"]
                    .as_str()
                    .ok_or(text::ACP_PROTOCOL)?
                    .to_owned();
                return Ok(Outcome {
                    session_id: session,
                    stop_reason,
                });
            }
            _ => return Err(text::ACP_PROTOCOL.into()),
        }
    }
}
