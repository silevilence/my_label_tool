use super::*;
use serde_json::json;

#[test]
fn normalizes_valid_code_plugin_manifest() {
    let result = parse_plugin_manifest(&json!({
        "schemaVersion": 1,
        "id": "dev.acme.exporter",
        "name": "示例导出器",
        "version": "1.0.0",
        "apiVersion": { "min": 1 },
        "extensionKind": "exporter",
        "runtime": "process",
        "entry": { "command": "plugin/main.exe" }
    }));

    assert!(result.ok);
    let manifest = result.value.expect("valid manifest");
    assert_eq!(manifest.entry.expect("entry").args, Vec::<String>::new());
    assert_eq!(manifest.permissions, Vec::<PluginPermission>::new());
    assert_eq!(manifest.config_version, 0);
    assert_eq!(manifest.capabilities.exporter.api_version.min, 1);
}

#[test]
fn collects_manifest_validation_errors() {
    let result = parse_plugin_manifest(&json!({
        "schemaVersion": 7,
        "id": "bad",
        "name": "",
        "version": "v1",
        "extensionKind": "prelabel",
        "runtime": "wasm",
        "entry": { "command": "../main.py" },
        "capabilities": { "annotationTypes": [] },
        "permissions": ["network", "network", "spawn"]
    }));

    assert!(!result.ok);
    let pairs: Vec<_> = result
        .errors
        .iter()
        .map(|error| (error.field.as_str(), error.code.as_str()))
        .collect();
    assert!(pairs.contains(&("schemaVersion", "UNSUPPORTED_VERSION")));
    assert!(pairs.contains(&("id", "INVALID_FORMAT")));
    assert!(pairs.contains(&("apiVersion", "REQUIRED")));
    assert!(pairs.contains(&("runtime", "UNSUPPORTED_RUNTIME")));
    assert!(pairs.contains(&("entry.command", "INVALID_PATH")));
    assert!(pairs.contains(&("capabilities.annotationTypes", "REQUIRED")));
    assert!(pairs.contains(&("permissions[1]", "DUPLICATE")));
    assert!(pairs.contains(&("permissions[2]", "UNKNOWN_PERMISSION")));
    assert!(result.errors.iter().all(|error| !error.reason.is_empty()));
}

#[test]
fn normalized_manifest_serializes_public_camel_case_fields() {
    let result = parse_plugin_manifest(&json!({
        "schemaVersion": 1,
        "id": "dev.acme.labels",
        "name": "标签",
        "version": "1.0.0",
        "apiVersion": { "min": 1 },
        "extensionKind": "label-preset"
    }));
    let serialized = serde_json::to_value(result.value.expect("valid manifest"))
        .expect("serialize normalized manifest");
    let fields: std::collections::HashSet<_> = serialized
        .as_object()
        .expect("manifest object")
        .keys()
        .map(String::as_str)
        .collect();

    assert_eq!(
        fields,
        std::collections::HashSet::from([
            "schemaVersion",
            "id",
            "name",
            "version",
            "apiVersion",
            "extensionKind",
            "capabilities",
            "permissions",
            "configVersion",
        ])
    );
}

#[test]
fn rejects_unsafe_paths_versions_and_permission_placeholders() {
    let cases = [
        (
            json!({ "entry": { "command": "C:outside.exe" } }),
            "entry.command",
            "INVALID_PATH",
        ),
        (
            json!({ "entry": { "command": "plugin//main.exe" } }),
            "entry.command",
            "INVALID_PATH",
        ),
        (
            json!({ "entry": { "command": "plugin/" } }),
            "entry.command",
            "INVALID_PATH",
        ),
        (
            json!({ "version": "1.0.0-01" }),
            "version",
            "INVALID_FORMAT",
        ),
        (
            json!({ "apiVersion": { "min": 1, "max": 2 } }),
            "apiVersion.max",
            "FORBIDDEN",
        ),
        (
            json!({ "apiVersion": { "min": 4_294_967_296_u64 } }),
            "apiVersion.min",
            "INVALID_VERSION",
        ),
        (
            json!({ "permissions": ["fs.read:%HOME%/x"] }),
            "permissions[0]",
            "UNKNOWN_PERMISSION",
        ),
    ];

    for (overrides, expected_field, expected_code) in cases {
        let mut input = json!({
            "schemaVersion": 1,
            "id": "dev.acme.exporter",
            "name": "导出器",
            "version": "1.0.0",
            "apiVersion": { "min": 1 },
            "extensionKind": "exporter",
            "runtime": "process",
            "entry": { "command": "plugin/main.exe" }
        });
        input
            .as_object_mut()
            .expect("manifest object")
            .extend(overrides.as_object().expect("override object").clone());
        let result = parse_plugin_manifest(&input);
        assert!(
            result.errors.iter().any(|error| {
                error.field == expected_field && error.code.as_str() == expected_code
            }),
            "missing {expected_field}:{expected_code} in {:?}",
            result.errors
        );
    }
}

#[test]
fn treats_normalized_permission_targets_as_duplicates() {
    let result = parse_plugin_manifest(&json!({
        "schemaVersion": 1,
        "id": "dev.acme.exporter",
        "name": "导出器",
        "version": "1.0.0",
        "apiVersion": { "min": 1 },
        "extensionKind": "exporter",
        "runtime": "process",
        "entry": { "command": "plugin/main.exe" },
        "permissions": ["fs.read:%PROJECT%/images", "fs.read:%PROJECT%\\images"]
    }));

    assert!(result.errors.iter().any(|error| {
        error.field == "permissions[1]" && error.code == ManifestValidationErrorCode::Duplicate
    }));
}
