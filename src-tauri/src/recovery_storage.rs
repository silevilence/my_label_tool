//! Recovery storage primitives. All callers hold the root's cross-process lock.
use super::*;
use std::fs::{File, OpenOptions};

pub(super) fn lock(root: &Path) -> Result<File, String> {
    fs::create_dir_all(root).map_err(text::failed)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("recovery.lock"))
        .map_err(text::failed)?;
    file.lock().map_err(text::failed)?;
    Ok(file)
}

fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or(text::INVALID)?;
    fs::create_dir_all(parent).map_err(text::failed)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(text::failed)?;
    file.write_all(bytes).map_err(text::failed)?;
    file.flush().map_err(text::failed)?;
    file.as_file().sync_all().map_err(text::failed)?;
    file.persist(path).map_err(text::failed)?;
    Ok(())
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Chunks {
    schema_version: u32,
    parts: usize,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum Stored {
    Chunks(Chunks),
    Legacy(Update),
}
fn part(dir: &Path, revision: u64, index: usize) -> PathBuf {
    dir.join(format!("{revision:020}.part-{index:08}.txt"))
}

pub(super) fn write_segment(
    dir: &Path,
    revision: u64,
    update: &Update,
    limit: usize,
) -> Result<(), String> {
    let json = serde_json::to_string(update).map_err(text::failed)?;
    if json.len() <= limit {
        return atomic_bytes(&segment(dir, revision), json.as_bytes());
    }
    let mut start = 0;
    let mut parts = 0;
    while start < json.len() {
        let mut end = (start + limit).min(json.len());
        while !json.is_char_boundary(end) {
            end -= 1;
        }
        if end == start {
            return Err(text::CAPACITY.into());
        }
        atomic_bytes(&part(dir, revision, parts), &json.as_bytes()[start..end])?;
        parts += 1;
        start = end;
    }
    atomic(
        &segment(dir, revision),
        &Chunks {
            schema_version: 2,
            parts,
        },
    )
}

pub(super) fn read_segment(dir: &Path, revision: u64) -> Result<Update, String> {
    match read::<Stored>(&segment(dir, revision))? {
        Stored::Legacy(update) => Ok(update),
        Stored::Chunks(chunks) => {
            if chunks.schema_version != 2 || chunks.parts == 0 || chunks.parts > 1_000_000 {
                return Err(text::INVALID.into());
            }
            let mut json = String::new();
            for index in 0..chunks.parts {
                json.push_str(&crate::text_read::read(part(dir, revision, index))?);
            }
            serde_json::from_str(&json).map_err(text::failed)
        }
    }
}

pub(super) fn remove_segment(dir: &Path, revision: u64) {
    if let Ok(Stored::Chunks(chunks)) = read::<Stored>(&segment(dir, revision)) {
        for index in 0..chunks.parts.min(1_000_000) {
            let _ = fs::remove_file(part(dir, revision, index));
        }
    }
    let _ = fs::remove_file(segment(dir, revision));
}

pub(super) fn archives(root: &Path, folder: &Path) -> Result<PathBuf, String> {
    let dir = directory(root, folder)?;
    Ok(root
        .join("archives")
        .join(dir.file_name().ok_or(text::INVALID)?))
}

/// Preserve bytes even if the reader cannot parse/decrypt the current copy.
pub(super) fn archive(root: &Path, folder: &Path) -> Result<(), String> {
    let source = directory(root, folder)?;
    if !source.try_exists().map_err(text::failed)? {
        return Ok(());
    }
    let archive_root = archives(root, folder)?;
    fs::create_dir_all(&archive_root).map_err(text::failed)?;
    let target = tempfile::Builder::new()
        .prefix("copy-")
        .tempdir_in(archive_root)
        .map_err(text::failed)?
        .keep();
    for entry in fs::read_dir(&source).map_err(text::failed)? {
        let entry = entry.map_err(text::failed)?;
        if !entry.file_type().map_err(text::failed)?.is_file() {
            return Err(text::INVALID.into());
        }
        let destination = target.join(entry.file_name());
        fs::copy(entry.path(), &destination).map_err(text::failed)?;
        OpenOptions::new()
            .write(true)
            .open(destination)
            .map_err(text::failed)?
            .sync_all()
            .map_err(text::failed)?;
    }
    Ok(())
}

pub fn open_archives(root: &Path, folder: &Path) -> Result<(), String> {
    let path = archives(root, folder)?;
    fs::create_dir_all(&path).map_err(text::failed)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(text::failed)?;
    }
    #[cfg(not(windows))]
    {
        return Err(text::OPEN_UNSUPPORTED.into());
    }
    #[cfg(windows)]
    Ok(())
}
