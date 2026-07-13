use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::models::annotation::AnnotationExport;

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

        if is_loadable_image(&path) {
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

fn is_loadable_image(path: &Path) -> bool {
    if !path.is_file() || !is_supported_image(path) {
        return false;
    }

    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if metadata.len() == 0 {
        return false;
    }

    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut signature = [0_u8; 8];
    let Ok(read_count) = file.read(&mut signature) else {
        return false;
    };

    matches!(
        &signature[..read_count],
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
            | [0xff, 0xd8, 0xff, ..]
            | [b'B', b'M', ..]
    )
}

#[tauri::command]
pub fn export_annotations_json(output_path: PathBuf, data: AnnotationExport) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(output_path, json).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{export_annotations_json, is_loadable_image, is_supported_image, list_image_files};
    use crate::models::annotation::{
        AnnotationExport, AnnotationShape, ImageAnnotations, LabelConfig,
    };
    use std::{fs, path::Path};

    #[test]
    fn detects_supported_image_extensions() {
        assert!(is_supported_image(Path::new("a.JPG")));
        assert!(is_supported_image(Path::new("b.png")));
        assert!(is_supported_image(Path::new("c.bmp")));
        assert!(!is_supported_image(Path::new("d.gif")));
    }

    #[test]
    fn rejects_empty_image_files() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_empty_{}.png",
            std::process::id()
        ));
        fs::write(&path, []).unwrap();

        assert!(!is_loadable_image(&path));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn list_image_files_skips_empty_images() {
        let dir = std::env::temp_dir().join(format!(
            "my_label_tool_images_{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let empty_path = dir.join("empty.png");
        let image_path = dir.join("image.png");
        fs::write(&empty_path, []).unwrap();
        fs::write(&image_path, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]).unwrap();

        let images = list_image_files(dir.clone()).unwrap();

        assert_eq!(images.len(), 1);
        assert_eq!(images[0].name, "image.png");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exports_annotations_json() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_annotations_{}.json",
            std::process::id()
        ));

        export_annotations_json(
            path.clone(),
            AnnotationExport {
                labels: vec![LabelConfig {
                    id: "person".to_string(),
                    name: "人".to_string(),
                    color: "#38bdf8".to_string(),
                    shortcut: Some("1".to_string()),
                    shape_type: "rect".to_string(),
                }],
                images: vec![ImageAnnotations {
                    path: "a.png".to_string(),
                    name: "a.png".to_string(),
                    annotations: vec![AnnotationShape {
                        id: "shape-1".to_string(),
                        shape_type: "rect".to_string(),
                        label_id: "person".to_string(),
                        points: vec![1.0, 2.0, 3.0, 4.0],
                        attributes: None,
                        frame_index: Some(0),
                    }],
                }],
            },
        )
        .unwrap();

        let exported = fs::read_to_string(&path).unwrap();
        assert!(exported.contains("\"labelId\": \"person\""));
        assert!(exported.contains("\"points\": ["));
        let _ = fs::remove_file(path);
    }
}
