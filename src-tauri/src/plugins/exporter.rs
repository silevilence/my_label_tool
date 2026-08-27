use super::manifest::{is_safe_relative_path, PluginExporterFormat, PluginExtensionKind};
use super::permissions::{normalize_for_comparison, opened_file_path};
use super::registry::{
    load_plugin_registry, plugin_state_disabled_reason, record_plugin_runtime_failure,
    record_plugin_runtime_success, PluginState,
};
use super::runtime::{
    invoke_plugin_with_hooks, load_plugin_runtime_settings, stop_plugin_process, PluginCallError,
    PluginCallHooks,
};
use crate::i18n::zh_cn as text;
use crate::models::annotation::AnnotationExport;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, AtomicU8, Ordering},
    Arc, Mutex, OnceLock,
};

const MAX_EXPORT_FILE_BYTES: usize = 50 * 1024 * 1024;
const MAX_EXPORT_TOTAL_BYTES: usize = MAX_EXPORT_FILE_BYTES;
const MAX_EXPORT_FILES: usize = 10_000;
static EXPORT_STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static ACTIVE_EXPORTS: OnceLock<Mutex<HashMap<String, ActiveExport>>> = OnceLock::new();

#[derive(Clone)]
struct ActiveExport {
    state: Arc<AtomicU8>,
}

