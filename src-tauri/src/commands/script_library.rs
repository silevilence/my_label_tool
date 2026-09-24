use crate::i18n::zh_cn as text;
use std::path::PathBuf;
use tauri::Manager;

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(text::script_execution_failed)?
        .join("scripts");
    std::fs::create_dir_all(&path).map_err(text::script_execution_failed)?;
    Ok(path)
}
#[tauri::command]
pub fn script_library_directory(app: tauri::AppHandle) -> Result<String, String> {
    let path = directory(&app)?;
    if !path.join("index.json").exists() {
        super::export_text_files(
            path.clone(),
            vec![super::TextExportFile {
                path: PathBuf::from("index.json"),
                content: "{\"schemaVersion\":1,\"scripts\":[]}".into(),
            }],
        )?;
    }
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub fn delete_script_file(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(text::script_invalid_library_id());
    }
    let path = directory(&app)?.join(format!("{id}.lua"));
    if path.exists() {
        std::fs::remove_file(path).map_err(text::script_execution_failed)?;
    }
    Ok(())
}
