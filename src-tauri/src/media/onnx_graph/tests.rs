use super::*;

pub(super) fn varint(mut v: u64) -> Vec<u8> {
    let mut result = vec![];
    while v >= 128 {
        result.push((v as u8 & 127) | 128);
        v >>= 7;
    }
    result.push(v as u8);
    result
}
pub(super) fn int(field: u64, v: u64) -> Vec<u8> {
    [varint(field * 8), varint(v)].concat()
}
pub(super) fn msg(field: u64, data: &[u8]) -> Vec<u8> {
    [
        varint(field * 8 + 2),
        varint(data.len() as u64),
        data.to_vec(),
    ]
    .concat()
}
pub(super) fn info(name: &str, shape: &[i64]) -> Vec<u8> {
    let shape: Vec<u8> = shape
        .iter()
        .flat_map(|v| msg(1, &int(1, *v as u64)))
        .collect();
    [
        msg(1, name.as_bytes()),
        msg(2, &msg(1, &[int(1, 1), msg(2, &shape)].concat())),
    ]
    .concat()
}
pub(super) fn node(op: &str, inputs: &[&str], outputs: &[&str]) -> Vec<u8> {
    [
        inputs
            .iter()
            .flat_map(|s| msg(1, s.as_bytes()))
            .collect::<Vec<_>>(),
        outputs.iter().flat_map(|s| msg(2, s.as_bytes())).collect(),
        msg(4, op.as_bytes()),
    ]
    .concat()
}
pub(super) fn model(nodes: &[Vec<u8>]) -> Vec<u8> {
    let graph = [
        msg(2, b"test"),
        msg(11, &info("x", &[1, 3, 8, 8])),
        msg(12, &info("y", &[1, 3, 8, 8])),
        nodes.iter().flat_map(|n| msg(1, n)).collect(),
    ]
    .concat();
    [int(1, 8), msg(8, &int(2, 13)), msg(7, &graph)].concat()
}

#[test]
fn parses_topology_names_and_shapes_without_runtime() {
    let data = model(&[
        node("Relu", &["x"], &["a"]),
        node("Add", &["a", "a"], &["y"]),
    ]);
    let g = inspect_bytes(&data).unwrap();
    assert_eq!(g.nodes.len(), 2);
    assert_eq!(g.edges.len(), 3);
    assert_eq!(g.edges[1].source, Some(0));
    assert_eq!(g.edges[2].input_index, 1);
    assert_eq!(
        g.tensors.iter().find(|t| t.name == "x").unwrap().shape,
        Some(vec![1.into(), 3.into(), 8.into(), 8.into()])
    );
}

#[test]
fn rejects_damage_missing_operators_and_dangling_edges() {
    for data in [
        vec![],
        vec![0],
        vec![255; 12],
        b"not onnx".to_vec(),
        model(&[node("", &["x"], &["y"])]),
        model(&[node("Relu", &["absent"], &["y"])]),
    ] {
        let error = inspect_bytes(&data).unwrap_err();
        assert!(error.contains("ModelProto"));
    }
    let data = model(&[node("Relu", &["x"], &["y"])]);
    for end in 0..data.len() {
        assert!(inspect_bytes(&data[..end]).is_err());
    }
    assert!(inspect_bytes(&model(&[node("Relu", &["x"], &["x"])])).is_err());
}

