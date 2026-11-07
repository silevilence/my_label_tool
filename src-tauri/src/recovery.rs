//! Host-only incremental recovery journal. A transaction becomes visible only after
//! its immutable segment and the small head file have both been atomically committed.
use crate::{i18n::recovery_zh_cn as text, models::annotation::AnnotationShape};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

static IO: Mutex<()> = Mutex::new(());
const COMPACT_AFTER: u64 = 128;
#[path = "recovery_storage.rs"]
mod storage;
pub use storage::open_archives;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub labels: Vec<crate::models::annotation::LabelConfig>,
    pub project_config: Option<Value>,
    pub config_path: String,
    pub selected_path: String,
    pub saved_at: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub expected_revision: u64,
    pub reset: bool,
    pub metadata: Metadata,
    pub changes: BTreeMap<String, Option<Vec<AnnotationShape>>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub metadata: Metadata,
    pub annotations: BTreeMap<String, Vec<AnnotationShape>>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Head {
    schema_version: u32,
    folder: PathBuf,
    base: u64,
    revision: u64,
}

fn directory(root: &Path, folder: &Path) -> Result<PathBuf, String> {
    if !folder.is_absolute() {
        return Err(text::FOLDER.into());
    }
    let key = folder.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let key = key.to_lowercase();
    Ok(root.join(format!(
        "{:x}",
        Sha256::digest(key.trim_end_matches('/').as_bytes())
    )))
}
fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    serde_json::from_str(&crate::text_read::read(path)?).map_err(text::failed)
}
fn head(dir: &Path) -> Result<Option<Head>, String> {
    let path = dir.join("head.json");
    if !path.try_exists().map_err(text::failed)? {
        return Ok(None);
    }
    let value: Head = read(&path)?;
    if value.schema_version != 1
        || value.base == 0
        || value.revision < value.base
        || value.revision - value.base >= COMPACT_AFTER
    {
        return Err(text::INVALID.into());
    }
    Ok(Some(value))
}
fn atomic(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or(text::INVALID)?;
    fs::create_dir_all(parent).map_err(text::failed)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(text::failed)?;
    serde_json::to_writer(&mut file, value).map_err(text::failed)?;
    file.flush().map_err(text::failed)?;
    if file.as_file().metadata().map_err(text::failed)?.len() > crate::text_read::MAX_BYTES {
        return Err(text::CAPACITY.into());
    }
    file.as_file().sync_all().map_err(text::failed)?;
    file.persist(path).map_err(text::failed)?;
    Ok(())
}
fn segment(dir: &Path, revision: u64) -> PathBuf {
    dir.join(format!("{revision:020}.json"))
}
fn replay(dir: &Path, head: &Head) -> Result<Snapshot, String> {
    let mut annotations = BTreeMap::new();
    let mut metadata = None;
    // Only committed segments are read; an interrupted write cannot erase the old head.
    for revision in head.base..=head.revision {
        let update = storage::read_segment(dir, revision)?;
        if update.reset {
            annotations.clear();
        }
        for (path, shapes) in update.changes {
            match shapes {
                Some(shapes) => {
                    annotations.insert(path, shapes);
                }
                None => {
                    annotations.remove(&path);
                }
            }
        }
        metadata = Some(update.metadata);
    }
    Ok(Snapshot {
        revision: head.revision,
        metadata: metadata.ok_or(text::INVALID)?,
        annotations,
    })
}
pub fn load(root: &Path, folder: &Path) -> Result<Option<Snapshot>, String> {
    let _guard = IO.lock().map_err(text::failed)?;
    let _file = storage::lock(root)?;
    let dir = directory(root, folder)?;
    head(&dir)?.map(|head| replay(&dir, &head)).transpose()
}
pub fn last(root: &Path) -> Result<Option<PathBuf>, String> {
    let _guard = IO.lock().map_err(text::failed)?;
    let _file = storage::lock(root)?;
    let path = root.join("last.json");
    if !path.try_exists().map_err(text::failed)? {
        return Ok(None);
    }
    let folder: PathBuf = read(&path)?;
    if !folder.is_dir() || head(&directory(root, &folder)?)?.is_none() {
        return Ok(None);
    }
    Ok(Some(folder))
}
pub fn save(root: &Path, folder: &Path, update: Update) -> Result<u64, String> {
    save_with_limit(
        root,
        folder,
        update,
        false,
        crate::text_read::MAX_BYTES as usize,
    )
}
/// Explicit conflict/corruption recovery: archive the on-disk copy before creating a new lineage.
pub fn fork(root: &Path, folder: &Path, update: Update) -> Result<u64, String> {
    save_with_limit(
        root,
        folder,
        update,
        true,
        crate::text_read::MAX_BYTES as usize,
    )
}
fn save_with_limit(
    root: &Path,
    folder: &Path,
    mut update: Update,
    fork: bool,
    limit: usize,
) -> Result<u64, String> {
    let _guard = IO.lock().map_err(text::failed)?;
    let _file = storage::lock(root)?;
    let dir = directory(root, folder)?;
    let previous = if fork {
        head(&dir).unwrap_or(None)
    } else {
        head(&dir)?
    };
    let revision = previous.as_ref().map_or(0, |h| h.revision);
    if !fork && revision != update.expected_revision {
        return Err(text::STALE.into());
    }
    if !folder.is_dir() {
        return Err(text::FOLDER.into());
    }
    if update.changes.keys().any(|path| !safe_relative(path)) {
        return Err(text::INVALID.into());
    }
    if fork {
        update.reset = true;
    }
    // Explicit resets preserve the previous lineage; routine compaction does not create backups.
    if (update.reset && previous.is_some()) || fork {
        storage::archive(root, folder)?;
    }
    // Bounded replay cost; compaction runs on the native blocking pool, never the UI thread.
    if let Some(old) = &previous {
        if !update.reset && old.revision - old.base + 1 >= COMPACT_AFTER {
            let mut combined = replay(&dir, old)?.annotations;
            for (path, shapes) in &update.changes {
                match shapes {
                    Some(shapes) => {
                        combined.insert(path.clone(), shapes.clone());
                    }
                    None => {
                        combined.remove(path);
                    }
                }
            }
            update.changes = combined.into_iter().map(|(p, s)| (p, Some(s))).collect();
            update.reset = true;
        }
    }
    let mut next = revision.checked_add(1).ok_or(text::INVALID)?;
    if fork {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(text::failed)?
            .as_millis();
        next = next.max(u64::try_from(now).map_err(text::failed)?);
    }
    let base = if update.reset {
        next
    } else {
        previous.as_ref().map_or(next, |h| h.base)
    };
    atomic(&root.join("last.json"), &folder)?;
    storage::write_segment(&dir, next, &update, limit)?;
    atomic(
        &dir.join("head.json"),
        &Head {
            schema_version: 1,
            folder: folder.to_owned(),
            base,
            revision: next,
        },
    )?;
    // Old committed segments are obsolete only after the new head is durable.
    if let Some(old) = previous {
        if base == next {
            for revision in old.base..=old.revision {
                storage::remove_segment(&dir, revision);
            }
        }
    }
    Ok(next)
}
fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', ':'])
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
