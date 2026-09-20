use crate::{i18n::zh_cn as text, media::thumbnail};
use std::path::PathBuf;
use tauri::Manager;

/// 宿主专用：为素材列表生成 ≤256px 长边的缩略图缓存，返回缓存文件路径；不向插件开放。
#[tauri::command]
pub async fn generate_image_thumbnail(
    app: tauri::AppHandle,
    image_path: PathBuf,
) -> Result<PathBuf, String> {
    if !image_path.is_file() {
        return Err(text::THUMBNAIL_SOURCE_INVALID.to_string());
    }
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map(|directory| directory.join("thumbnails"))
        .map_err(text::thumbnail_cache_dir_failed)?;
    // 解码与缩放放进阻塞线程池，缩略图生成不阻塞选中与切图
    tauri::async_runtime::spawn_blocking(move || thumbnail::generate(&image_path, &cache_dir))
        .await
        .map_err(text::thumbnail_task_failed)?
}
