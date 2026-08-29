use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::SystemTime,
};

use serde::Serialize;
use tauri::ipc::Channel;

use crate::{
    i18n::zh_cn as text,
    media::prelabel::{
        inference::PrelabelSession,
        pipeline::Detection,
        runtime_download::{ensure_runtime_available, runtime_directory},
        task::{CancelHandle, CancellationResult, CancellationToken, TaskRegistry},
    },
    models::prelabel::PrelabelModelConfig,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrelabelImageInference {
    image_path: String,
    detections: Vec<Detection>,
}

/// Per-image progress emitted while a prelabel task runs.
#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PrelabelProgressEvent {
    /// Emitted before the (possibly slow, one-time) session/model load.
    ModelLoading,
    Started {
        index: usize,
        total: usize,
        image_path: String,
    },
    Completed {
        index: usize,
        total: usize,
    },
}

/// The result of one prelabel task. `cancelled` distinguishes a user-initiated abort (which still
/// returns the images processed so far) from a hard failure (which returns `Err`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrelabelInferenceOutcome {
    results: Vec<PrelabelImageInference>,
    cancelled: bool,
}

#[derive(PartialEq)]
struct SessionCacheKey {
    model: PrelabelModelConfig,
    file_length: u64,
    modified_at: SystemTime,
}

struct CachedValue<K, V> {
    key: K,
    value: V,
}

static SESSION_CACHE: OnceLock<Mutex<Option<CachedValue<SessionCacheKey, PrelabelSession>>>> =
    OnceLock::new();

static PRELABEL_TASKS: OnceLock<TaskRegistry<CancellationToken>> = OnceLock::new();

fn prelabel_tasks() -> &'static TaskRegistry<CancellationToken> {
    PRELABEL_TASKS.get_or_init(|| TaskRegistry::new(text::PRELABEL_TASK_LABEL))
}

/// Runs a cancellable prelabel inference task end to end: registers a token under `task_id`, spawns
/// the blocking worker, and cleans up the registry entry on completion. Emits `on_progress` events
/// as the worker advances.
pub async fn run_prelabel_inference_task(
    app: tauri::AppHandle,
    task_id: String,
    model: PrelabelModelConfig,
    image_paths: Vec<PathBuf>,
    on_progress: Channel<PrelabelProgressEvent>,
) -> Result<PrelabelInferenceOutcome, String> {
    let token = Arc::new(CancellationToken::new());
    prelabel_tasks().register(&task_id, Arc::clone(&token))?;
    let runtime_directory = runtime_directory(&app)?;
    let for_task = Arc::clone(&token);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        run_prelabel_inference_blocking(
            &runtime_directory,
            &model,
            image_paths,
            &for_task,
            |event| {
                let _ = on_progress.send(event.clone());
            },
        )
    })
    .await;
    prelabel_tasks().remove(&task_id);
    outcome.map_err(text::prelabel_worker_failed)?
}

fn run_prelabel_inference_blocking(
    runtime_directory: &Path,
    model: &PrelabelModelConfig,
    image_paths: Vec<PathBuf>,
    token: &CancellationToken,
    mut on_progress: impl FnMut(&PrelabelProgressEvent),
) -> Result<PrelabelInferenceOutcome, String> {
    if token.is_cancelled() {
        return Ok(cancelled_outcome(Vec::new()));
    }
    ensure_runtime_available(runtime_directory)?;
    let key = session_cache_key(model)?;
    let cache = SESSION_CACHE.get_or_init(|| Mutex::new(None));
    let mut cache = cache
        .lock()
        .map_err(|_| text::PRELABEL_SESSION_CACHE_LOCK_FAILED.to_string())?;
    let session = get_or_try_insert(
        &mut cache,
        key,
        || PrelabelSession::from_config(model),
        || on_progress(&PrelabelProgressEvent::ModelLoading),
    )?;
    let total = image_paths.len();
    let mut results = Vec::new();
    let mut cancelled = false;
    for (index, image_path) in image_paths.into_iter().enumerate() {
        if token.is_cancelled() {
            cancelled = true;
            break;
        }
        on_progress(&PrelabelProgressEvent::Started {
            index,
            total,
            image_path: image_path.to_string_lossy().into_owned(),
        });
        let detections = session.infer_file(&image_path)?;
        on_progress(&PrelabelProgressEvent::Completed { index, total });
        results.push(PrelabelImageInference {
            image_path: image_path.to_string_lossy().into_owned(),
            detections,
        });
    }
    Ok(PrelabelInferenceOutcome { results, cancelled })
}

fn cancelled_outcome(results: Vec<PrelabelImageInference>) -> PrelabelInferenceOutcome {
    PrelabelInferenceOutcome {
        results,
        cancelled: true,
    }
}

fn session_cache_key(model: &PrelabelModelConfig) -> Result<SessionCacheKey, String> {
    let metadata = fs::metadata(&model.path)
        .map_err(|error| text::prelabel_model_metadata_failed(&model.path, error))?;
    let modified_at = metadata
        .modified()
        .map_err(|error| text::prelabel_model_modified_time_failed(&model.path, error))?;
    Ok(SessionCacheKey {
        model: model.clone(),
        file_length: metadata.len(),
        modified_at,
    })
}

/// Cancels the prelabel task with the given id. A finished (removed) task reports
/// [`CancellationResult`] with `AlreadyCompleted` rather than an error, so the command layer and
/// frontend treat it as benign.
pub fn cancel_prelabel_task(task_id: &str) -> Result<CancellationResult, String> {
    prelabel_tasks().cancel(task_id)
}

/// Flags every active prelabel task as cancelled. Used on app exit.
pub fn cancel_all_prelabel_tasks() {
    prelabel_tasks().cancel_all();
}

