use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum YoloModelFormat {
    #[serde(rename = "yolov5")]
    YoloV5,
    #[serde(rename = "yolov8")]
    YoloV8,
    #[serde(rename = "yolo11")]
    Yolo11,
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
