//! Bootstrap selection cannot depend on the selected reader. Windows stores it
//! in HKCU, outside DLP text-file I/O, so a broken reader remains repairable.
use super::{error, Config};

#[cfg(windows)]
const KEY: windows::core::PCWSTR = windows::core::w!("Software\\my_label_tool\\TextReadAdapter");
#[cfg(windows)]
const VALUE: windows::core::PCWSTR = windows::core::w!("Config");

#[cfg(windows)]
pub(super) fn load() -> Result<Config, String> {
    load_key(KEY)
}
#[cfg(windows)]
fn load_key(key: windows::core::PCWSTR) -> Result<Config, String> {
    use windows::Win32::{Foundation::ERROR_FILE_NOT_FOUND, System::Registry::*};
    let mut bytes = vec![0u8; 64 * 1024];
    let mut size = bytes.len() as u32;
    // SAFETY: static UTF-16 names and a writable buffer of `size` bytes.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key,
            VALUE,
            RRF_RT_REG_BINARY,
            None,
            Some(bytes.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(Config::default());
    }
    status.ok().map_err(error)?;
    bytes.truncate(size as usize);
    serde_json::from_slice(&bytes).map_err(error)
}
#[cfg(windows)]
pub(super) fn save(config: &Config) -> Result<(), String> {
    save_key(KEY, config)
}
#[cfg(windows)]
fn save_key(key_path: windows::core::PCWSTR, config: &Config) -> Result<(), String> {
    use windows::Win32::System::Registry::*;
    let bytes = serde_json::to_vec(config).map_err(error)?;
    if bytes.len() > 64 * 1024 {
        return Err(error(crate::i18n::zh_cn::TEXT_READ_CONFIG_INVALID));
    }
    let mut key = HKEY::default();
    // SAFETY: static UTF-16 names; the returned handle is closed on every path.
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key_path,
            None,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    }
    .ok()
    .map_err(error)?;
    // SAFETY: the handle is open and the buffer has the specified byte count.
    let result = unsafe {
        RegSetKeyValueW(
            key,
            None,
            VALUE,
            REG_BINARY.0,
            Some(bytes.as_ptr().cast()),
            bytes.len() as u32,
        )
    }
    .ok()
    .map_err(error);
    unsafe {
        let _ = RegCloseKey(key);
    }
    result
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn registry_bootstrap_round_trip_uses_an_isolated_key() {
        use windows::{core::PCWSTR, Win32::System::Registry::*};
        let name = format!(
            "Software\\my_label_tool\\Tests\\TextRead-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let key = PCWSTR(wide.as_ptr());
        struct Cleanup(PCWSTR);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                unsafe {
                    let _ = RegDeleteTreeW(HKEY_CURRENT_USER, self.0);
                }
            }
        }
        let _cleanup = Cleanup(key);
        assert_eq!(load_key(key).unwrap(), Config::default());
        let config = Config {
            mode: "python".into(),
            values: std::collections::HashMap::from([(
                "executable".into(),
                "C:\\中文\\python.exe".into(),
            )]),
            timeout_ms: 7000,
        };
        save_key(key, &config).unwrap();
        assert_eq!(load_key(key).unwrap(), config);
        // Corrupt bootstrap data must fail closed, not silently select native.
        let bytes = b"invalid";
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key,
                VALUE,
                REG_BINARY.0,
                Some(bytes.as_ptr().cast()),
                bytes.len() as u32,
            )
        }
        .ok()
        .unwrap();
        assert!(load_key(key).is_err());
    }
}
// Non-Windows development hosts use a bootstrap file; it is the sole native
// configuration read and must be excluded from any transparent-encryption policy.
#[cfg(not(windows))]
fn path() -> Result<std::path::PathBuf, String> {
    std::env::var_os("HOME")
        .map(|p| std::path::PathBuf::from(p).join(".my-label-tool-text-reader"))
        .ok_or_else(|| error(crate::i18n::zh_cn::TEXT_READ_CONFIG_INVALID))
}
#[cfg(not(windows))]
pub(super) fn load() -> Result<Config, String> {
    match std::fs::read(path()?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(error(e)),
    }
}
#[cfg(not(windows))]
pub(super) fn save(config: &Config) -> Result<(), String> {
    std::fs::write(path()?, serde_json::to_vec(config).map_err(error)?).map_err(error)
}
