use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::{
    i18n::zh_cn as text,
    media::{
        onnx_metadata::inspect_onnx_bytes,
        prelabel::runtime::{
            is_runtime_loaded, load_runtime, validate_model_with_runtime, ModelTensorContract,
        },
    },
};

const RUNTIME_VERSION: &str = "1.24.3";
const RUNTIME_DLL: &str = "onnxruntime.dll";
const PROVIDERS_DLL: &str = "onnxruntime_providers_shared.dll";
const RUNTIME_SHA256: &str = "e6abe8b3fe7eb38e0424fa366eb7edac2090ac2d211592c26d674f928b44f785";
const PROVIDERS_SHA256: &str = "1647771b4593c729df99a4a86e66aad6a77c9e6e3c8efd97322ef42ef9b1cc0b";
const RELEASE_BASE_URL: &str =
    "https://github.com/silevilence/my_label_tool/releases/latest/download";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnnxRuntimeStatus {
    state: RuntimeState,
    version: &'static str,
    dll_path: String,
    runtime_directory: String,
    download_available: bool,
    message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum RuntimeState {
    Missing,
    Available,
    Invalid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelValidationReport {
    #[serde(flatten)]
    contract: ModelTensorContract,
    class_names: Vec<String>,
}

#[tauri::command]
pub fn get_onnx_runtime_status(app: tauri::AppHandle) -> Result<OnnxRuntimeStatus, String> {
    runtime_status(&runtime_directory(&app)?)
}

#[tauri::command]
pub fn install_onnx_runtime_from_file(
    app: tauri::AppHandle,
    source_path: PathBuf,
) -> Result<OnnxRuntimeStatus, String> {
    if source_path.file_name().and_then(|name| name.to_str()) != Some(RUNTIME_DLL) {
        return Err(text::RUNTIME_SELECT_DLL.to_string());
    }
    let target_directory = runtime_directory(&app)?;
    let provider_source = source_path
        .parent()
        .map(|directory| directory.join(PROVIDERS_DLL))
        .ok_or_else(|| text::runtime_source_missing(Path::new(PROVIDERS_DLL)))?;
    let runtime_bytes = read_runtime_file(&source_path)?;
    let provider_bytes = read_runtime_file(&provider_source)?;
    install_runtime_bytes(
        &target_directory,
        &runtime_bytes,
        &provider_bytes,
        RUNTIME_SHA256,
        PROVIDERS_SHA256,
    )?;
    runtime_status(&target_directory)
}

#[tauri::command]
pub async fn download_onnx_runtime(app: tauri::AppHandle) -> Result<OnnxRuntimeStatus, String> {
    let target_directory = runtime_directory(&app)?;
    let runtime_bytes = download_checked_asset(RUNTIME_DLL, RUNTIME_SHA256).await?;
    let provider_bytes = download_checked_asset(PROVIDERS_DLL, PROVIDERS_SHA256).await?;
    install_runtime_bytes(
        &target_directory,
        &runtime_bytes,
        &provider_bytes,
        RUNTIME_SHA256,
        PROVIDERS_SHA256,
    )?;
    runtime_status(&target_directory)
}

#[tauri::command]
pub fn validate_prelabel_model(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<ModelValidationReport, String> {
    ensure_runtime_available(&runtime_directory(&app)?)?;
    validate_model_file(&path)
}

fn validate_model_file(path: &Path) -> Result<ModelValidationReport, String> {
    let mut contract = validate_model_with_runtime(path, None)?;
    let bytes = fs::read(path).map_err(text::read_onnx_failed)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let summary = inspect_onnx_bytes(&bytes, file_name)?;
    if contract.format != summary.format {
        if contract.format == crate::models::prelabel::YoloModelFormat::YoloV8
            && summary.format == crate::models::prelabel::YoloModelFormat::Yolo11
        {
            contract.format = summary.format.clone();
        } else {
            return Err(text::MODEL_FORMAT_RUNTIME_MISMATCH.to_string());
        }
    }
    if contract.class_count != summary.class_count
        || contract.input_width != summary.input_width
        || contract.input_height != summary.input_height
    {
        return Err(text::MODEL_METADATA_RUNTIME_MISMATCH.to_string());
    }
    Ok(ModelValidationReport {
        contract,
        class_names: summary.class_names,
    })
}

pub(crate) fn runtime_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("onnxruntime").join(RUNTIME_VERSION))
        .map_err(text::runtime_app_data_failed)
}

fn runtime_status(directory: &Path) -> Result<OnnxRuntimeStatus, String> {
    let dll_path = directory.join(RUNTIME_DLL);
    let provider_path = directory.join(PROVIDERS_DLL);
    let (state, message) = if is_runtime_loaded() {
        (RuntimeState::Available, text::RUNTIME_AVAILABLE.to_string())
    } else if !dll_path.is_file() {
        (RuntimeState::Missing, text::runtime_missing(&dll_path))
    } else if !provider_path.is_file() {
        (RuntimeState::Missing, text::runtime_missing(&provider_path))
    } else {
        match ensure_runtime_available(directory) {
            Ok(()) => (RuntimeState::Available, text::RUNTIME_AVAILABLE.to_string()),
            Err(error) => (RuntimeState::Invalid, error),
        }
    };
    Ok(OnnxRuntimeStatus {
        state,
        version: RUNTIME_VERSION,
        dll_path: dll_path.to_string_lossy().into_owned(),
        runtime_directory: directory.to_string_lossy().into_owned(),
        download_available: true,
        message,
    })
}

pub(crate) fn ensure_runtime_available(directory: &Path) -> Result<(), String> {
    if is_runtime_loaded() {
        return Ok(());
    }
    let dll_path = directory.join(RUNTIME_DLL);
    let provider_path = directory.join(PROVIDERS_DLL);
    let runtime_bytes = read_runtime_file(&dll_path)?;
    let provider_bytes = read_runtime_file(&provider_path)?;
    verify_sha256(&runtime_bytes, RUNTIME_SHA256)?;
    verify_sha256(&provider_bytes, PROVIDERS_SHA256)?;
    load_runtime(&dll_path)
}

async fn download_checked_asset(file_name: &str, expected_sha256: &str) -> Result<Vec<u8>, String> {
    let url = format!("{RELEASE_BASE_URL}/{file_name}");
    let response = reqwest::get(&url)
        .await
        .map_err(text::runtime_download_failed)?
        .error_for_status()
        .map_err(text::runtime_download_failed)?;
    let bytes = response
        .bytes()
        .await
        .map_err(text::runtime_download_failed)?;
    verify_sha256(&bytes, expected_sha256)?;
    Ok(bytes.to_vec())
}

fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual == expected {
        Ok(())
    } else {
        Err(text::runtime_checksum_mismatch(expected, &actual))
    }
}

