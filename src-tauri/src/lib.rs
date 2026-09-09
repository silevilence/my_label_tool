mod commands;
mod i18n;
mod media;
mod models;
pub mod plugins;
mod process_control;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_image_files,
            commands::export_annotations_json,
            commands::export_text_files,
            commands::read_text_file,
            commands::list_text_files,
            commands::load_label_configs,
            commands::save_label_configs,
            commands::load_label_templates,
            commands::save_label_templates,
            commands::load_shortcuts,
            commands::save_shortcuts,
            commands::inspect_onnx_model,
            commands::find_converted_onnx,
            commands::load_prelabel_model_library,
            commands::save_prelabel_model_library,
            commands::get_onnx_runtime_status,
            commands::install_onnx_runtime_from_file,
            commands::download_onnx_runtime,
            commands::cancel_onnx_runtime_download,
            commands::validate_prelabel_model,
            commands::download_prelabel_model,
            commands::cancel_prelabel_model_download,
            commands::run_prelabel_inference,
            commands::cancel_prelabel_inference,
            commands::detect_pt_conversion_environment,
            commands::preview_pt_conversion_command,
            commands::convert_pt_to_onnx,
            commands::cancel_pt_conversion,
            commands::install_plugin,
            commands::authorize_plugin,
            commands::uninstall_plugin,
            commands::list_plugins,
            commands::load_plugin_label_presets,
            commands::load_plugin_export_formats,
            commands::run_plugin_export,
            commands::cancel_plugin_export,
            commands::load_plugin_prelabel_sources,
            commands::run_plugin_prelabel,
            commands::cancel_plugin_prelabel,
            commands::set_plugin_enabled,
            commands::get_plugin_status,
            commands::clear_plugin_failures,
            commands::get_plugin_runtime_settings,
            commands::set_plugin_safe_mode,
            commands::get_plugin_runtime_logs,
            commands::migrate_plugin_configs
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                commands::cancel_all_pt_conversions_and_wait();
                commands::cancel_all_prelabel_tasks();
                commands::cancel_all_runtime_downloads();
                commands::cancel_all_prelabel_model_downloads();
                plugins::runtime::shutdown_all_plugin_processes();
            }
        });
}
