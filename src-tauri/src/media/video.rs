//! Offline extraction into a new, owned directory; failures never replace a project.
use crate::{
    i18n::zh_cn as text,
    models::video::{VideoFrame, VideoImportResult, VideoProject},
};
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

pub const MANIFEST: &str = "my-label-tool.video.json";
#[cfg(test)]
#[path = "video_tests.rs"]
mod tests;
static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(0);
const MAX_FRAMES: usize = 10_000;
const MAX_LOG_BYTES: u64 = 64 * 1024 * 1024;

pub struct ImportGuard;
impl ImportGuard {
    pub fn acquire() -> Result<Self, String> {
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| text::VIDEO_BUSY.to_string())?;
        CANCEL.store(false, Ordering::SeqCst);
        Ok(Self)
    }
}
impl Drop for ImportGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}
pub(super) fn is_cancelled() -> bool {
    CANCEL.load(Ordering::SeqCst)
}

pub fn shutdown() {
    cancel();
    let started = Instant::now();
    while BUSY.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(5) {
        thread::sleep(Duration::from_millis(25));
    }
}

struct OutputGuard(PathBuf, bool);
impl Drop for OutputGuard {
    fn drop(&mut self) {
        if !self.1 {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

fn failure(error: impl std::fmt::Display) -> String {
    text::video_failed(error)
}

pub fn executable(resource_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let filename = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let bundled = resource_dir.join("video-tools").join(&filename);
    if bundled.is_file() {
        return Ok(bundled);
    }
    #[cfg(debug_assertions)]
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            let candidate = path.join(&filename);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(text::VIDEO_TOOLS_MISSING.to_string())
}

fn run(command: &mut Command, folder: &Path) -> Result<Vec<u8>, String> {
    let output = folder.join("process-output.tmp");
    let errors = folder.join("process-errors.tmp");
    command
        .stdin(Stdio::null())
        .stdout(File::create(&output).map_err(failure)?)
        .stderr(File::create(&errors).map_err(failure)?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(failure)?;
    let started = Instant::now();
    let status = loop {
        let oversized = [&output, &errors].iter().any(|path| {
            fs::metadata(path)
                .map(|metadata| metadata.len() > MAX_LOG_BYTES)
                .unwrap_or(false)
        });
        if CANCEL.load(Ordering::SeqCst)
            || started.elapsed() > Duration::from_secs(1800)
            || oversized
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(text::VIDEO_INTERRUPTED.to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(failure(error));
            }
        }
    };
    if !status.success() {
        let detail = fs::read_to_string(&errors).unwrap_or_default();
        return Err(failure(detail.chars().take(2000).collect::<String>()));
    }
    if fs::metadata(&output).map_err(failure)?.len() > MAX_LOG_BYTES {
        return Err(text::VIDEO_LIMIT.to_string());
    }
    let bytes = fs::read(&output).map_err(failure)?;
    fs::remove_file(output).map_err(failure)?;
    fs::remove_file(errors).map_err(failure)?;
    Ok(bytes)
}

pub fn parse_timestamps(bytes: &[u8]) -> Result<Vec<f64>, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(failure)?;
    let frames = value["frames"].as_array().ok_or(text::VIDEO_INVALID)?;
    if frames.is_empty() || frames.len() > 1_000_000 {
        return Err(text::VIDEO_LIMIT.to_string());
    }
    let mut timestamps = Vec::with_capacity(frames.len());
    // Integer PTS avoids FFprobe's six-decimal time string rounding near sampling boundaries.
    let time_base = value["streams"][0]["time_base"].as_str().and_then(|base| {
        let (numerator, denominator) = base.split_once('/')?;
        let scale = numerator.parse::<f64>().ok()? / denominator.parse::<f64>().ok()?;
        (scale.is_finite() && scale > 0.0).then_some(scale)
    });
    for frame in frames {
        let time = time_base
            .and_then(|base| {
                frame["best_effort_timestamp"]
                    .as_i64()
                    .map(|pts| pts as f64 * base)
            })
            .or_else(|| {
                frame["best_effort_timestamp_time"]
                    .as_str()
                    .and_then(|value| value.parse::<f64>().ok())
            })
            .filter(|value| value.is_finite())
            .ok_or(text::VIDEO_INVALID)?;
        if timestamps.last().is_some_and(|last| time < *last) {
            return Err(text::VIDEO_INVALID.to_string());
        }
        timestamps.push(time);
    }
    let start = timestamps[0];
    Ok(timestamps.into_iter().map(|time| time - start).collect())
}

#[cfg(test)]
pub fn extract(
    source: &Path,
    parent: &Path,
    interval: usize,
    ffmpeg: &Path,
    ffprobe: &Path,
) -> Result<VideoImportResult, String> {
    extract_with_sampling(source, parent, interval, None, ffmpeg, ffprobe)
}

pub fn extract_with_sampling(
    source: &Path,
    parent: &Path,
    interval: usize,
    target_fps: Option<f64>,
    ffmpeg: &Path,
    ffprobe: &Path,
) -> Result<VideoImportResult, String> {
    if interval == 0
        || interval > 1_000_000
        || !valid_fps(target_fps)
        || !source.is_file()
        || !parent.is_dir()
    {
        return Err(text::VIDEO_INVALID.to_string());
    }
    let source = fs::canonicalize(source).map_err(failure)?;
    let parent = fs::canonicalize(parent).map_err(failure)?;
    let folder = loop {
        let name = format!(
            "video-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        );
        let folder = parent.join(name);
        match fs::create_dir(&folder) {
            Ok(()) => break folder,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(failure(error)),
        }
    };
    let mut guard = OutputGuard(folder.clone(), false);
    let times = parse_timestamps(&run(
        Command::new(ffprobe)
            .args([
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-threads",
                "2",
                "-select_streams",
                "v:0",
                "-show_frames",
                "-show_streams",
                "-show_entries",
                "frame=best_effort_timestamp,best_effort_timestamp_time:stream=time_base",
                "-of",
                "json",
            ])
            .arg(&source),
        &folder,
    )?)?;
    let selected = sampling_indices(&times, interval, target_fps);
    if selected.len() > MAX_FRAMES {
        return Err(text::VIDEO_LIMIT.to_string());
    }
    // Same time buckets as sampling_indices; select preserves original pixels and source indices.
    let filter = target_fps.map_or_else(
        || format!("select=not(mod(n\\,{interval}))"),
        |fps| format!("select=isnan(prev_selected_t)+gt(floor((t-start_t)*{fps}+0.00001)\\,floor((prev_selected_t-start_t)*{fps}+0.00001))"),
    );
    run(
        Command::new(ffmpeg)
            .args([
                "-nostdin",
                "-v",
                "error",
                "-xerror",
                "-protocol_whitelist",
                "file,pipe",
                "-threads",
                "2",
                "-i",
            ])
            .arg(&source)
            .args([
                "-map",
                "0:v:0",
                "-an",
                "-sn",
                "-vf",
                &filter,
                "-fps_mode",
                "passthrough",
                "-threads",
                "2",
                "-start_number",
                "0",
                "-n",
            ])
            .arg(folder.join("frame-%06d.png")),
        &folder,
    )?;
    let frames: Vec<_> = selected
        .iter()
        .enumerate()
        .map(|(index, &frame_index)| VideoFrame {
            name: format!("frame-{index:06}.png"),
            frame_index,
            timestamp_seconds: times[frame_index],
        })
        .collect();
    let (width, height) = image::image_dimensions(folder.join(&frames[0].name)).map_err(failure)?;
    let video = VideoProject {
        schema_version: 1,
        source_path: source,
        frame_interval: interval,
        target_fps,
        total_frames: times.len(),
        width,
        height,
        frames,
    };
    validate(&video, &folder)?;
    if CANCEL.load(Ordering::SeqCst) {
        return Err(text::VIDEO_INTERRUPTED.to_string());
    }
    fs::write(
        folder.join(MANIFEST),
        serde_json::to_vec_pretty(&video).map_err(failure)?,
    )
    .map_err(failure)?;
    guard.1 = true;
    Ok(VideoImportResult {
        folder_path: folder,
        video,
    })
}

pub fn validate(video: &VideoProject, folder: &Path) -> Result<(), String> {
    if video.schema_version != 1
        || video.frame_interval == 0
        || video.frame_interval > 1_000_000
        || video.source_path.as_os_str().is_empty()
        || video.total_frames == 0
        || video.total_frames > 1_000_000
        || video.frames.len() > MAX_FRAMES
        || video.frames.is_empty()
        || !valid_fps(video.target_fps)
        || (video.target_fps.is_none()
            && video.frames.len() != video.total_frames.div_ceil(video.frame_interval))
        || video.width == 0
        || video.height == 0
    {
        return Err(text::VIDEO_INVALID.to_string());
    }
    let mut previous = 0.0;
    for (index, frame) in video.frames.iter().enumerate() {
        if frame.name != format!("frame-{index:06}.png")
            || frame.frame_index >= video.total_frames
            || (index == 0 && frame.frame_index != 0)
            || (index > 0 && frame.frame_index <= video.frames[index - 1].frame_index)
            || (video.target_fps.is_none() && frame.frame_index != index * video.frame_interval)
            || (index > 0
                && video.target_fps.is_some_and(|fps| {
                    bucket(frame.timestamp_seconds, fps) <= bucket(previous, fps)
                }))
            || !frame.timestamp_seconds.is_finite()
            || frame.timestamp_seconds < previous
            || (index == 0 && frame.timestamp_seconds != 0.0)
            || image::image_dimensions(folder.join(&frame.name)).map_err(failure)?
                != (video.width, video.height)
        {
            return Err(text::VIDEO_INVALID.to_string());
        }
        previous = frame.timestamp_seconds;
    }
    Ok(())
}

pub fn load(folder: &Path) -> Result<Option<VideoProject>, String> {
    let path = folder.join(MANIFEST);
    if !path.exists() {
        return Ok(None);
    }
    if fs::metadata(&path).map_err(failure)?.len() > MAX_LOG_BYTES {
        return Err(text::VIDEO_LIMIT.to_string());
    }
    let video = serde_json::from_slice(&fs::read(path).map_err(failure)?).map_err(failure)?;
    validate(&video, folder)?;
    Ok(Some(video))
}

fn valid_fps(fps: Option<f64>) -> bool {
    fps.is_none_or(|fps| fps.is_finite() && fps > 0.0 && fps <= 1000.0)
}
fn bucket(time: f64, fps: f64) -> f64 {
    (time * fps + 0.00001).floor()
}
fn sampling_indices(times: &[f64], interval: usize, fps: Option<f64>) -> Vec<usize> {
    let Some(fps) = fps else {
        return (0..times.len()).step_by(interval).collect();
    };
    let mut previous = -1.0;
    times
        .iter()
        .enumerate()
        .filter_map(|(index, &time)| {
            let current = bucket(time, fps);
            if current > previous {
                previous = current;
                Some(index)
            } else {
                None
            }
        })
        .collect()
}
