use crate::{media::prelabel::resource_limits, models::prelabel::PrelabelResourceLimits};

#[tauri::command]
pub fn load_prelabel_resource_limits(
    app: tauri::AppHandle,
) -> Result<PrelabelResourceLimits, String> {
    resource_limits::load(&app)
}

#[tauri::command]
pub fn save_prelabel_resource_limits(
    app: tauri::AppHandle,
    limits: PrelabelResourceLimits,
) -> Result<(), String> {
    resource_limits::save(&app, limits)
}
