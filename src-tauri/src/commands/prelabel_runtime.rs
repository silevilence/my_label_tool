use std::path::PathBuf;

use tauri::ipc::Channel;

use crate::media::prelabel::{
    runtime_download::{self, cancel_download, install_runtime_from_file},
    task::CancellationResult,
};

/// Runtime download/verify/install/status orchestration lives in
/// [`crate::media::prelabel::runtime_download`]; these commands only validate arguments and forward
/// results (AGENTS.md §6).
pub use crate::media::prelabel::runtime_download::{
    ModelValidationReport, OnnxRuntimeStatus, RuntimeDownloadEvent, RuntimeDownloadOutcome,
};

#[tauri::command]
pub fn get_onnx_runtime_status(app: tauri::AppHandle) -> Result<OnnxRuntimeStatus, String> {
    runtime_download::runtime_status(&runtime_download::runtime_directory(&app)?)
}

#[tauri::command]
pub fn install_onnx_runtime_from_file(
    app: tauri::AppHandle,
    source_path: PathBuf,
) -> Result<OnnxRuntimeStatus, String> {
    install_runtime_from_file(app, source_path)
}

/// Downloads, verifies and installs the runtime DLLs for a cancellable `download_id`, streaming
/// per-file progress through `on_progress`. See
/// [`crate::media::prelabel::runtime_download::download_runtime_task`].
#[tauri::command]
pub async fn download_onnx_runtime(
    app: tauri::AppHandle,
    download_id: String,
    on_progress: Channel<RuntimeDownloadEvent>,
) -> Result<RuntimeDownloadOutcome, String> {
    runtime_download::download_runtime_task(app, download_id, on_progress).await
}

/// Marks the named download as cancelled. Idempotent: cancelling an already-finished download still
/// succeeds (reports already-completed).
#[tauri::command]
pub fn cancel_onnx_runtime_download(download_id: String) -> Result<CancellationResult, String> {
    cancel_download(&download_id)
}

/// Flags any in-flight runtime download as cancelled. Used on app exit so a stalled connection
/// cannot keep the process alive.
pub fn cancel_all_runtime_downloads() {
    runtime_download::cancel_all_runtime_downloads();
}

#[tauri::command]
pub fn validate_prelabel_model(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<ModelValidationReport, String> {
    runtime_download::validate_prelabel_model(app, path)
}
