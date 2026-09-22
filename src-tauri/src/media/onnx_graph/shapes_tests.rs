use super::*;
use serde_json::json;

fn node(op: &str, attrs: Value, outputs: usize) -> Node {
    Node {
        id: 0,
        name: String::new(),
        op_type: op.into(),
        domain: String::new(),
        inputs: vec!["x".into(), "w".into(), "b".into(), "c".into(), "d".into()],
        outputs: (0..outputs).map(|i| format!("y{i}")).collect(),
        attributes: serde_json::from_value(attrs).unwrap(),
    }
}
fn run(
    op: &str,
    x: &[i64],
    y: &[i64],
    attrs: Value,
    constants: Vec<(&str, Vec<f64>)>,
) -> Option<Vec<Vec<i64>>> {
    let mut n = node(op, attrs, 1);
    n.inputs.truncate(2);
    let s = BTreeMap::from([("x".into(), x.to_vec()), ("w".into(), y.to_vec())]);
    infer_node(
        &n,
        &s,
        &constants.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        17,
    )
}

#[test]
fn infers_spatial_broadcast_and_reshape_with_validated_dimensions() {
    assert_eq!(
        run(
            "Conv",
            &[1, 3, 32, 32],
            &[8, 3, 3, 3],
            json!({"pads":[1,1,1,1],"strides":[2,2]}),
            vec![]
        ),
        Some(vec![vec![1, 8, 16, 16]])
    );
    assert_eq!(
        run(
            "Conv",
            &[1, 3, 31, 31],
            &[8, 3, 3, 3],
            json!({"auto_pad":"SAME_UPPER","strides":[2,2]}),
            vec![]
        ),
        Some(vec![vec![1, 8, 16, 16]])
    );
    assert_eq!(
        run(
            "MaxPool",
            &[1, 8, 7, 7],
            &[],
            json!({"kernel_shape":[2,2],"strides":[2,2],"ceil_mode":1}),
            vec![]
        ),
        Some(vec![vec![1, 8, 4, 4]])
    );
    assert_eq!(
        run("GlobalAveragePool", &[1, 8, 7, 7], &[], json!({}), vec![]),
        Some(vec![vec![1, 8, 1, 1]])
    );
    assert_eq!(
        run("Mul", &[1, 8, 7, 7], &[1, 8, 1, 1], json!({}), vec![]),
        Some(vec![vec![1, 8, 7, 7]])
    );
    assert_eq!(
        run("Add", &[0, 3], &[1, 3], json!({}), vec![]),
        Some(vec![vec![0, 3]])
    );
    assert_eq!(
        run("Concat", &[1, 2, 3], &[1, 4, 3], json!({"axis":1}), vec![]),
        Some(vec![vec![1, 6, 3]])
    );
    assert_eq!(
        run(
            "Reshape",
            &[1, 4, 8, 8],
            &[3],
            json!({}),
            vec![("w", vec![0., 4., -1.])]
        ),
        Some(vec![vec![1, 4, 64]])
    );
    assert_eq!(
        run("MatMul", &[1, 2, 8, 4], &[1, 2, 4, 16], json!({}), vec![]),
        Some(vec![vec![1, 2, 8, 16]])
    );
    assert_eq!(
        run(
            "Transpose",
            &[1, 2, 3],
            &[],
            json!({"perm":[0,2,1]}),
            vec![]
        ),
        Some(vec![vec![1, 3, 2]])
    );
    assert_eq!(
        run("Flatten", &[2, 3, 4], &[], json!({"axis":-1}), vec![]),
        Some(vec![vec![6, 4]])
    );
    assert_eq!(
        run("Gather", &[2, 3, 4], &[5], json!({"axis":1}), vec![]),
        Some(vec![vec![2, 5, 4]])
    );
    assert_eq!(
        run(
            "Unsqueeze",
            &[2, 3],
            &[2],
            json!({}),
            vec![("w", vec![0., -1.])]
        ),
        Some(vec![vec![1, 2, 3, 1]])
    );
    assert_eq!(
        run(
            "Squeeze",
            &[1, 2, 1],
            &[2],
            json!({}),
            vec![("w", vec![0., 2.])]
        ),
        Some(vec![vec![2]])
    );
    assert_eq!(
        run("Relu", &[2, 3], &[], json!({}), vec![]),
        Some(vec![vec![2, 3]])
    );
}