fn read_runtime_file(source: &Path) -> Result<Vec<u8>, String> {
    if !source.is_file() {
        return Err(text::runtime_source_missing(source));
    }
    fs::read(source).map_err(|error| text::runtime_read_failed(source, error))
}

fn install_runtime_bytes(
    target_directory: &Path,
    runtime_bytes: &[u8],
    provider_bytes: &[u8],
    runtime_sha256: &str,
    provider_sha256: &str,
) -> Result<(), String> {
    verify_sha256(runtime_bytes, runtime_sha256)?;
    verify_sha256(provider_bytes, provider_sha256)?;

    let parent = target_directory
        .parent()
        .ok_or_else(|| text::runtime_invalid_target(target_directory))?;
    fs::create_dir_all(parent).map_err(|error| text::runtime_create_dir_failed(parent, error))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let stem = target_directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("runtime");
    let staging = parent.join(format!(".{stem}.installing-{}-{nonce}", std::process::id()));
    let backup = parent.join(format!(".{stem}.backup-{}-{nonce}", std::process::id()));

    fs::create_dir(&staging).map_err(|error| text::runtime_create_dir_failed(&staging, error))?;
    if let Err(error) = write_runtime_pair(&staging, runtime_bytes, provider_bytes) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let had_previous = target_directory.exists();
    if had_previous {
        if let Err(error) = fs::rename(target_directory, &backup) {
            let _ = fs::remove_dir_all(&staging);
            return Err(text::runtime_replace_blocked(target_directory, error));
        }
    }
    if let Err(error) = fs::rename(&staging, target_directory) {
        let _ = fs::remove_dir_all(&staging);
        if !had_previous {
            return Err(text::runtime_install_failed(target_directory, error));
        }
        return match fs::rename(&backup, target_directory) {
            Ok(()) => Err(text::runtime_replace_restored(target_directory, error)),
            Err(rollback_error) => Err(text::runtime_rollback_failed(
                target_directory,
                &backup,
                error,
                rollback_error,
            )),
        };
    }
    if had_previous {
        let _ = fs::remove_dir_all(backup);
    }
    Ok(())
}

