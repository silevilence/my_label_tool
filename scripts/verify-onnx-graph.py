"""One-shot independent protobuf/shape comparison. Not an application dependency.

Usage: python scripts/verify-onnx-graph.py model.onnx [model.onnx ...]
Build first: cargo build --manifest-path src-tauri/Cargo.toml --features onnx-graph-dev --bin inspect_onnx_graph
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import onnx

ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT / "src-tauri/target/debug/inspect_onnx_graph.exe"


def verify(path):
    model = onnx.load(path, load_external_data=False)
    actual = json.loads(subprocess.check_output([str(EXE), str(path)], encoding="utf-8"))
    graph = model.graph
    assert len(actual["nodes"]) == len(graph.node)
    producers = {name: i for i, node in enumerate(graph.node) for name in node.output if name}
    edges = []
    for i, (node, got) in enumerate(zip(graph.node, actual["nodes"])):
        assert (got["name"], got["opType"], got["domain"], got["inputs"], got["outputs"]) == (
            node.name, node.op_type, node.domain, list(node.input), list(node.output))
        for j, name in enumerate(node.input):
            if name:
                edges.append(dict(tensor=name, source=producers.get(name), target=i, inputIndex=j))
    assert actual["edges"] == edges
    assert len(actual["initializers"]) == len(graph.initializer)
    for expected, got in zip(graph.initializer, actual["initializers"]):
        assert (got["name"], got["shape"], got["dataType"]) == (
            expected.name, list(expected.dims), expected.data_type)
        if expected.raw_data:
            assert got["byteSize"] == len(expected.raw_data)
    assert actual["inputs"] == [v.name for v in graph.input]
    assert actual["outputs"] == [v.name for v in graph.output]
    assert actual["metadata"] == {v.key: v.value for v in model.metadata_props}
    inferred = onnx.shape_inference.infer_shapes(model, strict_mode=True).graph
    reference = {v.name: [d.dim_value if d.HasField("dim_value") else d.dim_param or None
                         for d in v.type.tensor_type.shape.dim]
                 for v in [*inferred.input, *inferred.output, *inferred.value_info]
                 if v.type.tensor_type.HasField("shape")}
    checked = 0
    symbolic = []
    for tensor in actual["tensors"]:
        if tensor["shape"] is not None and tensor["name"] in reference:
            expected = reference[tensor["name"]]
            assert len(tensor["shape"]) == len(expected), (tensor, expected)
            assert all(not isinstance(d, int) or d == got for got, d in zip(tensor["shape"], expected)), (tensor, expected)
            if any(not isinstance(d, int) for d in expected) and tensor["origin"] == "inferred":
                symbolic.append(tensor)
            checked += 1
    # ONNX's reference inference leaves some data-dependent Slice dimensions symbolic.
    # Cross-check our constant propagation against actual CPU execution as well.
    if symbolic:
        import numpy as np
        import onnxruntime as ort
        for tensor in symbolic:
            model.graph.output.append(onnx.helper.make_tensor_value_info(tensor["name"], onnx.TensorProto.FLOAT, None))
        session = ort.InferenceSession(model.SerializeToString(), providers=["CPUExecutionProvider"])
        feeds = {v.name: np.zeros(v.shape, dtype=np.float32) for v in session.get_inputs()}
        results = session.run([t["name"] for t in symbolic], feeds)
        for tensor, result in zip(symbolic, results):
            assert tensor["shape"] == list(result.shape), (tensor, result.shape)
    # Preserve only JSON inspection data for optional UI verification, never weights.
    path.with_suffix(".graph.json").write_text(json.dumps(actual, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(dict(model=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                          nodes=len(graph.node), edges=len(edges), initializers=len(graph.initializer),
                          checkedShapes=checked, runtimeCheckedShapes=len(symbolic), inferredShapes=sum(t["origin"] == "inferred" for t in actual["tensors"]),
                          unknownShapes=sum(t["shape"] is None for t in actual["tensors"])), ensure_ascii=False))


for name in sys.argv[1:]:
    verify(Path(name).resolve())
