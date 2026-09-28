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
