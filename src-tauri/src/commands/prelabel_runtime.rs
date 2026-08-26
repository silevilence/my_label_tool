use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, Manager};

use crate::{
    i18n::zh_cn as text,
    media::{
        onnx_metadata::inspect_onnx_bytes,
        prelabel::{
            runtime::{
                is_runtime_loaded, load_runtime, validate_model_with_runtime, ModelTensorContract,
            },
            task::{AsyncCancellation, CancellationResult, TaskRegistry},
        },
    },
};

/// The runtime build is `onnxruntime-directml`, which bundles the CPU and DirectML execution
/// providers so CPU-only machines still work while GPU machines can accelerate inference without a
/// separate runtime. `DirectML.dll` is the Microsoft Direct3D12 compute backend the DML EP loads at
/// runtime; it must sit next to `onnxruntime.dll`.
const RUNTIME_VERSION: &str = "1.24.3-dml";
const RUNTIME_DLL: &str = "onnxruntime.dll";
const PROVIDERS_DLL: &str = "onnxruntime_providers_shared.dll";
const DML_DLL: &str = "DirectML.dll";
const RUNTIME_SHA256: &str = "6169297ee0bbb3a3ba8d2c7ea8033e6d13d1e0c0f57ea849d7904c2f9f5b87a0";
const PROVIDERS_SHA256: &str = "ca503e4c86c729326512401be672dc33b717a2641de78e28a40a54a59f033cd9";
const DML_SHA256: &str = "2d1d0c0e7362d5f52062510ae454474f18044b570a175f34be05f4717a5904cc";
const RELEASE_BASE_URL: &str =
    "https://github.com/silevilence/my_label_tool/releases/latest/download";

/// How long a single network read may stall before the runtime download is aborted. This bounds
/// an otherwise-indefinite hang on a dead/slow connection without aborting steady downloads.
const DOWNLOAD_CHUNK_TIMEOUT: Duration = Duration::from_secs(30);
/// How long establishing a connection to the mirror may take before failing fast.
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// A single file that makes up the installed ONNX Runtime directory.
#[derive(Clone, Copy, Debug)]
struct RuntimeAsset {
    file_name: &'static str,
    sha256: &'static str,
}

/// The complete set of DLLs downloaded for this runtime build. The download installs exactly this
/// set: the ONNX Runtime, its shared provider support, and (for the DirectML build) Microsoft's
/// `DirectML.dll` GPU compute backend.
static RUNTIME_ASSETS: &[RuntimeAsset] = &[
    RuntimeAsset {
        file_name: RUNTIME_DLL,
        sha256: RUNTIME_SHA256,
    },
    RuntimeAsset {
        file_name: PROVIDERS_DLL,
        sha256: PROVIDERS_SHA256,
    },
    RuntimeAsset {
        file_name: DML_DLL,
        sha256: DML_SHA256,
    },
];

static DOWNLOAD_TASKS: OnceLock<TaskRegistry<AsyncCancellation>> = OnceLock::new();

fn download_tasks() -> &'static TaskRegistry<AsyncCancellation> {
    DOWNLOAD_TASKS.get_or_init(|| TaskRegistry::new(text::RUNTIME_DOWNLOAD_TASK_LABEL))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnnxRuntimeStatus {
    state: RuntimeState,
    version: &'static str,
    dll_path: String,
    runtime_directory: String,
    download_available: bool,
    message: String,
    /// Whether the installed runtime build carries the DirectML (GPU) backend. `None` when no
    /// runtime is installed yet. Note this reflects the bundled capability, not whether a usable
    /// D3D12 GPU is present — that is only determined when a session is created.
    gpu_available: Option<bool>,
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
    let mut files = vec![install_entry(
        RUNTIME_DLL,
        read_runtime_file(&source_path)?,
        RUNTIME_SHA256,
    )];
    let parent = source_path
        .parent()
        .ok_or_else(|| text::runtime_source_missing(Path::new(PROVIDERS_DLL)))?;
    let provider_source = parent.join(PROVIDERS_DLL);
    if provider_source.is_file() {
        files.push(install_entry(
            PROVIDERS_DLL,
            read_runtime_file(&provider_source)?,
            PROVIDERS_SHA256,
        ));
    }
    let dml_source = parent.join(DML_DLL);
    if dml_source.is_file() {
        files.push(install_entry(
            DML_DLL,
            read_runtime_file(&dml_source)?,
            DML_SHA256,
        ));
    }
    install_runtime_files(&target_directory, &files)?;
    runtime_status(&target_directory)
}

