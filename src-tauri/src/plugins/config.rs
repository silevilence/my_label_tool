use crate::i18n::zh_cn as text;
use crate::plugins::registry::{
    complete_plugin_config_migration, load_plugin_registry, mark_plugin_pending_migration,
    PluginState,
};
use crate::plugins::runtime::invoke_plugin_config_migration;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfig {
    pub plugin_id: String,
    pub config_version: u32,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigMigrationParams {
    pub from_version: u32,
    pub to_version: u32,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigMigrationResult {
    pub config_version: u32,
    pub config: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PluginConfigTarget {
    pub plugin_id: String,
    pub config_version: u32,
    pub config_migration: bool,
    pub pending_migration: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MigrationCallError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigMigrationIssue {
    pub plugin_id: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigMigrationReport {
    pub configs: Vec<PluginConfig>,
    pub pending_plugin_ids: Vec<String>,
    pub unavailable_plugin_ids: Vec<String>,
    pub issues: Vec<PluginConfigMigrationIssue>,
}

pub fn migrate_plugin_configs(
    app_data_dir: &Path,
    configs: Vec<PluginConfig>,
) -> PluginConfigMigrationReport {
    let snapshot = load_plugin_registry(app_data_dir);
    if snapshot.warning.is_some() {
        return registry_unavailable_report(configs);
    }

    let targets = snapshot
        .plugins
        .iter()
        .map(|plugin| PluginConfigTarget {
            plugin_id: plugin.id.clone(),
            config_version: plugin.config_version,
            config_migration: plugin.capabilities.config_migration,
            pending_migration: plugin.state == PluginState::PendingMigration,
        })
        .collect::<Vec<_>>();
    let mut report = migrate_configs_with(
        configs,
        &targets,
        |plugin_id, from_version, to_version, config| {
            let params = serde_json::to_value(PluginConfigMigrationParams {
                from_version,
                to_version,
                config,
            })
            .map_err(|error| MigrationCallError {
                code: "INTERNAL_ERROR".to_string(),
                message: text::plugin_config_migration_params_failed(error),
            })?;
            invoke_plugin_config_migration(app_data_dir, plugin_id, params).map_err(|error| {
                MigrationCallError {
                    code: error.code,
                    message: error.message,
                }
            })
        },
    );

    for target in targets {
        let has_project_config = report
            .configs
            .iter()
            .any(|config| config.plugin_id == target.plugin_id);
        if !has_project_config && !target.pending_migration {
            continue;
        }
        if has_project_config && report.pending_plugin_ids.contains(&target.plugin_id) {
            let message = report
                .issues
                .iter()
                .find(|issue| issue.plugin_id == target.plugin_id)
                .map_or(text::PLUGIN_CONFIG_MIGRATION_REQUIRED, |issue| {
                    issue.message.as_str()
                });
            if let Err(error) =
                mark_plugin_pending_migration(app_data_dir, &target.plugin_id, message)
            {
                add_registry_issue(&mut report, &target.plugin_id, error.code, error.message);
            }
        } else if let Err(error) = complete_plugin_config_migration(app_data_dir, &target.plugin_id)
        {
            add_registry_issue(&mut report, &target.plugin_id, error.code, error.message);
        }
    }
    report
}

pub(crate) fn migrate_configs_with(
    configs: Vec<PluginConfig>,
    targets: &[PluginConfigTarget],
    mut invoke: impl FnMut(&str, u32, u32, Value) -> Result<Value, MigrationCallError>,
) -> PluginConfigMigrationReport {
    let targets = targets
        .iter()
        .map(|target| (target.plugin_id.as_str(), target))
        .collect::<HashMap<_, _>>();
    let mut migrated_configs = Vec::with_capacity(configs.len());
    let mut pending_plugin_ids = Vec::new();
    let mut unavailable_plugin_ids = Vec::new();
    let mut issues = Vec::new();

    for original in configs {
        let Some(target) = targets.get(original.plugin_id.as_str()) else {
            unavailable_plugin_ids.push(original.plugin_id.clone());
            migrated_configs.push(original);
            continue;
        };

        if original.config_version == target.config_version {
            migrated_configs.push(original);
            continue;
        }

        if original.config_version > target.config_version {
            pending_plugin_ids.push(original.plugin_id.clone());
            issues.push(issue(
                &original.plugin_id,
                "CONFIG_MIGRATION_REQUIRED",
                text::plugin_config_newer_than_plugin(
                    original.config_version,
                    target.config_version,
                ),
            ));
            migrated_configs.push(original);
            continue;
        }

        if !target.config_migration {
            pending_plugin_ids.push(original.plugin_id.clone());
            issues.push(issue(
                &original.plugin_id,
                "CONFIG_MIGRATION_REQUIRED",
                text::PLUGIN_CONFIG_MIGRATION_CAPABILITY_MISSING.to_string(),
            ));
            migrated_configs.push(original);
            continue;
        }

        let mut next_config = original.config.clone();
        let mut next_version = original.config_version;
        let mut migration_error = None;
        while next_version < target.config_version {
            let to_version = next_version + 1;
            match invoke(
                &original.plugin_id,
                next_version,
                to_version,
                next_config.clone(),
            )
            .and_then(|result| parse_migration_result(result, to_version))
            {
                Ok(config) => {
                    next_config = config;
                    next_version = to_version;
                }
                Err(error) => {
                    migration_error = Some(error);
                    break;
                }
            }
        }

        if let Some(error) = migration_error {
            pending_plugin_ids.push(original.plugin_id.clone());
            issues.push(issue(&original.plugin_id, &error.code, error.message));
            migrated_configs.push(original);
        } else {
            migrated_configs.push(PluginConfig {
                plugin_id: original.plugin_id,
                config_version: next_version,
                config: next_config,
            });
        }
    }

    PluginConfigMigrationReport {
        configs: migrated_configs,
        pending_plugin_ids,
        unavailable_plugin_ids,
        issues,
    }
}

fn parse_migration_result(
    result: Value,
    expected_version: u32,
) -> Result<Value, MigrationCallError> {
    let result = serde_json::from_value::<PluginConfigMigrationResult>(result)
        .map_err(|_| invalid_result())?;
    if result.config_version != expected_version {
        return Err(invalid_result());
    }
    Ok(result.config)
}

fn invalid_result() -> MigrationCallError {
    MigrationCallError {
        code: "PROTOCOL_ERROR".to_string(),
        message: text::PLUGIN_CONFIG_MIGRATION_RESULT_INVALID.to_string(),
    }
}

fn issue(plugin_id: &str, code: &str, message: String) -> PluginConfigMigrationIssue {
    PluginConfigMigrationIssue {
        plugin_id: plugin_id.to_string(),
        code: code.to_string(),
        message,
    }
}

fn registry_unavailable_report(configs: Vec<PluginConfig>) -> PluginConfigMigrationReport {
    let pending_plugin_ids = configs
        .iter()
        .map(|config| config.plugin_id.clone())
        .collect::<Vec<_>>();
    let issues = pending_plugin_ids
        .iter()
        .map(|plugin_id| {
            issue(
                plugin_id,
                "INTERNAL_ERROR",
                text::PLUGIN_CONFIG_REGISTRY_UNAVAILABLE.to_string(),
            )
        })
        .collect();
    PluginConfigMigrationReport {
        configs,
        pending_plugin_ids,
        unavailable_plugin_ids: Vec::new(),
        issues,
    }
}

fn add_registry_issue(
    report: &mut PluginConfigMigrationReport,
    plugin_id: &str,
    code: String,
    message: String,
) {
    if !report
        .pending_plugin_ids
        .iter()
        .any(|pending| pending == plugin_id)
    {
        report.pending_plugin_ids.push(plugin_id.to_string());
    }
    report.issues.push(issue(plugin_id, &code, message));
}
