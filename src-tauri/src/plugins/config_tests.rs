use super::config::{
    migrate_configs_with, MigrationCallError, PluginConfig, PluginConfigMigrationParams,
    PluginConfigMigrationResult, PluginConfigTarget,
};
use serde_json::{json, Value};

fn config(plugin_id: &str, config_version: u32, value: Value) -> PluginConfig {
    PluginConfig {
        plugin_id: plugin_id.to_string(),
        config_version,
        config: value,
    }
}

fn target(plugin_id: &str, config_version: u32, config_migration: bool) -> PluginConfigTarget {
    PluginConfigTarget {
        plugin_id: plugin_id.to_string(),
        config_version,
        config_migration,
        pending_migration: false,
    }
}

#[test]
fn migration_contract_uses_the_public_camel_case_fields() {
    let params = PluginConfigMigrationParams {
        from_version: 1,
        to_version: 2,
        config: json!({ "opaque": true }),
    };
    assert_eq!(
        serde_json::to_value(params).expect("serialize params"),
        json!({ "fromVersion": 1, "toVersion": 2, "config": { "opaque": true } })
    );
    let result: PluginConfigMigrationResult = serde_json::from_value(json!({
        "configVersion": 2,
        "config": null
    }))
    .expect("deserialize result");
    assert_eq!(result.config_version, 2);
    assert_eq!(result.config, Value::Null);
}

#[test]
fn migrates_each_version_in_order_and_preserves_uninstalled_configs() {
    let mut calls = Vec::new();
    let report = migrate_configs_with(
        vec![
            config("dev.test.migrating", 1, json!({ "steps": [] })),
            config("dev.test.uninstalled", 7, json!({ "keep": true })),
        ],
        &[target("dev.test.migrating", 3, true)],
        |plugin_id, from_version, to_version, value| {
            calls.push((
                plugin_id.to_string(),
                from_version,
                to_version,
                value.clone(),
            ));
            let mut steps = value["steps"].as_array().cloned().unwrap_or_default();
            steps.push(json!(to_version));
            Ok(json!({
                "configVersion": to_version,
                "config": { "steps": steps }
            }))
        },
    );

    assert_eq!(
        calls,
        vec![
            (
                "dev.test.migrating".to_string(),
                1,
                2,
                json!({ "steps": [] })
            ),
            (
                "dev.test.migrating".to_string(),
                2,
                3,
                json!({ "steps": [2] })
            ),
        ]
    );
    assert_eq!(
        report.configs[0],
        config("dev.test.migrating", 3, json!({ "steps": [2, 3] }))
    );
    assert_eq!(
        report.configs[1],
        config("dev.test.uninstalled", 7, json!({ "keep": true }))
    );
    assert_eq!(report.unavailable_plugin_ids, ["dev.test.uninstalled"]);
    assert!(report.pending_plugin_ids.is_empty());
    assert!(report.issues.is_empty());
}

#[test]
fn marks_missing_capability_and_newer_project_config_pending_without_calling() {
    let report = migrate_configs_with(
        vec![
            config("dev.test.no-capability", 1, json!({})),
            config("dev.test.newer", 4, json!({})),
        ],
        &[
            target("dev.test.no-capability", 2, false),
            target("dev.test.newer", 3, true),
        ],
        |_, _, _, _| panic!("migration call must not be made"),
    );

    assert_eq!(
        report.pending_plugin_ids,
        ["dev.test.no-capability", "dev.test.newer"]
    );
    assert_eq!(report.issues[0].code, "CONFIG_MIGRATION_REQUIRED");
    assert_eq!(report.issues[1].code, "CONFIG_MIGRATION_REQUIRED");
}

#[test]
fn keeps_original_config_when_a_step_fails_or_returns_an_invalid_shape() {
    let original_failure = config("dev.test.failure", 1, json!({ "original": true }));
    let original_invalid = config("dev.test.invalid", 1, json!(["opaque"]));
    let report = migrate_configs_with(
        vec![original_failure.clone(), original_invalid.clone()],
        &[
            target("dev.test.failure", 2, true),
            target("dev.test.invalid", 2, true),
        ],
        |plugin_id, _, _, _| {
            if plugin_id == "dev.test.failure" {
                Err(MigrationCallError {
                    code: "TIMEOUT".to_string(),
                    message: "timed out".to_string(),
                })
            } else {
                Ok(json!({ "configVersion": 99, "config": {} }))
            }
        },
    );

    assert_eq!(report.configs, [original_failure, original_invalid]);
    assert_eq!(
        report.pending_plugin_ids,
        ["dev.test.failure", "dev.test.invalid"]
    );
    assert_eq!(report.issues[0].code, "TIMEOUT");
    assert_eq!(report.issues[1].code, "PROTOCOL_ERROR");
}