const EXPORT_CANCELLABLE: u8 = 0;
const EXPORT_CANCELLED: u8 = 1;
const EXPORT_PUBLISHING: u8 = 2;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginExportFormatDescriptor {
    pub selection_id: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub format: PluginExporterFormat,
    pub enabled: bool,
    pub disabled_reason: Option<String>,
    pub supports_progress: bool,
    pub supports_cancel: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginExportFormatSnapshot {
    pub formats: Vec<PluginExportFormatDescriptor>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginExportResult {
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginExportCancellationResult {
    pub export_id: String,
    pub found: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginExportRequest {
    pub plugin_id: String,
    pub format_id: String,
    pub export_data: AnnotationExport,
    pub options: Map<String, Value>,
    pub output_base_name: String,
    pub output_dir: PathBuf,
    pub export_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawExportResult {
    files: Vec<RawExportFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawExportFile {
    relative_path: String,
    content_utf8: Option<String>,
    content_base64: Option<String>,
}

pub fn load_plugin_export_formats(app_data_dir: &Path) -> PluginExportFormatSnapshot {
    let registry = load_plugin_registry(app_data_dir);
    let safe_mode = load_plugin_runtime_settings(app_data_dir)
        .map(|settings| settings.safe_mode)
        .unwrap_or(true);
    let mut formats = Vec::new();
    for plugin in registry
        .plugins
        .into_iter()
        .filter(|plugin| plugin.extension_kind == PluginExtensionKind::Exporter)
    {
        let enabled =
            plugin.state == PluginState::Enabled && plugin.last_error.is_none() && !safe_mode;
        let disabled_reason = if safe_mode {
            Some(text::PLUGIN_RUNTIME_SAFE_MODE.to_string())
        } else if plugin.state != PluginState::Enabled {
            plugin_state_disabled_reason(plugin.state)
        } else {
            plugin.last_error.clone()
        };
        for format in plugin
            .exporter_options
            .as_ref()
            .map(|options| options.formats.as_slice())
            .unwrap_or_default()
        {
            formats.push(PluginExportFormatDescriptor {
                selection_id: format!("plugin:{}:{}", plugin.id, format.id),
                plugin_id: plugin.id.clone(),
                plugin_name: plugin.name.clone(),
                format: format.clone(),
                enabled,
                disabled_reason: disabled_reason.clone(),
                supports_progress: plugin.capabilities.progress,
                supports_cancel: plugin.capabilities.cancel,
            });
        }
    }
    formats.sort_by(|left, right| left.selection_id.cmp(&right.selection_id));
    PluginExportFormatSnapshot {
        formats,
        warning: registry.warning,
    }
}

pub fn run_plugin_export(
    app_data_dir: &Path,
    request: PluginExportRequest,
    on_event: impl Fn(Value) + Send + Sync + 'static,
) -> Result<PluginExportResult, PluginCallError> {
    validate_export_request(&request)?;
    let active_export = register_export(&request.export_id)?;
    let _guard = ActiveExportGuard {
        export_id: request.export_id.clone(),
        plugin_id: request.plugin_id.clone(),
        state: Arc::clone(&active_export.state),
    };
    let descriptor = load_plugin_export_formats(app_data_dir)
        .formats
        .into_iter()
        .find(|format| {
            format.plugin_id == request.plugin_id && format.format.id == request.format_id
        })
        .ok_or_else(|| export_error("INVALID_ARGUMENT", text::PLUGIN_EXPORT_FORMAT_NOT_FOUND))?;
    if !descriptor.enabled {
        return Err(export_error(
            "PLUGIN_DISABLED",
            descriptor
                .disabled_reason
                .as_deref()
                .unwrap_or(text::PLUGIN_RUNTIME_DISABLED),
        ));
    }
    let cancel_state = Arc::clone(&active_export.state);
    let hooks = PluginCallHooks::new_with_cancel_check(
        move || cancel_state.load(Ordering::Acquire) == EXPORT_CANCELLED,
        on_event,
    )
    .with_deferred_success_recording();
    let result = invoke_plugin_with_hooks(
        app_data_dir,
        &request.plugin_id,
        "exporter.export",
        json!({
            "formatId": request.format_id,
            "exportData": request.export_data,
            "options": request.options,
            "outputBaseName": request.output_base_name,
        }),
        &hooks,
    )?;
    ensure_not_cancelled(&active_export)?;
    let files = match validate_export_result(result, &descriptor.format) {
        Ok(files) => files,
        Err(error) => {
            record_plugin_runtime_failure(app_data_dir, &request.plugin_id, &error.message)
                .map_err(|persist_error| {
                    export_error(
                        "INTERNAL_ERROR",
                        &text::plugin_failure_persist_failed(&error.message, persist_error.message),
                    )
                })?;
            return Err(error);
        }
    };
    ensure_not_cancelled(&active_export)?;
    record_plugin_runtime_success(app_data_dir, &request.plugin_id).map_err(|persist_error| {
        export_error(
            "INTERNAL_ERROR",
            &text::plugin_failure_persist_failed(
                text::PLUGIN_EXPORT_SUCCESS_PERSIST_CONTEXT,
                persist_error.message,
            ),
        )
    })?;
    let relative_paths = files
        .iter()
        .map(|(path, _)| path.to_string_lossy().replace('\\', "/"))
        .collect::<Vec<_>>();
    write_export_files(&request.output_dir, files, &active_export)?;
    Ok(PluginExportResult {
        files: relative_paths,
    })
}

fn write_export_files(
    output_dir: &Path,
    files: Vec<(PathBuf, Vec<u8>)>,
    active_export: &ActiveExport,
) -> Result<(), PluginCallError> {
    let canonical_root = fs::canonicalize(output_dir).map_err(|error| {
        export_error("INTERNAL_ERROR", &text::plugin_export_write_failed(error))
    })?;
    let staging = create_staging_directory(&canonical_root)?;
    let _staging_guard = StagingGuard(staging.clone());

    for (relative, _) in &files {
        if !is_safe_export_relative_path(&relative.to_string_lossy()) {
            return Err(unsafe_export_path());
        }
        preflight_destination(&canonical_root, relative)?;
    }
    for (relative, content) in &files {
        ensure_not_cancelled(active_export)?;
        let staged_target = staging.join(relative);
        if let Some(parent) = staged_target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                export_error("INTERNAL_ERROR", &text::plugin_export_write_failed(error))
            })?;
        }
        fs::write(staged_target, content).map_err(|error| {
            export_error("INTERNAL_ERROR", &text::plugin_export_write_failed(error))
        })?;
    }
    ensure_not_cancelled(active_export)?;
    for (relative, _) in &files {
        create_safe_destination_parent(&canonical_root, relative)?;
    }
    ensure_not_cancelled(active_export)?;

    // Publication is intentionally non-cancellable: cancellation remains all-or-none
    // through validation/staging, while this short host-only copy phase must finish.
    begin_publication(active_export)?;
    for (relative, _) in files {
        let staged_target = staging.join(&relative);
        let target = canonical_root.join(&relative);
        preflight_destination(&canonical_root, &relative)?;
        publish_staged_file(&canonical_root, &staged_target, &target)?;
    }
    Ok(())
}

fn validate_export_request(request: &PluginExportRequest) -> Result<(), PluginCallError> {
    if request.output_base_name.len() > 255
        || request.output_base_name.trim().is_empty()
        || matches!(request.output_base_name.as_str(), "." | "..")
        || !is_safe_windows_segment(&request.output_base_name)
        || !request.output_dir.is_dir()
        || request.export_data.images.iter().any(|image| {
            !is_safe_export_relative_path(&image.path)
                || image.name.trim().is_empty()
                || image.width == 0
                || image.height == 0
        })
    {
        return Err(export_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_EXPORT_ARGUMENT_INVALID,
        ));
    }
    let label_ids = request
        .export_data
        .labels
        .iter()
        .map(|label| label.id.as_str())
        .collect::<HashSet<_>>();
    if label_ids.len() != request.export_data.labels.len()
        || request.export_data.labels.iter().any(|label| {
            label.id.trim().is_empty()
                || label.name.trim().is_empty()
                || !matches!(
                    label.shape_type.as_str(),
                    "any" | "rect" | "polygon" | "point"
                )
                || !is_hex_color(&label.color)
                || label.shortcut.as_ref().is_some_and(|shortcut| {
                    shortcut.len() != 1
                        || !shortcut
                            .as_bytes()
                            .first()
                            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                })
        })
        || request.export_data.images.iter().any(|image| {
            image.annotations.iter().any(|annotation| {
                annotation.id.trim().is_empty()
                    || !label_ids.contains(annotation.label_id.as_str())
                    || !annotation_points_are_valid(annotation)
                    || annotation.attributes.as_ref().is_some_and(|attributes| {
                        !attributes.as_object().is_some_and(|values| {
                            values.values().all(|value| {
                                value.is_string() || value.is_number() || value.is_boolean()
                            })
                        })
                    })
            })
        })
    {
        return Err(export_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_EXPORT_ARGUMENT_INVALID,
        ));
    }
    Ok(())
}

fn annotation_points_are_valid(annotation: &crate::models::annotation::AnnotationShape) -> bool {
    let finite = annotation.points.iter().all(|point| point.is_finite());
    finite
        && match annotation.shape_type.as_str() {
            "rect" => {
                annotation.points.len() == 4
                    && annotation.points[2] >= 0.0
                    && annotation.points[3] >= 0.0
            }
            "polygon" => annotation.points.len() >= 6 && annotation.points.len().is_multiple_of(2),
            "point" => annotation.points.len() == 2,
            _ => false,
        }
}

fn ensure_not_cancelled(active_export: &ActiveExport) -> Result<(), PluginCallError> {
    if active_export.state.load(Ordering::Acquire) == EXPORT_CANCELLED {
        Err(export_error("CANCELLED", text::PLUGIN_RUNTIME_CANCELLED))
    } else {
        Ok(())
    }
}

fn begin_publication(active_export: &ActiveExport) -> Result<(), PluginCallError> {
    active_export
        .state
        .compare_exchange(
            EXPORT_CANCELLABLE,
            EXPORT_PUBLISHING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .map(|_| ())
        .map_err(|_| export_error("CANCELLED", text::PLUGIN_RUNTIME_CANCELLED))
}

fn is_hex_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn create_staging_directory(root: &Path) -> Result<PathBuf, PluginCallError> {
    for _ in 0..100 {
        let sequence = EXPORT_STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = root.join(format!(
            ".my-label-tool-export-staging-{}-{sequence}",
            std::process::id()
        ));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(export_error(
                    "INTERNAL_ERROR",
                    &text::plugin_export_write_failed(error),
                ))
            }
        }
    }
    Err(export_error(
        "INTERNAL_ERROR",
        text::PLUGIN_EXPORT_STAGING_FAILED,
    ))
}

