use tauri::ipc::Channel;

use crate::media::prelabel::{
    model_download::{self, cancel_model_download},
    task::CancellationResult,
};

/// Model download orchestration lives in [`crate::media::prelabel::model_download`]; these
/// commands only validate arguments and forward results (AGENTS.md §6).
pub use crate::media::prelabel::model_download::{ModelDownloadEvent, ModelDownloadResult};

/// Downloads the model from `source_url`, validates it as a YOLO ONNX export and installs it
/// into the managed models directory, streaming progress through `on_progress`. Returns `None`
/// when the download was cancelled. See
/// [`crate::media::prelabel::model_download::download_prelabel_model_task`].
#[tauri::command]
pub async fn download_prelabel_model(
    app: tauri::AppHandle,
    source_url: String,
    previous_path: Option<String>,
    download_id: String,
    on_progress: Channel<ModelDownloadEvent>,
) -> Result<Option<ModelDownloadResult>, String> {
    model_download::download_prelabel_model_task(
        app,
        download_id,
        source_url,
        previous_path,
        on_progress,
    )
    .await
}

/// Marks the named model download as cancelled. Idempotent: cancelling an already-finished
/// download still succeeds (reports already-completed).
#[tauri::command]
pub fn cancel_prelabel_model_download(download_id: String) -> Result<CancellationResult, String> {
    cancel_model_download(&download_id)
}

/// Flags any in-flight model download as cancelled. Used on app exit so a stalled connection
/// cannot keep the process alive.
pub fn cancel_all_prelabel_model_downloads() {
    model_download::cancel_all_model_downloads();
}
