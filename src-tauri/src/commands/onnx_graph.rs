use crate::{
    i18n::zh_cn as text,
    media::onnx_graph::{self, Graph},
};
use std::path::PathBuf;

/// Host UI only. Intentionally absent from the plugin protocol dispatcher.
#[tauri::command]
pub async fn inspect_onnx_graph(path: PathBuf) -> Result<Graph, String> {
    tauri::async_runtime::spawn_blocking(move || onnx_graph::inspect_file(&path))
        .await
        .map_err(text::onnx_graph_task_failed)?
}
