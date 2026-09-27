use crate::text_read::{self, Check, Config, Plan, Settings};
use std::path::PathBuf;

#[tauri::command]
pub fn get_text_read_settings() -> Result<Settings, String> {
    text_read::settings()
}
#[tauri::command]
pub fn preview_text_read(config: Config) -> Result<Plan, String> {
    text_read::preview(&config)
}
#[tauri::command]
pub async fn configure_text_read(
    config: Config,
    request_id: String,
    save: bool,
) -> Result<Check, String> {
    tauri::async_runtime::spawn_blocking(move || text_read::configure(config, request_id, save))
        .await
        .map_err(text_read_error)?
}
#[tauri::command]
pub async fn read_text_files(
    paths: Vec<PathBuf>,
    request_id: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || text_read::read_many(&paths, request_id))
        .await
        .map_err(text_read_error)?
}
#[tauri::command]
pub fn cancel_text_read(request_id: String) -> Result<bool, String> {
    text_read::cancel(&request_id)
}
fn text_read_error(error: impl std::fmt::Display) -> String {
    crate::i18n::zh_cn::text_read_failed(error)
}
