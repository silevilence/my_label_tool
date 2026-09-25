use crate::{
    acp::{self, Config, Outcome},
    i18n::zh_cn as text,
};
use serde_json::Value;
use tauri::ipc::Channel;

#[tauri::command]
pub async fn run_acp_agent(
    run_id: String,
    config: Config,
    prompt: String,
    on_event: Channel<Value>,
) -> Result<Outcome, String> {
    config.validate()?;
    let registration = acp::registry::Registration::new(run_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Never use the project, repository, or script library as the Agent cwd.
        let directory = tempfile::Builder::new()
            .prefix("my-label-tool-acp-")
            .tempdir()
            .map_err(text::acp_start_failed)?;
        acp::client::run(
            &config,
            directory.path(),
            &prompt,
            &registration.control,
            &mut |event| {
                if on_event.send(event).is_err() {
                    registration
                        .control
                        .cancelled
                        .store(true, std::sync::atomic::Ordering::Release);
                }
            },
        )
    })
    .await
    .map_err(text::acp_start_failed)?
}

#[tauri::command]
pub fn cancel_acp_agent(run_id: String) -> Result<(), String> {
    acp::registry::cancel(&run_id);
    Ok(())
}

#[tauri::command]
pub fn respond_acp_permission(
    run_id: String,
    request_id: String,
    option_id: Option<String>,
) -> Result<(), String> {
    acp::registry::respond(&run_id, &request_id, option_id)
}