/// Streamed progress events for an in-flight ONNX Runtime download.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RuntimeDownloadEvent {
    Started { file_name: &'static str },
    Progress {
        file_name: &'static str,
        downloaded: u64,
        total: Option<u64>,
    },
    Completed { file_name: &'static str },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDownloadOutcome {
    cancelled: bool,
}

/// Downloads, verifies and installs the runtime DLLs. `download_id` keyes a cancellable task and
/// `on_progress` receives per-file progress. A cancellation surfaces as
/// [`RuntimeDownloadOutcome::cancelled`] rather than an error so the frontend can distinguish
/// "user cancelled" from "download failed".
#[tauri::command]
pub async fn download_onnx_runtime(
    app: tauri::AppHandle,
    download_id: String,
    on_progress: Channel<RuntimeDownloadEvent>,
) -> Result<RuntimeDownloadOutcome, String> {
    let handle = Arc::new(AsyncCancellation::new());
    download_tasks().register(&download_id, Arc::clone(&handle))?;
    let outcome = download_onnx_runtime_assets(app, &handle, on_progress).await;
    download_tasks().remove(&download_id);
    outcome
}

/// `on_progress` is owned (not borrowed) across the async body: Tauri's [`Channel`] is `Send` but
/// not guaranteed `Sync`, so a shared `&Channel` would not be acceptable in a `Send` future.
async fn download_onnx_runtime_assets(
    app: tauri::AppHandle,
    handle: &AsyncCancellation,
    on_progress: Channel<RuntimeDownloadEvent>,
) -> Result<RuntimeDownloadOutcome, String> {
    if handle.is_cancelled() {
        return Ok(cancelled_outcome());
    }
    let target_directory = runtime_directory(&app)?;
    let mut files = Vec::with_capacity(RUNTIME_ASSETS.len());
    for asset in RUNTIME_ASSETS {
        if handle.is_cancelled() {
            return Ok(cancelled_outcome());
        }
        let _ = on_progress.send(RuntimeDownloadEvent::Started {
            file_name: asset.file_name,
        });
        let some_bytes = download_checked_asset(handle, asset, on_progress.clone()).await?;
        let Some(bytes) = some_bytes else {
            return Ok(cancelled_outcome());
        };
        let _ = on_progress.send(RuntimeDownloadEvent::Completed {
            file_name: asset.file_name,
        });
        files.push(install_entry(asset.file_name, bytes, asset.sha256));
    }
    if handle.is_cancelled() {
        return Ok(cancelled_outcome());
    }
    install_runtime_files(&target_directory, &files)?;
    Ok(RuntimeDownloadOutcome { cancelled: false })
}

fn cancelled_outcome() -> RuntimeDownloadOutcome {
    RuntimeDownloadOutcome { cancelled: true }
}

/// Marks the named download as cancelled. Idempotent: cancelling an already-finished download
/// still succeeds (reports already-completed). Fails with a specific message if the task id is
/// unknown.
#[tauri::command]
pub fn cancel_onnx_runtime_download(download_id: String) -> Result<CancellationResult, String> {
    download_tasks().cancel(&download_id)
}

/// Flags any in-flight runtime download as cancelled. Used on app exit so a stalled connection
/// cannot keep the process alive.
pub fn cancel_all_runtime_downloads() {
    download_tasks().cancel_all();
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
    let gpu_available = if dll_path.is_file() {
        Some(directory.join(DML_DLL).is_file())
    } else {
        None
    };
    Ok(OnnxRuntimeStatus {
        state,
        version: RUNTIME_VERSION,
        dll_path: dll_path.to_string_lossy().into_owned(),
        runtime_directory: directory.to_string_lossy().into_owned(),
        download_available: true,
        message,
        gpu_available,
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

/// Streams one runtime DLL to memory while reporting progress and honouring cancellation.
/// Returns `Ok(None)` if the download was cancelled mid-file (distinct from a transport error).
async fn download_checked_asset(
    handle: &AsyncCancellation,
    asset: &RuntimeAsset,
    on_progress: Channel<RuntimeDownloadEvent>,
) -> Result<Option<Vec<u8>>, String> {
    let url = format!("{RELEASE_BASE_URL}/{}", asset.file_name);
    let client = reqwest::Client::builder()
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .build()
        .map_err(text::runtime_download_failed)?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(text::runtime_download_failed)?
        .error_for_status()
        .map_err(text::runtime_download_failed)?;
    let total = response.content_length();
    let mut stream = response.bytes_stream();
    let mut bytes: Vec<u8> = Vec::new();
    let mut downloaded = 0_u64;
    loop {
        tokio::select! {
            biased;
            _ = handle.cancelled() => return Ok(None),
            next_chunk = tokio::time::timeout(DOWNLOAD_CHUNK_TIMEOUT, stream.next()) => {
                match next_chunk {
                    Err(_) => {
                        return Err(text::runtime_download_timed_out(asset.file_name));
                    }
                    Ok(None) => break,
                    Ok(Some(chunk)) => {
                        let chunk = chunk.map_err(text::runtime_download_failed)?;
                        downloaded += chunk.len() as u64;
                        let _ = on_progress.send(RuntimeDownloadEvent::Progress {
                            file_name: asset.file_name,
                            downloaded,
                            total,
                        });
                        bytes.extend_from_slice(&chunk);
                    }
                }
            }
        }
    }
    verify_sha256(&bytes, asset.sha256)?;
    Ok(Some(bytes))
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

/// One file to be installed into the runtime directory, already verified against its SHA-256.
struct RuntimeFileInstall {
    file_name: String,
    bytes: Vec<u8>,
    sha256: String,
}

fn install_entry(file_name: &str, bytes: Vec<u8>, sha256: &str) -> RuntimeFileInstall {
    RuntimeFileInstall {
        file_name: file_name.to_string(),
        bytes,
        sha256: sha256.to_string(),
    }
}

/// Atomically replaces the runtime directory with the given files. Every file is SHA-256 verified
/// before any existing files are touched, mirroring the old pair-based installer but generalised to
/// any number of DLLs (runtime + shared provider + optional DirectML provider).
fn install_runtime_files(target_directory: &Path, files: &[RuntimeFileInstall]) -> Result<(), String> {
    for file in files {
        verify_sha256(&file.bytes, &file.sha256)?;
    }

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
    for file in files {
        let path = staging.join(&file.file_name);
        if let Err(error) = fs::write(&path, &file.bytes) {
            let _ = fs::remove_dir_all(&staging);
            return Err(text::runtime_write_failed(&path, error));
        }
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use sha2::{Digest, Sha256};

    use super::{
        install_entry, install_runtime_files, read_runtime_file, validate_model_file, verify_sha256,
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

        let files = vec![
            install_entry(RUNTIME_DLL, runtime.to_vec(), &runtime_hash),
            install_entry(PROVIDERS_DLL, provider.to_vec(), "invalid-provider-hash"),
        ];
        let error = install_runtime_files(&target, &files).unwrap_err();
        assert!(error.contains("SHA-256"));
        assert_eq!(fs::read(target.join(RUNTIME_DLL)).unwrap(), b"old-runtime");
        assert_eq!(
            fs::read(target.join(PROVIDERS_DLL)).unwrap(),
            b"old-provider"
        );

        let files = vec![
            install_entry(RUNTIME_DLL, runtime.to_vec(), &runtime_hash),
            install_entry(PROVIDERS_DLL, provider.to_vec(), &provider_hash),
        ];
        install_runtime_files(&target, &files).unwrap();
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
    #[ignore = "requires external ONNX Runtime and an official YOLOv5 ONNX fixture"]
    fn validates_yolov5_model_through_the_command_seam() {
        let runtime_path = resolve_fixture(required_fixture("MY_LABEL_TOOL_ORT_DLL"));
        let yolov5_path = resolve_fixture(required_fixture("MY_LABEL_TOOL_YOLOV5_ONNX"));

        load_runtime(&runtime_path).unwrap();
        let yolov5 = validate_model_file(&yolov5_path).unwrap();
        assert_eq!(yolov5.contract.format, YoloModelFormat::YoloV5);
        assert_eq!(yolov5.contract.class_count, 80);
        assert_eq!(yolov5.contract.output_names, ["output0"]);
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