fn preflight_destination(root: &Path, relative: &Path) -> Result<(), PluginCallError> {
    let mut current = root.to_path_buf();
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    for component in parent.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if !metadata.is_dir() || metadata_is_reparse(&metadata) {
                    return Err(unsafe_export_path());
                }
                ensure_canonical_within(root, &current)?;
            }
            Err(error) if error.kind() == ErrorKind::NotFound => break,
            Err(error) => return Err(export_io_error(error)),
        }
    }
    let target = root.join(relative);
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.is_dir() || metadata_is_reparse(&metadata) => {
            Err(unsafe_export_path())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(export_io_error(error)),
    }
}

fn create_safe_destination_parent(root: &Path, relative: &Path) -> Result<(), PluginCallError> {
    let mut current = root.to_path_buf();
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    for component in parent.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.is_dir() && !metadata_is_reparse(&metadata) => {}
            Ok(_) => return Err(unsafe_export_path()),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(export_io_error)?;
                let metadata = fs::symlink_metadata(&current).map_err(export_io_error)?;
                if !metadata.is_dir() || metadata_is_reparse(&metadata) {
                    return Err(unsafe_export_path());
                }
            }
            Err(error) => return Err(export_io_error(error)),
        }
        ensure_canonical_within(root, &current)?;
    }
    Ok(())
}

