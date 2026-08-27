use my_label_tool_lib::plugins::protocol::{
    decode_message, encode_message, host_hello_request, negotiate_hello_response, ControlAction,
    EventKind, PluginMessage, ProtocolErrorCode, ResponseOutcome, ALL_PROTOCOL_ERROR_CODES,
    MAX_NDJSON_LINE_BYTES, PLUGIN_PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

#[test]
fn independent_stub_covers_the_public_protocol_contract() {
    let mut stub = StubProcess::spawn();

    stub.send(host_hello_request("hello-1"));
    let hello = stub.receive();
    let negotiated = negotiate_hello_response(&hello, "hello-1").expect("hello response");
    assert!(negotiated.capabilities.prelabel);
    assert!(negotiated.capabilities.progress);
    assert!(negotiated.capabilities.cancel);

    stub.send(request("run-1", "prelabel.run", json!({})));
    assert!(matches!(
        stub.receive(),
        PluginMessage::Event {
            event: EventKind::Progress,
            ..
        }
    ));
    assert_result(stub.receive(), "run-1", json!({ "annotations": [] }));

    stub.send(request("missing-1", "missing.method", Value::Null));
    assert_error(
        stub.receive(),
        "missing-1",
        ProtocolErrorCode::MethodNotFound,
    );

    stub.send(request("codes-1", "conformance.errorCodes", Value::Null));
    let expected_codes = ALL_PROTOCOL_ERROR_CODES
        .map(|code| Value::String(code.as_str().to_string()))
        .to_vec();
    assert_result(stub.receive(), "codes-1", Value::Array(expected_codes));
    for (index, code) in ALL_PROTOCOL_ERROR_CODES.into_iter().enumerate() {
        let id = format!("error-{index}");
        stub.send(request(
            &id,
            "conformance.raise",
            json!({ "code": code.as_str() }),
        ));
        assert_error(stub.receive(), &id, code);
    }

    stub.send(request(
        "cancel-1",
        "prelabel.run",
        json!({ "waitForCancel": true }),
    ));
    assert!(matches!(stub.receive(), PluginMessage::Event { .. }));
    stub.send(PluginMessage::Control {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("cancel-1".to_string()),
        action: ControlAction::Cancel,
    });
    assert_error(stub.receive(), "cancel-1", ProtocolErrorCode::Cancelled);

    stub.send(PluginMessage::Control {
        v: PLUGIN_PROTOCOL_VERSION,
        id: None,
        action: ControlAction::Heartbeat,
    });
    assert_eq!(
        stub.receive(),
        PluginMessage::Control {
            v: PLUGIN_PROTOCOL_VERSION,
            id: None,
            action: ControlAction::Heartbeat,
        }
    );

    stub.send_raw(b"not-json\n");
    assert_error(
        stub.receive(),
        "conformance-error",
        ProtocolErrorCode::ParseError,
    );
    stub.send_raw(b"{\"v\":1,\"id\":null,\"type\":\"request\"}\n");
    assert_error(
        stub.receive(),
        "conformance-error",
        ProtocolErrorCode::ProtocolError,
    );

    let prefix = br#"{"v":1,"id":"exact-limit","type":"request","method":"missing.method","params":{"padding":""#;
    let suffix = br#""}}"#;
    let padding = MAX_NDJSON_LINE_BYTES - prefix.len() - suffix.len();
    let mut exact_limit = Vec::with_capacity(MAX_NDJSON_LINE_BYTES + 1);
    exact_limit.extend_from_slice(prefix);
    exact_limit.extend(std::iter::repeat_n(b'x', padding));
    exact_limit.extend_from_slice(suffix);
    assert_eq!(exact_limit.len(), MAX_NDJSON_LINE_BYTES);
    exact_limit.push(b'\n');
    stub.send_raw(&exact_limit);
    assert_error(
        stub.receive(),
        "exact-limit",
        ProtocolErrorCode::MethodNotFound,
    );

    let mut oversized = vec![b'x'; MAX_NDJSON_LINE_BYTES + 1];
    oversized.push(b'\n');
    stub.send_raw(&oversized);
    assert_error(
        stub.receive(),
        "conformance-error",
        ProtocolErrorCode::ProtocolError,
    );

    stub.send(request("after-limit", "prelabel.run", json!({})));
    assert!(matches!(stub.receive(), PluginMessage::Event { .. }));
    assert_result(stub.receive(), "after-limit", json!({ "annotations": [] }));
}

fn request(id: &str, method: &str, params: Value) -> PluginMessage {
    PluginMessage::Request {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some(id.to_string()),
        method: method.to_string(),
        params,
    }
}

fn assert_result(message: PluginMessage, expected_id: &str, expected: Value) {
    let PluginMessage::Response { id, outcome, .. } = message else {
        panic!("expected response")
    };
    assert_eq!(id.as_deref(), Some(expected_id));
    assert_eq!(outcome, ResponseOutcome::Result(expected));
}

fn assert_error(message: PluginMessage, expected_id: &str, expected: ProtocolErrorCode) {
    let PluginMessage::Response { id, outcome, .. } = message else {
        panic!("expected error response")
    };
    assert_eq!(id.as_deref(), Some(expected_id));
    let ResponseOutcome::Error(error) = outcome else {
        panic!("expected protocol error")
    };
    assert_eq!(error.code, expected);
}

struct StubProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl StubProcess {
    fn spawn() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_plugin-conformance-stub"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn conformance stub");
        let stdin = child.stdin.take().expect("stub stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stub stdout"));
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn send(&mut self, message: PluginMessage) {
        let mut line = encode_message(&message).expect("encode message");
        line.push('\n');
        self.send_raw(line.as_bytes());
    }

    fn send_raw(&mut self, bytes: &[u8]) {
        self.stdin.write_all(bytes).expect("write stub stdin");
        self.stdin.flush().expect("flush stub stdin");
    }

    fn receive(&mut self) -> PluginMessage {
        let mut line = Vec::new();
        let read = self.stdout.read_until(b'\n', &mut line).expect("read stub");
        assert!(read > 0, "stub exited before response");
        if line.last() == Some(&b'\n') {
            line.pop();
        }
        decode_message(&line).expect("decode stub response")
    }
}

impl Drop for StubProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
