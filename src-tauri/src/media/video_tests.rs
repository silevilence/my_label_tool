use super::*;

#[test]
fn timestamps_use_decoded_order_and_actual_presentation_time() {
    assert_eq!(parse_timestamps(br#"{"frames":[{"best_effort_timestamp_time":"2"},{"best_effort_timestamp_time":"2.04"},{"best_effort_timestamp_time":"2.2"}]}"#).unwrap(), vec![0.0, 0.040000000000000036, 0.20000000000000018]);
    for input in [
        r#"{"frames":[]}"#,
        r#"{"frames":[{}]}"#,
        r#"{"frames":[{"best_effort_timestamp_time":"NaN"}]}"#,
        r#"{"frames":[{"best_effort_timestamp_time":"2"},{"best_effort_timestamp_time":"1"}]}"#,
        "{}",
        "garbage",
    ] {
        assert!(parse_timestamps(input.as_bytes()).is_err());
    }
}

#[test]
fn missing_manifest_is_an_image_project() {
    assert!(load(Path::new("nonexistent-video-fixture"))
        .unwrap()
        .is_none());
}

#[test]
#[ignore = "requires local FFmpeg and FFprobe; run in video verification"]
fn real_video_extract_reload_cancel_and_failure_cleanup() {
    let _guard = ImportGuard::acquire().unwrap();
    assert!(ImportGuard::acquire().is_err());
    let root = std::env::temp_dir().join(format!("annotool-video-test-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let output = OutputGuard(root.clone(), false);
    let ffmpeg = executable(Path::new("."), "ffmpeg").unwrap();
    let ffprobe = executable(Path::new("."), "ffprobe").unwrap();
    let source = root.join("测试 video.mkv");
    run(
        Command::new(&ffmpeg)
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=64x48:rate=10:duration=1",
                "-c:v",
                "ffv1",
                "-y",
            ])
            .arg(&source),
        &root,
    )
    .unwrap();
    assert!(extract(&source, &root, 0, &ffmpeg, &ffprobe).is_err());
    let result = extract(&source, &root, 3, &ffmpeg, &ffprobe).unwrap();
    assert_eq!(result.video.total_frames, 10);
    assert_eq!(
        result
            .video
            .frames
            .iter()
            .map(|frame| frame.frame_index)
            .collect::<Vec<_>>(),
        vec![0, 3, 6, 9]
    );
    assert_eq!((result.video.width, result.video.height), (64, 48));
    assert_eq!(result.video.frames[3].timestamp_seconds, 0.9);
    assert_eq!(load(&result.folder_path).unwrap().unwrap().frames.len(), 4);
    for interval in [0, 1_000_001] {
        let mut invalid = result.video.clone();
        invalid.frame_interval = interval;
        assert!(validate(&invalid, &result.folder_path).is_err());
    }
    let mut invalid = result.video.clone();
    invalid.frames[0].timestamp_seconds = 0.1;
    assert!(validate(&invalid, &result.folder_path).is_err());
    invalid = result.video.clone();
    invalid.source_path = PathBuf::new();
    assert!(validate(&invalid, &result.folder_path).is_err());
    let variable = root.join("variable.mkv");
    run(
        Command::new(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&source)
            .args([
                "-vf",
                "setpts=PTS+gte(N\\,5)*0.5/TB",
                "-fps_mode",
                "vfr",
                "-c:v",
                "ffv1",
                "-y",
            ])
            .arg(&variable),
        &root,
    )
    .unwrap();
    let variable_result = extract(&variable, &root, 3, &ffmpeg, &ffprobe).unwrap();
    assert_eq!(variable_result.video.total_frames, 10);
    assert!((variable_result.video.frames[2].timestamp_seconds - 1.1).abs() < 0.001);
    assert!((variable_result.video.frames[3].timestamp_seconds - 1.4).abs() < 0.001);
    let base = root.join("base.mp4");
    run(
        Command::new(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&source)
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-y"])
            .arg(&base),
        &root,
    )
    .unwrap();
    let rotated = root.join("rotated.mp4");
    run(
        Command::new(&ffmpeg)
            .args(["-v", "error", "-display_rotation", "90", "-i"])
            .arg(&base)
            .args(["-c", "copy", "-y"])
            .arg(&rotated),
        &root,
    )
    .unwrap();
    let rotated_result = extract(&rotated, &root, 3, &ffmpeg, &ffprobe).unwrap();
    assert_eq!(
        (rotated_result.video.width, rotated_result.video.height),
        (48, 64)
    );
    let mut malicious = result.video.clone();
    malicious.frames[0].name = "../source.png".into();
    assert!(validate(&malicious, &result.folder_path).is_err());
    fs::remove_file(result.folder_path.join("frame-000003.png")).unwrap();
    assert!(load(&result.folder_path).is_err());
    let before = fs::read_dir(&root).unwrap().count();
    cancel();
    assert!(extract(&source, &root, 3, &ffmpeg, &ffprobe).is_err());
    assert_eq!(fs::read_dir(&root).unwrap().count(), before);
    CANCEL.store(false, Ordering::SeqCst);
    fs::write(root.join("bad.mp4"), b"not a video").unwrap();
    assert!(extract(&root.join("bad.mp4"), &root, 3, &ffmpeg, &ffprobe).is_err());
    assert_eq!(fs::read_dir(&root).unwrap().count(), before + 1);
    drop(output);
}

#[test]
fn bundled_video_tools_take_precedence_over_development_path() {
    let root =
        std::env::temp_dir().join(format!("annotool-video-tools-test-{}", std::process::id()));
    fs::create_dir_all(root.join("video-tools")).unwrap();
    let _guard = OutputGuard(root.clone(), false);
    let expected = root
        .join("video-tools")
        .join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX));
    fs::write(&expected, []).unwrap();
    assert_eq!(executable(&root, "ffmpeg").unwrap(), expected);
}