#[test]
fn refuses_invalid_or_unsupported_inference_instead_of_guessing() {
    for (op, x, y, attrs, c) in [
        (
            "Conv",
            vec![1, 3, 8, 8],
            vec![8, 3, 3, 3],
            json!({"strides":[0,1]}),
            vec![],
        ),
        (
            "Conv",
            vec![1, 3, 8, 8],
            vec![8, 3, 3, 3],
            json!({"pads":[1]}),
            vec![],
        ),
        ("Add", vec![2, 3], vec![4, 3], json!({}), vec![]),
        ("Concat", vec![2, 3], vec![4, 4], json!({"axis":0}), vec![]),
        (
            "Transpose",
            vec![2, 3],
            vec![],
            json!({"perm":[0,0]}),
            vec![],
        ),
        (
            "Reshape",
            vec![2, 3],
            vec![2],
            json!({}),
            vec![("w", vec![-1., -1.])],
        ),
        (
            "Reshape",
            vec![2, 3],
            vec![2],
            json!({}),
            vec![("w", vec![4., 2.])],
        ),
        (
            "Reshape",
            vec![2, 3],
            vec![2],
            json!({}),
            vec![("w", vec![0., -1.])],
        ),
        ("Custom", vec![2, 3], vec![], json!({}), vec![]),
    ] {
        if op == "Reshape" && c == vec![("w", vec![0., -1.])] {
            assert_eq!(run(op, &x, &y, attrs, c), Some(vec![vec![2, 3]]));
            continue;
        }
        assert!(run(op, &x, &y, attrs, c).is_none(), "{op}");
    }
    assert_eq!(broadcast(&[i64::MAX], &[2]), None);
    assert_eq!(product(&[i64::MAX, 2]), None);
}

#[test]
fn infers_resize_split_slice_and_reduce() {
    let s = BTreeMap::from([("x".into(), vec![1, 8, 20, 20])]);
    let mut n = node("Resize", json!({}), 1);
    n.inputs.truncate(3);
    let c = BTreeMap::from([("b".into(), vec![1., 1., 2., 2.])]);
    assert_eq!(infer_node(&n, &s, &c, 17), Some(vec![vec![1, 8, 40, 40]]));
    n.attributes.insert("axes".into(), json!([2, 3]));
    assert!(infer_node(&n, &s, &c, 17).is_none());
    let n = node("Split", json!({"axis":1}), 2);
    let c = BTreeMap::from([("w".into(), vec![3., 5.])]);
    assert_eq!(
        infer_node(&n, &s, &c, 17),
        Some(vec![vec![1, 3, 20, 20], vec![1, 5, 20, 20]])
    );
    let n = node("Slice", json!({}), 1);
    let c = BTreeMap::from([
        ("w".into(), vec![2.]),
        ("b".into(), vec![8.]),
        ("c".into(), vec![1.]),
        ("d".into(), vec![2.]),
    ]);
    assert_eq!(infer_node(&n, &s, &c, 17), Some(vec![vec![1, 3, 20, 20]]));
    let mut n = node("ReduceMean", json!({"axes":[2,3],"keepdims":0}), 1);
    n.inputs.truncate(1);
    assert_eq!(
        infer_node(&n, &s, &BTreeMap::new(), 17),
        Some(vec![vec![1, 8]])
    );
}

#[test]
fn follows_topology_and_leaves_dynamic_and_custom_domains_unknown() {
    use crate::media::onnx_graph::{
        inspect_bytes,
        tests::{model, msg, node as raw_node},
    };
    let custom = [raw_node("Relu", &["x"], &["a"]), msg(7, b"vendor.custom")].concat();
    let raw = model(&[
        raw_node("Relu", &["b"], &["y"]),
        custom,
        raw_node("Relu", &["x"], &["b"]),
    ]);
    let g = inspect_bytes(&raw).unwrap();
    assert_eq!(
        g.tensors.iter().find(|t| t.name == "a").unwrap().origin,
        "unknown"
    );
    assert_eq!(
        g.tensors.iter().find(|t| t.name == "b").unwrap().shape,
        Some(vec![json!(1), json!(3), json!(8), json!(8)])
    );
    assert!(inspect_bytes(&model(&[
        raw_node("Relu", &["a"], &["a"]),
        raw_node("Relu", &["x"], &["y"])
    ]))
    .is_err());
    let mut g = inspect_bytes(&model(&[
        raw_node("Relu", &["x"], &["a"]),
        raw_node("Relu", &["a"], &["y"]),
    ]))
    .unwrap();
    for t in &mut g.tensors {
        if t.name == "x" {
            t.shape = Some(vec![json!("batch"), json!(3), json!(8), json!(8)]);
        }
        if t.name == "a" {
            t.shape = None;
            t.origin = "unknown".into();
        }
    }
    infer(&mut g, BTreeMap::new(), &[0, 1]);
    assert!(g
        .tensors
        .iter()
        .find(|t| t.name == "a")
        .unwrap()
        .shape
        .is_none());
}
