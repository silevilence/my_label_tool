use crate::{
    i18n::zh_cn as text,
    media::video,
    models::video::{VideoImportResult, VideoProject},
};
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub async fn import_video(
    app: tauri::AppHandle,
    source_path: PathBuf,
    output_folder: PathBuf,
    frame_interval: usize,
    target_fps: Option<f64>,
) -> Result<VideoImportResult, String> {
    let guard = video::ImportGuard::acquire()?;
    let resources = app.path().resource_dir().map_err(text::video_failed)?;
    let ffmpeg = video::executable(&resources, "ffmpeg")?;
    let ffprobe = video::executable(&resources, "ffprobe")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        video::extract_with_sampling(
            &source_path,
            &output_folder,
            frame_interval,
            target_fps,
            &ffmpeg,
            &ffprobe,
        )
    })
    .await
    .map_err(text::video_failed)?
}

#[tauri::command]
pub fn cancel_video_import() -> Result<(), String> {
    video::cancel();
    Ok(())
}

#[tauri::command]
pub async fn reextract_video(
    app: tauri::AppHandle,
    source_path: PathBuf,
    project_folder: PathBuf,
    frame_folder: PathBuf,
    frame_interval: usize,
    target_fps: Option<f64>,
) -> Result<VideoImportResult, String> {
    let guard = video::ImportGuard::acquire()?;
    let resources = app.path().resource_dir().map_err(text::video_failed)?;
    let ffmpeg = video::executable(&resources, "ffmpeg")?;
    let ffprobe = video::executable(&resources, "ffprobe")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        crate::media::video_reextract::reextract(
            &source_path,
            &project_folder,
            &frame_folder,
            frame_interval,
            target_fps,
            &ffmpeg,
            &ffprobe,
        )
    })
    .await
    .map_err(text::video_failed)?
}

#[tauri::command]
pub async fn load_video_project(folder_path: PathBuf) -> Result<Option<VideoProject>, String> {
    tauri::async_runtime::spawn_blocking(move || video::load(&folder_path))
        .await
        .map_err(text::video_failed)?
}

#[tauri::command]
pub async fn list_project_videos(
    folder_path: PathBuf,
) -> Result<Vec<crate::models::video::ProjectVideo>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::media::project_media::list(&folder_path))
        .await
        .map_err(text::video_failed)?
}
