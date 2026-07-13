use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

#[derive(Serialize)]
pub struct ImageFile {
    path: String,
    name: String,
}

#[tauri::command]
pub fn list_image_files(folder_path: PathBuf) -> Result<Vec<ImageFile>, String> {
    if !folder_path.is_dir() {
        return Err("请选择一个有效的文件夹".to_string());
    }

    let mut images = Vec::new();

    for entry in fs::read_dir(&folder_path).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();

        if path.is_file() && is_supported_image(&path) {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();

            images.push(ImageFile {
                path: path.to_string_lossy().into_owned(),
                name,
            });
        }
    }

    images.sort_by_key(|image| image.name.to_lowercase());
    Ok(images)
}

fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "bmp"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::is_supported_image;
    use std::path::Path;

    #[test]
    fn detects_supported_image_extensions() {
        assert!(is_supported_image(Path::new("a.JPG")));
        assert!(is_supported_image(Path::new("b.png")));
        assert!(is_supported_image(Path::new("c.bmp")));
        assert!(!is_supported_image(Path::new("d.gif")));
    }
}
