//! Offline, host-only graph inspection. No runtime session and no weight payload in IPC.
mod attributes;
mod shapes;
#[cfg(test)]
mod tests;
mod types;
pub use types::*;

use super::onnx_metadata::metadata_properties;
use super::onnx_wire::{bytes_field, first_string, first_varint};
use crate::i18n::zh_cn as text;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};

pub fn inspect_file(path: &Path) -> Result<Graph, String> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("onnx"))
    {
        return Err(text::select_extension("onnx"));
    }
    let bytes = std::fs::read(path).map_err(text::read_onnx_failed)?;
    inspect_bytes(&bytes).map_err(|error| format!("{}: {error}", path.display()))
}

pub fn inspect_bytes(bytes: &[u8]) -> Result<Graph, String> {
    parse(bytes).map_err(|error| text::onnx_graph_error("ModelProto", 0, &error))
}

fn parse(bytes: &[u8]) -> Result<Graph, String> {
    let ir_version = first_varint(bytes, 1)?
        .filter(|v| *v > 0)
        .ok_or(text::ONNX_GRAPH_INVALID_MODEL)?;
    let graphs = bytes_field(bytes, 7)?;
    if graphs.len() != 1 {
        return Err(text::ONNX_MISSING_GRAPH.into());
    }
    let raw = graphs[0];
    let mut graph = Graph {
        name: first_string(raw, 2)?.unwrap_or_default(),
        ir_version,
        producer: first_string(bytes, 2)?.unwrap_or_default(),
        opsets: BTreeMap::new(),
        metadata: metadata_properties(bytes)?,
        nodes: vec![],
        edges: vec![],
        inputs: vec![],
        outputs: vec![],
        tensors: vec![],
        initializers: vec![],
    };
    for entry in bytes_field(bytes, 8)? {
        graph.opsets.insert(
            first_string(entry, 1)?.unwrap_or_default(),
            first_varint(entry, 2)?.ok_or(text::ONNX_GRAPH_INVALID_MODEL)?,
        );
    }
    let mut tensors = BTreeMap::new();
    let mut constants = BTreeMap::new();
    for field in [11, 12, 13] {
        for (index, info) in bytes_field(raw, field)?.into_iter().enumerate() {
            let tensor = value_info(info)
                .map_err(|e| text::onnx_graph_error("ValueInfoProto", index, &e))?;
            if field == 11 {
                graph.inputs.push(tensor.name.clone());
            }
            if field == 12 {
                graph.outputs.push(tensor.name.clone());
            }
            tensors.insert(tensor.name.clone(), tensor);
        }
    }
    for (index, initializer) in bytes_field(raw, 5)?.into_iter().enumerate() {
        let weight = attributes::weight(initializer)
            .map_err(|e| text::onnx_graph_error("TensorProto", index, &e))?;
        if weight.name.is_empty() || graph.initializers.iter().any(|w| w.name == weight.name) {
            return Err(text::onnx_graph_error(
                "TensorProto",
                index,
                text::ONNX_GRAPH_DUPLICATE,
            ));
        }
        if let Some(values) = attributes::numbers(initializer)? {
            constants.insert(weight.name.clone(), values);
        }
        tensors.insert(
            weight.name.clone(),
            Tensor {
                name: weight.name.clone(),
                shape: Some(weight.shape.iter().copied().map(Value::from).collect()),
                data_type: Some(weight.data_type),
                origin: "disk".into(),
            },
        );
        graph.initializers.push(weight);
    }
    for (id, raw_node) in bytes_field(raw, 1)?.into_iter().enumerate() {
        let node =
            parse_node(raw_node, id).map_err(|e| text::onnx_graph_error("NodeProto", id, &e))?;
        if node.op_type == "Constant" && (node.domain.is_empty() || node.domain == "ai.onnx") {
            if let Some(output) = node.outputs.first() {
                for attr in bytes_field(raw_node, 5)? {
                    if first_string(attr, 1)?.as_deref() == Some("value") {
                        if let Some(tensor) = bytes_field(attr, 5)?.first() {
                            if let Some(values) = attributes::numbers(tensor)? {
                                constants.insert(output.clone(), values);
                            }
                        }
                    }
                }
            }
        }
        graph.nodes.push(node);
    }
    if graph.outputs.is_empty() {
        return Err(text::ONNX_GRAPH_INVALID_MODEL.into());
    }
    let mut producers = BTreeMap::new();
    let roots: HashSet<_> = graph
        .inputs
        .iter()
        .chain(graph.initializers.iter().map(|w| &w.name))
        .collect();
    for node in &graph.nodes {
        for output in node.outputs.iter().filter(|s| !s.is_empty()) {
            if roots.contains(output) || producers.insert(output.clone(), node.id).is_some() {
                return Err(text::onnx_graph_error(
                    output,
                    node.id,
                    text::ONNX_GRAPH_DUPLICATE,
                ));
            }
        }
    }
    for node in &graph.nodes {
        for (input_index, input) in node
            .inputs
            .iter()
            .enumerate()
            .filter(|(_, s)| !s.is_empty())
        {
            if !roots.contains(input) && !producers.contains_key(input) {
                return Err(text::onnx_graph_error(
                    input,
                    node.id,
                    text::ONNX_GRAPH_MISSING_TENSOR,
                ));
            }
            graph.edges.push(Edge {
                tensor: input.clone(),
                source: producers.get(input).copied(),
                target: node.id,
                input_index,
            });
        }
        for name in node
            .inputs
            .iter()
            .chain(&node.outputs)
            .filter(|s| !s.is_empty())
        {
            tensors.entry(name.clone()).or_insert_with(|| Tensor {
                name: name.clone(),
                shape: None,
                data_type: None,
                origin: "unknown".into(),
            });
        }
    }
    for output in &graph.outputs {
        if !roots.contains(output) && !producers.contains_key(output) {
            return Err(text::ONNX_GRAPH_MISSING_TENSOR.into());
        }
    }
    graph.tensors = tensors.into_values().collect();
    let order = shapes::topological_order(&graph).ok_or(text::ONNX_GRAPH_CYCLE)?;
    shapes::infer(&mut graph, constants, &order);
    Ok(graph)
}

