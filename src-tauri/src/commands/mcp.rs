use crate::mcp::{self, Poll, Status};
use serde_json::Value;

#[tauri::command]
pub fn mcp_poll() -> Result<Poll, String> {
    mcp::host().poll()
}
#[tauri::command]
pub fn mcp_token() -> Result<String, String> {
    mcp::host().token()
}
#[tauri::command]
pub async fn mcp_configure(
    enabled: bool,
    address: String,
    port: u16,
    rotate: bool,
) -> Result<Status, String> {
    mcp::host().configure(enabled, address, port, rotate).await
}
#[tauri::command]
pub fn mcp_resolve(id: String, result: Value) -> Result<(), String> {
    mcp::host().resolve(&id, result)
}

#[tauri::command]
pub fn mcp_set_authority(authority: mcp::output::Authority) -> Result<(), String> {
    mcp::host().set_authority(authority)
}
#[tauri::command]
pub async fn mcp_prepare_output(
    task_id: String,
    session: String,
    lease: String,
    groups: Vec<mcp::output::OutputGroup>,
) -> Result<mcp::output::Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mcp::host().prepare_output(task_id, session, lease, groups)
    })
    .await
    .map_err(crate::i18n::mcp_zh_cn::failed)?
}
#[tauri::command]
pub async fn mcp_commit_output(task_id: String, overwrite: bool) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || mcp::host().commit_output(&task_id, overwrite))
        .await
        .map_err(crate::i18n::mcp_zh_cn::failed)?
}
#[tauri::command]
pub fn mcp_discard_output(task_id: String) -> Result<(), String> {
    mcp::host().discard_output(task_id)
}
