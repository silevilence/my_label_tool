use std::path::PathBuf;

use tauri::Manager;

use crate::i18n::zh_cn as text;
use crate::plugins::registry::{
    authorize_plugin_install, clear_registered_plugin_failures, get_registered_plugin,
    load_plugin_registry, pending_plugin_install_id, prepare_plugin_install,
    set_registered_plugin_enabled, uninstall_registered_plugin, PluginInstallPreview,
    PluginPermissionGrant, PluginRegistryEntry, PluginRegistryError, PluginRegistrySnapshot,
};
use crate::plugins::runtime::{
    begin_plugin_maintenance, load_plugin_runtime_settings, plugin_runtime_logs,
    save_plugin_runtime_settings, shutdown_all_plugin_processes, stop_plugin_process,
    PluginRuntimeSettings,
};

#[tauri::command]
pub fn install_plugin(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<PluginInstallPreview, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    prepare_plugin_install(&app_data_dir, &path).map_err(command_error)
}

#[tauri::command]
pub fn authorize_plugin(
    app: tauri::AppHandle,
    install_token: String,
    grants: Option<Vec<PluginPermissionGrant>>,
) -> Result<Option<PluginRegistryEntry>, String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
    let _maintenance = if grants.is_some() {
        let plugin_id =
            pending_plugin_install_id(&app_data_dir, &install_token).map_err(command_error)?;
        Some(begin_plugin_maintenance(&plugin_id).map_err(runtime_command_error)?)
    } else {
        None
    };
    authorize_plugin_install(&app_data_dir, &install_token, grants).map_err(command_error)
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
