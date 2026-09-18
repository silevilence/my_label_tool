use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFrame {
    pub name: String,
    pub frame_index: usize,
    pub timestamp_seconds: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProject {
    pub schema_version: u32,
    pub source_path: PathBuf,
    pub frame_interval: usize,
    pub total_frames: usize,
    pub width: u32,
    pub height: u32,
    pub frames: Vec<VideoFrame>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoImportResult {
    pub folder_path: PathBuf,
    pub video: VideoProject,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectVideo {
    pub source_path: PathBuf,
    pub folder_path: Option<PathBuf>,
    pub video: Option<VideoProject>,
}
