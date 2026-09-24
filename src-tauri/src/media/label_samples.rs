//! Host-only sample images. Drafts never touch disk. A prepared batch retains its
//! original bytes until label persistence succeeds; failures restore the originals.
use crate::i18n::zh_cn as text;
use base64::Engine;
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 128 * 1024 * 1024;
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
static PENDING: Mutex<Option<Transaction>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub name: String,
    pub file_name: String,
    pub preview: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub name: String,
    pub original_name: Option<String>,
    pub source_path: Option<PathBuf>,
    #[serde(default)]
    pub clear: bool,
}

type Files = BTreeMap<PathBuf, Vec<u8>>;
struct Transaction {
    token: u64,
    before: Files,
    after: Files,
    staging: Option<PathBuf>,
    installed: Vec<PathBuf>,
    backups: Vec<(PathBuf, PathBuf)>,
}

pub fn file_stem(name: &str) -> Result<String, String> {
    let mut stem: String = name
        .trim()
        .chars()
        .map(|c| {
            if c < ' ' || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    stem = stem.trim_end_matches(['.', ' ']).to_owned();
    let device = stem.split('.').next().unwrap_or_default().to_lowercase();
    if ["con", "prn", "aux", "nul"].contains(&device.as_str())
        || ["com", "lpt"].iter().any(|prefix| {
            device.strip_prefix(prefix).is_some_and(|n| {
                ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&n)
            })
        })
    {
        stem.insert(0, '_');
    }
    if stem.is_empty() || stem.encode_utf16().count() > 200 {
        return Err(text::label_sample_name(name));
    }
    Ok(stem)
}

fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}

pub fn directory(folder: &Path, create: bool) -> Result<PathBuf, String> {
    let root = fs::canonicalize(folder).map_err(text::label_sample_error)?;
    if !root.is_dir() {
        return Err(text::LABEL_SAMPLE_DIRECTORY.into());
    }
    let dir = root.join("icon");
    match fs::symlink_metadata(&dir) {
        Ok(meta) if is_link(&meta) || !meta.is_dir() => {
            return Err(text::LABEL_SAMPLE_DIRECTORY.into())
        }
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if create {
                fs::create_dir(&dir).map_err(text::label_sample_error)?;
            }
        }
        Err(e) => return Err(text::label_sample_error(e)),
    }
    Ok(dir)
}

fn extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    ["png", "jpg", "jpeg", "bmp"]
        .contains(&ext.as_str())
        .then_some(ext)
}

fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(text::label_sample_error)?;
    if !meta.is_file() || is_link(&meta) || meta.len() > MAX_FILE_BYTES || extension(path).is_none()
    {
        return Err(text::LABEL_SAMPLE_IMAGE.into());
    }
    let bytes = fs::read(path).map_err(text::label_sample_error)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(text::LABEL_SAMPLE_IMAGE.into());
    }
    Ok(bytes)
}

fn thumbnail(bytes: &[u8]) -> Result<String, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(text::label_sample_error)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let img = reader
        .decode()
        .map_err(text::label_sample_error)?
        .thumbnail(256, 256);
    let mut png = Cursor::new(Vec::new());
    img.write_to(&mut png, ImageFormat::Png)
        .map_err(text::label_sample_error)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png.into_inner())
    ))
}

pub fn preview(path: &Path) -> Result<String, String> {
    thumbnail(&read_image(path)?)
}

fn scan(dir: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut files = BTreeMap::new();
    if !dir.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(dir).map_err(text::label_sample_error)? {
        let path = entry.map_err(text::label_sample_error)?.path();
        if extension(&path).is_none() {
            continue;
        }
        let meta = fs::symlink_metadata(&path).map_err(text::label_sample_error)?;
        if !meta.is_file() || is_link(&meta) {
            return Err(text::LABEL_SAMPLE_DIRECTORY.into());
        }
        let stem = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        if files.insert(stem.clone(), path).is_some() {
            return Err(text::label_sample_conflict(&stem));
        }
    }
    Ok(files)
}

pub fn list(folder: &Path) -> Result<Vec<Sample>, String> {
    let dir = directory(folder, false)?;
    scan(&dir)?
        .into_iter()
        .map(|(name, path)| {
            Ok(Sample {
                name,
                file_name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                preview: preview(&path)?,
            })
        })
        .collect()
}

