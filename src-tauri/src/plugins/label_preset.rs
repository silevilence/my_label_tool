use super::manifest::{is_valid_plugin_id, PluginExtensionKind, PluginManifest};
use super::registry::{load_plugin_registry, PluginRegistryError, PluginState};
use crate::i18n::zh_cn as text;
use crate::models::annotation::{LabelConfig, LabelTemplate};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;

pub const LABEL_PRESET_FILE_NAME: &str = "labels.json";
pub(crate) const MAX_LABEL_PRESET_BYTES: u64 = 1024 * 1024;
const MAX_LABELS: usize = 1_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginLabelPreset {
    pub plugin_id: String,
    pub plugin_name: String,
    pub template: LabelTemplate,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginLabelPresetSnapshot {
    pub presets: Vec<PluginLabelPreset>,
    pub warning: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawLabelTemplate {
    id: String,
    name: String,
    labels: Vec<RawLabelConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawLabelConfig {
    id: String,
    name: String,
    color: String,
    shortcut: Option<String>,
    shape_type: String,
}

pub fn validate_label_preset_package(
    manifest: &PluginManifest,
    package_root: &Path,
) -> Result<(), PluginRegistryError> {
    if manifest.extension_kind != PluginExtensionKind::LabelPreset {
        return Ok(());
    }
    for entry in fs::read_dir(package_root)
        .map_err(|error| invalid_label_preset(text::plugin_label_preset_read_failed(error)))?
    {
        let entry = entry
            .map_err(|error| invalid_label_preset(text::plugin_label_preset_read_failed(error)))?;
        let name = entry.file_name();
        if name != "manifest.json" && name != LABEL_PRESET_FILE_NAME {
            return Err(invalid_label_preset(
                text::PLUGIN_LABEL_PRESET_EXTRA_ENTRY.to_string(),
            ));
        }
    }
    load_label_preset(package_root, &manifest.id)
        .map(|_| ())
        .map_err(invalid_label_preset)
}

pub fn load_plugin_label_presets(app_data_dir: &Path) -> PluginLabelPresetSnapshot {
    let registry = load_plugin_registry(app_data_dir);
    let mut warnings = registry.warning.into_iter().collect::<Vec<_>>();
    let mut presets = Vec::new();
    for plugin in registry.plugins.into_iter().filter(|plugin| {
        plugin.state == PluginState::Enabled
            && plugin.extension_kind == PluginExtensionKind::LabelPreset
    }) {
        let package_root = app_data_dir.join("plugins").join(&plugin.id);
        match load_label_preset(&package_root, &plugin.id) {
            Ok(template) => presets.push(PluginLabelPreset {
                plugin_id: plugin.id,
                plugin_name: plugin.name,
                template,
            }),
            Err(error) => {
                warnings.push(text::plugin_label_preset_load_warning(&plugin.name, &error))
            }
        }
    }
    presets.sort_by(|left, right| left.plugin_id.cmp(&right.plugin_id));
    PluginLabelPresetSnapshot {
        presets,
        warning: (!warnings.is_empty()).then(|| warnings.join("；")),
    }
}

pub fn load_label_preset(package_root: &Path, plugin_id: &str) -> Result<LabelTemplate, String> {
    let path = package_root.join(LABEL_PRESET_FILE_NAME);
    let bytes = read_label_preset_file(&path)?;
    parse_label_preset(&bytes, plugin_id)
}

pub(crate) fn read_label_preset_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| text::PLUGIN_LABEL_PRESET_MISSING.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(text::PLUGIN_LABEL_PRESET_MISSING.to_string());
    }
    let file = fs::File::open(path).map_err(text::plugin_label_preset_read_failed)?;
    if file
        .metadata()
        .map_err(text::plugin_label_preset_read_failed)?
        .len()
        > MAX_LABEL_PRESET_BYTES
    {
        return Err(text::PLUGIN_LABEL_PRESET_TOO_LARGE.to_string());
    }
    let mut bytes = Vec::new();
    file.take(MAX_LABEL_PRESET_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(text::plugin_label_preset_read_failed)?;
    if bytes.len() as u64 > MAX_LABEL_PRESET_BYTES {
        return Err(text::PLUGIN_LABEL_PRESET_TOO_LARGE.to_string());
    }
    Ok(bytes)
}

pub fn parse_label_preset(bytes: &[u8], plugin_id: &str) -> Result<LabelTemplate, String> {
    if bytes.len() as u64 > MAX_LABEL_PRESET_BYTES {
        return Err(text::PLUGIN_LABEL_PRESET_TOO_LARGE.to_string());
    }
    if !is_valid_plugin_id(plugin_id) {
        return Err(text::PLUGIN_LABEL_PRESET_ID_INVALID.to_string());
    }
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(text::plugin_label_preset_json_failed)?;
    if value
        .get("labels")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|labels| {
            labels.iter().any(|label| {
                label
                    .as_object()
                    .and_then(|object| object.get("shortcut"))
                    .is_some_and(|shortcut| !shortcut.is_string())
            })
        })
    {
        return Err(text::PLUGIN_LABEL_PRESET_SHORTCUT_INVALID.to_string());
    }
    let raw: RawLabelTemplate =
        serde_json::from_value(value).map_err(text::plugin_label_preset_json_failed)?;
    if !is_namespaced_id(&raw.id, plugin_id) {
        return Err(text::PLUGIN_LABEL_PRESET_ID_INVALID.to_string());
    }
    if raw.name.trim().is_empty() {
        return Err(text::PLUGIN_LABEL_PRESET_NAME_REQUIRED.to_string());
    }
    if raw.labels.is_empty() || raw.labels.len() > MAX_LABELS {
        return Err(text::PLUGIN_LABEL_PRESET_LABEL_COUNT_INVALID.to_string());
    }
    let mut ids = HashSet::new();
    let mut shortcuts = HashSet::new();
    let mut labels = Vec::with_capacity(raw.labels.len());
    for label in raw.labels {
        if !is_namespaced_id(&label.id, plugin_id) || !ids.insert(label.id.clone()) {
            return Err(text::PLUGIN_LABEL_PRESET_LABEL_ID_INVALID.to_string());
        }
        if label.name.trim().is_empty() {
            return Err(text::PLUGIN_LABEL_PRESET_LABEL_NAME_REQUIRED.to_string());
        }
        if !is_hex_color(&label.color) {
            return Err(text::PLUGIN_LABEL_PRESET_COLOR_INVALID.to_string());
        }
        if !matches!(
            label.shape_type.as_str(),
            "any" | "rect" | "polygon" | "point"
        ) {
            return Err(text::PLUGIN_LABEL_PRESET_SHAPE_INVALID.to_string());
        }
        if let Some(shortcut) = &label.shortcut {
            if shortcut.len() != 1
                || !shortcut.as_bytes()[0].is_ascii_lowercase()
                    && !shortcut.as_bytes()[0].is_ascii_digit()
                || !shortcuts.insert(shortcut.clone())
            {
                return Err(text::PLUGIN_LABEL_PRESET_SHORTCUT_INVALID.to_string());
            }
        }
        labels.push(LabelConfig {
            id: label.id,
            name: label.name.trim().to_string(),
            color: label.color,
            shortcut: label.shortcut,
            shape_type: label.shape_type,
        });
    }
    Ok(LabelTemplate {
        id: raw.id,
        name: raw.name.trim().to_string(),
        labels,
    })
}

fn is_namespaced_id(value: &str, plugin_id: &str) -> bool {
    is_valid_plugin_id(value) && (value == plugin_id || value.starts_with(&format!("{plugin_id}.")))
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn invalid_label_preset(message: String) -> PluginRegistryError {
    PluginRegistryError {
        code: "INVALID_PACKAGE".to_string(),
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_bytes() -> Vec<u8> {
        r##"{
          "id":"dev.acme.labels.traffic",
          "name":"道路交通",
          "labels":[
            {"id":"dev.acme.labels.car","name":"汽车","color":"#38bdf8","shortcut":"1","shapeType":"rect"},
            {"id":"dev.acme.labels.person","name":"行人","color":"#f97316","shapeType":"any"}
          ]
        }"##
            .as_bytes()
            .to_vec()
    }

    #[test]
    fn parses_strict_namespaced_template() {
        let template = parse_label_preset(&valid_bytes(), "dev.acme.labels").expect("valid");
        assert_eq!(template.labels.len(), 2);
        assert_eq!(template.labels[0].shortcut.as_deref(), Some("1"));
        let serialized = serde_json::to_value(&template).expect("serialize template");
        assert!(serialized["labels"][1].get("shortcut").is_none());
    }

    #[test]
    fn rejects_unknown_fields_and_invalid_semantics() {
        let unknown = br##"{"id":"dev.acme.labels","name":"x","labels":[],"extra":true}"##;
        assert!(parse_label_preset(unknown, "dev.acme.labels").is_err());
        let mut value: serde_json::Value = serde_json::from_slice(&valid_bytes()).expect("json");
        value["labels"][0]["color"] = serde_json::json!("blue");
        assert_eq!(
            parse_label_preset(
                &serde_json::to_vec(&value).expect("json"),
                "dev.acme.labels"
            ),
            Err(text::PLUGIN_LABEL_PRESET_COLOR_INVALID.to_string())
        );
        let mut value: serde_json::Value = serde_json::from_slice(&valid_bytes()).expect("json");
        value["id"] = serde_json::json!("dev.acme.labels..traffic");
        assert_eq!(
            parse_label_preset(
                &serde_json::to_vec(&value).expect("json"),
                "dev.acme.labels"
            ),
            Err(text::PLUGIN_LABEL_PRESET_ID_INVALID.to_string())
        );
    }

    #[test]
    fn rejects_duplicate_ids_and_shortcuts() {
        let mut value: serde_json::Value = serde_json::from_slice(&valid_bytes()).expect("json");
        value["labels"][1]["id"] = value["labels"][0]["id"].clone();
        assert_eq!(
            parse_label_preset(
                &serde_json::to_vec(&value).expect("json"),
                "dev.acme.labels"
            ),
            Err(text::PLUGIN_LABEL_PRESET_LABEL_ID_INVALID.to_string())
        );
        let mut value: serde_json::Value = serde_json::from_slice(&valid_bytes()).expect("json");
        value["labels"][0]["shortcut"] = serde_json::Value::Null;
        assert_eq!(
            parse_label_preset(
                &serde_json::to_vec(&value).expect("json"),
                "dev.acme.labels"
            ),
            Err(text::PLUGIN_LABEL_PRESET_SHORTCUT_INVALID.to_string())
        );
        let mut value: serde_json::Value = serde_json::from_slice(&valid_bytes()).expect("json");
        value["labels"][1]["shortcut"] = serde_json::json!("1");
        assert_eq!(
            parse_label_preset(
                &serde_json::to_vec(&value).expect("json"),
                "dev.acme.labels"
            ),
            Err(text::PLUGIN_LABEL_PRESET_SHORTCUT_INVALID.to_string())
        );
    }
}
