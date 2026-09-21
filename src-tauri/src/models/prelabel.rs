use serde::{Deserialize, Serialize};

/// Host-only ONNX output budget. Each f32 element accounts for the runtime output
/// and one host copy (8 bytes); model weights/intermediates are not included.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrelabelResourceLimits {
    #[serde(rename = "maxMemoryMiB")]
    pub max_memory_mib: u64,
    pub max_candidates: u64,
}

impl Default for PrelabelResourceLimits {
    fn default() -> Self {
        Self {
            max_memory_mib: 80,
            max_candidates: 100_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum YoloModelFormat {
    #[serde(rename = "yolov5")]
    YoloV5,
    #[serde(rename = "yolov8")]
    YoloV8,
    #[serde(rename = "yolo11")]
    Yolo11,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
pub enum PrelabelDevice {
    #[serde(rename = "auto")]
    #[default]
    Auto,
    #[serde(rename = "cpu")]
    Cpu,
    #[serde(rename = "gpu")]
    Gpu,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrelabelModelConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub format: YoloModelFormat,
    pub class_count: usize,
    pub input_width: usize,
    pub input_height: usize,
    pub input_size_override: Option<[usize; 2]>,
    pub class_names: Vec<String>,
    pub confidence_threshold: f32,
    pub iou_threshold: f32,
    pub added_at: String,
    /// Inference execution device for this model. Defaults to auto (use GPU when available).
    #[serde(default)]
    pub device: PrelabelDevice,
    /// Download URL for the manual "update model" flow. Absent in libraries created before
    /// this field existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Timestamp of the last successful update from `source_url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrelabelModelLibrary {
    pub schema_version: u32,
    pub current_model_id: Option<String>,
    pub models: Vec<PrelabelModelConfig>,
}

impl Default for PrelabelModelLibrary {
    fn default() -> Self {
        Self {
            schema_version: 1,
            current_model_id: None,
            models: Vec::new(),
        }
    }
}
