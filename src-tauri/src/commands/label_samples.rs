use crate::media::label_sample_crops::{self, Crop, CropBounds};
use crate::{
    i18n::zh_cn as text,
    media::label_samples::{self, Change, Sample},
};
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub async fn preview_project_label_sample(
    folder: PathBuf,
    path: PathBuf,
    bounds: CropBounds,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        label_sample_crops::preview(&folder, &path, bounds)
    })
    .await
    .map_err(text::label_sample_error)?
}

#[tauri::command]
pub async fn create_label_sample_crop(
    app: tauri::AppHandle,
    folder: PathBuf,
    path: PathBuf,
    bounds: CropBounds,
) -> Result<Crop, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(text::label_sample_error)?
        .join("label-sample-crops");
    tauri::async_runtime::spawn_blocking(move || {
        label_sample_crops::create(&folder, &path, bounds, &cache)
    })
    .await
    .map_err(text::label_sample_error)?
}

#[tauri::command]
pub async fn discard_label_sample_crop(path: PathBuf) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || label_sample_crops::discard(&path))
        .await
        .map_err(text::label_sample_error)?
}

#[tauri::command]
pub async fn list_label_samples(folder: PathBuf) -> Result<Vec<Sample>, String> {
    tauri::async_runtime::spawn_blocking(move || label_samples::list(&folder))
        .await
        .map_err(text::label_sample_error)?
}

#[tauri::command]
pub async fn preview_label_sample(path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || label_samples::preview(&path))
        .await
        .map_err(text::label_sample_error)?
}

#[tauri::command]
pub async fn prepare_label_samples(folder: PathBuf, changes: Vec<Change>) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || label_samples::prepare(&folder, &changes))
        .await
        .map_err(text::label_sample_error)?
}

#[tauri::command]
pub async fn finish_label_samples(token: u64, commit: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || label_samples::finish(token, commit))
        .await
        .map_err(text::label_sample_error)?
}

#[tauri::command]
pub fn open_label_sample_directory(folder: PathBuf) -> Result<(), String> {
    label_samples::open_directory(&folder)
}
