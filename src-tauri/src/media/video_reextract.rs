//! Prepare new frames first, then recycle only the old manifest's owned files.
use super::{image_deletion, video};
use crate::{i18n::zh_cn as text, models::video::VideoImportResult};
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);

pub fn reextract(
    source: &Path,
    project: &Path,
    old: &Path,
    interval: usize,
    target_fps: Option<f64>,
    ffmpeg: &Path,
    ffprobe: &Path,
) -> Result<VideoImportResult, String> {
    replace_with(
        source,
        project,
        old,
        || video::extract_with_sampling(source, project, interval, target_fps, ffmpeg, ffprobe),
        |path| image_deletion::recycle_owned_path(path.to_path_buf()),
    )
}

fn plain(path: &Path, directory: bool) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(text::video_failed)?;
    let unsafe_link = metadata.file_type().is_symlink();
    #[cfg(windows)]
    let unsafe_link = {
        use std::os::windows::fs::MetadataExt;
        unsafe_link || metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    };
    if unsafe_link || (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
        return Err(text::VIDEO_REEXTRACT_PATH.to_string());
    }
    Ok(())
}

fn replace_with(
    source: &Path,
    project: &Path,
    old: &Path,
    extract: impl FnOnce() -> Result<VideoImportResult, String>,
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<VideoImportResult, String> {
    plain(old, true)?;
    let project = fs::canonicalize(project).map_err(text::video_failed)?;
    let old = fs::canonicalize(old).map_err(text::video_failed)?;
    if old != project && old.parent() != Some(project.as_path()) {
        return Err(text::VIDEO_REEXTRACT_PATH.to_string());
    }
    plain(&old.join(video::MANIFEST), false)?;
    let metadata = video::load(&old)?.ok_or(text::VIDEO_INVALID)?;
    if fs::canonicalize(&metadata.source_path).map_err(text::video_failed)?
        != fs::canonicalize(source).map_err(text::video_failed)?
    {
        return Err(text::VIDEO_REEXTRACT_PATH.to_string());
    }
    let manifest = fs::read(old.join(video::MANIFEST)).map_err(text::video_failed)?;
    let names: Vec<_> = std::iter::once(video::MANIFEST.to_string())
        .chain(metadata.frames.iter().map(|frame| frame.name.clone()))
        .collect();
    for name in &names {
        plain(&old.join(name), false)?;
    }
    let result = extract()?;
    // extract creates a unique direct child. Never clean an arbitrary caller-supplied path.
    let new_folder = fs::canonicalize(&result.folder_path).map_err(text::video_failed)?;
    if new_folder.parent() != Some(project.as_path()) || new_folder == old {
        return Err(text::VIDEO_REEXTRACT_PATH.to_string());
    }
    let commit = (|| {
        if video::is_cancelled() {
            return Err(text::VIDEO_INTERRUPTED.to_string());
        }
        plain(&old, true)?;
        for name in &names {
            plain(&old.join(name), false)?;
        }
        if fs::read(old.join(video::MANIFEST)).map_err(text::video_failed)? != manifest {
            return Err(text::VIDEO_REEXTRACT_CHANGED.to_string());
        }
        retire(&project, &old, &names, recycle)
    })();
    if let Err(error) = commit {
        // This directory was created by this extraction, and its absolute parent was checked above.
        if let Err(cleanup) = fs::remove_dir_all(&new_folder) {
            return Err(text::video_failed(format!(
                "{error}; {}: {cleanup}",
                new_folder.display()
            )));
        }
        return Err(error);
    }
    // Legacy root projects and directories containing unrelated files must remain intact.
    if old != project {
        let _ = fs::remove_dir(&old);
    }
    Ok(result)
}

fn retire(
    project: &Path,
    old: &Path,
    names: &[String],
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let staging = loop {
        let path = project.join(format!(
            ".video-replaced-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        match fs::create_dir(&path) {
            Ok(()) => break path,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(text::video_failed(error)),
        }
    };
    let mut moved = Vec::new();
    let outcome = (|| {
        for name in names {
            fs::rename(old.join(name), staging.join(name)).map_err(text::video_failed)?;
            moved.push(name);
        }
        recycle(&staging)
    })();
    if let Err(error) = outcome {
        for name in moved.into_iter().rev() {
            fs::rename(staging.join(name), old.join(name)).map_err(|restore| {
                text::video_failed(format!("{error}; {}: {restore}", staging.display()))
            })?;
        }
        fs::remove_dir(&staging).map_err(text::video_failed)?;
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
#[path = "video_reextract_tests.rs"]
mod tests;
