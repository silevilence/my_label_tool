//! Small cached thumbnails for the media list; decoding and scaling run off the
//! main thread via the command's blocking pool.
use crate::i18n::zh_cn as text;
use base64::Engine;
use image::{DynamicImage, GenericImageView, ImageFormat};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::UNIX_EPOCH,
};

/// 缩略图长边上限（像素）。
pub(crate) const THUMBNAIL_LONG_EDGE: u32 = 256;
const CACHE_EXTENSION: &str = "png";
static NEXT_PART: AtomicU64 = AtomicU64::new(0);

/// 缓存文件名 = base64(sha256(规范化路径 | mtime | 文件大小))；任一变化即换键，旧条目自然失效。
pub(crate) fn cache_path_for(image_path: &Path, cache_dir: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(image_path).map_err(text::thumbnail_stat_failed)?;
    let modified = metadata.modified().map_err(text::thumbnail_stat_failed)?;
    let since_epoch = modified.duration_since(UNIX_EPOCH).unwrap_or_default();
    // 规范化去除相对段与链接差异；无法规范化时退回原路径，仅影响缓存复用粒度。
    let normalized = fs::canonicalize(image_path).unwrap_or_else(|_| image_path.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(normalized.to_string_lossy().as_bytes());
    hasher.update([b'|']);
    hasher.update(since_epoch.as_secs().to_le_bytes());
    hasher.update(since_epoch.subsec_nanos().to_le_bytes());
    hasher.update(metadata.len().to_le_bytes());
    let key = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize());
    Ok(cache_dir.join(format!("{key}.{CACHE_EXTENSION}")))
}

/// 生成（或命中缓存直接返回）`image_path` 的缩略图，返回缓存文件路径。
pub fn generate(image_path: &Path, cache_dir: &Path) -> Result<PathBuf, String> {
    let cache_path = cache_path_for(image_path, cache_dir)?;
    if cache_path.is_file() {
        return Ok(cache_path);
    }
    let image = image::open(image_path).map_err(text::thumbnail_decode_failed)?;
    let thumbnail = scale_to_long_edge(&image, THUMBNAIL_LONG_EDGE);
    fs::create_dir_all(cache_dir).map_err(text::thumbnail_write_failed)?;
    write_atomically(&cache_path, &thumbnail)?;
    Ok(cache_path)
}

/// 等比缩放到长边 ≤ `long_edge`；不放大小于上限的图片。
fn scale_to_long_edge(image: &DynamicImage, long_edge: u32) -> DynamicImage {
    let (width, height) = image.dimensions();
    let longest = width.max(height);
    if longest == 0 || longest <= long_edge {
        return image.clone();
    }
    image.thumbnail(
        (u64::from(width) * u64::from(long_edge) / u64::from(longest)).max(1) as u32,
        (u64::from(height) * u64::from(long_edge) / u64::from(longest)).max(1) as u32,
    )
}

/// 先写临时分片再重命名，避免并发或中断留下半截缓存文件。
fn write_atomically(cache_path: &Path, thumbnail: &DynamicImage) -> Result<(), String> {
    let mut bytes = Vec::new();
    thumbnail
        .write_to(&mut std::io::Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(text::thumbnail_encode_failed)?;
    let part = cache_path.with_extension(format!(
        "part-{}-{}",
        std::process::id(),
        NEXT_PART.fetch_add(1, Ordering::Relaxed)
    ));
    let result = fs::write(&part, bytes).and_then(|()| fs::rename(&part, cache_path));
    // 同一个源可能同时被多个列表请求；每个请求持有独立分片，并清理失败分片。
    if result.is_err() {
        let _ = fs::remove_file(&part);
        if cache_path.is_file() {
            return Ok(());
        }
    }
    result.map_err(text::thumbnail_write_failed)
}

#[cfg(test)]
#[path = "thumbnail_tests.rs"]
mod tests;
