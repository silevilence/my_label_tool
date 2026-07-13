use std::{
    fs,
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

#[tauri::command]
pub fn export_annotations_json(output_path: PathBuf, data: AnnotationExport) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(output_path, json).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{export_annotations_json, is_supported_image};
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
