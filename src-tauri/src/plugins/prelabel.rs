use super::manifest::{PluginAnnotationType, PluginExtensionKind};
use super::permissions::normalize_for_comparison;
use super::registry::{
    load_plugin_registry, plugin_state_disabled_reason, record_plugin_runtime_failure,
    record_plugin_runtime_success, PluginState,
};
use super::runtime::{
    invoke_plugin_with_hooks, load_plugin_runtime_settings, stop_plugin_process, PluginCallError,
    PluginCallHooks,
};
use crate::i18n::zh_cn as text;
use crate::models::annotation::AnnotationShape;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

const MAX_PRELABEL_IMAGES_PER_CALL: usize = 8;
const MAX_PRELABEL_SHAPES_PER_CALL: usize = 100_000;
const MAX_PRELABEL_POINTS_PER_SHAPE: usize = 200;
static ACTIVE_PRELABEL_OPERATIONS: OnceLock<Mutex<HashMap<String, ActivePrelabelOperation>>> =
    OnceLock::new();

#[derive(Clone)]
struct ActivePrelabelOperation {
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrelabelSourceDescriptor {
    pub selection_id: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub class_names: Vec<String>,
    pub annotation_types: Vec<PluginAnnotationType>,
    pub enabled: bool,
    pub disabled_reason: Option<String>,
    pub supports_batch: bool,
    pub supports_progress: bool,
    pub supports_cancel: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrelabelSourceSnapshot {
    pub sources: Vec<PluginPrelabelSourceDescriptor>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPrelabelClassMapping {
    pub model_class: String,
    pub label_id: String,
    pub label_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrelabelRequest {
    pub plugin_id: String,
    pub project_folder: PathBuf,
    pub image_paths: Vec<String>,
    pub class_mappings: Vec<PluginPrelabelClassMapping>,
    pub params: Map<String, Value>,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrelabelImageResult {
    pub image_path: String,
    pub shapes: Vec<AnnotationShape>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrelabelResult {
    pub images: Vec<PluginPrelabelImageResult>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPrelabelCancellationResult {
    pub operation_id: String,
    pub found: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawPrelabelResult {
    shapes: Vec<RawPrelabelShape>,
    #[serde(default)]
    cancelled: bool,
    completed_image_paths: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawPrelabelShape {
    image_path: Option<String>,
    id: String,
    #[serde(rename = "type")]
    shape_type: String,
    label_id: String,
    points: Vec<f64>,
    attributes: Option<Map<String, Value>>,
    frame_index: Option<u32>,
}

pub fn load_plugin_prelabel_sources(
    app_data_dir: &Path,
    project_folder: Option<&Path>,
) -> PluginPrelabelSourceSnapshot {
    let registry = load_plugin_registry(app_data_dir);
    let safe_mode = load_plugin_runtime_settings(app_data_dir)
        .map(|settings| settings.safe_mode)
        .unwrap_or(true);
    let mut sources = registry
        .plugins
        .into_iter()
        .filter(|plugin| plugin.extension_kind == PluginExtensionKind::Prelabel)
        .map(|plugin| {
            let has_read_grant = project_folder
                .is_some_and(|folder| has_exact_project_read_grant(&plugin.grants, folder));
            let enabled = plugin.state == PluginState::Enabled
                && plugin.last_error.is_none()
                && !safe_mode
                && has_read_grant;
            let disabled_reason = if safe_mode {
                Some(text::PLUGIN_RUNTIME_SAFE_MODE.to_string())
            } else if plugin.state != PluginState::Enabled {
                plugin_state_disabled_reason(plugin.state)
            } else if let Some(error) = plugin.last_error.clone() {
                Some(error)
            } else if !has_read_grant {
                Some(text::PLUGIN_PRELABEL_READ_PERMISSION_REQUIRED.to_string())
            } else {
                None
            };
            PluginPrelabelSourceDescriptor {
                selection_id: format!("plugin:{}", plugin.id),
                plugin_id: plugin.id,
                plugin_name: plugin.name,
                class_names: plugin
                    .prelabel_options
                    .map(|options| options.class_names)
                    .unwrap_or_default(),
                annotation_types: plugin.capabilities.annotation_types,
                enabled,
                disabled_reason,
                supports_batch: plugin.capabilities.batch,
                supports_progress: plugin.capabilities.progress,
                supports_cancel: plugin.capabilities.cancel,
            }
        })
        .collect::<Vec<_>>();
    sources.sort_by(|left, right| left.selection_id.cmp(&right.selection_id));
    PluginPrelabelSourceSnapshot {
        sources,
        warning: registry.warning,
    }
}

pub fn run_plugin_prelabel(
    app_data_dir: &Path,
    request: PluginPrelabelRequest,
    on_event: impl Fn(Value) + Send + Sync + 'static,
) -> Result<PluginPrelabelResult, PluginCallError> {
    validate_request(&request)?;
    let source = load_plugin_prelabel_sources(app_data_dir, Some(&request.project_folder))
        .sources
        .into_iter()
        .find(|source| source.plugin_id == request.plugin_id)
        .ok_or_else(|| {
            prelabel_error("INVALID_ARGUMENT", text::PLUGIN_PRELABEL_SOURCE_NOT_FOUND)
        })?;
    if !source.enabled {
        return Err(prelabel_error(
            "PLUGIN_DISABLED",
            source
                .disabled_reason
                .as_deref()
                .unwrap_or(text::PLUGIN_RUNTIME_DISABLED),
        ));
    }
    if request.image_paths.len() > 1 && !source.supports_batch {
        return Err(prelabel_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_PRELABEL_ARGUMENT_INVALID,
        ));
    }

    let active = register_operation(&request.operation_id)?;
    let _guard = ActivePrelabelGuard {
        operation_id: request.operation_id.clone(),
        plugin_id: request.plugin_id.clone(),
        cancelled: Arc::clone(&active.cancelled),
    };
    let hooks = PluginCallHooks::new(Arc::clone(&active.cancelled), on_event)
        .with_deferred_success_recording()
        .with_cancelled_result();
    let result = invoke_plugin_with_hooks(
        app_data_dir,
        &request.plugin_id,
        "prelabel.run",
        json!({
            "imagePaths": request.image_paths,
            "classMappings": request.class_mappings,
            "params": request.params,
        }),
        &hooks,
    )?;
    let cancelled = active.cancelled.load(Ordering::Acquire);
    let images = match validate_result(result, &request, &source, cancelled) {
        Ok(images) => images,
        Err(error) => {
            record_plugin_runtime_failure(app_data_dir, &request.plugin_id, &error.message)
                .map_err(|persist_error| {
                    prelabel_error(
                        "INTERNAL_ERROR",
                        &text::plugin_failure_persist_failed(&error.message, persist_error.message),
                    )
                })?;
            return Err(error);
        }
    };
    record_plugin_runtime_success(app_data_dir, &request.plugin_id).map_err(|persist_error| {
        prelabel_error(
            "INTERNAL_ERROR",
            &text::plugin_failure_persist_failed(
                text::PLUGIN_PRELABEL_SUCCESS_PERSIST_CONTEXT,
                persist_error.message,
            ),
        )
    })?;
    Ok(PluginPrelabelResult { images, cancelled })
}

pub fn cancel_plugin_prelabel(operation_id: &str) -> PluginPrelabelCancellationResult {
    let operation = active_operations()
        .lock()
        .ok()
        .and_then(|operations| operations.get(operation_id).cloned());
    let found = operation.is_some();
    if let Some(operation) = operation {
        operation.cancelled.store(true, Ordering::Release);
    }
    PluginPrelabelCancellationResult {
        operation_id: operation_id.to_string(),
        found,
    }
}

fn validate_request(request: &PluginPrelabelRequest) -> Result<(), PluginCallError> {
    if !is_operation_id(&request.operation_id)
        || request.plugin_id.trim().is_empty()
        || !request.project_folder.is_absolute()
        || !request.project_folder.is_dir()
        || request.image_paths.is_empty()
        || request.image_paths.len() > MAX_PRELABEL_IMAGES_PER_CALL
        || request
            .image_paths
            .iter()
            .any(|path| !is_safe_project_path(path))
        || request
            .image_paths
            .iter()
            .map(|path| path.to_ascii_lowercase())
            .collect::<HashSet<_>>()
            .len()
            != request.image_paths.len()
        || request.class_mappings.iter().any(|mapping| {
            mapping.model_class.trim().is_empty()
                || mapping.label_id.trim().is_empty()
                || mapping.label_name.trim().is_empty()
        })
        || request
            .class_mappings
            .iter()
            .map(|mapping| mapping.model_class.as_str())
            .collect::<HashSet<_>>()
            .len()
            != request.class_mappings.len()
    {
        return Err(prelabel_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_PRELABEL_ARGUMENT_INVALID,
        ));
    }
    Ok(())
}

fn validate_result(
    value: Value,
    request: &PluginPrelabelRequest,
    source: &PluginPrelabelSourceDescriptor,
    host_cancelled: bool,
) -> Result<Vec<PluginPrelabelImageResult>, PluginCallError> {
    let raw: RawPrelabelResult = serde_json::from_value(value)
        .map_err(|_| prelabel_error("INVALID_ARGUMENT", text::PLUGIN_PRELABEL_RESULT_INVALID))?;
    if raw.shapes.len() > MAX_PRELABEL_SHAPES_PER_CALL {
        return Err(prelabel_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_PRELABEL_RESULT_INVALID,
        ));
    }
    if raw.cancelled && !host_cancelled {
        return Err(prelabel_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_PRELABEL_RESULT_INVALID,
        ));
    }
    let paths = request
        .image_paths
        .iter()
        .map(|path| (path.to_ascii_lowercase(), path.clone()))
        .collect::<HashMap<_, _>>();
    let label_ids = request
        .class_mappings
        .iter()
        .map(|mapping| mapping.label_id.as_str())
        .collect::<HashSet<_>>();
    let allowed_types = source
        .annotation_types
        .iter()
        .map(annotation_type_name)
        .collect::<HashSet<_>>();
    let completed_paths = if raw.cancelled {
        let completed_image_paths = raw.completed_image_paths.as_ref().ok_or_else(|| {
            prelabel_error("INVALID_ARGUMENT", text::PLUGIN_PRELABEL_RESULT_INVALID)
        })?;
        let unique = completed_image_paths
            .iter()
            .map(|path| path.to_ascii_lowercase())
            .collect::<HashSet<_>>();
        if unique.len() != completed_image_paths.len()
            || completed_image_paths
                .iter()
                .any(|path| !paths.contains_key(&path.to_ascii_lowercase()))
        {
            return Err(invalid_shape());
        }
        completed_image_paths
            .iter()
            .filter_map(|path| paths.get(&path.to_ascii_lowercase()).cloned())
            .collect::<Vec<_>>()
    } else {
        if raw
            .completed_image_paths
            .as_ref()
            .is_some_and(|paths| !paths.is_empty())
        {
            return Err(invalid_shape());
        }
        request.image_paths.clone()
    };
    let completed_lookup = completed_paths
        .iter()
        .map(|path| path.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut grouped = completed_paths
        .iter()
        .map(|path| (path.clone(), Vec::new()))
        .collect::<HashMap<_, Vec<AnnotationShape>>>();
    let mut ids = HashSet::new();
    for shape in raw.shapes {
        let image_path = match shape.image_path {
            Some(path) => paths.get(&path.to_ascii_lowercase()).cloned(),
            None if request.image_paths.len() == 1 => request.image_paths.first().cloned(),
            None => None,
        }
        .ok_or_else(invalid_shape)?;
        if shape.id.trim().is_empty()
            || !completed_lookup.contains(&image_path.to_ascii_lowercase())
            || !ids.insert((image_path.to_ascii_lowercase(), shape.id.clone()))
            || !label_ids.contains(shape.label_id.as_str())
            || !allowed_types.contains(shape.shape_type.as_str())
            || shape.points.len() > MAX_PRELABEL_POINTS_PER_SHAPE
            || !points_are_valid(&shape.shape_type, &shape.points)
            || shape.frame_index.is_some_and(|frame| frame != 0)
            || shape
                .attributes
                .as_ref()
                .is_some_and(|attributes| !attributes_are_valid(attributes))
        {
            return Err(invalid_shape());
        }
        grouped
            .get_mut(&image_path)
            .ok_or_else(invalid_shape)?
            .push(AnnotationShape {
                id: shape.id,
                shape_type: shape.shape_type,
                label_id: shape.label_id,
                points: shape.points,
                attributes: shape.attributes.map(Value::Object),
                frame_index: Some(0),
            });
    }
    Ok(completed_paths
        .iter()
        .map(|path| PluginPrelabelImageResult {
            image_path: path.clone(),
            shapes: grouped.remove(path).unwrap_or_default(),
        })
        .collect())
}

fn has_exact_project_read_grant(
    grants: &[super::registry::PluginPermissionGrant],
    project_folder: &Path,
) -> bool {
    let Ok(canonical_project) = fs::canonicalize(project_folder) else {
        return false;
    };
    let Ok(project_root) = normalize_for_comparison(&canonical_project) else {
        return false;
    };
    let matching = grants
        .iter()
        .filter(|grant| grant.permission == "fs.read")
        .filter_map(|grant| grant.target.as_deref())
        .filter_map(|target| normalize_for_comparison(Path::new(target)).ok())
        .filter(|target| target == &project_root)
        .count();
    matching == 1
        && grants
            .iter()
            .filter(|grant| grant.permission == "fs.read")
            .count()
            == 1
}

fn points_are_valid(shape_type: &str, points: &[f64]) -> bool {
    let nonnegative = points
        .iter()
        .all(|point| point.is_finite() && *point >= 0.0);
    nonnegative
        && match shape_type {
            "rect" => points.len() == 4 && points[2] > 0.0 && points[3] > 0.0,
            "polygon" => points.len() >= 6 && points.len().is_multiple_of(2),
            "point" => points.len() == 2,
            _ => false,
        }
}

fn attributes_are_valid(attributes: &Map<String, Value>) -> bool {
    attributes.values().all(|value| {
        value.is_string() || value.is_boolean() || value.as_f64().is_some_and(f64::is_finite)
    }) && attributes.get("confidence").is_none_or(|value| {
        value
            .as_f64()
            .is_some_and(|confidence| (0.0..=1.0).contains(&confidence))
    })
}

fn annotation_type_name(annotation_type: &PluginAnnotationType) -> &'static str {
    match annotation_type {
        PluginAnnotationType::Rect => "rect",
        PluginAnnotationType::Polygon => "polygon",
        PluginAnnotationType::Point => "point",
    }
}

fn is_safe_project_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.trim().is_empty()
        && !path.is_absolute()
        && !value.contains(':')
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn is_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn register_operation(operation_id: &str) -> Result<ActivePrelabelOperation, PluginCallError> {
    let mut operations = active_operations()
        .lock()
        .map_err(|_| prelabel_error("INTERNAL_ERROR", text::PLUGIN_RUNTIME_LOCK_POISONED))?;
    if operations.contains_key(operation_id) {
        return Err(prelabel_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_PRELABEL_ALREADY_RUNNING,
        ));
    }
    let operation = ActivePrelabelOperation {
        cancelled: Arc::new(AtomicBool::new(false)),
    };
    operations.insert(operation_id.to_string(), operation.clone());
    Ok(operation)
}

fn active_operations() -> &'static Mutex<HashMap<String, ActivePrelabelOperation>> {
    ACTIVE_PRELABEL_OPERATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ActivePrelabelGuard {
    operation_id: String,
    plugin_id: String,
    cancelled: Arc<AtomicBool>,
}

impl Drop for ActivePrelabelGuard {
    fn drop(&mut self) {
        if let Ok(mut operations) = active_operations().lock() {
            operations.remove(&self.operation_id);
        }
        if self.cancelled.load(Ordering::Acquire) {
            stop_plugin_process(&self.plugin_id);
        }
    }
}

fn invalid_shape() -> PluginCallError {
    prelabel_error("INVALID_ARGUMENT", text::PLUGIN_PRELABEL_SHAPE_INVALID)
}

fn prelabel_error(code: &str, message: &str) -> PluginCallError {
    PluginCallError::external(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn source(batch: bool) -> PluginPrelabelSourceDescriptor {
        PluginPrelabelSourceDescriptor {
            selection_id: "plugin:dev.test.prelabel".to_string(),
            plugin_id: "dev.test.prelabel".to_string(),
            plugin_name: "Test".to_string(),
            class_names: vec!["car".to_string()],
            annotation_types: vec![PluginAnnotationType::Rect],
            enabled: true,
            disabled_reason: None,
            supports_batch: batch,
            supports_progress: true,
            supports_cancel: true,
        }
    }

    fn request(paths: &[&str]) -> PluginPrelabelRequest {
        PluginPrelabelRequest {
            plugin_id: "dev.test.prelabel".to_string(),
            project_folder: std::env::current_dir().expect("current directory"),
            image_paths: paths.iter().map(|path| (*path).to_string()).collect(),
            class_mappings: vec![PluginPrelabelClassMapping {
                model_class: "car".to_string(),
                label_id: "vehicle".to_string(),
                label_name: "车辆".to_string(),
            }],
            params: Map::new(),
            operation_id: "operation-1".to_string(),
        }
    }

    #[test]
    fn validates_and_routes_single_and_batch_shapes() {
        let single = request(&["images/a.jpg"]);
        let result = validate_result(
            json!({"shapes":[{
                "id":"one","type":"rect","labelId":"vehicle","points":[1,2,3,4],
                "attributes":{"confidence":0.8}
            }]}),
            &single,
            &source(false),
            false,
        )
        .expect("single result");
        assert_eq!(result[0].image_path, "images/a.jpg");
        assert_eq!(result[0].shapes.len(), 1);

        let batch = request(&["images/a.jpg", "images/b.jpg"]);
        let result = validate_result(
            json!({"shapes":[
                {"imagePath":"images/b.jpg","id":"two","type":"rect","labelId":"vehicle","points":[1,2,3,4]},
                {"imagePath":"images/a.jpg","id":"one","type":"rect","labelId":"vehicle","points":[5,6,7,8]}
            ]}),
            &batch,
            &source(true),
            false,
        )
        .expect("batch result");
        assert_eq!(result[0].image_path, "images/a.jpg");
        assert_eq!(result[0].shapes[0].id, "one");
        assert_eq!(result[1].shapes[0].id, "two");
    }

    #[test]
    fn rejects_unknown_labels_invalid_coordinates_and_ambiguous_batch_routes() {
        let batch = request(&["images/a.jpg", "images/b.jpg"]);
        for value in [
            json!({"shapes":[{"imagePath":"images/a.jpg","id":"one","type":"rect","labelId":"unknown","points":[1,2,3,4]}]}),
            json!({"shapes":[{"imagePath":"images/a.jpg","id":"one","type":"rect","labelId":"vehicle","points":[-1,2,3,4]}]}),
            json!({"shapes":[{"id":"one","type":"rect","labelId":"vehicle","points":[1,2,3,4]}]}),
        ] {
            assert_eq!(
                validate_result(value, &batch, &source(true), false)
                    .expect_err("invalid plugin shape")
                    .code,
                "INVALID_ARGUMENT"
            );
        }
    }

    #[test]
    fn cancelled_batch_keeps_only_valid_completed_images() {
        let batch = request(&["images/a.jpg", "images/b.jpg"]);
        let result = validate_result(
            json!({
                "cancelled": true,
                "completedImagePaths": ["images/a.jpg"],
                "shapes": [{
                    "imagePath":"images/a.jpg","id":"one","type":"rect",
                    "labelId":"vehicle","points":[1,2,3,4]
                }]
            }),
            &batch,
            &source(true),
            true,
        )
        .expect("partial cancelled result");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].image_path, "images/a.jpg");

        assert!(validate_result(
            json!({
                "cancelled": true,
                "completedImagePaths": ["images/a.jpg"],
                "shapes": [{
                    "imagePath":"images/b.jpg","id":"two","type":"rect",
                    "labelId":"vehicle","points":[1,2,3,4]
                }]
            }),
            &batch,
            &source(true),
            true,
        )
        .is_err());
        assert!(validate_result(
            json!({ "cancelled": true, "shapes": [] }),
            &batch,
            &source(true),
            true,
        )
        .is_err());
    }

    #[test]
    fn rejects_unsafe_input_paths_and_duplicate_operations() {
        assert!(validate_request(&request(&["../secret.jpg"])).is_err());
        let operation = register_operation("unique-operation").expect("register operation");
        assert!(register_operation("unique-operation").is_err());
        active_operations()
            .lock()
            .expect("active operations")
            .remove("unique-operation");
        assert!(!operation.cancelled.load(Ordering::Acquire));
    }

    #[test]
    fn project_read_grant_must_match_the_current_project_exactly() {
        let root = test_directory("project-grant");
        let current = root.join("current");
        let old = root.join("old");
        fs::create_dir_all(&current).expect("current project");
        fs::create_dir_all(&old).expect("old project");
        let grant = |path: &Path| super::super::registry::PluginPermissionGrant {
            permission: "fs.read".to_string(),
            target: Some(
                fs::canonicalize(path)
                    .expect("canonical grant")
                    .to_string_lossy()
                    .into_owned(),
            ),
        };

        assert!(has_exact_project_read_grant(&[grant(&current)], &current));
        assert!(!has_exact_project_read_grant(&[grant(&old)], &current));
        assert!(!has_exact_project_read_grant(
            &[grant(&current), grant(&old)],
            &current,
        ));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn host_runtime_reads_project_image_and_validates_plugin_shapes() {
        let _isolation = crate::process_control::windows_isolation_test_guard();
        use crate::plugins::manifest::{
            PluginApiVersionTarget, PluginCapabilities, PluginCapabilityVersion, PluginEntry,
            PluginPrelabelOptions,
        };
        use crate::plugins::permissions::PluginPermissionGrant;
        use crate::plugins::registry::PluginRegistryEntry;

        let root = test_directory("host-flow");
        let project = root.join("project");
        let plugin_id = "dev.test.prelabelhost";
        let package = root.join("plugins").join(plugin_id);
        fs::create_dir_all(&package).expect("plugin package");
        crate::process_control::install_plugin_test_stub(&package);
        fs::create_dir_all(project.join("images")).expect("project images");
        fs::write(project.join("images/a.bin"), b"image-bytes").expect("image fixture");
        let capability = PluginCapabilityVersion {
            api_version: PluginApiVersionTarget { min: 1 },
        };
        let entry = PluginRegistryEntry {
            id: plugin_id.to_string(),
            name: "Prelabel host flow".to_string(),
            version: "1.0.0".to_string(),
            extension_kind: PluginExtensionKind::Prelabel,
            entry: Some(PluginEntry {
                command: crate::process_control::PLUGIN_TEST_STUB_FILENAME.to_string(),
                args: vec!["--fixture".to_string(), "prelabel-host".to_string()],
            }),
            exporter_options: None,
            prelabel_options: Some(PluginPrelabelOptions {
                class_names: vec!["car".to_string()],
            }),
            capabilities: PluginCapabilities {
                annotation_types: vec![PluginAnnotationType::Rect],
                batch: true,
                progress: false,
                cancel: false,
                config_migration: false,
                exporter: capability.clone(),
                prelabel: capability,
            },
            grants: vec![PluginPermissionGrant {
                permission: "fs.read".to_string(),
                target: Some(
                    fs::canonicalize(&project)
                        .expect("canonical project")
                        .to_string_lossy()
                        .into_owned(),
                ),
            }],
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
        let mut request = request(&["images/a.bin"]);
        request.plugin_id = plugin_id.to_string();
        request.project_folder = project;
        request.operation_id = "host-flow".to_string();
        let result = run_plugin_prelabel(&root, request, |_| {}).expect("plugin prelabel");
        assert_eq!(result.images[0].shapes.len(), 1);
        assert_eq!(result.images[0].shapes[0].label_id, "vehicle");
        assert_eq!(result.images[0].shapes[0].points, vec![1.0, 2.0, 3.0, 4.0]);
        stop_plugin_process(plugin_id);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "my-label-tool-prelabel-{name}-{}-{nonce}",
            std::process::id()
        ))
    }
}
