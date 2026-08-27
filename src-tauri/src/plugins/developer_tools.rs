use super::label_preset::{
    parse_label_preset, read_label_preset_file, LABEL_PRESET_FILE_NAME, MAX_LABEL_PRESET_BYTES,
};
use super::manifest::PluginExtensionKind;
use super::manifest::{parse_plugin_manifest, PluginManifest};
use super::registry::{MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_TOTAL_BYTES, MAX_COMPRESSION_RATIO};
use crate::i18n::zh_cn as text;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginValidationIssue {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginValidationReport {
    pub ok: bool,
    pub source_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<PluginManifest>,
    pub permissions: Vec<String>,
    pub issues: Vec<PluginValidationIssue>,
}

pub fn validate_plugin_source(path: &Path) -> Result<PluginValidationReport, String> {
    if path.is_dir() {
        validate_directory(path)
    } else if path.is_file() {
        validate_archive(path)
    } else {
        Err(text::plugin_validator_source_missing(path))
    }
}

pub fn plugin_validator_usage() -> &'static str {
    text::PLUGIN_VALIDATOR_USAGE
}

fn validate_directory(root: &Path) -> Result<PluginValidationReport, String> {
    let mut files = Vec::new();
    collect_directory_files(root, root, &mut files)?;
    let mut issues = validate_file_sizes(files.iter().map(|(_, size)| *size));
    let manifest_path = root.join("manifest.json");
    let manifest_value = if manifest_path.is_file() {
        let bytes = fs::read(&manifest_path)
            .map_err(|error| text::plugin_validator_read_failed(&manifest_path, error))?;
        match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(error) => {
                issues.push(issue(
                    "manifest.json",
                    "INVALID_JSON",
                    &text::plugin_validator_manifest_json_failed(&manifest_path, error),
                ));
                serde_json::Value::Null
            }
        }
    } else {
        issues.push(issue(
            "manifest.json",
            "MISSING_MANIFEST",
            text::PLUGIN_ARCHIVE_MISSING_MANIFEST,
        ));
        serde_json::Value::Null
    };
    let entry_exists = |relative: &str| root.join(relative).is_file();
    let label_preset_path = root.join(LABEL_PRESET_FILE_NAME);
    let label_preset_bytes = match fs::symlink_metadata(&label_preset_path) {
        Ok(_) => Some(read_label_preset_file(&label_preset_path)),
        Err(_) => None,
    };
    Ok(build_report(
        "directory",
        manifest_value,
        issues,
        entry_exists,
        label_preset_bytes,
    ))
}

fn validate_archive(path: &Path) -> Result<PluginValidationReport, String> {
    let file =
        fs::File::open(path).map_err(|error| text::plugin_validator_read_failed(path, error))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| text::plugin_validator_archive_failed(path, error))?;
    let mut issues = Vec::new();
    let mut manifest_value = None;
    let mut label_preset_bytes = None;
    let mut package_files = HashSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| text::plugin_validator_archive_failed(path, error))?;
        let Some(relative) = entry.enclosed_name() else {
            issues.push(issue(
                "$",
                "UNSAFE_ENTRY",
                text::PLUGIN_ARCHIVE_UNSAFE_ENTRY,
            ));
            continue;
        };
        if entry.is_symlink() {
            issues.push(issue(
                &relative.to_string_lossy(),
                "UNSAFE_ENTRY",
                text::PLUGIN_ARCHIVE_UNSAFE_ENTRY,
            ));
            continue;
        }
        if entry.is_dir() {
            continue;
        }
        if !package_files.insert(relative.to_path_buf()) {
            issues.push(issue(
                &relative.to_string_lossy(),
                "DUPLICATE_ENTRY",
                text::PLUGIN_VALIDATOR_DUPLICATE_ENTRY,
            ));
        }
        total = total.saturating_add(entry.size());
        if entry.size() > MAX_ARCHIVE_FILE_BYTES || total > MAX_ARCHIVE_TOTAL_BYTES {
            issues.push(issue(
                &relative.to_string_lossy(),
                "PACKAGE_TOO_LARGE",
                text::PLUGIN_ARCHIVE_TOO_LARGE,
            ));
        }
        if entry.size() > 0
            && (entry.compressed_size() == 0
                || entry.size()
                    > entry
                        .compressed_size()
                        .saturating_mul(MAX_COMPRESSION_RATIO))
        {
            issues.push(issue(
                &relative.to_string_lossy(),
                "COMPRESSION_RATIO",
                text::PLUGIN_ARCHIVE_RATIO_TOO_HIGH,
            ));
        }
        if relative == Path::new("manifest.json") {
            let mut bytes = Vec::new();
            entry
                .by_ref()
                .take(MAX_ARCHIVE_FILE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| text::plugin_validator_archive_failed(path, error))?;
            if manifest_value.is_none() {
                manifest_value = Some(match serde_json::from_slice(&bytes) {
                    Ok(value) => value,
                    Err(error) => {
                        issues.push(issue(
                            "manifest.json",
                            "INVALID_JSON",
                            &text::plugin_validator_manifest_json_failed(path, error),
                        ));
                        serde_json::Value::Null
                    }
                });
            }
        } else if relative == Path::new(LABEL_PRESET_FILE_NAME) {
            let mut bytes = Vec::new();
            let read_result = entry
                .by_ref()
                .take(MAX_LABEL_PRESET_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| text::plugin_validator_archive_failed(path, error));
            if label_preset_bytes.is_none() {
                label_preset_bytes = Some(match read_result {
                    Ok(_) if bytes.len() as u64 <= MAX_LABEL_PRESET_BYTES => Ok(bytes),
                    Ok(_) => Err(text::PLUGIN_LABEL_PRESET_TOO_LARGE.to_string()),
                    Err(error) => Err(error),
                });
            }
        }
    }
    let manifest_value = manifest_value.unwrap_or_else(|| {
        issues.push(issue(
            "manifest.json",
            "MISSING_MANIFEST",
            text::PLUGIN_ARCHIVE_MISSING_MANIFEST,
        ));
        serde_json::Value::Null
    });
    let entry_exists = |relative: &str| package_files.contains(Path::new(relative));
    Ok(build_report(
        "archive",
        manifest_value,
        issues,
        entry_exists,
        label_preset_bytes,
    ))
}

