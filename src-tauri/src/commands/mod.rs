use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

use crate::models::annotation::{LabelConfig, LabelTemplate};

#[derive(Serialize)]
pub struct ImageFile {
    path: String,
    name: String,
}

#[derive(Serialize)]
pub struct TextFileEntry {
    path: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextExportFile {
    path: PathBuf,
    content: String,
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
pub fn export_annotations_json(output_path: PathBuf, data: Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(output_path, json).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_text_files(output_dir: PathBuf, files: Vec<TextExportFile>) -> Result<(), String> {
    if !output_dir.is_dir() {
        return Err("请选择一个有效的导出文件夹".to_string());
    }

    for file in files {
        if !is_safe_relative_path(&file.path) {
            return Err(format!("导出文件路径不安全: {}", file.path.display()));
        }

        let path = output_dir.join(&file.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(path, file.content).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn read_text_file(path: PathBuf) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_text_files(
    folder_path: PathBuf,
    extension: String,
) -> Result<Vec<TextFileEntry>, String> {
    if !folder_path.is_dir() {
        return Err("请选择一个有效的文件夹".to_string());
    }

    let extension = extension.trim_start_matches('.').to_lowercase();
    let mut files = Vec::new();

    for entry in fs::read_dir(&folder_path).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if !path.is_file() {
            continue;
        }

        let matches_extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case(&extension))
            .unwrap_or(false);
        if !matches_extension {
            continue;
        }

        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string();
        files.push(TextFileEntry {
            path: path.to_string_lossy().into_owned(),
            name,
        });
    }

    files.sort_by_key(|file| file.name.to_lowercase());
    Ok(files)
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

#[tauri::command]
pub fn load_label_configs(app: tauri::AppHandle) -> Result<Vec<LabelConfig>, String> {
    let path = label_configs_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    read_label_configs(&path)
}

#[tauri::command]
pub fn save_label_configs(app: tauri::AppHandle, labels: Vec<LabelConfig>) -> Result<(), String> {
    let path = label_configs_path(&app)?;
    write_label_configs(&path, &labels)
}

#[tauri::command]
pub fn load_label_templates(app: tauri::AppHandle) -> Result<Vec<LabelTemplate>, String> {
    let path = label_templates_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    read_label_templates(&path)
}

#[tauri::command]
pub fn save_label_templates(
    app: tauri::AppHandle,
    templates: Vec<LabelTemplate>,
) -> Result<(), String> {
    let path = label_templates_path(&app)?;
    write_label_templates(&path, &templates)
}

#[tauri::command]
pub fn load_shortcuts(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = shortcuts_path(&app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }

    read_shortcuts(&path)
}

#[tauri::command]
pub fn save_shortcuts(
    app: tauri::AppHandle,
    shortcuts: HashMap<String, String>,
) -> Result<(), String> {
    let path = shortcuts_path(&app)?;
    write_shortcuts(&path, &shortcuts)
}

fn label_configs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("labels.json"))
}

fn label_templates_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("label-templates.json"))
}

fn shortcuts_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("shortcuts.json"))
}

fn read_label_configs(path: &Path) -> Result<Vec<LabelConfig>, String> {
    let json = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&json).map_err(|error| error.to_string())
}

fn write_label_configs(path: &Path, labels: &[LabelConfig]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(labels).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn read_label_templates(path: &Path) -> Result<Vec<LabelTemplate>, String> {
    let json = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&json).map_err(|error| error.to_string())
}

fn write_label_templates(path: &Path, templates: &[LabelTemplate]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(templates).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn read_shortcuts(path: &Path) -> Result<HashMap<String, String>, String> {
    let json = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&json).map_err(|error| error.to_string())
}

