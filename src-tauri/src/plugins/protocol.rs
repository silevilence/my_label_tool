use crate::i18n::zh_cn as text;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub use super::versioning::PLUGIN_PROTOCOL_VERSION;
use super::versioning::{
    CURRENT_HOST_API_VERSION, SUPPORTED_EXPORTER_API_VERSIONS, SUPPORTED_HOST_API_VERSIONS,
    SUPPORTED_PRELABEL_API_VERSIONS,
};

pub const MAX_NDJSON_LINE_BYTES: usize = 16 * 1024 * 1024;
// Exporter processes have a capability-scoped transport allowance so one
// 50 MiB file still fits after Base64 encoding without weakening the v1 baseline.
pub const MAX_EXPORTER_NDJSON_LINE_BYTES: usize = 72 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolErrorCode {
    ParseError,
    ProtocolError,
    MethodNotFound,
    PermissionDenied,
    Timeout,
    Cancelled,
    InternalError,
    ConfigMigrationRequired,
    InvalidArgument,
    ApiVersionUnsupported,
}

pub const ALL_PROTOCOL_ERROR_CODES: [ProtocolErrorCode; 10] = [
    ProtocolErrorCode::ParseError,
    ProtocolErrorCode::ProtocolError,
    ProtocolErrorCode::MethodNotFound,
    ProtocolErrorCode::PermissionDenied,
    ProtocolErrorCode::Timeout,
    ProtocolErrorCode::Cancelled,
    ProtocolErrorCode::InternalError,
    ProtocolErrorCode::ConfigMigrationRequired,
    ProtocolErrorCode::InvalidArgument,
    ProtocolErrorCode::ApiVersionUnsupported,
];

impl ProtocolErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ParseError => "PARSE_ERROR",
            Self::ProtocolError => "PROTOCOL_ERROR",
            Self::MethodNotFound => "METHOD_NOT_FOUND",
            Self::PermissionDenied => "PERMISSION_DENIED",
            Self::Timeout => "TIMEOUT",
            Self::Cancelled => "CANCELLED",
            Self::InternalError => "INTERNAL_ERROR",
            Self::ConfigMigrationRequired => "CONFIG_MIGRATION_REQUIRED",
            Self::InvalidArgument => "INVALID_ARGUMENT",
            Self::ApiVersionUnsupported => "API_VERSION_UNSUPPORTED",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        ALL_PROTOCOL_ERROR_CODES
            .into_iter()
            .find(|code| code.as_str() == value)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolError {
    pub code: ProtocolErrorCode,
    pub message: String,
    pub data: Option<Value>,
}