fn plan(folder: &Path, changes: &[Change]) -> Result<Transaction, String> {
    let dir = directory(folder, false)?;
    let files = scan(&dir)?;
    let mut names = HashSet::new();
    let mut originals = HashSet::new();
    let mut before = Files::new();
    let mut after = Files::new();
    let mut targets = Vec::new();
    let mut total_bytes = 0;
    for change in changes {
        let name = file_stem(&change.name)?;
        if !names.insert(name.to_lowercase()) {
            return Err(text::label_sample_conflict(&name));
        }
        // Permit repairing legacy names that could never own a valid sample.
        let old = change
            .original_name
            .as_deref()
            .and_then(|old| file_stem(old).ok());
        if let Some(old) = &old {
            if !originals.insert(old.to_lowercase()) && files.contains_key(&old.to_lowercase()) {
                return Err(text::label_sample_conflict(old));
            }
        }
        let existing = old.as_ref().and_then(|old| files.get(&old.to_lowercase()));
        let source = if change.clear {
            None
        } else {
            change.source_path.as_ref().or(existing)
        };
        // A new label may adopt an existing directory entry by name. Only explicit
        // replacement/clear or a real rename modifies that entry.
        let renamed = old.as_ref().is_some_and(|old| old != &name);
        let existing = if renamed {
            existing
        } else {
            existing.or_else(|| files.get(&name.to_lowercase()))
        };
        if !renamed && change.source_path.is_none() && !change.clear {
            continue;
        }
        if source.is_none() && !change.clear {
            continue;
        }
        if let Some(path) = existing {
            let bytes = read_image(path)?;
            total_bytes += bytes.len();
            before.insert(path.clone(), bytes);
        }
        if let Some(source) = source {
            let bytes = read_image(source)?;
            total_bytes += bytes.len();
            thumbnail(&bytes)?; // Validate before moving or removing any original.
            let ext = extension(source).ok_or(text::LABEL_SAMPLE_IMAGE)?;
            let target = dir.join(format!("{name}.{ext}"));
            targets.push((name.to_lowercase(), target.clone()));
            after.insert(target, bytes);
        }
        if total_bytes > MAX_BATCH_BYTES {
            return Err(text::LABEL_SAMPLE_IMAGE.into());
        }
    }
    // Targets occupied by another label are allowed only if that original is
    // part of the same batch (including swaps). Never overwrite unrelated files.
    for (name, _target) in targets {
        if files
            .get(&name)
            .is_some_and(|path| !before.contains_key(path))
        {
            return Err(text::label_sample_conflict(&name));
        }
    }
    Ok(Transaction {
        token: NEXT_TOKEN.fetch_add(1, Ordering::Relaxed),
        before,
        after,
        staging: None,
        installed: Vec::new(),
        backups: Vec::new(),
    })
}

impl Transaction {
    fn apply(&mut self, folder: &Path) -> Result<(), String> {
        if self.before.is_empty() && self.after.is_empty() {
            return Ok(());
        }
        let dir = directory(folder, true)?;
        let staging = dir.join(format!(
            ".label-samples-{}-{}",
            std::process::id(),
            self.token
        ));
        fs::create_dir(&staging).map_err(text::label_sample_error)?;
        self.staging = Some(staging.clone());
        // Write every new file before moving any original. Disk-full errors
        // cannot truncate the original, and rollback needs no new allocation.
        for (index, bytes) in self.after.values().enumerate() {
            fs::write(staging.join(format!("new-{index}")), bytes)
                .map_err(text::label_sample_error)?;
        }
        for (index, (path, expected)) in self.before.iter().enumerate() {
            if read_image(path)? != *expected {
                return Err(text::LABEL_SAMPLE_CHANGED.into());
            }
            let backup = staging.join(format!("old-{index}"));
            fs::rename(path, &backup).map_err(text::label_sample_error)?;
            self.backups.push((path.clone(), backup));
        }
        for (index, path) in self.after.keys().enumerate() {
            if path.exists() {
                return Err(text::LABEL_SAMPLE_CHANGED.into());
            }
            fs::rename(staging.join(format!("new-{index}")), path)
                .map_err(text::label_sample_error)?;
            self.installed.push(path.clone());
        }
        Ok(())
    }

    fn rollback(&mut self) -> Result<(), String> {
        while let Some(path) = self.installed.last() {
            fs::remove_file(path).map_err(text::label_sample_error)?;
            self.installed.pop();
        }
        while let Some((path, backup)) = self.backups.last() {
            fs::rename(backup, path).map_err(text::label_sample_error)?;
            self.backups.pop();
        }
        Ok(())
    }

    fn cleanup(&self) {
        // Only the private directory created by this transaction is removed.
        if let Some(path) = &self.staging {
            let _ = fs::remove_dir_all(path);
        }
    }
}

pub fn prepare(folder: &Path, changes: &[Change]) -> Result<u64, String> {
    let mut pending = PENDING.lock().map_err(text::label_sample_error)?;
    if pending.is_some() {
        return Err(text::LABEL_SAMPLE_BUSY.into());
    }
    let mut transaction = plan(folder, changes)?;
    if let Err(error) = transaction.apply(folder) {
        if let Err(rollback) = transaction.rollback() {
            *pending = Some(transaction);
            return Err(text::label_sample_rollback(error, rollback));
        }
        transaction.cleanup();
        return Err(error);
    }
    let token = transaction.token;
    *pending = Some(transaction);
    Ok(token)
}

pub fn finish(token: u64, commit: bool) -> Result<(), String> {
    let mut pending = PENDING.lock().map_err(text::label_sample_error)?;
    let transaction = pending
        .as_mut()
        .filter(|t| t.token == token)
        .ok_or(text::LABEL_SAMPLE_BUSY)?;
    if !commit {
        transaction.rollback()?;
    }
    transaction.cleanup();
    *pending = None;
    Ok(())
}

pub fn open_directory(folder: &Path) -> Result<(), String> {
    let dir = directory(folder, true)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(dunce::simplified(&dir))
            .creation_flags(0x08000000)
            .spawn()
            .map_err(text::label_sample_error)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err(text::LABEL_SAMPLE_WINDOWS.into())
    }
}

#[cfg(test)]
#[path = "label_samples_tests.rs"]
mod tests;
