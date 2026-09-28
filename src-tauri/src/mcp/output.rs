//! Host-only staged text output. HTTP clients never supply filesystem destinations.
use super::{now, Host};
use crate::i18n::mcp_zh_cn as text;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tempfile::NamedTempFile;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Authority {
    pub epoch: u64,
    pub session_id: Option<String>,
    pub lease_id: Option<String>,
    pub expires_at: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputFile {
    path: String,
    content: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputGroup {
    root: PathBuf,
    files: Vec<OutputFile>,
}
#[derive(Serialize)]
pub struct Preview {
    pub overwrites: usize,
    pub files: usize,
}
pub(super) struct Prepared {
    session: String,
    lease: String,
    deadline: u64,
    files: Vec<Staged>,
    // Deny directory deletion/renaming while staged targets are being checked and replaced.
    _directories: Vec<File>,
}
struct Staged {
    target: PathBuf,
    staged: NamedTempFile,
    backup: Option<NamedTempFile>,
    hash: Option<Vec<u8>>,
}
#[derive(Default)]
pub(super) struct Outputs {
    pub authority: Option<Authority>,
    prepared: HashMap<String, Prepared>,
    cancelled: HashMap<String, u64>,
}
impl Outputs {
    pub fn invalidate(&mut self) {
        self.authority = None;
        self.prepared.clear();
        self.cancelled.clear();
    }
    pub fn sweep(&mut self) {
        self.prepared.retain(|_, p| p.deadline > now());
        self.cancelled.retain(|_, deadline| *deadline > now());
    }
}
impl Host {
    pub fn set_authority(&self, authority: Authority) -> Result<(), String> {
        let mut inner = self.lock()?;
        if inner
            .outputs
            .authority
            .as_ref()
            .is_some_and(|a| a.epoch >= authority.epoch)
        {
            return Ok(());
        }
        if inner
            .outputs
            .authority
            .as_ref()
            .and_then(|a| a.lease_id.as_ref())
            != authority.lease_id.as_ref()
        {
            inner.outputs.prepared.clear();
        }
        inner.outputs.authority = Some(authority);
        Ok(())
    }
    pub fn discard_output(&self, task_id: String) -> Result<(), String> {
        let mut inner = self.lock()?;
        inner.outputs.prepared.remove(&task_id);
        if inner.outputs.cancelled.len() >= 1024 {
            return Err(text::LIMIT.into());
        }
        inner.outputs.cancelled.insert(task_id, now() + 300_000);
        Ok(())
    }
    pub fn prepare_output(
        &self,
        task_id: String,
        session: String,
        lease: String,
        groups: Vec<OutputGroup>,
    ) -> Result<Preview, String> {
        {
            let mut inner = self.lock()?;
            inner.sweep();
            check_authority(&inner, &session, &lease)?;
            if inner.outputs.cancelled.contains_key(&task_id) || inner.outputs.prepared.len() >= 4 {
                return Err(text::OUTPUT_CANCELLED.into());
            }
        }
        let mut prepared = stage(groups)?;
        prepared.session = session;
        prepared.lease = lease;
        let preview = Preview {
            overwrites: prepared.files.iter().filter(|f| f.backup.is_some()).count(),
            files: prepared.files.len(),
        };
        let mut inner = self.lock()?;
        check_authority(&inner, &prepared.session, &prepared.lease)?;
        if inner.outputs.cancelled.contains_key(&task_id)
            || inner.outputs.prepared.contains_key(&task_id)
        {
            return Err(text::OUTPUT_CANCELLED.into());
        }
        inner.outputs.prepared.insert(task_id, prepared);
        Ok(preview)
    }
    pub fn commit_output(&self, task_id: &str, overwrite: bool) -> Result<usize, String> {
        // The same mutex linearizes commit, revocation, session deletion and service shutdown.
        let mut inner = self.lock()?;
        inner.sweep();
        let prepared = inner
            .outputs
            .prepared
            .remove(task_id)
            .ok_or(text::OUTPUT_CANCELLED)?;
        check_authority(&inner, &prepared.session, &prepared.lease)?;
        if inner.outputs.cancelled.contains_key(task_id) {
            return Err(text::OUTPUT_CANCELLED.into());
        }
        commit(prepared, overwrite)
    }
}
fn check_authority(inner: &super::Inner, session: &str, lease: &str) -> Result<(), String> {
    let valid = inner.running
        && now().saturating_sub(inner.last_poll) < 3000
        && inner
            .sessions
            .get(session)
            .is_some_and(|s| now().saturating_sub(s.last_seen) < 60_000)
        && inner.outputs.authority.as_ref().is_some_and(|a| {
            a.expires_at > now()
                && a.session_id.as_deref() == Some(session)
                && a.lease_id.as_deref() == Some(lease)
        });
    if valid {
        Ok(())
    } else {
        Err(text::OUTPUT_CANCELLED.into())
    }
}
fn unsafe_path() -> String {
    text::OUTPUT_PATH.into()
}
fn reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
fn safe_relative(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && Path::new(value)
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| matches!(s.to_ascii_lowercase().as_str(), "json" | "xml" | "txt"))
        && !value.starts_with(['/', '\\'])
        && value.split(['/', '\\']).all(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part
                    .chars()
                    .any(|c| c.is_control() || ":*?\"<>|".contains(c))
                && !matches!(
                    stem.as_str(),
                    "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                )
                && !((stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(
                        &stem[3..],
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    ))
        })
}
fn open_checked(path: &Path, directory: bool) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ | FILE_SHARE_WRITE for directories; no DELETE share.
        options
            .share_mode(if directory { 3 } else { 1 })
            .custom_flags(0x00200000 | if directory { 0x02000000 } else { 0 });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(text::failed)?;
    let metadata = file.metadata().map_err(text::failed)?;
    if reparse(&metadata)
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(unsafe_path());
    }
    Ok(file)
}
fn lock_directory(
    path: &Path,
    create: bool,
    handles: &mut Vec<File>,
    seen: &mut HashSet<PathBuf>,
) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err(unsafe_path());
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if matches!(component, Component::Prefix(_)) || seen.contains(&current) {
            continue;
        }
        if create && !current.try_exists().map_err(text::failed)? {
            fs::create_dir(&current).map_err(text::failed)?;
        }
        handles.push(open_checked(&current, true)?);
        seen.insert(current.clone());
    }
    Ok(())
}
fn fingerprint(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(text::failed(e)),
        Ok(_) => {
            let mut file = open_checked(path, false)?;
            if file.metadata().map_err(text::failed)?.len() > 64 * 1024 * 1024 {
                return Err(text::LIMIT.into());
            }
            let mut hash = Sha256::new();
            let mut buffer = [0; 64 * 1024];
            loop {
                let n = file.read(&mut buffer).map_err(text::failed)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            Ok(Some(hash.finalize().to_vec()))
        }
    }
}
fn stage(groups: Vec<OutputGroup>) -> Result<Prepared, String> {
    let count: usize = groups.iter().map(|g| g.files.len()).sum();
    let size: usize = groups
        .iter()
        .flat_map(|g| &g.files)
        .map(|f| f.content.len())
        .sum();
    if count == 0 || count > 10_000 || size > 64 * 1024 * 1024 {
        return Err(text::LIMIT.into());
    }
    let mut prepared = Prepared {
        session: String::new(),
        lease: String::new(),
        deadline: now() + 300_000,
        files: vec![],
        _directories: vec![],
    };
    let mut directories = HashSet::new();
    let mut targets = HashSet::new();
    // Validate every relative path before creating any directories or staging any content.
    for group in &groups {
        for file in &group.files {
            if !safe_relative(&file.path)
                || !targets.insert(
                    group
                        .root
                        .join(file.path.replace('\\', "/"))
                        .to_string_lossy()
                        .to_lowercase(),
                )
            {
                return Err(unsafe_path());
            }
        }
    }
    for group in groups {
        lock_directory(
            &group.root,
            false,
            &mut prepared._directories,
            &mut directories,
        )?;
        for file in group.files {
            let target = group.root.join(file.path.replace('\\', "/"));
            let parent = target.parent().ok_or_else(unsafe_path)?;
            lock_directory(parent, true, &mut prepared._directories, &mut directories)?;
            let hash = fingerprint(&target)?;
            let backup = if hash.is_some() {
                let mut old = open_checked(&target, false)?;
                let mut backup = NamedTempFile::new_in(parent).map_err(text::failed)?;
                std::io::copy(&mut old, &mut backup).map_err(text::failed)?;
                Some(backup)
            } else {
                None
            };
            // Recheck after copying, so a modification cannot slip between the snapshot and hash.
            if fingerprint(&target)? != hash {
                return Err(text::OUTPUT_CHANGED.into());
            }
            let mut staged = NamedTempFile::new_in(parent).map_err(text::failed)?;
            staged
                .write_all(file.content.as_bytes())
                .map_err(text::failed)?;
            staged.as_file().sync_all().map_err(text::failed)?;
            prepared.files.push(Staged {
                target,
                staged,
                backup,
                hash,
            });
        }
    }
    Ok(prepared)
}
fn commit(prepared: Prepared, overwrite: bool) -> Result<usize, String> {
    for file in &prepared.files {
        if (!overwrite && file.hash.is_some()) || fingerprint(&file.target)? != file.hash {
            return Err(text::OUTPUT_CHANGED.into());
        }
    }
    let count = prepared.files.len();
    let mut installed: Vec<(PathBuf, Option<NamedTempFile>)> = vec![];
    for file in prepared.files {
        let result = if file.hash.is_none() {
            file.staged.persist_noclobber(&file.target)
        } else {
            file.staged.persist(&file.target)
        };
        if let Err(error) = result {
            let mut rollback_ok = true;
            let mut recovery = Vec::new();
            for (target, backup) in installed.into_iter().rev() {
                rollback_ok &= if let Some(backup) = backup {
                    match backup.persist(&target) {
                        Ok(_) => true,
                        Err(error) => {
                            // Never delete the only copy of the previous content when rollback fails.
                            let path = error.file.path().to_path_buf();
                            if let Err(error) = error.file.keep() {
                                std::mem::forget(error.file);
                            }
                            recovery.push(path);
                            false
                        }
                    }
                } else {
                    fs::remove_file(target).is_ok()
                };
            }
            return Err(if rollback_ok {
                text::failed(error)
            } else {
                text::output_rollback(&recovery)
            });
        }
        installed.push((file.target, file.backup));
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn group(root: &Path, files: &[(&str, &str)]) -> Vec<OutputGroup> {
        vec![OutputGroup {
            root: root.into(),
            files: files
                .iter()
                .map(|(p, c)| OutputFile {
                    path: (*p).into(),
                    content: (*c).into(),
                })
                .collect(),
        }]
    }
    #[test]
    fn paths_overwrites_and_stale_files_are_rejected_atomically() {
        let dir = tempfile::tempdir().unwrap();
        for path in [
            "../escape",
            "C:/escape",
            "a:stream",
            "CON.txt",
            "LPT1.json",
            "a/../b",
            "a//b",
            "x.",
            "/root",
        ] {
            assert!(
                stage(group(dir.path(), &[("good.json", "ok"), (path, "bad")])).is_err(),
                "{path}"
            );
            assert!(!dir.path().join("good.json").exists());
        }
        fs::write(dir.path().join("one.json"), "old").unwrap();
        let staged = stage(group(
            dir.path(),
            &[("one.json", "new"), ("two.json", "two")],
        ))
        .unwrap();
        assert!(commit(staged, false).is_err());
        let staged = stage(group(
            dir.path(),
            &[("one.json", "new"), ("two.json", "two")],
        ))
        .unwrap();
        fs::write(dir.path().join("one.json"), "changed").unwrap();
        assert!(commit(staged, true).is_err());
        assert!(!dir.path().join("two.json").exists());
        assert_eq!(
            commit(
                stage(group(
                    dir.path(),
                    &[("one.json", "new"), ("nested/two.json", "two")]
                ))
                .unwrap(),
                true
            )
            .unwrap(),
            2
        );
        assert_eq!(fs::read(dir.path().join("one.json")).unwrap(), b"new");
    }
    #[test]
    fn duplicate_and_directory_targets_fail() {
        let dir = tempfile::tempdir().unwrap();
        assert!(stage(group(dir.path(), &[("a.json", "a"), ("A.json", "b")])).is_err());
        fs::create_dir(dir.path().join("folder")).unwrap();
        assert!(stage(group(dir.path(), &[("folder", "x")])).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn rejects_junction_escape_and_pins_parent_during_staging() {
        use std::os::windows::process::CommandExt;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let junction = root.path().join("escape");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(status.status.success());
        assert!(stage(group(root.path(), &[("escape/out.json", "bad")])).is_err());
        assert!(!outside.path().join("out.json").exists());
        let held = stage(group(root.path(), &[("nested/out.json", "safe")])).unwrap();
        assert!(fs::rename(root.path().join("nested"), root.path().join("moved")).is_err());
        assert_eq!(commit(held, false).unwrap(), 1);
    }
}