fn write_runtime_pair(
    directory: &Path,
    runtime_bytes: &[u8],
    provider_bytes: &[u8],
) -> Result<(), String> {
    let runtime_path = directory.join(RUNTIME_DLL);
    fs::write(&runtime_path, runtime_bytes)
        .map_err(|error| text::runtime_write_failed(&runtime_path, error))?;
    let provider_path = directory.join(PROVIDERS_DLL);
    fs::write(&provider_path, provider_bytes)
        .map_err(|error| text::runtime_write_failed(&provider_path, error))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use sha2::{Digest, Sha256};

    use super::{
        install_runtime_bytes, read_runtime_file, validate_model_file, verify_sha256,
        PROVIDERS_DLL, RUNTIME_DLL,
    };
    use crate::{media::prelabel::runtime::load_runtime, models::prelabel::YoloModelFormat};

    #[test]
    fn verifies_runtime_download_sha256() {
        verify_sha256(
            b"abc",
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )
        .unwrap();

        let error = verify_sha256(b"changed", "ba7816").unwrap_err();
        assert!(error.contains("SHA-256"));
    }

    #[test]
    fn runtime_pair_is_verified_before_existing_files_are_replaced() {
        let root = temporary_directory("verified-replacement");
        let target = root.join("1.24.3");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join(RUNTIME_DLL), b"old-runtime").unwrap();
        fs::write(target.join(PROVIDERS_DLL), b"old-provider").unwrap();
        let runtime = b"new-runtime";
        let provider = b"new-provider";
        let runtime_hash = format!("{:x}", Sha256::digest(runtime));
        let provider_hash = format!("{:x}", Sha256::digest(provider));

        let error = install_runtime_bytes(
            &target,
            runtime,
            provider,
            &runtime_hash,
            "invalid-provider-hash",
        )
        .unwrap_err();
        assert!(error.contains("SHA-256"));
        assert_eq!(fs::read(target.join(RUNTIME_DLL)).unwrap(), b"old-runtime");
        assert_eq!(
            fs::read(target.join(PROVIDERS_DLL)).unwrap(),
            b"old-provider"
        );

        install_runtime_bytes(&target, runtime, provider, &runtime_hash, &provider_hash).unwrap();
        assert_eq!(fs::read(target.join(RUNTIME_DLL)).unwrap(), runtime);
        assert_eq!(fs::read(target.join(PROVIDERS_DLL)).unwrap(), provider);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_manual_provider_has_an_actionable_file_error() {
        let root = temporary_directory("missing-provider");
        let provider = root.join(PROVIDERS_DLL);

        let error = read_runtime_file(&provider).unwrap_err();

        assert!(error.contains("运行时文件不存在"));
        assert!(error.contains(PROVIDERS_DLL));
    }

    #[test]
    #[ignore = "requires external ONNX Runtime and ignored official ONNX fixtures"]
    fn validates_official_v8_and_yolo11_models_through_the_command_seam() {
        let runtime_path = resolve_fixture(required_fixture("MY_LABEL_TOOL_ORT_DLL"));
        let official_path = resolve_fixture(required_fixture("MY_LABEL_TOOL_YOLO_ONNX"));
        let yolov8_path = resolve_fixture(required_fixture("MY_LABEL_TOOL_YOLOV8_ONNX"));

        load_runtime(&runtime_path).unwrap();
        let official = validate_model_file(&official_path).unwrap();
        assert_eq!(official.contract.format, YoloModelFormat::Yolo11);
        assert_eq!(official.contract.class_count, 80);

        let yolov8 = validate_model_file(&yolov8_path).unwrap();
        assert_eq!(yolov8.contract.format, YoloModelFormat::YoloV8);
        assert_eq!(yolov8.contract.class_count, 80);
        assert_eq!(yolov8.contract.output_names, ["output0"]);
    }

    #[test]
    #[ignore = "requires external ONNX Runtime and an ignored YOLOv5 ONNX fixture"]
    fn validates_yolov5_model_through_the_command_seam() {
        let runtime_path = resolve_fixture(required_fixture("MY_LABEL_TOOL_ORT_DLL"));
        let yolov5_path = resolve_fixture(required_fixture("MY_LABEL_TOOL_YOLOV5_ONNX"));

        load_runtime(&runtime_path).unwrap();
        let yolov5 = validate_model_file(&yolov5_path).unwrap();
        assert_eq!(yolov5.contract.format, YoloModelFormat::YoloV5);
        assert_eq!(yolov5.contract.class_count, 80);
        assert_eq!(yolov5.contract.output_names.len(), 3);
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "my-label-tool-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn required_fixture(name: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| panic!("{name} must point to a local test fixture"))
    }

    fn resolve_fixture(value: String) -> PathBuf {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            path
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("workspace root")
                .join(path)
        }
    }
}
