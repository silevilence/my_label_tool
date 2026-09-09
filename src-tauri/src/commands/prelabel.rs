use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::i18n::zh_cn as text;
use tauri::Manager;

use crate::{
    media::{
        onnx_metadata::{inspect_onnx_bytes, OnnxModelSummary},
        prelabel::model_download::{download_file_name, remove_replaced_managed_models},
    },
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
    // Read the previous snapshot before writing; failure only disables optional cleanup.
    let previous = read_prelabel_model_library(path).ok();
    let json = serde_json::to_string_pretty(library).map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let staging = path.with_extension(format!("saving-{}-{nonce}", std::process::id()));
    let result = fs::write(&staging, json).and_then(|()| fs::rename(&staging, path));
    if let Err(error) = result {
        let _ = fs::remove_file(&staging);
        return Err(error.to_string());
    }
    if let (Some(previous), Some(directory)) = (previous, path.parent()) {
        remove_replaced_managed_models(&directory.join("models"), &previous, library);
    }
    Ok(())
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
        let resolved_input = model
            .input_size_override
            .unwrap_or([model.input_width, model.input_height]);
        if resolved_input[0] == 0 || resolved_input[1] == 0 {
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
        if let Some(source_url) = &model.source_url {
            download_file_name(source_url)?;
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
                device: crate::models::prelabel::PrelabelDevice::Auto,
                source_url: None,
                updated_at: None,
            }],
        }
    }

    #[test]
    fn model_library_accepts_legacy_json_without_update_fields() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_legacy_prelabel_models_{}.json",
            std::process::id()
        ));
        let json = r#"{
            "schemaVersion": 1,
            "currentModelId": "model-1",
            "models": [{
                "id": "model-1",
                "name": "YOLO11n",
                "path": "C:\\models\\yolo11n.onnx",
                "format": "yolo11",
                "classCount": 2,
                "inputWidth": 640,
                "inputHeight": 640,
                "inputSizeOverride": null,
                "classNames": ["person", "car"],
                "confidenceThreshold": 0.25,
                "iouThreshold": 0.45,
                "addedAt": "2026-08-20T00:00:00.000Z",
                "device": "auto"
            }]
        }"#;
        fs::write(&path, json).unwrap();

        let library = read_prelabel_model_library(&path).unwrap();

        assert_eq!(library.models[0].source_url, None);
        assert_eq!(library.models[0].updated_at, None);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn model_library_rejects_a_non_http_source_url() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_bad_url_prelabel_models_{}.json",
            std::process::id()
        ));
        let mut library = sample_library();
        library.models[0].source_url = Some("file:///etc/passwd".to_string());

        let error = write_prelabel_model_library(&path, &library).unwrap_err();

        assert!(error.contains("更新地址"));
        let _ = fs::remove_file(path);
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

    fn update_fixture(
        label: &str,
    ) -> (
        std::path::PathBuf,
        PrelabelModelLibrary,
        PrelabelModelLibrary,
    ) {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "model-library-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(directory.join("models")).unwrap();
        let old_path = directory.join("models").join("old.onnx");
        let new_path = directory.join("models").join("new.onnx");
        fs::write(&old_path, b"old model").unwrap();
        fs::write(&new_path, b"new model").unwrap();
        let mut old = sample_library();
        old.models[0].path = old_path.to_string_lossy().into_owned();
        let mut next = old.clone();
        next.models[0].path = new_path.to_string_lossy().into_owned();
        let path = directory.join("prelabel-models.json");
        write_prelabel_model_library(&path, &old).unwrap();
        (path, old, next)
    }

    #[test]
    fn cleans_up_old_models_only_after_persisting_a_valid_replacement() {
        let (path, old, mut next) = update_fixture("commit");
        let mut invalid = next.clone();
        invalid.models[0].input_width = 0;
        invalid.models[0].input_height = 0;
        assert!(write_prelabel_model_library(&path, &invalid).is_err());
        assert_eq!(read_prelabel_model_library(&path).unwrap(), old);
        assert_eq!(fs::read(&old.models[0].path).unwrap(), b"old model");

        next.models[0].source_url = Some("HTTPS://example.com/new.ONNX?token=abc".to_string());
        write_prelabel_model_library(&path, &next).unwrap();
        assert_eq!(read_prelabel_model_library(&path).unwrap(), next);
        assert!(!std::path::Path::new(&old.models[0].path).exists());
        assert_eq!(fs::read(&next.models[0].path).unwrap(), b"new model");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_failed_library_write_preserves_the_previous_config_and_model() {
        use std::os::windows::fs::OpenOptionsExt;
        let (path, old, next) = update_fixture("write-failure");
        // Hold the existing JSON without delete sharing, making atomic replacement fail.
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        assert!(write_prelabel_model_library(&path, &next).is_err());
        assert_eq!(read_prelabel_model_library(&path).unwrap(), old);
        assert_eq!(fs::read(&old.models[0].path).unwrap(), b"old model");
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 2);
        drop(locked);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn cleanup_keeps_external_files_and_models_referenced_by_another_entry() {
        let (path, mut old, mut next) = update_fixture("shared");
        let mut shared = old.models[0].clone();
        shared.id = "shared-model".to_string();
        // An equivalent path spelling must count as a reference too.
        shared.path = path
            .parent()
            .unwrap()
            .join("models")
            .join(".")
            .join("old.onnx")
            .to_string_lossy()
            .into_owned();
        old.models.push(shared.clone());
        next.models.push(shared);
        write_prelabel_model_library(&path, &old).unwrap();
        write_prelabel_model_library(&path, &next).unwrap();
        assert_eq!(fs::read(&old.models[0].path).unwrap(), b"old model");

        let external = path.parent().unwrap().join("user-model.onnx");
        fs::write(&external, b"user model").unwrap();
        old.models[0].path = external.to_string_lossy().into_owned();
        write_prelabel_model_library(&path, &old).unwrap();
        write_prelabel_model_library(&path, &next).unwrap();
        assert_eq!(fs::read(external).unwrap(), b"user model");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn model_library_rejects_non_file_update_urls_before_writing() {
        let (path, old, mut next) = update_fixture("url");
        for url in [
            "https://example.com/model.onnx/download",
            "https://example.com/model.onnx/",
            "https://model.onnx",
            "https://",
        ] {
            next.models[0].source_url = Some(url.to_string());
            assert!(write_prelabel_model_library(&path, &next).is_err(), "{url}");
            assert_eq!(read_prelabel_model_library(&path).unwrap(), old);
            assert!(std::path::Path::new(&old.models[0].path).exists());
        }
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
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
    fn model_library_accepts_dynamic_metadata_with_a_concrete_override() {
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_dynamic_prelabel_models_{}.json",
            std::process::id()
        ));
        let mut library = sample_library();
        library.models[0].input_width = 0;
        library.models[0].input_height = 0;
        library.models[0].input_size_override = Some([1280, 736]);

        write_prelabel_model_library(&path, &library).unwrap();
        assert_eq!(read_prelabel_model_library(&path).unwrap(), library);

        library.models[0].input_size_override = None;
        assert!(write_prelabel_model_library(&path, &library)
            .unwrap_err()
            .contains("输入尺寸"));
        let _ = fs::remove_file(path);
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