fn get_or_try_insert<K: PartialEq, V, E>(
    cache: &mut Option<CachedValue<K, V>>,
    key: K,
    create: impl FnOnce() -> Result<V, E>,
    on_create: impl FnOnce(),
) -> Result<&mut V, E> {
    if cache.as_ref().is_none_or(|cached| cached.key != key) {
        on_create();
        *cache = Some(CachedValue {
            key,
            value: create()?,
        });
    }
    match cache.as_mut() {
        Some(cached) => Ok(&mut cached.value),
        None => unreachable!("cache is populated before access"),
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, path::PathBuf};

    use super::{
        cancelled_outcome, get_or_try_insert, run_prelabel_inference_blocking, CachedValue,
        PrelabelProgressEvent,
    };
    use crate::media::prelabel::task::{CancelHandle, CancellationToken};
    use crate::models::prelabel::{PrelabelDevice, PrelabelModelConfig, YoloModelFormat};

    #[test]
    fn reuses_a_cached_session_until_its_model_key_changes() {
        let loads = Cell::new(0);
        let loading_events = Cell::new(0);
        let mut cache: Option<CachedValue<&str, usize>> = None;

        assert_eq!(
            *get_or_try_insert(
                &mut cache,
                "model-a",
                || {
                    loads.set(loads.get() + 1);
                    Ok::<_, ()>(loads.get())
                },
                || loading_events.set(loading_events.get() + 1),
            )
            .unwrap(),
            1
        );
        assert_eq!(
            *get_or_try_insert(
                &mut cache,
                "model-a",
                || {
                    loads.set(loads.get() + 1);
                    Ok::<_, ()>(loads.get())
                },
                || loading_events.set(loading_events.get() + 1),
            )
            .unwrap(),
            1
        );
        assert_eq!(
            *get_or_try_insert(
                &mut cache,
                "model-b",
                || {
                    loads.set(loads.get() + 1);
                    Ok::<_, ()>(loads.get())
                },
                || loading_events.set(loading_events.get() + 1),
            )
            .unwrap(),
            2
        );
        assert_eq!(loads.get(), 2);
        assert_eq!(loading_events.get(), 2);
    }

    #[test]
    fn cancelled_outcome_flags_cancelled() {
        let outcome = cancelled_outcome(Vec::new());
        assert!(outcome.cancelled);
        assert!(outcome.results.is_empty());
    }

    #[test]
    fn pre_cancelled_token_returns_empty_cancelled_outcome() {
        // Cancelling before the worker starts must stop it before any inference runs; this path
        // does not require a session, so it is exercised here even without external ONNX fixtures.
        let token = CancellationToken::new();
        token.cancel();
        let events = Cell::new(0);
        let outcome = run_prelabel_inference_blocking(
            std::path::Path::new("/nonexistent-runtime"),
            &sample_model(),
            vec![PathBuf::from("a.png")],
            &token,
            |_| events.set(events.get() + 1),
        )
        .unwrap();

        assert!(outcome.cancelled);
        assert!(outcome.results.is_empty());
        assert_eq!(events.get(), 0);
    }

    #[test]
    fn progress_events_round_trip_a_completed_image() {
        let events: Vec<PrelabelProgressEvent> = vec![PrelabelProgressEvent::ModelLoading];
        assert_eq!(
            serde_json::to_value(&events[0]).unwrap()["event"],
            "modelLoading"
        );
        let started = PrelabelProgressEvent::Started {
            index: 0,
            total: 3,
            image_path: "/x.png".to_string(),
        };
        let value = serde_json::to_value(&started).unwrap();
        assert_eq!(value["event"], "started");
        assert_eq!(value["imagePath"], "/x.png");
        assert_eq!(value["total"], 3);
    }

    #[test]
    #[ignore = "requires external ONNX Runtime and ignored official YOLOv8/image fixtures"]
    fn reuses_the_session_cache_across_frontend_chunks() {
        let runtime_directory = fixture("MY_LABEL_TOOL_ORT_DIR");
        let model_path = fixture("MY_LABEL_TOOL_YOLOV8_ONNX");
        let image_path = fixture("MY_LABEL_TOOL_YOLO_IMAGE");
        let mut model = sample_model_with_path(model_path);
        // Pin this cache test to CPU so its result is independent of runner GPU availability.
        model.device = PrelabelDevice::Cpu;

        let first = run_prelabel_inference_blocking(
            &runtime_directory,
            &model,
            vec![image_path.clone()],
            &CancellationToken::new(),
            |_| {},
        )
        .unwrap();
        let second = run_prelabel_inference_blocking(
            &runtime_directory,
            &model,
            vec![image_path],
            &CancellationToken::new(),
            |_| {},
        )
        .unwrap();

        assert_eq!(first.results[0].detections, second.results[0].detections);
        assert!(!first.results[0].detections.is_empty());
    }

    fn sample_model() -> PrelabelModelConfig {
        PrelabelModelConfig {
            id: "test-model".to_string(),
            name: "test model".to_string(),
            path: "nonexistent.onnx".to_string(),
            format: YoloModelFormat::YoloV8,
            class_count: 80,
            input_width: 640,
            input_height: 640,
            input_size_override: None,
            class_names: (0..80).map(|index| format!("class_{index}")).collect(),
            confidence_threshold: 0.25,
            iou_threshold: 0.7,
            added_at: "2026-08-20T00:00:00.000Z".to_string(),
            device: PrelabelDevice::Auto,
        }
    }

    fn sample_model_with_path(path: PathBuf) -> PrelabelModelConfig {
        let mut model = sample_model();
        model.path = path.to_string_lossy().into_owned();
        model
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(std::env::var(name).unwrap_or_else(|_| panic!("{name} is required")))
    }
}