fn build_report(
    source_kind: &str,
    manifest_value: serde_json::Value,
    mut issues: Vec<PluginValidationIssue>,
    entry_exists: impl Fn(&str) -> bool,
    label_preset_bytes: Option<Result<Vec<u8>, String>>,
) -> PluginValidationReport {
    let parsed = parse_plugin_manifest(&manifest_value);
    issues.extend(
        parsed
            .errors
            .into_iter()
            .map(|error| PluginValidationIssue {
                field: error.field,
                code: error.code.as_str().to_string(),
                message: error.reason,
            }),
    );
    let manifest = parsed.value;
    if let Some(label_manifest) = manifest
        .as_ref()
        .filter(|manifest| manifest.extension_kind == PluginExtensionKind::LabelPreset)
    {
        match label_preset_bytes {
            Some(Ok(bytes)) => {
                if let Err(message) = parse_label_preset(&bytes, &label_manifest.id) {
                    issues.push(issue(
                        LABEL_PRESET_FILE_NAME,
                        "INVALID_LABEL_PRESET",
                        &message,
                    ));
                }
            }
            Some(Err(message)) => issues.push(issue(
                LABEL_PRESET_FILE_NAME,
                "INVALID_LABEL_PRESET",
                &message,
            )),
            None => issues.push(issue(
                LABEL_PRESET_FILE_NAME,
                "MISSING_LABEL_PRESET",
                text::PLUGIN_LABEL_PRESET_MISSING,
            )),
        }
    }
    if let Some(entry) = manifest
        .as_ref()
        .and_then(|manifest| manifest.entry.as_ref())
    {
        let system_python = matches!(entry.command.as_str(), "python" | "python3" | "py");
        if !system_python && !entry_exists(&entry.command) {
            issues.push(issue(
                "entry.command",
                "MISSING_ENTRY",
                text::PLUGIN_ENTRY_MISSING,
            ));
        }
    }
    let permissions = manifest
        .as_ref()
        .map(|manifest| {
            manifest
                .permissions
                .iter()
                .map(|permission| permission.manifest_value())
                .collect()
        })
        .unwrap_or_default();
    PluginValidationReport {
        ok: issues.is_empty() && manifest.is_some(),
        source_kind: source_kind.to_string(),
        manifest,
        permissions,
        issues,
    }
}

fn collect_directory_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(PathBuf, u64)>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory)
        .map_err(|error| text::plugin_validator_read_failed(directory, error))?;
    for entry in entries {
        let entry = entry.map_err(|error| text::plugin_validator_read_failed(directory, error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| text::plugin_validator_read_failed(&entry.path(), error))?;
        if file_type.is_symlink() {
            return Err(text::plugin_validator_unsafe_directory_entry(&entry.path()));
        }
        if file_type.is_dir() {
            collect_directory_files(root, &entry.path(), files)?;
        } else if file_type.is_file() {
            let size = entry
                .metadata()
                .map_err(|error| text::plugin_validator_read_failed(&entry.path(), error))?
                .len();
            let entry_path = entry.path();
            let relative = entry_path
                .strip_prefix(root)
                .map(Path::to_path_buf)
                .map_err(|_| text::plugin_validator_unsafe_directory_entry(&entry_path))?;
            files.push((relative, size));
        }
    }
    Ok(())
}

