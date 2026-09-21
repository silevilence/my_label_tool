//! Inspect image headers without decoding image contents while listing a folder.
use crate::i18n::zh_cn as text;
use serde::Serialize;
use std::{fs, io::Read, path::Path};

#[derive(Serialize)]
pub struct ImageFile {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) size: u64,
}

pub fn list(folder: &Path) -> Result<Vec<ImageFile>, String> {
    if !folder.is_dir() {
        return Err(text::IMAGE_FOLDER_INVALID.to_string());
    }
    let mut images = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if let Some(size) = loadable_image_size(&path) {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            images.push(ImageFile {
                path: path.to_string_lossy().into_owned(),
                name,
                size,
            });
        }
    }
    images.sort_by_cached_key(|image| image.name.to_lowercase());
    Ok(images)
}

pub(crate) fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["jpg", "jpeg", "png", "bmp"]
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn loadable_image_size(path: &Path) -> Option<u64> {
    if !is_supported_image(path) {
        return None;
    }
    let metadata = path.metadata().ok()?;
    if !metadata.is_file() || metadata.len() == 0 {
        return None;
    }
    let mut file = fs::File::open(path).ok()?;
    let mut signature = [0_u8; 8];
    let read_count = file.read(&mut signature).ok()?;
    matches!(
        &signature[..read_count],
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
            | [0xff, 0xd8, 0xff, ..]
            | [b'B', b'M', ..]
    )
    .then_some(metadata.len())
}

#[cfg(test)]
pub(crate) fn is_loadable_image(path: &Path) -> bool {
    loadable_image_size(path).is_some()
}
