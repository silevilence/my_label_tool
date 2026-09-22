use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub name: String,
    pub ir_version: u64,
    pub producer: String,
    pub opsets: BTreeMap<String, u64>,
    pub shape_inference: ShapeInference,
    pub metadata: BTreeMap<String, String>,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub tensors: Vec<Tensor>,
    pub initializers: Vec<Weight>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeInference {
    pub opset: Option<u64>,
    pub supported: bool,
    pub min_opset: u64,
    pub max_opset: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: usize,
    pub name: String,
    pub op_type: String,
    pub domain: String,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub attributes: BTreeMap<String, Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub tensor: String,
    pub source: Option<usize>,
    pub target: usize,
    pub input_index: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tensor {
    pub name: String,
    pub shape: Option<Vec<Value>>,
    pub data_type: Option<u64>,
    pub origin: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weight {
    pub name: String,
    pub shape: Vec<i64>,
    pub data_type: u64,
    pub byte_size: Option<u64>,
    pub external: bool,
}
