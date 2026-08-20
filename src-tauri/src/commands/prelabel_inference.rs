use std::path::PathBuf;

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
    let mut session = PrelabelSession::from_config(model)?;
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