fn write_shortcuts(path: &Path, shortcuts: &HashMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(shortcuts).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        export_annotations_json, export_text_files, is_loadable_image, is_supported_image,
        list_image_files, list_text_files, read_label_configs, read_label_templates,
        read_shortcuts, read_text_file, write_label_configs, write_label_templates,
        write_shortcuts, TextExportFile,
    };
    use crate::models::annotation::{
        AnnotationExport, AnnotationShape, ImageAnnotations, LabelConfig, LabelTemplate,
    };
    use std::{
        collections::HashMap,
        fs,
        path::{Path, PathBuf},
    };

    #[test]
    fn detects_supported_image_extensions() {
        assert!(is_supported_image(Path::new("a.JPG")));
        assert!(is_supported_image(Path::new("b.png")));
        assert!(is_supported_image(Path::new("c.bmp")));
        assert!(!is_supported_image(Path::new("d.gif")));
    }

    #[test]
    fn rejects_empty_image_files() {
        let path =
            std::env::temp_dir().join(format!("my_label_tool_empty_{}.png", std::process::id()));
        fs::write(&path, []).unwrap();

        assert!(!is_loadable_image(&path));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn list_image_files_skips_empty_images() {
        let dir = std::env::temp_dir().join(format!("my_label_tool_images_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let empty_path = dir.join("empty.png");
        let image_path = dir.join("image.png");
        fs::write(&empty_path, []).unwrap();
        fs::write(
            &image_path,
            [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        )
        .unwrap();

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
            serde_json::to_value(AnnotationExport {
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
            })
            .unwrap(),
        )
        .unwrap();

        let exported = fs::read_to_string(&path).unwrap();
        assert!(exported.contains("\"labelId\": \"person\""));
        assert!(exported.contains("\"points\": ["));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn exports_text_files() {
        let dir =
            std::env::temp_dir().join(format!("my_label_tool_text_export_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        export_text_files(
            dir.clone(),
            vec![TextExportFile {
                path: PathBuf::from("a.txt"),
                content: "ok".to_string(),
            }],
        )
        .unwrap();

        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "ok");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reads_and_lists_text_files() {
        let dir =
            std::env::temp_dir().join(format!("my_label_tool_text_import_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.xml"), "ok").unwrap();
        fs::write(dir.join("b.txt"), "skip").unwrap();

        let files = list_text_files(dir.clone(), "xml".to_string()).unwrap();

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "a.xml");
        assert_eq!(read_text_file(PathBuf::from(&files[0].path)).unwrap(), "ok");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_unsafe_text_export_paths() {
        let result = export_text_files(
            std::env::temp_dir(),
            vec![TextExportFile {
                path: PathBuf::from("../a.txt"),
                content: "bad".to_string(),
            }],
        );

        assert!(result.is_err());
    }

    #[test]
    fn saves_and_loads_label_configs() {
        let path =
            std::env::temp_dir().join(format!("my_label_tool_labels_{}.json", std::process::id()));
        let labels = vec![LabelConfig {
            id: "person".to_string(),
            name: "人".to_string(),
            color: "#38bdf8".to_string(),
            shortcut: Some("1".to_string()),
            shape_type: "rect".to_string(),
        }];

        write_label_configs(&path, &labels).unwrap();
        let loaded = read_label_configs(&path).unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "person");
        assert_eq!(loaded[0].shortcut.as_deref(), Some("1"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn saves_and_loads_label_templates() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_label_templates_{}.json",
            std::process::id()
        ));
        let templates = vec![LabelTemplate {
            id: "custom".to_string(),
            name: "自定义".to_string(),
            labels: vec![LabelConfig {
                id: "person".to_string(),
                name: "人".to_string(),
                color: "#38bdf8".to_string(),
                shortcut: Some("1".to_string()),
                shape_type: "rect".to_string(),
            }],
        }];

        write_label_templates(&path, &templates).unwrap();
        let loaded = read_label_templates(&path).unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "自定义");
        assert_eq!(loaded[0].labels[0].id, "person");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn saves_and_loads_shortcuts() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_shortcuts_{}.json",
            std::process::id()
        ));
        let shortcuts = HashMap::from([
            ("previousImage".to_string(), "ArrowLeft".to_string()),
            ("nextImage".to_string(), "ArrowRight".to_string()),
        ]);

        write_shortcuts(&path, &shortcuts).unwrap();
        let loaded = read_shortcuts(&path).unwrap();

        assert_eq!(
            loaded.get("previousImage").map(String::as_str),
            Some("ArrowLeft")
        );
        assert_eq!(
            loaded.get("nextImage").map(String::as_str),
            Some("ArrowRight")
        );
        let _ = fs::remove_file(path);
    }
}
