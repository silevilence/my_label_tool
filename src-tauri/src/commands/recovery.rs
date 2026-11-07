use crate::{
    i18n::recovery_zh_cn as text,
    recovery::{self, Snapshot, Update},
};
use std::path::PathBuf;
use tauri::Manager;

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(text::failed)?
        .join("recovery"))
}
#[tauri::command]
pub async fn load_recovery(
    app: tauri::AppHandle,
    folder: PathBuf,
) -> Result<Option<Snapshot>, String> {
    let root = root(&app)?;
    super::host_text_io(move || recovery::load(&root, &folder)).await
}
#[tauri::command]
pub async fn save_recovery(
    app: tauri::AppHandle,
    folder: PathBuf,
    update: Update,
) -> Result<u64, String> {
    let root = root(&app)?;
    super::host_text_io(move || recovery::save(&root, &folder, update)).await
}
#[tauri::command]
pub async fn last_recovery_project(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let root = root(&app)?;
    super::host_text_io(move || recovery::last(&root)).await
}

#[tauri::command]
pub async fn fork_recovery(
    app: tauri::AppHandle,
    folder: PathBuf,
    update: Update,
) -> Result<u64, String> {
    let root = root(&app)?;
    super::host_text_io(move || recovery::fork(&root, &folder, update)).await
}

#[tauri::command]
pub async fn open_recovery_directory(app: tauri::AppHandle, folder: PathBuf) -> Result<(), String> {
    let root = root(&app)?;
    super::host_text_io(move || recovery::open_archives(&root, &folder)).await
}