fn ensure_canonical_within(root: &Path, path: &Path) -> Result<(), PluginCallError> {
    let canonical = fs::canonicalize(path).map_err(export_io_error)?;
    if canonical.starts_with(root) {
        Ok(())
    } else {
        Err(unsafe_export_path())
    }
}

fn publish_staged_file(root: &Path, staged: &Path, target: &Path) -> Result<(), PluginCallError> {
    let mut source = fs::File::open(staged).map_err(export_io_error)?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options
            .share_mode(0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0);
    }
    let mut destination = options.open(target).map_err(export_io_error)?;
    let metadata = destination.metadata().map_err(export_io_error)?;
    if !metadata.is_file() || metadata_is_reparse(&metadata) {
        return Err(unsafe_export_path());
    }
    let opened_path = opened_file_path(&destination).map_err(export_io_error)?;
    let comparable_root = normalize_for_comparison(root).map_err(|_| unsafe_export_path())?;
    let comparable_target =
        normalize_for_comparison(&opened_path).map_err(|_| unsafe_export_path())?;
    if !comparable_target.starts_with(comparable_root) {
        return Err(unsafe_export_path());
    }
    destination.set_len(0).map_err(export_io_error)?;
    std::io::copy(&mut source, &mut destination).map_err(export_io_error)?;
    destination.flush().map_err(export_io_error)
}

fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    false
}

fn unsafe_export_path() -> PluginCallError {
    export_error("PERMISSION_DENIED", text::PLUGIN_EXPORT_PATH_INVALID)
}

fn export_io_error(error: std::io::Error) -> PluginCallError {
    export_error("INTERNAL_ERROR", &text::plugin_export_write_failed(error))
}

struct StagingGuard(PathBuf);

