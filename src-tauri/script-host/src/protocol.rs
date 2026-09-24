use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, Read, Write};

pub const VERSION: u32 = 1;
pub const MAX_LINE: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub max_memory_mi_b: u64,
    pub timeout_seconds: u64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub labels: Vec<Value>,
    pub images: Vec<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
}
impl Failure {
    pub fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
            image_path: None,
        }
    }
}
pub type Result<T> = std::result::Result<T, Failure>;

pub fn read_line(input: &mut impl BufRead) -> Result<Option<Value>> {
    let mut bytes = Vec::new();
    let n = (&mut *input)
        .take((MAX_LINE + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| Failure::new("PROTOCOL_ERROR", e))?;
    if n == 0 {
        return Ok(None);
    }
    if n > MAX_LINE {
        return Err(Failure::new("LINE_LIMIT", "NDJSON"));
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| Failure::new("PARSE_ERROR", e))
}
pub fn write_line(output: &mut impl Write, value: &Value) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|e| Failure::new("PROTOCOL_ERROR", e))?;
    if bytes.len() + 1 > MAX_LINE {
        return Err(Failure::new("LINE_LIMIT", "NDJSON"));
    }
    output
        .write_all(&bytes)
        .and_then(|_| output.write_all(b"\n"))
        .and_then(|_| output.flush())
        .map_err(|e| Failure::new("PROTOCOL_ERROR", e))
}

/// Unknown envelope fields are ignored; unknown operations and malformed parameters fail.
pub fn receive(
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> Result<(Snapshot, String, Limits)> {
    receive_with_init(input, output, |_| Ok(()))
}

pub fn receive_with_init(
    input: &mut impl BufRead,
    output: &mut impl Write,
    init: impl FnOnce(&Limits) -> Result<()>,
) -> Result<(Snapshot, String, Limits)> {
    let hello = read_line(input)?.ok_or_else(|| Failure::new("PROTOCOL_ERROR", "hello"))?;
    if hello["op"] != "hello" || hello["version"] != VERSION {
        return Err(Failure::new("VERSION_UNSUPPORTED", "hello"));
    }
    let limits: Limits = serde_json::from_value(hello["limits"].clone())
        .map_err(|e| Failure::new("INVALID_ARGUMENT", e))?;
    crate::limits::validate(&limits)?;
    init(&limits)?;
    write_line(output, &json!({"event":"ready", "version":VERSION}))?;
    let mut snapshot = Snapshot::default();
    loop {
        let message = read_line(input)?.ok_or_else(|| Failure::new("PROTOCOL_ERROR", "EOF"))?;
        match message["op"].as_str() {
            Some("section") => {
                let values = message["items"]
                    .as_array()
                    .ok_or_else(|| Failure::new("INVALID_ARGUMENT", "items"))?;
                match message["name"].as_str() {
                    Some("labels") => snapshot.labels.extend(values.iter().cloned()),
                    Some("images") => snapshot.images.extend(values.iter().cloned()),
                    _ => return Err(Failure::new("INVALID_ARGUMENT", "section")),
                }
            }
            Some("execute") => {
                return Ok((
                    snapshot,
                    message["source"]
                        .as_str()
                        .ok_or_else(|| Failure::new("INVALID_ARGUMENT", "source"))?
                        .into(),
                    limits,
                ))
            }
            _ => return Err(Failure::new("METHOD_NOT_FOUND", "op")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contract_negotiates_ignores_extensions_and_rejects_bad_commands() {
        let hello = "{\"op\":\"hello\",\"version\":1,\"future\":true,\"limits\":{\"maxMemoryMiB\":256,\"timeoutSeconds\":30}}\n";
        for (tail, expected) in [
            ("{\"op\":\"wat\"}\n", "METHOD_NOT_FOUND"),
            (
                "{\"op\":\"section\",\"name\":\"images\",\"items\":0}\n",
                "INVALID_ARGUMENT",
            ),
        ] {
            assert_eq!(
                receive(&mut format!("{hello}{tail}").as_bytes(), &mut Vec::new())
                    .unwrap_err()
                    .code,
                expected
            );
        }
        assert!(receive(
            &mut format!("{hello}{{\"op\":\"execute\",\"source\":\"\",\"future\":1}}\n").as_bytes(),
            &mut Vec::new()
        )
        .is_ok());
    }
}
