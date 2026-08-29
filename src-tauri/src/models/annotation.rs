use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AnnotationExport {
    pub labels: Vec<LabelConfig>,
    pub images: Vec<ImageAnnotations>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ImageAnnotations {
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub annotations: Vec<AnnotationShape>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AnnotationShape {
    pub id: String,
    #[serde(rename = "type")]
    pub shape_type: String,
    pub label_id: String,
    pub points: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attributes: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_index: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LabelConfig {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    pub shape_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LabelTemplate {
    pub id: String,
    pub name: String,
    pub labels: Vec<LabelConfig>,
}
