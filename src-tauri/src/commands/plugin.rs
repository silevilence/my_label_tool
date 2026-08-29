use std::path::PathBuf;

use tauri::Manager;

use crate::i18n::zh_cn as text;
use crate::plugins::config::{
    migrate_plugin_configs as migrate_configs, PluginConfig, PluginConfigMigrationReport,
};
use crate::plugins::exporter::{
    cancel_plugin_export as cancel_export, load_plugin_export_formats as load_export_formats,
    run_plugin_export as run_export, PluginExportCancellationResult, PluginExportFormatSnapshot,
    PluginExportRequest, PluginExportResult,
};
use crate::plugins::label_preset::{
    load_plugin_label_presets as load_presets, PluginLabelPresetSnapshot,
};
use crate::plugins::prelabel::{
    cancel_plugin_prelabel as cancel_prelabel,
    load_plugin_prelabel_sources as load_prelabel_sources, run_plugin_prelabel as run_prelabel,
    PluginPrelabelCancellationResult, PluginPrelabelRequest, PluginPrelabelResult,
    PluginPrelabelSourceSnapshot,
};
use crate::plugins::registry::{
    authorize_plugin_install_for_project, clear_registered_plugin_failures, get_registered_plugin,
    load_plugin_registry, pending_plugin_install_id, prepare_plugin_install_for_project,
    set_registered_plugin_enabled, uninstall_registered_plugin, PluginInstallPreview,
    PluginPermissionGrant, PluginRegistryEntry, PluginRegistryError, PluginRegistrySnapshot,
};
use crate::plugins::runtime::{
    begin_plugin_maintenance, load_plugin_runtime_settings, plugin_runtime_logs,
    save_plugin_runtime_settings, shutdown_all_plugin_processes, stop_plugin_process,
    PluginRuntimeSettings,
};
use tauri::ipc::Channel;

#[tauri::command]
pub fn install_plugin(
    app: tauri::AppHandle,
    path: PathBuf,
    project_dir: Option<PathBuf>,
) -> Result<PluginInstallPreview, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    prepare_plugin_install_for_project(&app_data_dir, &path, project_dir.as_deref())
        .map_err(command_error)
}

#[tauri::command]
pub fn authorize_plugin(
    app: tauri::AppHandle,
    install_token: String,
    grants: Option<Vec<PluginPermissionGrant>>,
    project_dir: Option<PathBuf>,
) -> Result<Option<PluginRegistryEntry>, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    let _maintenance = if grants.is_some() {
        let plugin_id =
            pending_plugin_install_id(&app_data_dir, &install_token).map_err(command_error)?;
        Some(begin_plugin_maintenance(&plugin_id).map_err(runtime_command_error)?)
    } else {
        None
    };
    authorize_plugin_install_for_project(
        &app_data_dir,
        &install_token,
        grants,
        project_dir.as_deref(),
    )
    .map_err(command_error)
}

#[tauri::command]
pub fn uninstall_plugin(app: tauri::AppHandle, plugin_id: String) -> Result<(), String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    let _maintenance = begin_plugin_maintenance(&plugin_id).map_err(runtime_command_error)?;
    uninstall_registered_plugin(&app_data_dir, &plugin_id).map_err(command_error)
}

#[tauri::command]
pub fn list_plugins(app: tauri::AppHandle) -> Result<PluginRegistrySnapshot, String> {
    Ok(load_plugin_registry(&plugin_app_data_dir(&app)?))
}

#[tauri::command]
pub fn load_plugin_label_presets(
    app: tauri::AppHandle,
) -> Result<PluginLabelPresetSnapshot, String> {
    Ok(load_presets(&plugin_app_data_dir(&app)?))
}

#[tauri::command]
pub fn load_plugin_export_formats(
    app: tauri::AppHandle,
) -> Result<PluginExportFormatSnapshot, String> {
    Ok(load_export_formats(&plugin_app_data_dir(&app)?))
}

