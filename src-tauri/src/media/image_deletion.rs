use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::i18n::zh_cn as text;

#[cfg(windows)]
#[path = "image_recycle_windows.rs"]
mod platform;

pub fn recycle_image(folder: &Path, image: &Path) -> Result<(), String> {
    let path = validate_image_path(folder, image)?;
    #[cfg(windows)]
    {
        // IFileOperation needs its own STA; the Tauri blocking pool may already be MTA.
        std::thread::spawn(move || platform::recycle(&path))
            .join()
            .map_err(|_| text::IMAGE_DELETE_FAILED.to_string())?
            .map_err(|error| format!("{}：{error}", text::IMAGE_DELETE_FAILED))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(text::IMAGE_DELETE_UNSUPPORTED.to_string())
    }
}

fn validate_image_path(folder: &Path, image: &Path) -> Result<PathBuf, String> {
    let invalid = || text::IMAGE_DELETE_INVALID_PATH.to_string();
    if !folder.is_absolute() || !image.is_absolute() {
        return Err(invalid());
    }
    let folder = fs::canonicalize(folder).map_err(|_| invalid())?;
    let metadata = fs::symlink_metadata(image)
        .map_err(|error| format!("{}：{error}", text::IMAGE_DELETE_FAILED))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(invalid());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return Err(invalid());
        }
    }
    let path = fs::canonicalize(image).map_err(|_| invalid())?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if path.parent() != Some(folder.as_path())
        || !["jpg", "jpeg", "png", "bmp"]
            .iter()
            .any(|value| extension.eq_ignore_ascii_case(value))
    {
        return Err(invalid());
    }
    // The same supported file types as the list; even an image damaged since loading
    // can be recycled. No recursive removal, wildcard expansion or permanent fallback.
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "image-delete-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn validates_only_direct_regular_image_files() {
        let folder = fixture();
        let image = folder.join("图 片.PNG");
        fs::write(&image, b"test fixture").unwrap();
        assert_eq!(
            validate_image_path(&folder, &image).unwrap(),
            fs::canonicalize(&image).unwrap()
        );
        assert!(validate_image_path(&folder, Path::new("relative.png")).is_err());
        assert!(validate_image_path(&folder, &folder).is_err());
        assert!(validate_image_path(&folder, &folder.join("missing.png")).is_err());
        let other = folder.join("other.txt");
        fs::write(&other, b"keep").unwrap();
        assert!(validate_image_path(&folder, &other).is_err());
        let nested = folder.join("nested");
        fs::create_dir(&nested).unwrap();
        let nested_image = nested.join("nested.jpg");
        fs::write(&nested_image, b"keep").unwrap();
        assert!(validate_image_path(&folder, &nested_image).is_err());
        assert!(validate_image_path(&nested, &image).is_err());
        assert!(image.exists() && other.exists() && nested_image.exists());
        fs::remove_dir_all(&folder).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_file_is_not_deleted() {
        use std::os::windows::fs::OpenOptionsExt;
        let folder = fixture();
        let image = folder.join("locked.png");
        fs::write(&image, b"keep").unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&image)
            .unwrap();
        assert!(recycle_image(&folder, &image).is_err());
        assert!(image.exists());
        drop(lock);
        assert_eq!(fs::read(&image).unwrap(), b"keep");
        fs::remove_dir_all(&folder).unwrap();
    }

    /// Opt-in integration test: recycles only its own fixture, checks the real Shell
    /// Recycle Bin and restores it before cleaning up the temporary directory.
    #[cfg(windows)]
    #[test]
    #[ignore = "requires an interactive Windows user profile with a Recycle Bin"]
    fn recycle_and_restore_real_file() {
        use std::os::windows::process::CommandExt;
        let folder = fixture();
        let image = folder.join("回收站 验收.png");
        fs::write(&image, b"recycle-only fixture").unwrap();
        recycle_image(&folder, &image).unwrap();
        assert!(!image.exists());
        let script = r#"
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$items = @($shell.Namespace(10).Items() | Where-Object {
    $_.ExtendedProperty('System.Recycle.DeletedFrom') -eq $env:IMAGE_DELETE_TEST_FOLDER -and
    $_.Name -eq '回收站 验收.png'
})
if ($items.Count -ne 1) { throw 'Expected exactly one fixture in Recycle Bin' }
$items[0].InvokeVerb('undelete')
"#;
        let result = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("IMAGE_DELETE_TEST_FOLDER", &folder)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        for _ in 0..50 {
            if image.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert_eq!(fs::read(&image).unwrap(), b"recycle-only fixture");
        fs::remove_dir_all(&folder).unwrap();
    }
}