impl ProtocolError {
    pub fn new(code: ProtocolErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Progress,
    Log,
}

impl EventKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Progress => "progress",
            Self::Log => "log",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "progress" => Some(Self::Progress),
            "log" => Some(Self::Log),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlAction {
    Cancel,
    Heartbeat,
}

impl ControlAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cancel => "cancel",
            Self::Heartbeat => "heartbeat",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "cancel" => Some(Self::Cancel),
            "heartbeat" => Some(Self::Heartbeat),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResponseOutcome {
    Result(Value),
    Error(ProtocolError),
}

#[derive(Debug, Clone, PartialEq)]
pub enum PluginMessage {
    Request {
        v: u32,
        id: Option<String>,
        method: String,
        params: Value,
    },
    Response {
        v: u32,
        id: Option<String>,
        outcome: ResponseOutcome,
    },
    Event {
        v: u32,
        id: Option<String>,
        event: EventKind,
        payload: Value,
    },
    Control {
        v: u32,
        id: Option<String>,
        action: ControlAction,
    },
}

pub fn encode_message(message: &PluginMessage) -> Result<String, ProtocolError> {
    encode_message_with_limit(message, MAX_NDJSON_LINE_BYTES)
}

pub fn encode_message_with_limit(
    message: &PluginMessage,
    max_line_bytes: usize,
) -> Result<String, ProtocolError> {
    validate_message(message)?;
    let encoded = serde_json::to_string(&message_value(message)).map_err(|error| {
        ProtocolError::new(
            ProtocolErrorCode::InternalError,
            text::plugin_protocol_serialize_failed(error),
        )
    })?;
    if encoded.len() > max_line_bytes {
        Err(line_too_long(max_line_bytes))
    } else {
        Ok(encoded)
    }
}

pub fn decode_message(line: &[u8]) -> Result<PluginMessage, ProtocolError> {
    decode_message_with_limit(line, MAX_NDJSON_LINE_BYTES)
}

fn decode_message_with_limit(
    line: &[u8],
    max_line_bytes: usize,
) -> Result<PluginMessage, ProtocolError> {
    if line.len() > max_line_bytes {
        return Err(line_too_long(max_line_bytes));
    }
    let value = serde_json::from_slice::<Value>(line).map_err(|error| {
        ProtocolError::new(
            ProtocolErrorCode::ParseError,
            text::plugin_protocol_parse_failed(error),
        )
    })?;
    let object = value.as_object().ok_or_else(protocol_shape_error)?;
    decode_object(object)
}

fn decode_object(object: &Map<String, Value>) -> Result<PluginMessage, ProtocolError> {
    let version = required_u32(object, "v")?;
    if version != PLUGIN_PROTOCOL_VERSION {
        return Err(ProtocolError::new(
            ProtocolErrorCode::ProtocolError,
            text::plugin_protocol_envelope_version_unsupported(version),
        ));
    }
    let id = required_id(object)?;
    match required_string(object, "type")?.as_str() {
        "request" => decode_request(object, version, id),
        "response" => decode_response(object, version, id),
        "event" => decode_event(object, version, id),
        "control" => decode_control(object, version, id),
        _ => Err(protocol_field_error("type")),
    }
}

fn decode_request(
    object: &Map<String, Value>,
    v: u32,
    id: Option<String>,
) -> Result<PluginMessage, ProtocolError> {
    require_call_id(&id, "request.id")?;
    let method = required_string(object, "method")?;
    if method.is_empty() {
        return Err(protocol_field_error("method"));
    }
    let params = object
        .get("params")
        .cloned()
        .ok_or_else(|| protocol_field_error("params"))?;
    Ok(PluginMessage::Request {
        v,
        id,
        method,
        params,
    })
}

fn decode_response(
    object: &Map<String, Value>,
    v: u32,
    id: Option<String>,
) -> Result<PluginMessage, ProtocolError> {
    require_call_id(&id, "response.id")?;
    let outcome = match (object.get("result"), object.get("error")) {
        (Some(result), None) => ResponseOutcome::Result(result.clone()),
        (None, Some(error)) => ResponseOutcome::Error(decode_error(error)?),
        _ => return Err(protocol_field_error("response.result/error")),
    };
    Ok(PluginMessage::Response { v, id, outcome })
}

fn decode_event(
    object: &Map<String, Value>,
    v: u32,
    id: Option<String>,
) -> Result<PluginMessage, ProtocolError> {
    require_call_id(&id, "event.id")?;
    let event = EventKind::parse(&required_string(object, "event")?)
        .ok_or_else(|| protocol_field_error("event"))?;
    let payload = object
        .get("payload")
        .cloned()
        .ok_or_else(|| protocol_field_error("payload"))?;
    validate_event_payload(event, &payload)?;
    Ok(PluginMessage::Event {
        v,
        id,
        event,
        payload,
    })
}

fn decode_control(
    object: &Map<String, Value>,
    v: u32,
    id: Option<String>,
) -> Result<PluginMessage, ProtocolError> {
    let action = ControlAction::parse(&required_string(object, "action")?)
        .ok_or_else(|| protocol_field_error("action"))?;
    if action == ControlAction::Cancel {
        require_call_id(&id, "control.cancel.id")?;
    }
    Ok(PluginMessage::Control { v, id, action })
}

fn decode_error(value: &Value) -> Result<ProtocolError, ProtocolError> {
    let object = value
        .as_object()
        .ok_or_else(|| protocol_field_error("error"))?;
    let code = ProtocolErrorCode::parse(&required_string(object, "code")?)
        .ok_or_else(|| protocol_field_error("error.code"))?;
    let message = required_string(object, "message")?;
    if message.is_empty() {
        return Err(protocol_field_error("error.message"));
    }
    Ok(ProtocolError {
        code,
        message,
        data: object.get("data").cloned(),
    })
}

fn validate_message(message: &PluginMessage) -> Result<(), ProtocolError> {
    let (version, id) = match message {
        PluginMessage::Request { v, id, .. }
        | PluginMessage::Response { v, id, .. }
        | PluginMessage::Event { v, id, .. }
        | PluginMessage::Control { v, id, .. } => (*v, id),
    };
    if version != PLUGIN_PROTOCOL_VERSION {
        return Err(protocol_field_error("v"));
    }
    if id.as_ref().is_some_and(String::is_empty) {
        return Err(protocol_field_error("id"));
    }
    match message {
        PluginMessage::Request { id, method, .. } => {
            require_call_id(id, "request.id")?;
            if method.is_empty() {
                return Err(protocol_field_error("method"));
            }
        }
        PluginMessage::Response { id, outcome, .. } => {
            require_call_id(id, "response.id")?;
            if let ResponseOutcome::Error(error) = outcome {
                if error.message.is_empty() {
                    return Err(protocol_field_error("error.message"));
                }
            }
        }
        PluginMessage::Event {
            id, event, payload, ..
        } => {
            require_call_id(id, "event.id")?;
            validate_event_payload(*event, payload)?;
        }
        PluginMessage::Control { id, action, .. } if *action == ControlAction::Cancel => {
            require_call_id(id, "control.cancel.id")?;
        }
        PluginMessage::Control { .. } => {}
    }
    Ok(())
}

fn validate_event_payload(event: EventKind, payload: &Value) -> Result<(), ProtocolError> {
    let object = payload
        .as_object()
        .ok_or_else(|| protocol_field_error("payload"))?;
    if event == EventKind::Progress
        && object
            .get("percent")
            .is_some_and(|percent| !percent.is_number())
    {
        return Err(protocol_field_error("payload.percent"));
    }
    Ok(())
}

fn message_value(message: &PluginMessage) -> Value {
    let mut object = Map::new();
    match message {
        PluginMessage::Request {
            v,
            id,
            method,
            params,
        } => {
            insert_envelope(&mut object, *v, id, "request");
            object.insert("method".to_string(), Value::String(method.clone()));
            object.insert("params".to_string(), params.clone());
        }
        PluginMessage::Response { v, id, outcome } => {
            insert_envelope(&mut object, *v, id, "response");
            match outcome {
                ResponseOutcome::Result(result) => {
                    object.insert("result".to_string(), result.clone());
                }
                ResponseOutcome::Error(error) => {
                    object.insert("error".to_string(), error_value(error));
                }
            }
        }
        PluginMessage::Event {
            v,
            id,
            event,
            payload,
        } => {
            insert_envelope(&mut object, *v, id, "event");
            object.insert(
                "event".to_string(),
                Value::String(event.as_str().to_string()),
            );
            object.insert("payload".to_string(), payload.clone());
        }
        PluginMessage::Control { v, id, action } => {
            insert_envelope(&mut object, *v, id, "control");
            object.insert(
                "action".to_string(),
                Value::String(action.as_str().to_string()),
            );
        }
    }
    Value::Object(object)
}

fn insert_envelope(object: &mut Map<String, Value>, v: u32, id: &Option<String>, kind: &str) {
    object.insert("v".to_string(), Value::from(v));
    object.insert(
        "id".to_string(),
        id.as_ref()
            .map_or(Value::Null, |id| Value::String(id.clone())),
    );
    object.insert("type".to_string(), Value::String(kind.to_string()));
}

fn error_value(error: &ProtocolError) -> Value {
    let mut object = Map::new();
    object.insert(
        "code".to_string(),
        Value::String(error.code.as_str().to_string()),
    );
    object.insert("message".to_string(), Value::String(error.message.clone()));
    if let Some(data) = &error.data {
        object.insert("data".to_string(), data.clone());
    }
    Value::Object(object)
}

fn required_u32(object: &Map<String, Value>, field: &str) -> Result<u32, ProtocolError> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| protocol_field_error(field))
}

