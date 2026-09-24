use crate::{
    i18n::zh_cn as text,
    scripting::{
        registry,
        runner::{self, ScriptResult},
    },
};
use label_script_host::protocol::{Failure, Snapshot};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{ipc::Channel, Manager};

fn host_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let name = format!("label-script-host{}", std::env::consts::EXE_SUFFIX);
    let mut paths = vec![];
    if let Ok(current) = std::env::current_exe() {
        if let Some(directory) = current.parent() {
            paths.push(directory.join(&name));
        }
    }
    if let Ok(directory) = app.path().resource_dir() {
        paths.push(directory.join("script-tools").join(&name));
        paths.push(directory.join(&name));
    }
    #[cfg(debug_assertions)]
    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("script-host/target/debug")
            .join(name),
    );
    paths
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(text::script_host_unavailable)
}

#[tauri::command]
pub fn script_host_available(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(host_path(&app).is_ok())
}

#[tauri::command]
pub async fn run_script(
    app: tauri::AppHandle,
    run_id: String,
    snapshot: Snapshot,
    source: String,
    on_event: Channel<Value>,
) -> Result<Vec<ScriptResult>, Vec<Failure>> {
    let limits = super::load_script_resource_limits(app.clone())
        .map_err(|e| vec![Failure::new("INVALID_ARGUMENT", e)])?;
    let path = host_path(&app).map_err(|e| vec![Failure::new("HOST_UNAVAILABLE", e)])?;
    let registration = registry::Registration::new(run_id).map_err(|e| vec![e])?;
    tauri::async_runtime::spawn_blocking(move || {
        runner::run(
            &path,
            snapshot,
            source,
            limits,
            16,
            &registration.cancelled,
            &mut |event| {
                let _ = on_event.send(event);
            },
        )
    })
    .await
    .map_err(|e| {
        vec![Failure::new(
            "PROTOCOL_ERROR",
            text::script_execution_failed(e),
        )]
    })?
}

#[tauri::command]
pub fn cancel_script(run_id: String) -> Result<(), String> {
    registry::cancel(&run_id);
    Ok(())
}
