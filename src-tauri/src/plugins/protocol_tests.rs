use super::*;
use serde_json::json;

fn request() -> PluginMessage {
    PluginMessage::Request {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("7".to_string()),
        method: "export.run".to_string(),
        params: json!({ "format": "yolo" }),
    }
}

fn assert_round_trip(message: PluginMessage) {
    let encoded = encode_message(&message).expect("encode protocol message");
    let decoded = decode_message(encoded.as_bytes()).expect("decode protocol message");
    assert_eq!(decoded, message);
}

#[test]
fn four_message_shapes_round_trip_as_ndjson_objects() {
    assert_round_trip(request());
    assert_round_trip(PluginMessage::Response {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("7".to_string()),
        outcome: ResponseOutcome::Result(json!({ "written": 3 })),
    });
    assert_round_trip(PluginMessage::Response {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("8".to_string()),
        outcome: ResponseOutcome::Error(
            ProtocolError::new(ProtocolErrorCode::InvalidArgument, "参数错误")
                .with_data(json!({ "field": "outputDir" })),
        ),
    });
    assert_round_trip(PluginMessage::Event {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("7".to_string()),
        event: EventKind::Log,
        payload: json!({ "level": "info", "message": "ready" }),
    });
    assert_round_trip(PluginMessage::Control {
        v: PLUGIN_PROTOCOL_VERSION,
        id: None,
        action: ControlAction::Heartbeat,
    });
}