fn required_string(object: &Map<String, Value>, field: &str) -> Result<String, ProtocolError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| protocol_field_error(field))
}

fn required_id(object: &Map<String, Value>) -> Result<Option<String>, ProtocolError> {
    match object.get("id") {
        Some(Value::Null) => Ok(None),
        Some(Value::String(id)) if !id.is_empty() => Ok(Some(id.clone())),
        _ => Err(protocol_field_error("id")),
    }
}

fn require_call_id(id: &Option<String>, field: &str) -> Result<(), ProtocolError> {
    if id.as_ref().is_some_and(|id| !id.is_empty()) {
        Ok(())
    } else {
        Err(protocol_field_error(field))
    }
}

fn protocol_shape_error() -> ProtocolError {
    ProtocolError::new(
        ProtocolErrorCode::ProtocolError,
        text::PLUGIN_PROTOCOL_ENVELOPE_MUST_BE_OBJECT,
    )
}

fn protocol_field_error(field: &str) -> ProtocolError {
    ProtocolError::new(
        ProtocolErrorCode::ProtocolError,
        text::plugin_protocol_field_invalid(field),
    )
}

fn line_too_long(max_line_bytes: usize) -> ProtocolError {
    ProtocolError::new(
        ProtocolErrorCode::ProtocolError,
        text::plugin_protocol_line_too_long(max_line_bytes),
    )
}

#[derive(Debug)]
pub struct NdjsonDecoder {
    line: Vec<u8>,
    discarding_oversized_line: bool,
    max_line_bytes: usize,
}