#[test]
fn summarizes_packed_weights_attributes_and_dynamic_shapes() {
    let weight = [
        msg(1, &[2, 3]),
        int(2, 1),
        msg(8, b"weights"),
        msg(9, &[0; 24]),
    ]
    .concat();
    let w = attributes::weight(&weight).unwrap();
    assert_eq!(w.shape, [2, 3]);
    assert_eq!(w.byte_size, Some(24));
    let attr = [msg(1, b"value"), int(20, 4), msg(5, &weight)].concat();
    let value = attributes::attribute(&attr).unwrap();
    assert_eq!(value["byteSize"], 24);
    assert!(value.get("rawData").is_none());
    let attr = [int(20, 7), msg(8, &[1, 2])].concat();
    assert_eq!(
        attributes::attribute(&attr).unwrap(),
        serde_json::json!([1, 2])
    );
    let attr = [int(20, 6), msg(7, &1.5f32.to_le_bytes())].concat();
    assert_eq!(
        attributes::attribute(&attr).unwrap(),
        serde_json::json!([1.5])
    );
    assert!(attributes::floats(&msg(7, &[0]), 7).is_err());
    assert!(attributes::weight(&[int(1, u64::MAX), int(2, 1)].concat()).is_err());
    for data in [
        msg(9, &((1i64 << 53) + 1).to_le_bytes()),
        int(7, (1u64 << 53) + 1),
    ] {
        let large_integer = [int(2, 7), data].concat();
        assert!(attributes::numbers(&large_integer).unwrap().is_none());
    }
    let symbolic = [
        msg(1, b"dynamic"),
        msg(2, &msg(1, &msg(2, &msg(1, &msg(2, b"batch"))))),
    ]
    .concat();
    assert_eq!(
        value_info(&symbolic).unwrap().shape,
        Some(vec!["batch".into()])
    );
}

#[test]
#[ignore = "requires external official YOLO11 and YOLOv8 fixtures"]
fn graph_io_agrees_with_existing_official_model_metadata() {
    use crate::media::onnx_metadata::inspect_onnx_bytes;
    for key in ["MY_LABEL_TOOL_YOLO_ONNX", "MY_LABEL_TOOL_YOLOV8_ONNX"] {
        let path = std::path::PathBuf::from(std::env::var(key).expect("missing fixture path"));
        let bytes = std::fs::read(&path).unwrap();
        let summary =
            inspect_onnx_bytes(&bytes, path.file_name().unwrap().to_str().unwrap()).unwrap();
        let graph = inspect_bytes(&bytes).unwrap();
        let input = graph
            .tensors
            .iter()
            .find(|t| t.name == graph.inputs[0])
            .unwrap();
        let output = graph
            .tensors
            .iter()
            .find(|t| t.name == graph.outputs[0])
            .unwrap();
        assert_eq!(input.origin, "disk");
        assert_eq!(output.origin, "disk");
        assert_eq!(input.shape.as_ref().unwrap()[2], summary.input_height);
        assert_eq!(input.shape.as_ref().unwrap()[3], summary.input_width);
        assert_eq!(output.shape.as_ref().unwrap()[1], summary.class_count + 4);
    }
}

#[test]
fn metadata_and_graph_share_dimensions_without_erasing_symbols() {
    use crate::media::onnx_metadata::inspect_onnx_bytes;
    for dynamic in [false, true] {
        let dims = [
            msg(1, &int(1, 1)),
            msg(1, &int(1, 3)),
            msg(
                1,
                &if dynamic {
                    msg(2, b"height")
                } else {
                    int(1, 320)
                },
            ),
            msg(1, &if dynamic { vec![] } else { int(1, 640) }),
        ]
        .concat();
        let input = [
            msg(1, b"images"),
            msg(2, &msg(1, &[int(1, 1), msg(2, &dims)].concat())),
        ]
        .concat();
        let graph = [
            msg(11, &input),
            msg(12, &info("output", &[1, 84, 8400])),
            msg(
                1,
                &[
                    node("Detector", &["images"], &["output"]),
                    msg(7, b"custom"),
                ]
                .concat(),
            ),
        ]
        .concat();
        let bytes = [int(1, 8), msg(8, &int(2, 17)), msg(7, &graph)].concat();
        let g = inspect_bytes(&bytes).unwrap();
        let summary = inspect_onnx_bytes(&bytes, "yolo11n.onnx").unwrap();
        let input = g.tensors.iter().find(|t| t.name == "images").unwrap();
        let expected = if dynamic {
            serde_json::json!([1, 3, "height", null])
        } else {
            serde_json::json!([1, 3, 320, 640])
        };
        assert_eq!(serde_json::json!(input.shape), expected);
        assert_eq!(
            (summary.input_height, summary.input_width),
            if dynamic { (0, 0) } else { (320, 640) }
        );
        let output = g.tensors.iter().find(|t| t.name == "output").unwrap();
        assert_eq!(
            serde_json::json!(output.shape),
            serde_json::json!([1, 84, 8400])
        );
        assert_eq!(summary.class_count, 80);
    }
}
