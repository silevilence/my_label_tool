//! Project-image crops are materialized only on selection, then owned by the
//! label draft. Gallery previews do not create files.
use crate::i18n::zh_cn as text;
use base64::Engine;
use image::{DynamicImage, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

static FILES: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Deserialize)]
pub struct CropBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize)]
pub struct Crop {
    pub path: PathBuf,
    pub preview: String,
}

fn crop(folder: &Path, path: &Path, bounds: CropBounds) -> Result<DynamicImage, String> {
    let root = fs::canonicalize(folder).map_err(text::label_sample_error)?;
    let path = fs::canonicalize(path).map_err(text::label_sample_error)?;
    if !root.is_dir() || !path.starts_with(&root) || !path.is_file() {
        return Err(text::LABEL_SAMPLE_CROP_SOURCE.into());
    }
    if ![bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|n| n.is_finite())
        || bounds.width <= 0.0
        || bounds.height <= 0.0
    {
        return Err(text::LABEL_SAMPLE_CROP_BOUNDS.into());
    }
    let mut reader = ImageReader::open(&path)
        .map_err(text::label_sample_error)?
        .with_guessed_format()
        .map_err(text::label_sample_error)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(text::label_sample_error)?;
    let left = bounds.x.floor().clamp(0.0, image.width() as f64) as u32;
    let top = bounds.y.floor().clamp(0.0, image.height() as f64) as u32;
    let right = (bounds.x + bounds.width)
        .ceil()
        .clamp(0.0, image.width() as f64) as u32;
    let bottom = (bounds.y + bounds.height)
        .ceil()
        .clamp(0.0, image.height() as f64) as u32;
    if right <= left || bottom <= top {
        return Err(text::LABEL_SAMPLE_CROP_BOUNDS.into());
    }
    Ok(image.crop_imm(left, top, right - left, bottom - top))
}

fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(text::label_sample_error)?;
    Ok(bytes.into_inner())
}

fn thumbnail(image: &DynamicImage) -> Result<String, String> {
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png(&image.thumbnail(256, 256))?)
    ))
}

pub fn preview(folder: &Path, path: &Path, bounds: CropBounds) -> Result<String, String> {
    thumbnail(&crop(folder, path, bounds)?)
}

pub fn create(
    folder: &Path,
    path: &Path,
    bounds: CropBounds,
    cache: &Path,
) -> Result<Crop, String> {
    let image = crop(folder, path, bounds)?;
    let preview = thumbnail(&image)?;
    let bytes = png(&image)?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(text::LABEL_SAMPLE_IMAGE.into());
    }
    fs::create_dir_all(cache).map_err(text::label_sample_error)?;
    let mut files = FILES.lock().map_err(text::label_sample_error)?;
    let path = cache.join(format!(
        "sample-{}-{}.png",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    // create_new prevents overwriting any pre-existing cache file.
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(text::label_sample_error)?;
    if let Err(error) = file.write_all(&bytes) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(text::label_sample_error(error));
    }
    files.get_or_insert_with(HashSet::new).insert(path.clone());
    Ok(Crop { path, preview })
}

pub fn discard(path: &Path) -> Result<(), String> {
    let mut files = FILES.lock().map_err(text::label_sample_error)?;
    if let Some(files) = files.as_mut() {
        if files.contains(path) {
            match fs::remove_file(path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(text::label_sample_error(e)),
            }
            files.remove(path);
        }
    }
    Ok(())
}

pub fn shutdown() {
    if let Ok(mut files) = FILES.lock() {
        for path in files.take().unwrap_or_default() {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
#[path = "label_sample_crops_tests.rs"]
mod tests;