#[test]
fn parser_produces_only_parse_or_protocol_errors() {
    assert_eq!(
        decode_message(br#"{"v":1,"id":null,"type":"request""#)
            .unwrap_err()
            .code,
        ProtocolErrorCode::ParseError
    );
    assert_eq!(
        decode_message(br#"[1,2,3]"#).unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
    assert_eq!(
        decode_message(&[0xff, b'\n']).unwrap_err().code,
        ProtocolErrorCode::ParseError
    );
    assert_eq!(
        decode_message(br#"{"id":"1","type":"request","method":"hello","params":{}}"#)
            .unwrap_err()
            .code,
        ProtocolErrorCode::ProtocolError
    );
    assert_eq!(
        decode_message(br#"{"v":1,"id":"1","type":"mystery"}"#)
            .unwrap_err()
            .code,
        ProtocolErrorCode::ProtocolError
    );
}

#[test]
fn message_specific_validation_rejects_ambiguous_or_unknown_shapes() {
    let both = br#"{"v":1,"id":"1","type":"response","result":{},"error":{"code":"INTERNAL_ERROR","message":"bad"}}"#;
    assert_eq!(
        decode_message(both).unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
    let neither = br#"{"v":1,"id":"1","type":"response"}"#;
    assert_eq!(
        decode_message(neither).unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
    let unknown_event = br#"{"v":1,"id":"1","type":"event","event":"metric","payload":{}}"#;
    assert_eq!(
        decode_message(unknown_event).unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
    let unknown_control = br#"{"v":1,"id":null,"type":"control","action":"stop"}"#;
    assert_eq!(
        decode_message(unknown_control).unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
}

#[test]
fn progress_accepts_optional_percent_and_cancel_targets_a_request_id() {
    assert_round_trip(PluginMessage::Event {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("job-1".to_string()),
        event: EventKind::Progress,
        payload: json!({ "message": "starting" }),
    });
    assert_round_trip(PluginMessage::Event {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("job-1".to_string()),
        event: EventKind::Progress,
        payload: json!({ "percent": 42.5, "message": "working" }),
    });
    assert_round_trip(PluginMessage::Control {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("job-1".to_string()),
        action: ControlAction::Cancel,
    });

    let missing_cancel_id = br#"{"v":1,"id":null,"type":"control","action":"cancel"}"#;
    assert_eq!(
        decode_message(missing_cancel_id).unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
    let bad_percent =
        br#"{"v":1,"id":"job-1","type":"event","event":"progress","payload":{"percent":"half"}}"#;
    assert_eq!(
        decode_message(bad_percent).unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
}

#[test]
fn oversized_line_is_discarded_and_the_next_line_is_decoded() {
    let valid = encode_message(&request()).unwrap();
    let mut input = vec![b'x'; MAX_NDJSON_LINE_BYTES + 1];
    input.push(b'\n');
    input.extend_from_slice(valid.as_bytes());
    input.push(b'\n');

    let mut decoder = NdjsonDecoder::default();
    let decoded = decoder.push(&input);
    assert_eq!(decoded.len(), 2);
    assert_eq!(
        decoded[0].as_ref().unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
    assert_eq!(decoded[1].as_ref().unwrap(), &request());
    assert!(decoder.finish().is_empty());
}

#[test]
fn encoder_enforces_baseline_and_capability_scoped_line_limits() {
    let message = PluginMessage::Request {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("large".to_string()),
        method: "exporter.export".to_string(),
        params: json!({ "padding": "x".repeat(MAX_NDJSON_LINE_BYTES) }),
    };
    assert_eq!(
        encode_message(&message).expect_err("baseline limit").code,
        ProtocolErrorCode::ProtocolError
    );
    let encoded = encode_message_with_limit(&message, MAX_EXPORTER_NDJSON_LINE_BYTES)
        .expect("exporter-scoped limit");
    assert!(encoded.len() > MAX_NDJSON_LINE_BYTES);
    assert!(encoded.len() <= MAX_EXPORTER_NDJSON_LINE_BYTES);
    let mut decoder = NdjsonDecoder::with_max_line_bytes(MAX_EXPORTER_NDJSON_LINE_BYTES);
    assert_eq!(decoder.push(encoded.as_bytes()), Vec::new());
    assert_eq!(decoder.finish(), vec![Ok(message)]);
}

#[test]
fn a_valid_line_at_the_exact_size_limit_is_accepted() {
    let prefix = br#"{"v":1,"id":"limit","type":"request","method":"test","params":{"padding":""#;
    let suffix = br#""}}"#;
    let padding = MAX_NDJSON_LINE_BYTES - prefix.len() - suffix.len();
    let mut line = Vec::with_capacity(MAX_NDJSON_LINE_BYTES);
    line.extend_from_slice(prefix);
    line.extend(std::iter::repeat_n(b'x', padding));
    line.extend_from_slice(suffix);
    assert_eq!(line.len(), MAX_NDJSON_LINE_BYTES);

    let message = decode_message(&line).expect("exact limit line");
    assert!(matches!(message, PluginMessage::Request { .. }));

    line.extend_from_slice(b"\r\n");
    let mut decoder = NdjsonDecoder::default();
    let framed = decoder.push(&line);
    assert_eq!(framed.len(), 1);
    assert!(matches!(framed[0], Ok(PluginMessage::Request { .. })));

    line.pop();
    let mut decoder = NdjsonDecoder::default();
    assert!(decoder.push(&line).is_empty());
    assert_eq!(
        decoder.finish()[0].as_ref().unwrap_err().code,
        ProtocolErrorCode::ProtocolError
    );
}

#[test]
fn decoder_handles_chunk_boundaries_crlf_and_unterminated_final_lines() {
    let first = encode_message(&request()).unwrap();
    let heartbeat = encode_message(&PluginMessage::Control {
        v: PLUGIN_PROTOCOL_VERSION,
        id: None,
        action: ControlAction::Heartbeat,
    })
    .unwrap();
    let split = first.len() / 2;
    let mut decoder = NdjsonDecoder::default();
    assert!(decoder.push(&first.as_bytes()[..split]).is_empty());
    let mut tail = first.as_bytes()[split..].to_vec();
    tail.extend_from_slice(b"\r\n");
    assert_eq!(decoder.push(&tail), vec![Ok(request())]);
    assert!(decoder.push(heartbeat.as_bytes()).is_empty());
    assert_eq!(
        decoder.finish(),
        vec![Ok(PluginMessage::Control {
            v: PLUGIN_PROTOCOL_VERSION,
            id: None,
            action: ControlAction::Heartbeat,
        })]
    );
}

#[test]
fn all_ten_standard_error_codes_are_stable_and_documented() {
    let expected = [
        "PARSE_ERROR",
        "PROTOCOL_ERROR",
        "METHOD_NOT_FOUND",
        "PERMISSION_DENIED",
        "TIMEOUT",
        "CANCELLED",
        "INTERNAL_ERROR",
        "CONFIG_MIGRATION_REQUIRED",
        "INVALID_ARGUMENT",
        "API_VERSION_UNSUPPORTED",
    ];
    assert_eq!(
        ALL_PROTOCOL_ERROR_CODES.map(ProtocolErrorCode::as_str),
        expected
    );
    let docs = include_str!("../../../docs/plugin-protocol.md");
    for code in expected {
        assert!(docs.contains(code), "protocol docs omit {code}");
    }

    let schema: serde_json::Value =
        serde_json::from_str(include_str!("../../../docs/plugin-protocol.schema.json"))
            .expect("protocol JSON Schema");
    let schema_codes = schema["$defs"]["errorCode"]["enum"]
        .as_array()
        .expect("error code enum")
        .iter()
        .map(|value| value.as_str().expect("string error code"))
        .collect::<Vec<_>>();
    assert_eq!(schema_codes, expected);
    assert_eq!(
        schema["$defs"]["request"]["properties"]["v"]["const"],
        PLUGIN_PROTOCOL_VERSION
    );
    assert_eq!(schema["$defs"]["fsReadParams"]["required"], json!(["path"]));
    assert_eq!(
        schema["$defs"]["fsWriteParams"]["required"],
        json!(["path", "contentUtf8"])
    );
    let schema_message_types = schema["oneOf"]
        .as_array()
        .expect("message variants")
        .iter()
        .map(|variant| {
            variant["$ref"]
                .as_str()
                .expect("variant ref")
                .rsplit('/')
                .next()
                .expect("variant name")
        })
        .collect::<Vec<_>>();
    assert_eq!(
        schema_message_types,
        ["request", "response", "event", "control"]
    );
}

#[test]
fn hello_declares_supported_versions_and_caches_only_actual_capabilities() {
    let hello = host_hello_request("hello-1");
    let PluginMessage::Request { method, params, .. } = hello else {
        panic!("hello must be a request")
    };
    assert_eq!(method, "hello");
    assert_eq!(params["protocolVersion"], 1);
    assert_eq!(params["hostApiVersion"], 1);
    assert_eq!(params["supportedVersions"]["hostApi"], json!([1]));

    let response = PluginMessage::Response {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("hello-1".to_string()),
        outcome: ResponseOutcome::Result(json!({
            "protocolVersion": 1,
            "capabilities": {
                "exporter": true,
                "progress": true
            }
        })),
    };
    let session = negotiate_hello_response(&response, "hello-1").expect("hello negotiation");
    assert!(session.capabilities.exporter);
    assert!(session.capabilities.progress);
    assert!(!session.capabilities.prelabel);
    assert!(!session.capabilities.cancel);
    assert!(!session.capabilities.config_migration);
}

#[test]
fn hello_rejects_wrong_ids_versions_and_plugin_errors() {
    let wrong_envelope = PluginMessage::Response {
        v: 2,
        id: Some("hello-1".to_string()),
        outcome: ResponseOutcome::Result(json!({
            "protocolVersion": 1,
            "capabilities": {}
        })),
    };
    assert_eq!(
        negotiate_hello_response(&wrong_envelope, "hello-1")
            .unwrap_err()
            .code,
        ProtocolErrorCode::ProtocolError
    );

    let wrong_version = PluginMessage::Response {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("hello-1".to_string()),
        outcome: ResponseOutcome::Result(json!({
            "protocolVersion": 2,
            "capabilities": {}
        })),
    };
    assert_eq!(
        negotiate_hello_response(&wrong_version, "hello-1")
            .unwrap_err()
            .code,
        ProtocolErrorCode::ApiVersionUnsupported
    );

    let wrong_id = PluginMessage::Response {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("other".to_string()),
        outcome: ResponseOutcome::Result(json!({
            "protocolVersion": 1,
            "capabilities": {}
        })),
    };
    assert_eq!(
        negotiate_hello_response(&wrong_id, "hello-1")
            .unwrap_err()
            .code,
        ProtocolErrorCode::ProtocolError
    );

    let plugin_error = ProtocolError::new(
        ProtocolErrorCode::ApiVersionUnsupported,
        "插件不支持宿主 API v1",
    );
    let rejected = PluginMessage::Response {
        v: PLUGIN_PROTOCOL_VERSION,
        id: Some("hello-1".to_string()),
        outcome: ResponseOutcome::Error(plugin_error.clone()),
    };
    assert_eq!(
        negotiate_hello_response(&rejected, "hello-1").unwrap_err(),
        plugin_error
    );
}
