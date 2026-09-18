//! Discover project video assets without decoding unprepared source files.
use super::video;
use crate::{i18n::zh_cn as text, models::video::ProjectVideo};
use std::{collections::BTreeMap, fs, path::Path};

pub fn list(folder: &Path) -> Result<Vec<ProjectVideo>, String> {
    let mut videos = BTreeMap::new();
    // Existing single-video frame folders remain valid projects.
    if let Some(metadata) = video::load(folder)? {
        videos.insert(
            metadata.source_path.to_string_lossy().to_lowercase(),
            ProjectVideo {
                source_path: metadata.source_path.clone(),
                folder_path: Some(folder.to_path_buf()),
                video: Some(metadata),
            },
        );
    }
    let mut entries = fs::read_dir(folder)
        .map_err(text::video_failed)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(text::video_failed)?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let kind = entry.file_type().map_err(text::video_failed)?;
        let path = entry.path();
        // Never follow directory junctions/symlinks outside the chosen project.
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            if let Some(metadata) = video::load(&path)? {
                videos.insert(
                    metadata.source_path.to_string_lossy().to_lowercase(),
                    ProjectVideo {
                        source_path: metadata.source_path.clone(),
                        folder_path: Some(path),
                        video: Some(metadata),
                    },
                );
            }
        } else if kind.is_file() && supported(&path) {
            videos
                .entry(path.to_string_lossy().to_lowercase())
                .or_insert(ProjectVideo {
                    source_path: path,
                    folder_path: None,
                    video: None,
                });
        }
    }
    Ok(videos.into_values().collect())
}

fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "mp4" | "mkv" | "avi" | "mov" | "webm" | "m4v"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lists_unprepared_videos_without_treating_images_as_videos() {
        let folder = std::env::temp_dir().join(format!("project-media-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("one.MP4"), b"fixture").unwrap();
        fs::write(folder.join("two.mov"), b"fixture").unwrap();
        fs::write(folder.join("photo.png"), b"fixture").unwrap();
        let entries = list(&folder).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .all(|entry| entry.video.is_none() && entry.folder_path.is_none()));
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn restores_multiple_prepared_assets_and_deduplicates_local_sources() {
        use crate::models::video::{VideoFrame, VideoProject};
        let folder =
            std::env::temp_dir().join(format!("project-media-prepared-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        for name in ["one", "two"] {
            let frames = folder.join(name);
            fs::create_dir_all(&frames).unwrap();
            let source = folder.join(format!("{name}.mp4"));
            fs::write(&source, b"fixture").unwrap();
            image::RgbImage::new(2, 3)
                .save(frames.join("frame-000000.png"))
                .unwrap();
            let metadata = VideoProject {
                schema_version: 1,
                source_path: source,
                frame_interval: 1,
                total_frames: 1,
                width: 2,
                height: 3,
                frames: vec![VideoFrame {
                    name: "frame-000000.png".into(),
                    frame_index: 0,
                    timestamp_seconds: 0.0,
                }],
            };
            fs::write(
                frames.join(video::MANIFEST),
                serde_json::to_vec(&metadata).unwrap(),
            )
            .unwrap();
        }
        let entries = list(&folder).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| entry.video.is_some()));
        assert_eq!(list(&folder.join("one")).unwrap().len(), 1);
        let nested = folder.join("one/nested");
        fs::create_dir_all(&nested).unwrap();
        fs::copy(
            folder.join("two/frame-000000.png"),
            nested.join("frame-000000.png"),
        )
        .unwrap();
        fs::copy(
            folder.join("two").join(video::MANIFEST),
            nested.join(video::MANIFEST),
        )
        .unwrap();
        assert_eq!(list(&folder.join("one")).unwrap().len(), 2);
        fs::remove_file(folder.join("two/frame-000000.png")).unwrap();
        assert!(list(&folder).is_err());
        assert!(list(&folder.join("missing")).is_err());
        fs::remove_dir_all(folder).unwrap();
    }
}
