use super::{catalog, config, failure, now, text, Host, Session, VERSIONS};
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router(host: Arc<Host>) -> Router {
    Router::new().route("/mcp", any(handle)).with_state(host)
}
fn error(status: StatusCode, code: i32, message: &str, id: Value) -> Response {
    (
        status,
        Json(json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})),
    )
        .into_response()
}
fn header<'a>(headers: &'a HeaderMap, key: &str) -> Option<&'a str> {
    headers.get(key).and_then(|v| v.to_str().ok())
}
fn secure_equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}
fn authorize(host: &Host, headers: &HeaderMap) -> Result<(), Box<Response>> {
    let mut inner = host.lock().map_err(|_| {
        Box::new(error(
            StatusCode::SERVICE_UNAVAILABLE,
            -32603,
            text::INTERNAL,
            Value::Null,
        ))
    })?;
    let reject = |status, message| Box::new(error(status, -32600, message, Value::Null));
    let Some(config) = &inner.config else {
        return Err(reject(StatusCode::SERVICE_UNAVAILABLE, text::READY));
    };
    let bearer = header(headers, "authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !secure_equal(bearer, &config.token) {
        inner.record("", "http", "UNAUTHORIZED");
        return Err(reject(StatusCode::UNAUTHORIZED, text::AUTH));
    }
    if !inner.running {
        return Err(reject(StatusCode::SERVICE_UNAVAILABLE, text::READY));
    }
    let authority = if config.address.contains(':') {
        format!("[{}]:{}", config.address, config.port)
    } else {
        format!("{}:{}", config.address, config.port)
    };
    let localhost = format!("localhost:{}", config.port);
    if !header(headers, "host").is_some_and(|h| h == authority || h == localhost) {
        inner.record("", "http", "FORBIDDEN");
        return Err(reject(StatusCode::FORBIDDEN, text::ORIGIN));
    }
    if let Some(origin) = header(headers, "origin") {
        if origin != format!("http://{authority}") && origin != format!("http://{localhost}") {
            inner.record("", "http", "FORBIDDEN");
            return Err(reject(StatusCode::FORBIDDEN, text::ORIGIN));
        }
    }
    Ok(())
}
async fn handle(State(host): State<Arc<Host>>, request: Request<Body>) -> Response {
    if let Err(response) = authorize(&host, request.headers()) {
        return *response;
    }
    let method = request.method().clone();
    let headers = request.headers().clone();
    if method == Method::GET {
        return (StatusCode::METHOD_NOT_ALLOWED, [("allow", "POST, DELETE")]).into_response();
    }
    if method != Method::POST && method != Method::DELETE {
        return error(
            StatusCode::METHOD_NOT_ALLOWED,
            -32600,
            text::METHOD,
            Value::Null,
        );
    }
    let sid = header(&headers, "mcp-session-id").map(str::to_owned);
    if method == Method::DELETE {
        let Ok(mut inner) = host.lock() else {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                -32603,
                text::INTERNAL,
                Value::Null,
            );
        };
        inner.sweep();
        if sid
            .as_ref()
            .is_none_or(|id| inner.sessions.remove(id).is_none())
        {
            return error(StatusCode::NOT_FOUND, -32600, text::SESSION, Value::Null);
        }
        inner.sweep();
        return StatusCode::NO_CONTENT.into_response();
    }
    if header(&headers, "content-type")
        .is_none_or(|v| v.split(';').next() != Some("application/json"))
    {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            -32600,
            text::INVALID,
            Value::Null,
        );
    }
    let accept = header(&headers, "accept").unwrap_or_default();
    if !accept.contains("application/json") || !accept.contains("text/event-stream") {
        return error(
            StatusCode::NOT_ACCEPTABLE,
            -32600,
            text::INVALID,
            Value::Null,
        );
    }
    let bytes = match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        to_bytes(request.into_body(), 2 * 1024 * 1024),
    )
    .await
    {
        Ok(Ok(b)) => b,
        Ok(Err(_)) => {
            return error(
                StatusCode::PAYLOAD_TOO_LARGE,
                -32600,
                text::LIMIT,
                Value::Null,
            )
        }
        Err(_) => {
            return error(
                StatusCode::REQUEST_TIMEOUT,
                -32600,
                text::TIMEOUT,
                Value::Null,
            )
        }
    };
    // Recheck after awaiting the body: rotation/stop must revoke in-flight authorization too.
    if let Err(response) = authorize(&host, &headers) {
        return *response;
    }
    let value: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return error(StatusCode::BAD_REQUEST, -32700, text::INVALID, Value::Null),
    };
    let id = value.get("id").cloned().unwrap_or(Value::Null);
    if !value.is_object()
        || value["jsonrpc"] != "2.0"
        || !value["method"].is_string()
        || (value.get("id").is_some() && !id.is_string() && !id.is_i64() && !id.is_u64())
    {
        return error(StatusCode::BAD_REQUEST, -32600, text::INVALID, Value::Null);
    }
    let name = value["method"].as_str().unwrap_or_default();
    if name == "initialize" {
        if sid.is_some() || id.is_null() {
            return error(StatusCode::BAD_REQUEST, -32600, text::INVALID, id);
        }
        let Some(version) = value["params"]["protocolVersion"].as_str() else {
            return error(StatusCode::BAD_REQUEST, -32602, text::INVALID, id);
        };
        let Some(client) = value["params"]["clientInfo"]["name"]
            .as_str()
            .filter(|s| s.len() <= 128)
        else {
            return error(StatusCode::BAD_REQUEST, -32602, text::INVALID, id);
        };
        if !value["params"]["capabilities"].is_object()
            || !value["params"]["clientInfo"]["version"].is_string()
        {
            return error(StatusCode::BAD_REQUEST, -32602, text::INVALID, id);
        }
        let version = if VERSIONS.contains(&version) {
            version
        } else {
            VERSIONS[2]
        };
        let Ok(sid) = config::secret() else {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                -32603,
                text::INTERNAL,
                id,
            );
        };
        let Ok(mut inner) = host.lock() else {
            return error(StatusCode::SERVICE_UNAVAILABLE, -32603, text::INTERNAL, id);
        };
        inner.sweep();
        if inner.sessions.len() >= 16 {
            return error(StatusCode::TOO_MANY_REQUESTS, -32600, text::LIMIT, id);
        }
        inner.sessions.insert(
            sid.clone(),
            Session {
                id: sid.clone(),
                client: client.into(),
                version: version.into(),
                last_seen: now(),
                initialized: false,
                window: now(),
                count: 0,
            },
        );
        return ([("mcp-session-id",sid)],Json(json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":version,
            "capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"my-label-tool","version":env!("CARGO_PKG_VERSION")}}}))).into_response();
    }
    let Some(sid) = sid else {
        return error(StatusCode::BAD_REQUEST, -32600, text::SESSION, id);
    };
    let version;
    {
        let Ok(mut inner) = host.lock() else {
            return error(StatusCode::SERVICE_UNAVAILABLE, -32603, text::INTERNAL, id);
        };
        inner.sweep();
        let Some(session) = inner.sessions.get_mut(&sid) else {
            return error(StatusCode::NOT_FOUND, -32600, text::SESSION, id);
        };
        if header(&headers, "mcp-protocol-version").is_some_and(|v| v != session.version) {
            return error(StatusCode::BAD_REQUEST, -32600, text::INVALID, id);
        }
        if now().saturating_sub(session.window) >= 60_000 {
            session.window = now();
            session.count = 0;
        }
        session.count += 1;
        if session.count > 120 {
            return error(StatusCode::TOO_MANY_REQUESTS, -32600, text::LIMIT, id);
        }
        session.last_seen = now();
        version = session.version.clone();
        if name == "notifications/initialized" && id.is_null() {
            session.initialized = true;
            return StatusCode::ACCEPTED.into_response();
        }
        if !session.initialized && name != "ping" {
            return error(StatusCode::BAD_REQUEST, -32600, text::INVALID, id);
        }
    }
    if id.is_null() {
        // Cancellation notifications cancel the queued request only; domain tasks use task_cancel.
        return StatusCode::ACCEPTED.into_response();
    }
    let result = match name {
        "ping" => json!({}),
        "tools/list" => json!({"tools":catalog()}),
        "tools/call" => {
            let Some(tool) = value["params"]["name"].as_str() else {
                return error(StatusCode::OK, -32602, text::INVALID, id);
            };
            if !catalog()
                .as_array()
                .is_some_and(|tools| tools.iter().any(|t| t["name"] == tool))
            {
                return error(StatusCode::OK, -32602, text::METHOD, id);
            }
            let args = value["params"]
                .get("arguments")
                .cloned()
                .unwrap_or(json!({}));
            if !args.is_object() {
                failure("INVALID_ARGUMENT", text::INVALID)
            } else {
                host.call(&sid, tool, args).await
            }
        }
        _ => return error(StatusCode::OK, -32601, text::METHOD, id),
    };
    let mut result = result;
    if version == "2025-03-26" {
        if let Some(obj) = result.as_object_mut() {
            obj.remove("structuredContent");
        }
    }
    Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response()
}
