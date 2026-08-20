use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

use serde::Serialize;

use crate::{
    commands::prelabel_runtime::{ensure_runtime_available, runtime_directory},
    media::prelabel::{inference::PrelabelSession, pipeline::Detection},
    models::prelabel::PrelabelModelConfig,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrelabelImageInference {
    image_path: String,
    detections: Vec<Detection>,
}

#[derive(PartialEq)]
struct SessionCacheKey {
    model: PrelabelModelConfig,
    file_length: u64,
    modified_at: Option<SystemTime>,
}

struct CachedValue<K, V> {
    key: K,
    value: V,
}

static SESSION_CACHE: OnceLock<Mutex<Option<CachedValue<SessionCacheKey, PrelabelSession>>>> =
    OnceLock::new();

#[tauri::command]
pub async fn run_prelabel_inference(
    app: tauri::AppHandle,
    model: PrelabelModelConfig,
    image_paths: Vec<PathBuf>,
) -> Result<Vec<PrelabelImageInference>, String> {
    let runtime_directory = runtime_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_prelabel_inference_blocking(&runtime_directory, &model, image_paths)
    })
    .await
    .map_err(crate::i18n::zh_cn::prelabel_worker_failed)?
}

fn run_prelabel_inference_blocking(
    runtime_directory: &std::path::Path,
    model: &PrelabelModelConfig,
    image_paths: Vec<PathBuf>,
) -> Result<Vec<PrelabelImageInference>, String> {
    ensure_runtime_available(runtime_directory)?;
    let key = session_cache_key(model)?;
    let cache = SESSION_CACHE.get_or_init(|| Mutex::new(None));
    let mut cache = cache
        .lock()
        .map_err(|_| crate::i18n::zh_cn::PRELABEL_SESSION_CACHE_LOCK_FAILED.to_string())?;
    let session = get_or_try_insert(&mut cache, key, || PrelabelSession::from_config(model))?;
    image_paths
        .into_iter()
        .map(|image_path| {
            let detections = session.infer_file(&image_path)?;
            Ok(PrelabelImageInference {
                image_path: image_path.to_string_lossy().into_owned(),
                detections,
            })
        })
        .collect()
}

fn session_cache_key(model: &PrelabelModelConfig) -> Result<SessionCacheKey, String> {
    let metadata = fs::metadata(&model.path)
        .map_err(|error| crate::i18n::zh_cn::prelabel_model_metadata_failed(&model.path, error))?;
    Ok(SessionCacheKey {
        model: model.clone(),
        file_length: metadata.len(),
        modified_at: metadata.modified().ok(),
    })
}

fn get_or_try_insert<K: PartialEq, V, E>(
    cache: &mut Option<CachedValue<K, V>>,
    key: K,
    create: impl FnOnce() -> Result<V, E>,
) -> Result<&mut V, E> {
    if cache.as_ref().is_none_or(|cached| cached.key != key) {
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

    use super::{get_or_try_insert, run_prelabel_inference_blocking, CachedValue};
    use crate::models::prelabel::{PrelabelModelConfig, YoloModelFormat};

    #[test]
    fn reuses_a_cached_session_until_its_model_key_changes() {
        let loads = Cell::new(0);
        let mut cache: Option<CachedValue<&str, usize>> = None;
        let mut load = || -> Result<usize, ()> {
            loads.set(loads.get() + 1);
            Ok(loads.get())
        };

        assert_eq!(
            *get_or_try_insert(&mut cache, "model-a", &mut load).unwrap(),
            1
        );
        assert_eq!(
            *get_or_try_insert(&mut cache, "model-a", &mut load).unwrap(),
            1
        );
        assert_eq!(
            *get_or_try_insert(&mut cache, "model-b", &mut load).unwrap(),
            2
        );
        assert_eq!(loads.get(), 2);
    }

    #[test]
    #[ignore = "requires external ONNX Runtime and ignored official YOLOv8/image fixtures"]
    fn reuses_the_command_session_cache_across_frontend_chunks() {
        let runtime_directory = fixture("MY_LABEL_TOOL_ORT_DIR");
        let model_path = fixture("MY_LABEL_TOOL_YOLOV8_ONNX");
        let image_path = fixture("MY_LABEL_TOOL_YOLO_IMAGE");
        let model = PrelabelModelConfig {
            id: "official-yolov8".to_string(),
            name: "YOLOv8n".to_string(),
            path: model_path.to_string_lossy().into_owned(),
            format: YoloModelFormat::YoloV8,
            class_count: 80,
            input_width: 640,
            input_height: 640,
            input_size_override: None,
            class_names: (0..80).map(|index| format!("class_{index}")).collect(),
            confidence_threshold: 0.25,
            iou_threshold: 0.7,
            added_at: "2026-08-20T00:00:00.000Z".to_string(),
        };

        let first =
            run_prelabel_inference_blocking(&runtime_directory, &model, vec![image_path.clone()])
                .unwrap();
        let second =
            run_prelabel_inference_blocking(&runtime_directory, &model, vec![image_path]).unwrap();

        assert_eq!(first[0].detections, second[0].detections);
        assert!(!first[0].detections.is_empty());
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(std::env::var(name).unwrap_or_else(|_| panic!("{name} is required")))
    }
}