fn validate_file_sizes(sizes: impl Iterator<Item = u64>) -> Vec<PluginValidationIssue> {
    let mut total = 0_u64;
    for size in sizes {
        total = total.saturating_add(size);
        if size > MAX_ARCHIVE_FILE_BYTES || total > MAX_ARCHIVE_TOTAL_BYTES {
            return vec![issue(
                "$",
                "PACKAGE_TOO_LARGE",
                text::PLUGIN_ARCHIVE_TOO_LARGE,
            )];
        }
    }
    Vec::new()
}

fn issue(field: &str, code: &str, message: &str) -> PluginValidationIssue {
    PluginValidationIssue {
        field: field.to_string(),
        code: code.to_string(),
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn validates_directory_and_previews_permissions() {
        let root = temp_dir("directory");
        fs::create_dir_all(root.join("plugin")).unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&manifest()).unwrap(),
        )
        .unwrap();
        fs::write(root.join("plugin/main.py"), b"print('ok')").unwrap();

        let report = validate_plugin_source(&root).unwrap();
        assert!(report.ok, "{:?}", report.issues);
        assert_eq!(report.source_kind, "directory");
        assert_eq!(report.permissions, vec!["fs.read:%PROJECT%/images"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_archive_and_reports_missing_entry() {
        let root = temp_dir("archive");
        fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("plugin.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&archive_path).unwrap());
        writer
            .start_file("manifest.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer
            .write_all(&serde_json::to_vec(&manifest()).unwrap())
            .unwrap();
        writer.finish().unwrap();

        let report = validate_plugin_source(&archive_path).unwrap();
        assert!(!report.ok);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "MISSING_ENTRY"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn malformed_manifest_is_a_validation_failure() {
        let root = temp_dir("invalid-json");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("manifest.json"), b"{").unwrap();

        let report = validate_plugin_source(&root).expect("validation report");
        assert!(!report.ok);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == "INVALID_JSON"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn label_preset_validator_requires_and_parses_root_data_file() {
        let root = temp_dir("label-preset");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&label_manifest()).unwrap(),
        )
        .unwrap();
        let missing = validate_plugin_source(&root).unwrap();
        assert!(missing
            .issues
            .iter()
            .any(|issue| issue.code == "MISSING_LABEL_PRESET"));

        fs::write(root.join("labels.json"), b"{}").unwrap();
        let invalid = validate_plugin_source(&root).unwrap();
        assert!(invalid
            .issues
            .iter()
            .any(|issue| issue.code == "INVALID_LABEL_PRESET"));

        fs::write(
            root.join("labels.json"),
            vec![b' '; (MAX_LABEL_PRESET_BYTES + 1) as usize],
        )
        .unwrap();
        let oversized = validate_plugin_source(&root).unwrap();
        assert!(oversized.issues.iter().any(|issue| {
            issue.code == "INVALID_LABEL_PRESET"
                && issue.message == text::PLUGIN_LABEL_PRESET_TOO_LARGE
        }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn repository_examples_match_the_manifest_contract() {
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repository root");
        for example in ["label-preset-demo", "prelabel-demo"] {
            let report = validate_plugin_source(&repository.join("examples/plugins").join(example))
                .expect("validate repository example");
            assert!(report.ok, "{example}: {:?}", report.issues);
        }

        let schema: serde_json::Value =
            serde_json::from_str(include_str!("../../../docs/plugin-manifest.schema.json"))
                .expect("manifest schema");
        assert_eq!(schema["properties"]["schemaVersion"]["const"], 1);
        assert_eq!(
            schema["properties"]["extensionKind"]["enum"],
            json!(["label-preset", "exporter", "prelabel"])
        );
        let preset_schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/plugin-label-preset.schema.json"
        ))
        .expect("label preset schema");
        assert_eq!(preset_schema["properties"]["labels"]["minItems"], 1);
    }

    fn manifest() -> serde_json::Value {
        json!({
            "schemaVersion": 1,
            "id": "dev.example.prelabel",
            "name": "示例预打标",
            "version": "1.0.0",
            "apiVersion": { "min": 1 },
            "extensionKind": "prelabel",
            "runtime": "process",
            "entry": { "command": "plugin/main.py", "args": [] },
            "capabilities": {
                "annotationTypes": ["rect"],
                "prelabel": { "apiVersion": { "min": 1 } }
            },
            "permissions": ["fs.read:%PROJECT%/images"]
        })
    }

    fn label_manifest() -> serde_json::Value {
        json!({
            "schemaVersion": 1,
            "id": "dev.example.labels",
            "name": "示例标签",
            "version": "1.0.0",
            "apiVersion": { "min": 1 },
            "extensionKind": "label-preset",
            "capabilities": {},
            "permissions": []
        })
    }

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("my-label-tool-validator-{name}-{stamp}"))
    }
}
