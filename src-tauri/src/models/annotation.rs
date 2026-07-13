use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationExport {
    pub labels: Vec<LabelConfig>,
    pub images: Vec<ImageAnnotations>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnnotations {
    pub path: String,
    pub name: String,
    pub annotations: Vec<AnnotationShape>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationShape {
    pub id: String,
    #[serde(rename = "type")]
    pub shape_type: String,
    pub label_id: String,
    pub points: Vec<f64>,
    pub attributes: Option<Value>,
    pub frame_index: Option<u32>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelConfig {
    pub id: String,
    pub name: String,
    pub color: String,
    pub shortcut: Option<String>,
    pub shape_type: String,
}
