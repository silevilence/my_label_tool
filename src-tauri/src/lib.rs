mod commands;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::save_shortcuts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
