use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use crate::i18n::zh_cn as text;
use tauri::Manager;

use crate::{
    media::onnx_metadata::{inspect_onnx_bytes, OnnxModelSummary},
    models::prelabel::PrelabelModelLibrary,
};

#[tauri::command]
pub fn inspect_onnx_model(path: PathBuf) -> Result<OnnxModelSummary, String> {
    ensure_extension(&path, "onnx")?;
    let bytes = fs::read(&path).map_err(text::read_onnx_failed)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    inspect_onnx_bytes(&bytes, file_name)
}

#[tauri::command]
pub fn find_converted_onnx(pt_path: PathBuf) -> Result<Option<String>, String> {
    ensure_extension(&pt_path, "pt")?;
    let onnx_path = pt_path.with_extension("onnx");
    Ok(onnx_path
        .is_file()
        .then(|| onnx_path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn load_prelabel_model_library(app: tauri::AppHandle) -> Result<PrelabelModelLibrary, String> {
    let path = prelabel_model_library_path(&app)?;
    if !path.exists() {
        return Ok(PrelabelModelLibrary::default());
    }
    read_prelabel_model_library(&path)
}

#[tauri::command]
pub fn save_prelabel_model_library(
    app: tauri::AppHandle,
    library: PrelabelModelLibrary,
) -> Result<(), String> {
    let path = prelabel_model_library_path(&app)?;
    write_prelabel_model_library(&path, &library)
}

fn ensure_extension(path: &Path, expected: &str) -> Result<(), String> {
    let matches = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected));
    if matches {
        Ok(())
    } else {
        Err(text::select_extension(expected))
    }
}

fn prelabel_model_library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("prelabel-models.json"))
}

fn read_prelabel_model_library(path: &Path) -> Result<PrelabelModelLibrary, String> {
    let json = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let library: PrelabelModelLibrary =
        serde_json::from_str(&json).map_err(text::invalid_library)?;
    validate_library(&library)?;
    Ok(library)
}

fn write_prelabel_model_library(path: &Path, library: &PrelabelModelLibrary) -> Result<(), String> {
    validate_library(library)?;
    let json = serde_json::to_string_pretty(library).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn validate_library(library: &PrelabelModelLibrary) -> Result<(), String> {
    if library.schema_version != 1 {
        return Err(text::unsupported_library_version(library.schema_version));
    }
    let mut ids = HashSet::new();
    for model in &library.models {
        if model.id.trim().is_empty() || !ids.insert(model.id.as_str()) {
            return Err(text::MODEL_ID_INVALID.to_string());
        }
        if model.name.trim().is_empty() || model.path.trim().is_empty() {
            return Err(text::MODEL_NAME_OR_PATH_EMPTY.to_string());
        }
        if model.class_count == 0 || model.class_names.len() != model.class_count {
            return Err(text::MODEL_CLASSES_MISMATCH.to_string());
        }
        if model.input_width == 0
            || model.input_height == 0
            || model
                .input_size_override
                .is_some_and(|[width, height]| width == 0 || height == 0)
        {
            return Err(text::MODEL_INPUT_SIZE_INVALID.to_string());
        }
        if model.class_names.iter().any(|name| name.trim().is_empty()) {
            return Err(text::MODEL_CLASS_NAME_EMPTY.to_string());
        }
        if !(0.0..=1.0).contains(&model.confidence_threshold)
            || !(0.0..=1.0).contains(&model.iou_threshold)
        {
            return Err(text::MODEL_THRESHOLDS_INVALID.to_string());
        }
    }
    if let Some(current_id) = &library.current_model_id {
        if !ids.contains(current_id.as_str()) {
            return Err(text::CURRENT_MODEL_MISSING.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{find_converted_onnx, read_prelabel_model_library, write_prelabel_model_library};
    use crate::models::prelabel::{PrelabelModelConfig, PrelabelModelLibrary, YoloModelFormat};
    use std::fs;

    fn sample_library() -> PrelabelModelLibrary {
        PrelabelModelLibrary {
            schema_version: 1,
            current_model_id: Some("model-1".to_string()),
            models: vec![PrelabelModelConfig {
                id: "model-1".to_string(),
                name: "YOLO11n".to_string(),
                path: r"C:\models\yolo11n.onnx".to_string(),
                format: YoloModelFormat::Yolo11,
                class_count: 2,
                input_width: 640,
                input_height: 640,
                input_size_override: None,
                class_names: vec!["person".to_string(), "car".to_string()],
                confidence_threshold: 0.25,
                iou_threshold: 0.45,
                added_at: "2026-08-20T00:00:00.000Z".to_string(),
            }],
        }
    }

    #[test]
    fn model_library_round_trips_all_configuration() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_prelabel_models_{}.json",
            std::process::id()
        ));
        let expected = sample_library();

        write_prelabel_model_library(&path, &expected).unwrap();
        let actual = read_prelabel_model_library(&path).unwrap();

        assert_eq!(actual, expected);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn model_library_rejects_a_missing_current_model() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_invalid_prelabel_models_{}.json",
            std::process::id()
        ));
        let mut library = sample_library();
        library.current_model_id = Some("missing".to_string());

        let error = write_prelabel_model_library(&path, &library).unwrap_err();

        assert!(error.contains("当前模型"));
    }

    #[test]
    fn recommends_an_existing_onnx_file_next_to_a_pt_model() {
        let dir =
            std::env::temp_dir().join(format!("my_label_tool_pt_guidance_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let pt_path = dir.join("best.pt");
        let onnx_path = dir.join("best.onnx");
        fs::write(&pt_path, []).unwrap();

        assert_eq!(find_converted_onnx(pt_path.clone()).unwrap(), None);

        fs::write(&onnx_path, []).unwrap();
        assert_eq!(
            find_converted_onnx(pt_path).unwrap(),
            Some(onnx_path.to_string_lossy().into_owned())
        );
        let _ = fs::remove_dir_all(dir);
    }
}
