use crate::{i18n::zh_cn as text, models::prelabel::PrelabelResourceLimits};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MIB: u64 = 1024 * 1024;
pub const BYTES_PER_OUTPUT_ELEMENT: u64 = 8;
static SETTINGS_IO: Mutex<()> = Mutex::new(());

impl PrelabelResourceLimits {
    pub fn max_output_elements(&self) -> Result<usize, String> {
        if self.max_memory_mib == 0
            || self.max_memory_mib > MAX_SAFE_INTEGER / MIB
            || self.max_candidates == 0
            || self.max_candidates > MAX_SAFE_INTEGER
        {
            return Err(text::PRELABEL_RESOURCE_LIMITS_INVALID.to_string());
        }
        usize::try_from(self.max_candidates)
            .map_err(|_| text::PRELABEL_RESOURCE_LIMITS_INVALID.to_string())?;
        usize::try_from(self.max_memory_mib * MIB / BYTES_PER_OUTPUT_ELEMENT)
            .map_err(|_| text::PRELABEL_RESOURCE_LIMITS_INVALID.to_string())
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("prelabel-resource-limits.json"))
        .map_err(text::prelabel_resource_settings_failed)
}

pub fn load(app: &tauri::AppHandle) -> Result<PrelabelResourceLimits, String> {
    read(&settings_path(app)?)
}

pub fn save(app: &tauri::AppHandle, limits: PrelabelResourceLimits) -> Result<(), String> {
    write(&settings_path(app)?, limits)
}

fn read(path: &Path) -> Result<PrelabelResourceLimits, String> {
    let _guard = SETTINGS_IO
        .lock()
        .map_err(text::prelabel_resource_settings_failed)?;
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PrelabelResourceLimits::default())
        }
        Err(error) => return Err(text::prelabel_resource_settings_failed(error)),
    };
    let limits: PrelabelResourceLimits =
        serde_json::from_str(&contents).map_err(text::prelabel_resource_settings_failed)?;
    limits.max_output_elements()?;
    Ok(limits)
}

fn write(path: &Path, limits: PrelabelResourceLimits) -> Result<(), String> {
    limits.max_output_elements()?;
    let _guard = SETTINGS_IO
        .lock()
        .map_err(text::prelabel_resource_settings_failed)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(text::prelabel_resource_settings_failed)?;
    }
    let json =
        serde_json::to_vec_pretty(&limits).map_err(text::prelabel_resource_settings_failed)?;
    let staging = path.with_extension("saving");
    let result = fs::write(&staging, json).and_then(|()| fs::rename(&staging, path));
    if let Err(error) = result {
        let _ = fs::remove_file(&staging);
        return Err(text::prelabel_resource_settings_failed(error));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_memory_for_both_copies_and_rejects_invalid_limits() {
        assert_eq!(MAX_SAFE_INTEGER / MIB, 8_589_934_591);
        assert_eq!(
            PrelabelResourceLimits {
                max_memory_mib: 1,
                max_candidates: 9_007_199_254_740_991,
            }
            .max_output_elements()
            .unwrap(),
            131_072
        );
        let maximum = PrelabelResourceLimits {
            max_memory_mib: 8_589_934_591,
            max_candidates: 1,
        };
        assert_eq!(
            maximum.max_output_elements().unwrap(),
            1_125_899_906_711_552
        );
        assert!(PrelabelResourceLimits {
            max_memory_mib: 8_589_934_592,
            ..maximum
        }
        .max_output_elements()
        .is_err());
        assert_eq!(
            PrelabelResourceLimits::default()
                .max_output_elements()
                .unwrap(),
            10_485_760
        );
        for limits in [
            PrelabelResourceLimits {
                max_memory_mib: 0,
                ..Default::default()
            },
            PrelabelResourceLimits {
                max_candidates: 0,
                ..Default::default()
            },
            PrelabelResourceLimits {
                max_memory_mib: u64::MAX,
                ..Default::default()
            },
            PrelabelResourceLimits {
                max_candidates: 9_007_199_254_740_992,
                ..Default::default()
            },
        ] {
            assert!(limits.max_output_elements().is_err());
        }
    }

    #[test]
    fn loads_defaults_round_trips_and_preserves_saved_settings_on_invalid_write() {
        let dir = std::env::temp_dir().join(format!("prelabel-limits-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("limits.json");
        let _ = fs::remove_file(&path);
        assert_eq!(read(&path).unwrap(), PrelabelResourceLimits::default());
        fs::write(&path, "{}").unwrap();
        assert_eq!(read(&path).unwrap(), PrelabelResourceLimits::default());
        let limits = PrelabelResourceLimits {
            max_memory_mib: 256,
            max_candidates: 200_000,
        };
        write(&path, limits).unwrap();
        assert_eq!(read(&path).unwrap(), limits);
        assert_eq!(serde_json::to_value(limits).unwrap()["maxMemoryMiB"], 256);
        assert!(write(
            &path,
            PrelabelResourceLimits {
                max_memory_mib: 0,
                ..limits
            }
        )
        .is_err());
        assert_eq!(read(&path).unwrap(), limits);
        write(&path, PrelabelResourceLimits::default()).unwrap();
        assert_eq!(read(&path).unwrap(), PrelabelResourceLimits::default());
        fs::write(&path, "{broken").unwrap();
        assert!(read(&path).is_err());
        write(&path, PrelabelResourceLimits::default()).unwrap();
        assert_eq!(read(&path).unwrap(), PrelabelResourceLimits::default());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&dir).unwrap();
    }
}