impl Drop for StagingGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn cancel_plugin_export(export_id: &str) -> PluginExportCancellationResult {
    let active_export = active_exports()
        .lock()
        .ok()
        .and_then(|exports| exports.get(export_id).cloned());
    let found = active_export.as_ref().is_some_and(|export| {
        export
            .state
            .compare_exchange(
                EXPORT_CANCELLABLE,
                EXPORT_CANCELLED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    });
    PluginExportCancellationResult {
        export_id: export_id.to_string(),
        found,
    }
}

fn register_export(export_id: &str) -> Result<ActiveExport, PluginCallError> {
    if export_id.is_empty()
        || export_id.len() > 128
        || !export_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(export_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_EXPORT_ARGUMENT_INVALID,
        ));
    }
    let mut exports = active_exports()
        .lock()
        .map_err(|_| export_error("INTERNAL_ERROR", text::PLUGIN_RUNTIME_LOCK_POISONED))?;
    if exports.contains_key(export_id) {
        return Err(export_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_EXPORT_ALREADY_RUNNING,
        ));
    }
    let active_export = ActiveExport {
        state: Arc::new(AtomicU8::new(EXPORT_CANCELLABLE)),
    };
    exports.insert(export_id.to_string(), active_export.clone());
    Ok(active_export)
}

fn active_exports() -> &'static Mutex<HashMap<String, ActiveExport>> {
    ACTIVE_EXPORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ActiveExportGuard {
    export_id: String,
    plugin_id: String,
    state: Arc<AtomicU8>,
}

impl Drop for ActiveExportGuard {
    fn drop(&mut self) {
        if let Ok(mut exports) = active_exports().lock() {
            exports.remove(&self.export_id);
        }
        if self.state.load(Ordering::Acquire) == EXPORT_CANCELLED {
            stop_plugin_process(&self.plugin_id);
        }
    }
}