impl Default for NdjsonDecoder {
    fn default() -> Self {
        Self::with_max_line_bytes(MAX_NDJSON_LINE_BYTES)
    }
}

impl NdjsonDecoder {
    pub fn with_max_line_bytes(max_line_bytes: usize) -> Self {
        Self {
            line: Vec::new(),
            discarding_oversized_line: false,
            max_line_bytes,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<Result<PluginMessage, ProtocolError>> {
        let mut messages = Vec::new();
        for byte in chunk {
            if self.discarding_oversized_line {
                if *byte == b'\n' {
                    self.discarding_oversized_line = false;
                }
                continue;
            }
            if *byte == b'\n' {
                messages.push(self.decode_buffered_line());
                continue;
            }
            if self.line.len() == self.max_line_bytes {
                if *byte == b'\r' {
                    self.line.push(*byte);
                    continue;
                }
                self.line.clear();
                self.discarding_oversized_line = true;
                messages.push(Err(line_too_long(self.max_line_bytes)));
                continue;
            }
            if self.line.len() > self.max_line_bytes {
                self.line.clear();
                self.discarding_oversized_line = true;
                messages.push(Err(line_too_long(self.max_line_bytes)));
                continue;
            }
            self.line.push(*byte);
        }
        messages
    }

    pub fn finish(&mut self) -> Vec<Result<PluginMessage, ProtocolError>> {
        if self.discarding_oversized_line {
            self.discarding_oversized_line = false;
            self.line.clear();
            return Vec::new();
        }
        if self.line.is_empty() {
            return Vec::new();
        }
        if self.line.len() > self.max_line_bytes {
            self.line.clear();
            return vec![Err(line_too_long(self.max_line_bytes))];
        }
        vec![self.decode_buffered_line()]
    }

    fn decode_buffered_line(&mut self) -> Result<PluginMessage, ProtocolError> {
        if self.line.last() == Some(&b'\r') {
            self.line.pop();
        }
        let decoded = decode_message_with_limit(&self.line, self.max_line_bytes);
        self.line.clear();
        decoded
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportedApiVersions {
    pub host_api: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exporter: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prelabel: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NegotiatedCapabilities {
    pub exporter: bool,
    pub prelabel: bool,
    pub batch: bool,
    pub progress: bool,
    pub cancel: bool,
    pub config_migration: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NegotiatedSession {
    pub protocol_version: u32,
    pub capabilities: NegotiatedCapabilities,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginHelloResult {
    protocol_version: u32,
    #[serde(default)]
    capabilities: NegotiatedCapabilities,
}

pub fn host_hello_request(id: impl Into<String>) -> PluginMessage {
    let supported_versions = SupportedApiVersions {
        host_api: SUPPORTED_HOST_API_VERSIONS.to_vec(),
        exporter: Some(SUPPORTED_EXPORTER_API_VERSIONS.to_vec()),
        prelabel: Some(SUPPORTED_PRELABEL_API_VERSIONS.to_vec()),
    };
    PluginMessage::Request {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some(id.into()),
        method: "hello".to_string(),
        params: serde_json::json!({
            "protocolVersion": PLUGIN_PROTOCOL_VERSION,
            "hostApiVersion": CURRENT_HOST_API_VERSION,
            "supportedVersions": supported_versions,
        }),
    }
}

pub fn negotiate_hello_response(
    response: &PluginMessage,
    expected_id: &str,
) -> Result<NegotiatedSession, ProtocolError> {
    let PluginMessage::Response { v, id, outcome } = response else {
        return Err(protocol_field_error("hello.response.type"));
    };
    if *v != PLUGIN_PROTOCOL_VERSION {
        return Err(protocol_field_error("hello.response.v"));
    }
    if id.as_deref() != Some(expected_id) {
        return Err(protocol_field_error("hello.response.id"));
    }
    let result = match outcome {
        ResponseOutcome::Result(result) => result.clone(),
        ResponseOutcome::Error(error) => return Err(error.clone()),
    };
    let hello = serde_json::from_value::<PluginHelloResult>(result)
        .map_err(|_| protocol_field_error("hello.response.result"))?;
    if hello.protocol_version != PLUGIN_PROTOCOL_VERSION {
        return Err(ProtocolError::new(
            ProtocolErrorCode::ApiVersionUnsupported,
            text::plugin_protocol_hello_version_unsupported(
                hello.protocol_version,
                PLUGIN_PROTOCOL_VERSION,
            ),
        ));
    }
    Ok(NegotiatedSession {
        protocol_version: hello.protocol_version,
        capabilities: hello.capabilities,
    })
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
