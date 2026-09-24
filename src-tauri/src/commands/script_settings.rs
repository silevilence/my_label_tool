use crate::i18n::zh_cn as text;
use label_script_host::{limits, protocol::Limits};
use std::path::{Path, PathBuf};
use tauri::Manager;

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(text::script_execution_failed)?;
    std::fs::create_dir_all(&path).map_err(text::script_execution_failed)?;
    Ok(path)
}
fn load(directory: &Path) -> Result<Limits, String> {
    let path = directory.join("script-resource-limits.json");
    if !path.exists() {
        return Ok(limits::defaults());
    }
    let value = serde_json::from_str(&super::read_text_file(path)?)
        .map_err(text::script_execution_failed)?;
    limits::validate(&value).map_err(|_| text::script_invalid_limits())?;
    Ok(value)
}
fn save(directory: &Path, value: &Limits) -> Result<(), String> {
    limits::validate(value).map_err(|_| text::script_invalid_limits())?;
    let content = serde_json::to_string_pretty(value).map_err(text::script_execution_failed)?;
    super::export_text_files(
        directory.to_owned(),
        vec![super::TextExportFile {
            path: PathBuf::from("script-resource-limits.json"),
            content,
        }],
    )
}
#[tauri::command]
pub fn load_script_resource_limits(app: tauri::AppHandle) -> Result<Limits, String> {
    load(&directory(&app)?)
}
#[tauri::command]
pub fn save_script_resource_limits(app: tauri::AppHandle, value: Limits) -> Result<(), String> {
    save(&directory(&app)?, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changes_apply_on_next_load_and_invalid_values_do_not_overwrite() {
        let path = std::env::temp_dir().join(format!("script-limits-test-{}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        let value = Limits {
            max_memory_mi_b: 128,
            timeout_seconds: 7,
        };
        save(&path, &value).unwrap();
        assert_eq!(load(&path).unwrap().timeout_seconds, 7);
        assert!(save(
            &path,
            &Limits {
                max_memory_mi_b: 1,
                timeout_seconds: 7
            }
        )
        .is_err());
        assert_eq!(load(&path).unwrap().max_memory_mi_b, 128);
        std::fs::remove_file(path.join("script-resource-limits.json")).unwrap();
        assert_eq!(
            load(&path).unwrap().max_memory_mi_b,
            limits::defaults().max_memory_mi_b
        );
        std::fs::remove_dir(path).unwrap();
    }
}