fn validate_export_result(
    value: Value,
    format: &PluginExporterFormat,
) -> Result<Vec<(PathBuf, Vec<u8>)>, PluginCallError> {
    let raw: RawExportResult = serde_json::from_value(value)
        .map_err(|_| export_error("PROTOCOL_ERROR", text::PLUGIN_EXPORT_RESULT_INVALID))?;
    if raw.files.is_empty()
        || raw.files.len() > MAX_EXPORT_FILES
        || (!format.multi_file && raw.files.len() != 1)
    {
        return Err(export_error(
            "PROTOCOL_ERROR",
            text::PLUGIN_EXPORT_RESULT_INVALID,
        ));
    }
    let mut seen = HashSet::new();
    let mut total = 0_usize;
    raw.files
        .into_iter()
        .map(|file| {
            if !is_safe_export_relative_path(&file.relative_path)
                || !seen.insert(file.relative_path.replace('\\', "/").to_ascii_lowercase())
            {
                return Err(export_error(
                    "PERMISSION_DENIED",
                    text::PLUGIN_EXPORT_PATH_INVALID,
                ));
            }
            let extension = Path::new(&file.relative_path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !format
                .extensions
                .iter()
                .any(|allowed| allowed == &extension)
            {
                return Err(export_error(
                    "PROTOCOL_ERROR",
                    text::PLUGIN_EXPORT_EXTENSION_INVALID,
                ));
            }
            let content = match (file.content_utf8, file.content_base64) {
                (Some(content), None) => content.into_bytes(),
                (None, Some(content)) if content.len() <= MAX_EXPORT_FILE_BYTES * 2 => {
                    base64::engine::general_purpose::STANDARD
                        .decode(content)
                        .map_err(|_| {
                            export_error("PROTOCOL_ERROR", text::PLUGIN_EXPORT_RESULT_INVALID)
                        })?
                }
                _ => {
                    return Err(export_error(
                        "PROTOCOL_ERROR",
                        text::PLUGIN_EXPORT_RESULT_INVALID,
                    ))
                }
            };
            total = total.saturating_add(content.len());
            if content.len() > MAX_EXPORT_FILE_BYTES || total > MAX_EXPORT_TOTAL_BYTES {
                return Err(export_error(
                    "INVALID_ARGUMENT",
                    text::PLUGIN_EXPORT_TOO_LARGE,
                ));
            }
            Ok((PathBuf::from(file.relative_path), content))
        })
        .collect()
}

fn is_safe_export_relative_path(value: &str) -> bool {
    is_safe_relative_path(value)
        && value.len() <= 32_768
        && value
            .replace('\\', "/")
            .split('/')
            .all(is_safe_windows_segment)
}

fn is_safe_windows_segment(segment: &str) -> bool {
    if segment.is_empty()
        || segment
            .to_ascii_lowercase()
            .starts_with(".my-label-tool-export-staging-")
        || segment.ends_with([' ', '.'])
        || segment.chars().any(|character| {
            character < ' '
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        return false;
    }
    let stem = segment
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
        && !(stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

fn export_error(code: &str, message: &str) -> PluginCallError {
    PluginCallError::external(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::annotation::{
        AnnotationExport, AnnotationShape, ImageAnnotations, LabelConfig,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    fn format(multi_file: bool) -> PluginExporterFormat {
        PluginExporterFormat {
            id: "labelme".to_string(),
            display_name: "LabelMe JSON".to_string(),
            extensions: vec!["json".to_string()],
            multi_file,
        }
    }

    #[test]
    fn validates_utf8_and_base64_files_before_writing() {
        let files = validate_export_result(
            json!({"files": [
                {"relativePath":"a.json","contentUtf8":"{}"},
                {"relativePath":"nested/b.json","contentBase64":"e30="}
            ]}),
            &format(true),
        )
        .expect("valid files");
        assert_eq!(files[0].1, b"{}");
        assert_eq!(files[1].1, b"{}");
    }

    #[test]
    fn rejects_escape_duplicate_wrong_extension_and_ambiguous_content() {
        for value in [
            json!({"files":[{"relativePath":"../evil.json","contentUtf8":"x"}]}),
            json!({"files":[{"relativePath":"a.json","contentUtf8":"x"},{"relativePath":"A.json","contentUtf8":"y"}]}),
            json!({"files":[{"relativePath":"a.exe","contentUtf8":"x"}]}),
            json!({"files":[{"relativePath":"a.json","contentUtf8":"x","contentBase64":"eA=="}]}),
        ] {
            assert!(validate_export_result(value, &format(true)).is_err());
        }
    }

    #[test]
    fn rejects_windows_ads_devices_and_ambiguous_segments() {
        for path in [
            "file:stream.json",
            "CON.json",
            "nested/LPT1.json",
            "trailing./file.json",
            ".my-label-tool-export-staging-1/file.json",
        ] {
            assert!(!is_safe_export_relative_path(path), "accepted {path}");
        }
        assert!(is_safe_export_relative_path("nested/正常.json"));
    }

    #[test]
    fn validates_the_typed_annotation_export_contract() {
        let output = test_directory("typed-request");
        fs::create_dir_all(&output).expect("output directory");
        let request = test_request(output.clone());
        validate_export_request(&request).expect("valid request");

        let mut invalid = test_request(output.clone());
        invalid.export_data.images[0].path = "C:/secret.jpg".to_string();
        assert_eq!(
            validate_export_request(&invalid)
                .expect_err("absolute image path")
                .code,
            "INVALID_ARGUMENT"
        );
        fs::remove_dir_all(output).expect("remove output");
    }

    #[test]
    fn cancellation_after_response_removes_staging_without_target_files() {
        let output = test_directory("staging-cancel");
        fs::create_dir_all(&output).expect("output directory");
        let active = ActiveExport {
            state: Arc::new(AtomicU8::new(EXPORT_CANCELLED)),
        };
        let error = write_export_files(
            &output,
            vec![(PathBuf::from("nested/a.json"), b"{}".to_vec())],
            &active,
        )
        .expect_err("cancelled staging");
        assert_eq!(error.code, "CANCELLED");
        assert_eq!(fs::read_dir(&output).expect("read output").count(), 0);
        fs::remove_dir_all(output).expect("remove output");
    }

    #[test]
    fn unsafe_later_path_is_rejected_before_any_target_file_is_written() {
        let output = test_directory("all-paths-first");
        fs::create_dir_all(&output).expect("output directory");
        let active = ActiveExport {
            state: Arc::new(AtomicU8::new(EXPORT_CANCELLABLE)),
        };
        let error = write_export_files(
            &output,
            vec![
                (PathBuf::from("first.json"), b"{}".to_vec()),
                (PathBuf::from("../evil.json"), b"evil".to_vec()),
            ],
            &active,
        )
        .expect_err("unsafe later path");
        assert_eq!(error.code, "PERMISSION_DENIED");
        assert_eq!(fs::read_dir(&output).expect("read output").count(), 0);
        assert!(!output.parent().expect("parent").join("evil.json").exists());
        fs::remove_dir_all(output).expect("remove output");
    }

    #[test]
    fn staged_publication_writes_valid_nested_files() {
        let output = test_directory("staging-publish");
        fs::create_dir_all(&output).expect("output directory");
        let active = ActiveExport {
            state: Arc::new(AtomicU8::new(EXPORT_CANCELLABLE)),
        };
        write_export_files(
            &output,
            vec![(PathBuf::from("nested/a.json"), b"{\"ok\":true}".to_vec())],
            &active,
        )
        .expect("publish staged file");
        assert_eq!(
            fs::read_to_string(output.join("nested/a.json")).expect("published file"),
            "{\"ok\":true}"
        );
        assert_eq!(active.state.load(Ordering::Acquire), EXPORT_PUBLISHING);
        fs::remove_dir_all(output).expect("remove output");
    }

    #[test]
    fn cancellation_and_publication_have_one_atomic_winner() {
        let cancellation_wins = ActiveExport {
            state: Arc::new(AtomicU8::new(EXPORT_CANCELLABLE)),
        };
        assert!(cancellation_wins
            .state
            .compare_exchange(
                EXPORT_CANCELLABLE,
                EXPORT_CANCELLED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok());
        assert_eq!(
            begin_publication(&cancellation_wins)
                .expect_err("cancelled export cannot publish")
                .code,
            "CANCELLED"
        );

        let publication_wins = ActiveExport {
            state: Arc::new(AtomicU8::new(EXPORT_CANCELLABLE)),
        };
        begin_publication(&publication_wins).expect("publication wins");
        assert!(publication_wins
            .state
            .compare_exchange(
                EXPORT_CANCELLABLE,
                EXPORT_CANCELLED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err());
    }

    #[test]
    fn serialized_export_params_match_schema_optional_field_semantics() {
        let output = test_directory("serialized-contract");
        fs::create_dir_all(&output).expect("output directory");
        let mut request = test_request(output.clone());
        request.export_data.images[0].annotations[0].attributes = None;
        request.export_data.images[0].annotations[0].frame_index = None;
        let params = json!({
            "formatId": request.format_id,
            "exportData": request.export_data,
            "options": request.options,
            "outputBaseName": request.output_base_name,
        });
        let annotation = &params["exportData"]["images"][0]["annotations"][0];
        assert!(annotation.get("attributes").is_none());
        assert!(annotation.get("frameIndex").is_none());
        fs::remove_dir_all(output).expect("remove output");
    }

    #[test]
    fn request_rejects_non_schema_label_color_and_shortcut() {
        let output = test_directory("invalid-label-contract");
        fs::create_dir_all(&output).expect("output directory");
        let mut request = test_request(output.clone());
        request.export_data.labels[0].color = "blue".to_string();
        assert!(validate_export_request(&request).is_err());
        request.export_data.labels[0].color = "#38bdf8".to_string();
        request.export_data.labels[0].shortcut = Some("Q".to_string());
        assert!(validate_export_request(&request).is_err());
        fs::remove_dir_all(output).expect("remove output");
    }

    #[cfg(windows)]
    #[test]
    fn host_runtime_writes_a_labelme_document_from_an_exporter_plugin() {
        let _isolation = crate::process_control::windows_isolation_test_guard();
        use crate::plugins::manifest::{
            PluginApiVersionTarget, PluginCapabilities, PluginCapabilityVersion, PluginEntry,
            PluginExporterOptions,
        };
        use crate::plugins::registry::PluginRegistryEntry;
        use crate::plugins::runtime::stop_plugin_process;

        let root = test_directory("host-flow");
        let output = root.join("output");
        let plugin_id = "dev.test.labelmeflow";
        fs::create_dir_all(root.join("plugins").join(plugin_id)).expect("plugin package");
        fs::create_dir_all(&output).expect("output directory");
        let script = r#"while (($line = [Console]::In.ReadLine()) -ne $null) { $msg = $line | ConvertFrom-Json; if ($msg.method -eq 'hello') { $response = @{ v = 1; id = $msg.id; type = 'response'; result = @{ protocolVersion = 1; capabilities = @{ exporter = $true } } } } else { $content = '{"version":"5.5.0","flags":{},"shapes":[],"imagePath":"images/a.jpg","imageData":null,"imageHeight":480,"imageWidth":640}'; $response = @{ v = 1; id = $msg.id; type = 'response'; result = @{ files = @(@{ relativePath = 'a.json'; contentUtf8 = $content }) } } }; [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8)); [Console]::Out.Flush() }"#;
        let capability = PluginCapabilityVersion {
            api_version: PluginApiVersionTarget { min: 1 },
        };
        let entry = PluginRegistryEntry {
            id: plugin_id.to_string(),
            name: "LabelMe flow".to_string(),
            version: "1.0.0".to_string(),
            extension_kind: PluginExtensionKind::Exporter,
            entry: Some(PluginEntry {
                command: "powershell.exe".to_string(),
                args: vec![
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-Command".to_string(),
                    script.to_string(),
                ],
            }),
            exporter_options: Some(PluginExporterOptions {
                formats: vec![format(true)],
            }),
            prelabel_options: None,
            capabilities: PluginCapabilities {
                annotation_types: Vec::new(),
                batch: false,
                progress: false,
                cancel: false,
                config_migration: false,
                exporter: capability.clone(),
                prelabel: capability,
            },
            grants: Vec::new(),
            state: PluginState::Enabled,
            failure_count: 0,
            last_error: None,
            config_version: 0,
            timeout_ms: 5_000,
            installed_at: "1".to_string(),
            updated_at: "1".to_string(),
        };
        serde_json::to_writer_pretty(
            fs::File::create(root.join("plugin-registry.json")).expect("registry"),
            &vec![entry],
        )
        .expect("write registry");
        let mut request = test_request(output.clone());
        request.plugin_id = plugin_id.to_string();
        request.export_id = "host-flow".to_string();
        let result = run_plugin_export(&root, request, |_| {}).expect("plugin export");
        assert_eq!(result.files, vec!["a.json"]);
        let document: Value = serde_json::from_str(
            &fs::read_to_string(output.join("a.json")).expect("LabelMe output"),
        )
        .expect("parse LabelMe JSON");
        assert_eq!(document["version"], "5.5.0");
        assert_eq!(document["imagePath"], "images/a.jpg");
        stop_plugin_process(plugin_id);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    fn test_request(output_dir: PathBuf) -> PluginExportRequest {
        PluginExportRequest {
            plugin_id: "dev.test.exporter".to_string(),
            format_id: "labelme".to_string(),
            export_data: AnnotationExport {
                labels: vec![LabelConfig {
                    id: "car".to_string(),
                    name: "汽车".to_string(),
                    color: "#38bdf8".to_string(),
                    shortcut: None,
                    shape_type: "rect".to_string(),
                }],
                images: vec![ImageAnnotations {
                    path: "images/a.jpg".to_string(),
                    name: "a.jpg".to_string(),
                    width: 640,
                    height: 480,
                    annotations: vec![AnnotationShape {
                        id: "one".to_string(),
                        shape_type: "rect".to_string(),
                        label_id: "car".to_string(),
                        points: vec![1.0, 2.0, 3.0, 4.0],
                        attributes: None,
                        frame_index: Some(0),
                    }],
                }],
            },
            options: Map::new(),
            output_base_name: "annotations".to_string(),
            output_dir,
            export_id: "test-export".to_string(),
        }
    }

    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "my-label-tool-exporter-{name}-{}-{nonce}",
            std::process::id()
        ))
    }
}
