use std::path::PathBuf;

use crate::{i18n::zh_cn as text, media::image_deletion};

/// Host UI command only; deliberately not exposed through the plugin protocol.
#[tauri::command]
pub async fn recycle_image_file(folder_path: PathBuf, image_path: PathBuf) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        image_deletion::recycle_image(&folder_path, &image_path)
    })
    .await
    .map_err(|error| format!("{}：{error}", text::IMAGE_DELETE_FAILED))?
}
