use std::path::PathBuf;

use tauri::Manager;

use crate::i18n::zh_cn as text;
use crate::plugins::registry::{
    authorize_plugin_install, clear_registered_plugin_failures, get_registered_plugin,
    load_plugin_registry, prepare_plugin_install, set_registered_plugin_enabled,
    uninstall_registered_plugin, PluginInstallPreview, PluginPermissionGrant, PluginRegistryEntry,
    PluginRegistryError, PluginRegistrySnapshot,
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
    authorize_plugin_install(&app_data_dir, &install_token, grants).map_err(command_error)
}

#[tauri::command]
pub fn uninstall_plugin(app: tauri::AppHandle, plugin_id: String) -> Result<(), String> {
    let app_data_dir = plugin_app_data_dir(&app)?;
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
    set_registered_plugin_enabled(&app_data_dir, &plugin_id, enabled).map_err(command_error)
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

fn plugin_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(text::plugin_app_data_dir_failed)
}

fn command_error(error: PluginRegistryError) -> String {
    format!("[{}] {}", error.code, error.message)
}