#[tauri::command]
pub async fn run_plugin_export(
    app: tauri::AppHandle,
    request: PluginExportRequest,
    on_event: Channel<serde_json::Value>,
) -> Result<PluginExportResult, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_export(&app_data_dir, request, move |event| {
            let _ = on_event.send(event);
        })
        .map_err(runtime_command_error)
    })
    .await
    .map_err(text::plugin_export_task_failed)?
}

#[tauri::command]
pub fn cancel_plugin_export(export_id: String) -> Result<PluginExportCancellationResult, String> {
    Ok(cancel_export(&export_id))
}

#[tauri::command]
pub fn load_plugin_prelabel_sources(
    app: tauri::AppHandle,
    project_folder: Option<PathBuf>,
) -> Result<PluginPrelabelSourceSnapshot, String> {
    Ok(load_prelabel_sources(
        &plugin_app_data_dir(&app)?,
        project_folder.as_deref(),
    ))
}

#[tauri::command]
pub async fn run_plugin_prelabel(
    app: tauri::AppHandle,
    request: PluginPrelabelRequest,
    on_event: Channel<serde_json::Value>,
) -> Result<PluginPrelabelResult, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_prelabel(&app_data_dir, request, move |event| {
            let _ = on_event.send(event);
        })
        .map_err(runtime_command_error)
    })
    .await
    .map_err(text::plugin_prelabel_task_failed)?
}

#[tauri::command]
pub fn cancel_plugin_prelabel(
    operation_id: String,
) -> Result<PluginPrelabelCancellationResult, String> {
    Ok(cancel_prelabel(&operation_id))
}

#[tauri::command]
pub fn set_plugin_enabled(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<PluginRegistryEntry, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    let updated =
        set_registered_plugin_enabled(&app_data_dir, &plugin_id, enabled).map_err(command_error)?;
    if !enabled {
        stop_plugin_process(&plugin_id);
    }
    Ok(updated)
}

#[tauri::command]
pub fn get_plugin_status(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<PluginRegistryEntry, String> {
    get_registered_plugin(&plugin_app_data_dir(&app)?, &plugin_id).map_err(command_error)
}

#[tauri::command]
pub fn clear_plugin_failures(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<PluginRegistryEntry, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    clear_registered_plugin_failures(&app_data_dir, &plugin_id).map_err(command_error)
}

#[tauri::command]
pub fn get_plugin_runtime_settings(app: tauri::AppHandle) -> Result<PluginRuntimeSettings, String> {
    load_plugin_runtime_settings(&plugin_app_data_dir(&app)?).map_err(command_error)
}

#[tauri::command]
pub fn set_plugin_safe_mode(
    app: tauri::AppHandle,
    safe_mode: bool,
) -> Result<PluginRuntimeSettings, String> {
    let settings = save_plugin_runtime_settings(
        &plugin_app_data_dir(&app)?,
        PluginRuntimeSettings { safe_mode },
    )
    .map_err(command_error)?;
    if safe_mode {
        shutdown_all_plugin_processes();
    }
    Ok(settings)
}

#[tauri::command]
pub fn get_plugin_runtime_logs(plugin_id: String) -> Result<Vec<String>, String> {
    Ok(plugin_runtime_logs(&plugin_id))
}

#[tauri::command]
pub async fn migrate_plugin_configs(
    app: tauri::AppHandle,
    configs: Vec<PluginConfig>,
) -> Result<PluginConfigMigrationReport, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || migrate_configs(&app_data_dir, configs))
        .await
        .map_err(text::plugin_config_migration_task_failed)
}

fn plugin_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(text::plugin_app_data_dir_failed)
}

fn command_error(error: PluginRegistryError) -> String {
    format!("[{}] {}", error.code, error.message)
}

fn runtime_command_error(error: crate::plugins::runtime::PluginCallError) -> String {
    format!("[{}] {}", error.code, error.message)
}