fn strings(data: &[u8], field: u32) -> Result<Vec<String>, String> {
    bytes_field(data, field)?
        .into_iter()
        .map(|value| {
            std::str::from_utf8(value)
                .map(str::to_owned)
                .map_err(|_| text::ONNX_METADATA_INVALID_UTF8.to_string())
        })
        .collect()
}

fn parse_node(raw: &[u8], id: usize) -> Result<Node, String> {
    let op_type = first_string(raw, 4)?
        .filter(|s| !s.is_empty())
        .ok_or(text::ONNX_GRAPH_MISSING_OPERATOR)?;
    let mut attributes = BTreeMap::new();
    for attr in bytes_field(raw, 5)? {
        let name = first_string(attr, 1)?.ok_or(text::ONNX_GRAPH_INVALID_FIELD)?;
        attributes.insert(name, attributes::attribute(attr)?);
    }
    Ok(Node {
        id,
        name: first_string(raw, 3)?.unwrap_or_default(),
        op_type,
        domain: first_string(raw, 7)?.unwrap_or_default(),
        inputs: strings(raw, 1)?,
        outputs: strings(raw, 2)?,
        attributes,
    })
}

fn value_info(raw: &[u8]) -> Result<Tensor, String> {
    let name = first_string(raw, 1)?
        .filter(|s| !s.is_empty())
        .ok_or(text::ONNX_GRAPH_MISSING_TENSOR)?;
    let mut tensor = Tensor {
        name,
        shape: None,
        data_type: None,
        origin: "unknown".into(),
    };
    if let Some(proto) = bytes_field(raw, 2)?.first() {
        if let Some(t) = bytes_field(proto, 1)?.first() {
            tensor.data_type = first_varint(t, 1)?;
            if let Some(shape) = bytes_field(t, 2)?.first() {
                let mut dims = vec![];
                for dim in bytes_field(shape, 1)? {
                    dims.push(if let Some(v) = first_varint(dim, 1)? {
                        Value::from(i64::try_from(v).map_err(|_| text::ONNX_GRAPH_INVALID_SHAPE)?)
                    } else {
                        first_string(dim, 2)?
                            .map(Value::from)
                            .unwrap_or(Value::Null)
                    });
                }
                tensor.shape = Some(dims);
                tensor.origin = "disk".into();
            }
        }
    }
    Ok(tensor)
}
