use super::*;
use crate::models::video::{VideoFrame, VideoProject};
use std::path::PathBuf;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "video-reextract-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir(&path).unwrap();
        fs::write(path.join("source.mp4"), "source").unwrap();
        Self(path)
    }
    fn frames(&self, name: &str) -> VideoImportResult {
        let folder = self.0.join(name);
        fs::create_dir_all(&folder).unwrap();
        image::RgbImage::new(3, 4)
            .save(folder.join("frame-000000.png"))
            .unwrap();
        let video = VideoProject {
            schema_version: 1,
            source_path: self.0.join("source.mp4"),
            frame_interval: 30,
            target_fps: None,
            total_frames: 1,
            width: 3,
            height: 4,
            frames: vec![VideoFrame {
                name: "frame-000000.png".into(),
                frame_index: 0,
                timestamp_seconds: 0.0,
            }],
        };
        fs::write(
            folder.join(video::MANIFEST),
            serde_json::to_vec(&video).unwrap(),
        )
        .unwrap();
        VideoImportResult {
            folder_path: folder,
            video,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn replaces_only_manifest_frames_and_preserves_other_files_and_legacy_root() {
    for old_name in ["old", ""] {
        let fixture = Fixture::new();
        let old = fixture.frames(old_name);
        fs::write(old.folder_path.join("unrelated.txt"), "keep").unwrap();
        let result = replace_with(
            &old.video.source_path,
            &fixture.0,
            &old.folder_path,
            || Ok(fixture.frames("new")),
            |stage| {
                assert_eq!(fs::read_dir(stage).unwrap().count(), 2);
                fs::remove_dir_all(stage).map_err(text::video_failed)
            },
        )
        .unwrap();
        assert!(video::load(&result.folder_path).unwrap().is_some());
        assert!(!old.folder_path.join("frame-000000.png").exists());
        assert!(!old.folder_path.join(video::MANIFEST).exists());
        assert_eq!(
            fs::read(old.folder_path.join("unrelated.txt")).unwrap(),
            b"keep"
        );
        assert!(old.video.source_path.exists());
        assert_eq!(
            super::super::project_media::list(&fixture.0).unwrap().len(),
            1
        );
    }
}

#[test]
fn restores_old_frames_and_discards_new_frames_if_recycling_fails() {
    let fixture = Fixture::new();
    let old = fixture.frames("old");
    let result = replace_with(
        &old.video.source_path,
        &fixture.0,
        &old.folder_path,
        || Ok(fixture.frames("new")),
        |_| Err("recycle failed".into()),
    );
    assert_eq!(result.err().unwrap(), "recycle failed");
    assert!(video::load(&old.folder_path).unwrap().is_some());
    assert!(!fixture.0.join("new").exists());
    assert!(!fs::read_dir(&fixture.0).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".video-replaced")));
}

#[test]
fn extraction_failure_leaves_old_frames_unchanged() {
    let fixture = Fixture::new();
    let old = fixture.frames("old");
    assert!(replace_with(
        &old.video.source_path,
        &fixture.0,
        &old.folder_path,
        || Err("decode failed".into()),
        |_| panic!("must not recycle")
    )
    .is_err());
    assert!(video::load(&old.folder_path).unwrap().is_some());
}

#[test]
fn rejects_outside_folder_and_mismatched_source_before_extraction() {
    let fixture = Fixture::new();
    let old = fixture.frames("old");
    let other = Fixture::new();
    for (source, project) in [
        (&old.video.source_path, &other.0),
        (&other.0.join("source.mp4"), &fixture.0),
    ] {
        assert!(replace_with(
            source,
            project,
            &old.folder_path,
            || panic!("invalid request must not extract"),
            |_| panic!("invalid request must not recycle")
        )
        .is_err());
    }
    assert!(video::load(&old.folder_path).unwrap().is_some());
}

#[test]
fn changed_metadata_aborts_before_removal() {
    let fixture = Fixture::new();
    let old = fixture.frames("old");
    let result = replace_with(
        &old.video.source_path,
        &fixture.0,
        &old.folder_path,
        || {
            let new = fixture.frames("new");
            fs::write(old.folder_path.join(video::MANIFEST), "changed").unwrap();
            Ok(new)
        },
        |_| panic!("changed project must not recycle"),
    );
    assert!(result.is_err());
    assert!(old.folder_path.join("frame-000000.png").exists());
    assert!(!fixture.0.join("new").exists());
}

#[test]
fn partial_staging_failure_rolls_back_already_moved_files() {
    let fixture = Fixture::new();
    let old = fixture.frames("old");
    assert!(retire(
        &fixture.0,
        &old.folder_path,
        &[video::MANIFEST.to_string(), "missing.png".to_string()],
        |_| panic!("staging failed")
    )
    .is_err());
    assert!(video::load(&old.folder_path).unwrap().is_some());
}

#[cfg(windows)]
#[test]
#[ignore = "requires FFmpeg and Windows recycle bin; creates only temporary fixture media"]
fn real_ffmpeg_reextract_recycles_old_frame_directory() {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    let _guard = video::ImportGuard::acquire().unwrap();
    let fixture = Fixture::new();
    let source = fixture.0.join("real.mkv");
    let ffmpeg = video::executable(Path::new("."), "ffmpeg").unwrap();
    let ffprobe = video::executable(Path::new("."), "ffprobe").unwrap();
    assert!(Command::new(&ffmpeg)
        .creation_flags(0x08000000)
        .args([
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=64x48:rate=10:duration=1",
            "-c:v",
            "ffv1"
        ])
        .arg(&source)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .unwrap()
        .success());
    let old = video::extract(&source, &fixture.0, 3, &ffmpeg, &ffprobe).unwrap();
    assert_eq!(old.video.frames.len(), 4);
    let new = reextract(
        &source,
        &fixture.0,
        &old.folder_path,
        1,
        Some(5.0),
        &ffmpeg,
        &ffprobe,
    )
    .unwrap();
    assert_eq!(
        new.video
            .frames
            .iter()
            .map(|frame| frame.frame_index)
            .collect::<Vec<_>>(),
        [0, 2, 4, 6, 8]
    );
    assert!(!old.folder_path.exists());
    assert!(video::load(&new.folder_path).unwrap().is_some());
    assert!(source.exists());
}
