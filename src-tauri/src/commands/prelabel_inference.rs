use std::path::PathBuf;

use tauri::ipc::Channel;

use crate::{
    media::prelabel::{
        execution::{self, cancel_prelabel_task},
        task::CancellationResult,
    },
    models::prelabel::PrelabelModelConfig,
};

/// The inference loop, session cache and task bookkeeping live in
/// [`crate::media::prelabel::execution`]; these commands only forward results (AGENTS.md §6).
pub use crate::media::prelabel::execution::{PrelabelInferenceOutcome, PrelabelProgressEvent};

/// Runs inference over `image_paths` (a frontend batch chunk), emitting per-image progress and
/// honouring cancellation. See
/// [`crate::media::prelabel::execution::run_prelabel_inference_task`].
#[tauri::command]
pub async fn run_prelabel_inference(
    app: tauri::AppHandle,
    task_id: String,
    model: PrelabelModelConfig,
    image_paths: Vec<PathBuf>,
    on_progress: Channel<PrelabelProgressEvent>,
) -> Result<PrelabelInferenceOutcome, String> {
    execution::run_prelabel_inference_task(app, task_id, model, image_paths, on_progress).await
}

/// Marks the named prelabel task as cancelled. Idempotent; the worker stops at the next image
/// boundary and returns the images processed so far via [`PrelabelInferenceOutcome`].
#[tauri::command]
pub fn cancel_prelabel_inference(task_id: String) -> Result<CancellationResult, String> {
    cancel_prelabel_task(&task_id)
}

pub fn cancel_all_prelabel_tasks() {
    execution::cancel_all_prelabel_tasks();
}
