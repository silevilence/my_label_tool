use std::path::PathBuf;

use tauri::ipc::Channel;

pub use crate::media::pt_conversion::{
    cancel_all_pt_conversions_and_wait, PtConversionEnvironment, PtConversionEvent,
    PtConversionParameters, PtConversionPlan, PtConversionResult,
};

#[tauri::command]
pub async fn detect_pt_conversion_environment() -> Result<PtConversionEnvironment, String> {
    crate::media::pt_conversion::detect_pt_conversion_environment().await
}

#[tauri::command]
pub fn preview_pt_conversion_command(
    pt_path: PathBuf,
    parameters: PtConversionParameters,
    conversion_id: String,
    environment: PtConversionEnvironment,
) -> Result<PtConversionPlan, String> {
    crate::media::pt_conversion::preview_pt_conversion_command(
        pt_path,
        parameters,
        conversion_id,
        environment,
    )
}

#[tauri::command]
pub async fn convert_pt_to_onnx(
    pt_path: PathBuf,
    plan: PtConversionPlan,
    conversion_id: String,
    on_event: Channel<PtConversionEvent>,
) -> Result<PtConversionResult, String> {
    crate::media::pt_conversion::convert_pt_to_onnx(pt_path, plan, conversion_id, move |event| {
        let _ = on_event.send(event);
    })
    .await
}

#[tauri::command]
pub fn cancel_pt_conversion(conversion_id: String) -> Result<(), String> {
    crate::media::pt_conversion::cancel_pt_conversion(conversion_id)
}
