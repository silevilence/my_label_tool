//! Conservative static shape propagation for display only. Unknown never means zero.
use super::proto_types::tensor as data_type;
use super::{Graph, Node, ShapeInference};
use serde_json::Value;
#[cfg(test)]
#[path = "shapes_tests.rs"]
mod tests;
use std::collections::{BTreeMap, VecDeque};

type Shapes = BTreeMap<String, Vec<i64>>;
type Constants = BTreeMap<String, Vec<f64>>;

pub(super) fn support(opsets: &BTreeMap<String, u64>) -> ShapeInference {
    let opset = opsets.get("").or_else(|| opsets.get("ai.onnx")).copied();
    const MIN: u64 = 11;
    const MAX: u64 = 23;
    ShapeInference {
        opset,
        supported: opset.is_some_and(|v| (MIN..=MAX).contains(&v)),
        min_opset: MIN,
        max_opset: MAX,
    }
}

pub(super) fn topological_order(graph: &Graph) -> Option<Vec<usize>> {
    let mut degrees = vec![0usize; graph.nodes.len()];
    let mut children = vec![vec![]; graph.nodes.len()];
    for edge in &graph.edges {
        if let Some(source) = edge.source {
            degrees[edge.target] += 1;
            children[source].push(edge.target);
        }
    }
    let mut ready: VecDeque<_> = degrees
        .iter()
        .enumerate()
        .filter(|(_, d)| **d == 0)
        .map(|(i, _)| i)
        .collect();
    let mut order = vec![];
    while let Some(id) = ready.pop_front() {
        order.push(id);
        for child in &children[id] {
            degrees[*child] -= 1;
            if degrees[*child] == 0 {
                ready.push_back(*child);
            }
        }
    }
    (order.len() == graph.nodes.len()).then_some(order)
}

pub(super) fn infer(graph: &mut Graph, mut constants: Constants, order: &[usize]) {
    let Some(version) = graph
        .shape_inference
        .opset
        .filter(|_| graph.shape_inference.supported)
    else {
        return;
    };
    let mut shapes: Shapes = graph
        .tensors
        .iter()
        .filter_map(|t| {
            let shape = t
                .shape
                .as_ref()?
                .iter()
                .map(Value::as_i64)
                .collect::<Option<Vec<_>>>()?;
            shape
                .iter()
                .all(|d| *d >= 0)
                .then(|| (t.name.clone(), shape))
        })
        .collect();
    let mut integer_tensors: std::collections::HashSet<String> = graph
        .tensors
        .iter()
        .filter(|t| matches!(t.data_type, Some(data_type::INT32 | data_type::INT64)))
        .map(|t| t.name.clone())
        .collect();
    for &id in order {
        let node = &graph.nodes[id];
        if !node.domain.is_empty() && node.domain != "ai.onnx" {
            continue;
        }
        let integer_output = node.op_type == "Shape"
            || node.op_type == "Constant"
                && node
                    .attributes
                    .get("value")
                    .and_then(|v| v.get("dataType"))
                    .and_then(Value::as_u64)
                    .is_some_and(|v| matches!(v, data_type::INT32 | data_type::INT64))
            || matches!(
                node.op_type.as_str(),
                "Add"
                    | "Sub"
                    | "Mul"
                    | "Div"
                    | "Gather"
                    | "Concat"
                    | "Identity"
                    | "Reshape"
                    | "Unsqueeze"
                    | "Squeeze"
            ) && node
                .inputs
                .first()
                .is_some_and(|name| integer_tensors.contains(name));
        if integer_output {
            integer_tensors.extend(node.outputs.iter().cloned());
        }
        if let Some(outputs) = infer_node(node, &shapes, &constants, version) {
            for (name, shape) in node.outputs.iter().zip(outputs) {
                if !name.is_empty() && shape.iter().all(|d| *d >= 0) && product(&shape).is_some() {
                    shapes.entry(name.clone()).or_insert(shape);
                }
            }
        }
        if let Some(output) = node.outputs.first() {
            if let Some(values) = evaluate(node, &shapes, &constants, integer_output) {
                if values.len() <= 128 && values.iter().all(|v| v.is_finite()) {
                    constants.insert(output.clone(), values);
                }
            }
        }
    }
    for tensor in &mut graph.tensors {
        // A symbolic or partially known on-disk shape is authoritative, not replaced.
        if tensor.shape.is_none() {
            if let Some(shape) = shapes.get(&tensor.name) {
                tensor.shape = Some(shape.iter().copied().map(Value::from).collect());
                tensor.origin = "inferred".into();
            }
        }
    }
}

fn attr(n: &Node, key: &str, default: i64) -> i64 {
    n.attributes
        .get(key)
        .and_then(Value::as_i64)
        .unwrap_or(default)
}
fn list(n: &Node, key: &str) -> Option<Vec<i64>> {
    n.attributes
        .get(key)?
        .as_array()?
        .iter()
        .map(Value::as_i64)
        .collect()
}
fn axis(value: i64, rank: usize) -> Option<usize> {
    let value = if value < 0 {
        value.checked_add(rank as i64)?
    } else {
        value
    };
    usize::try_from(value).ok().filter(|v| *v < rank)
}
fn product(dims: &[i64]) -> Option<i64> {
    dims.iter().try_fold(1i64, |a, b| a.checked_mul(*b))
}
// Shape and positive-step Slice both clamp negative/end positions to [0, length].
fn clamp_position(value: i64, length: i64) -> i64 {
    if value < 0 {
        value.saturating_add(length).clamp(0, length)
    } else {
        value.min(length)
    }
}
fn integer_values(values: &[f64]) -> Option<Vec<i64>> {
    values
        .iter()
        .map(|v| {
            (v.is_finite() && v.fract() == 0. && v.abs() <= (1u64 << 53) as f64)
                .then_some(*v as i64)
        })
        .collect()
}
fn input_values(n: &Node, c: &Constants, i: usize) -> Option<Vec<i64>> {
    integer_values(c.get(n.inputs.get(i)?)?)
}
fn broadcast(a: &[i64], b: &[i64]) -> Option<Vec<i64>> {
    let mut result = vec![];
    for i in 0..a.len().max(b.len()) {
        let a = a.iter().rev().nth(i).copied().unwrap_or(1);
        let b = b.iter().rev().nth(i).copied().unwrap_or(1);
        result.push(if a == b || b == 1 {
            a
        } else if a == 1 {
            b
        } else {
            return None;
        });
    }
    result.reverse();
    Some(result)
}

fn infer_node(n: &Node, s: &Shapes, c: &Constants, version: u64) -> Option<Vec<Vec<i64>>> {
    if n.op_type == "Constant" {
        let shape = n
            .attributes
            .get("value")?
            .get("shape")?
            .as_array()?
            .iter()
            .map(Value::as_i64)
            .collect::<Option<_>>()?;
        return Some(vec![shape]);
    }
    let x = s.get(n.inputs.first()?)?;
    let result = match n.op_type.as_str() {
        "Identity" | "Relu" | "LeakyRelu" | "Sigmoid" | "Tanh" | "Softmax" | "LogSoftmax"
        | "Clip" | "Cast" | "Abs" | "Neg" | "Exp" | "Log" | "Sqrt" | "Erf" | "Elu"
        | "HardSigmoid" | "HardSwish" | "Gelu" | "BatchNormalization" => {
            if n.outputs.len() != 1 {
                return None;
            }
            x.clone()
        }
        "Add" | "Sub" | "Mul" | "Div" | "Pow" | "Max" | "Min" | "Sum" => n
            .inputs
            .iter()
            .skip(1)
            .try_fold(x.clone(), |a, name| broadcast(&a, s.get(name)?))?,
        "Conv" | "MaxPool" | "AveragePool" => spatial(n, x, s)?,
        "GlobalAveragePool" | "GlobalMaxPool" => {
            if x.len() < 3 {
                return None;
            }
            let mut out = x.clone();
            out[2..].fill(1);
            out
        }
        "Concat" => {
            let a = axis(attr(n, "axis", 0), x.len())?;
            let mut out = x.clone();
            for input in n.inputs.iter().skip(1) {
                let next = s.get(input)?;
                if next.len() != x.len()
                    || next.iter().enumerate().any(|(i, d)| i != a && *d != x[i])
                {
                    return None;
                }
                out[a] = out[a].checked_add(next[a])?;
            }
            out
        }
        "Split" => {
            let a = axis(attr(n, "axis", 0), x.len())?;
            if n.inputs.get(1).is_some_and(|v| !v.is_empty()) && input_values(n, c, 1).is_none() {
                return None;
            }
            let splits = input_values(n, c, 1)
                .or_else(|| list(n, "split"))
                .or_else(|| {
                    let count = n.outputs.len() as i64;
                    (count > 0 && x[a] % count == 0).then(|| vec![x[a] / count; count as usize])
                })?;
            if splits.len() != n.outputs.len()
                || splits.iter().any(|v| *v < 0)
                || splits.iter().try_fold(0i64, |a, b| a.checked_add(*b))? != x[a]
            {
                return None;
            }
            return Some(
                splits
                    .iter()
                    .map(|v| {
                        let mut out = x.clone();
                        out[a] = *v;
                        out
                    })
                    .collect(),
            );
        }
        "Reshape" => {
            let mut out = input_values(n, c, 1)?;
            let mut missing = None;
            for (i, d) in out.iter_mut().enumerate() {
                if *d == -1 {
                    if missing.replace(i).is_some() {
                        return None;
                    }
                    *d = 1;
                } else if *d == 0 && attr(n, "allowzero", 0) == 0 {
                    *d = *x.get(i)?;
                } else if *d < 0 {
                    return None;
                }
            }
            let total = product(x)?;
            let size = product(&out)?;
            if let Some(i) = missing {
                if size == 0 || total % size != 0 {
                    return None;
                }
                out[i] = total / size;
            } else if total != size {
                return None;
            }
            out
        }
        "Transpose" => {
            let perm = list(n, "perm").unwrap_or_else(|| (0..x.len() as i64).rev().collect());
            if perm.len() != x.len() {
                return None;
            }
            let mut seen = vec![false; x.len()];
            let mut out = vec![];
            for v in perm {
                let i = usize::try_from(v).ok()?;
                if *seen.get(i)? {
                    return None;
                }
                seen[i] = true;
                out.push(x[i]);
            }
            out
        }
        "Resize" => {
            if n.inputs.get(3).is_some_and(|v| !v.is_empty()) && input_values(n, c, 3).is_none() {
                return None;
            }
            if n.attributes.contains_key("axes")
                || n.attributes
                    .get("keep_aspect_ratio_policy")
                    .and_then(Value::as_str)
                    .is_some_and(|v| v != "stretch")
            {
                return None;
            }
            if let Some(sizes) = input_values(n, c, 3).filter(|v| !v.is_empty()) {
                if sizes.len() != x.len() {
                    return None;
                }
                sizes
            } else {
                let scales = c.get(n.inputs.get(2)?)?;
                if scales.len() != x.len() {
                    return None;
                }
                x.iter()
                    .zip(scales)
                    .map(|(d, f)| {
                        let v = (*d as f64 * f).floor();
                        (v.is_finite() && *f > 0. && v >= 0. && v < i64::MAX as f64)
                            .then_some(v as i64)
                    })
                    .collect::<Option<_>>()?
            }
        }
        "Shape" => {
            let rank = x.len() as i64;
            vec![(clamp_position(attr(n, "end", rank), rank)
                - clamp_position(attr(n, "start", 0), rank))
            .max(0)]
        }
        "Gather" => {
            let a = axis(attr(n, "axis", 0), x.len())?;
            let indices = s.get(n.inputs.get(1)?)?;
            [x[..a].to_vec(), indices.clone(), x[a + 1..].to_vec()].concat()
        }
        "Slice" => slice(n, x, c)?,
        "Unsqueeze" => {
            let axes = input_values(n, c, 1).or_else(|| list(n, "axes"))?;
            let rank = x.len() + axes.len();
            let mut axes = axes
                .iter()
                .map(|v| axis(*v, rank))
                .collect::<Option<Vec<_>>>()?;
            axes.sort_unstable();
            if axes.windows(2).any(|w| w[0] == w[1]) {
                return None;
            }
            let mut out = x.clone();
            for i in axes {
                out.insert(i, 1);
            }
            out
        }
        "Squeeze" => {
            if n.inputs.get(1).is_some_and(|v| !v.is_empty()) && input_values(n, c, 1).is_none() {
                return None;
            }
            let axes = input_values(n, c, 1).or_else(|| list(n, "axes"));
            let axes = match axes {
                Some(v) => v
                    .iter()
                    .map(|v| axis(*v, x.len()))
                    .collect::<Option<Vec<_>>>()?,
                None => x
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| **v == 1)
                    .map(|(i, _)| i)
                    .collect(),
            };
            if axes.iter().any(|i| x[*i] != 1) {
                return None;
            }
            x.iter()
                .enumerate()
                .filter(|(i, _)| !axes.contains(i))
                .map(|(_, v)| *v)
                .collect()
        }
        "Flatten" => {
            let a = attr(n, "axis", 1);
            let a = if a < 0 { a + x.len() as i64 } else { a };
            let a = usize::try_from(a).ok()?;
            if a > x.len() {
                return None;
            }
            vec![product(&x[..a])?, product(&x[a..])?]
        }
        "MatMul" => {
            let y = s.get(n.inputs.get(1)?)?;
            if x.len() < 2 || y.len() < 2 || x[x.len() - 1] != y[y.len() - 2] {
                return None;
            }
            let mut out = broadcast(&x[..x.len() - 2], &y[..y.len() - 2])?;
            out.extend([x[x.len() - 2], y[y.len() - 1]]);
            out
        }
        "ReduceMean" | "ReduceSum" | "ReduceMax" => {
            let axes = if version >= 18 || n.op_type == "ReduceSum" && version >= 13 {
                input_values(n, c, 1)
            } else {
                list(n, "axes")
            };
            if n.inputs.get(1).is_some_and(|v| !v.is_empty()) && axes.is_none() {
                return None;
            }
            let axes = axes.unwrap_or_default();
            if axes.is_empty() && attr(n, "noop_with_empty_axes", 0) == 1 {
                return Some(vec![x.clone()]);
            }
            let axes = if axes.is_empty() {
                (0..x.len()).collect()
            } else {
                axes.iter()
                    .map(|v| axis(*v, x.len()))
                    .collect::<Option<Vec<_>>>()?
            };
            x.iter()
                .enumerate()
                .filter_map(|(i, d)| {
                    if axes.contains(&i) {
                        (attr(n, "keepdims", 1) != 0).then_some(1)
                    } else {
                        Some(*d)
                    }
                })
                .collect()
        }
        _ => return None,
    };
    Some(vec![result])
}

fn spatial(n: &Node, x: &[i64], s: &Shapes) -> Option<Vec<i64>> {
    if x.len() < 3 {
        return None;
    }
    let rank = x.len() - 2;
    let (kernel, channels) = if n.op_type == "Conv" {
        let weight = s.get(n.inputs.get(1)?)?;
        (weight.get(2..)?.to_vec(), *weight.first()?)
    } else {
        (list(n, "kernel_shape")?, x[1])
    };
    let stride = list(n, "strides").unwrap_or(vec![1; rank]);
    let dilation = list(n, "dilations").unwrap_or(vec![1; rank]);
    let pads = list(n, "pads").unwrap_or(vec![0; rank * 2]);
    if kernel.len() != rank
        || stride.len() != rank
        || dilation.len() != rank
        || pads.len() != rank * 2
    {
        return None;
    }
    let mode = n
        .attributes
        .get("auto_pad")
        .and_then(Value::as_str)
        .unwrap_or("NOTSET");
    let mut out = x[..2].to_vec();
    out[1] = channels;
    for i in 0..rank {
        if kernel[i] <= 0 || stride[i] <= 0 || dilation[i] <= 0 || pads[i] < 0 || pads[i + rank] < 0
        {
            return None;
        }
        let d = x[i + 2];
        let size = match mode {
            "SAME_UPPER" | "SAME_LOWER" => d.checked_add(stride[i] - 1)? / stride[i],
            "NOTSET" | "VALID" => {
                let before = if mode == "VALID" { 0 } else { pads[i] };
                let after = if mode == "VALID" { 0 } else { pads[i + rank] };
                let numerator = d
                    .checked_add(before)?
                    .checked_add(after)?
                    .checked_sub(dilation[i].checked_mul(kernel[i] - 1)?)?
                    .checked_sub(1)?;
                let ceil = attr(n, "ceil_mode", 0) != 0;
                let mut v = if ceil {
                    numerator.checked_add(stride[i] - 1)?.div_euclid(stride[i])
                } else {
                    numerator.div_euclid(stride[i])
                }
                .checked_add(1)?;
                if ceil && (v - 1).checked_mul(stride[i])? >= d.checked_add(before)? {
                    v -= 1;
                }
                v
            }
            _ => return None,
        };
        if size < 0 {
            return None;
        }
        out.push(size);
    }
    Some(out)
}

fn slice(n: &Node, x: &[i64], c: &Constants) -> Option<Vec<i64>> {
    let starts = input_values(n, c, 1)?;
    let ends = input_values(n, c, 2)?;
    for i in [3, 4] {
        if n.inputs.get(i).is_some_and(|v| !v.is_empty()) && input_values(n, c, i).is_none() {
            return None;
        }
    }
    let axes = input_values(n, c, 3).unwrap_or_else(|| (0..starts.len() as i64).collect());
    let steps = input_values(n, c, 4).unwrap_or(vec![1; starts.len()]);
    if starts.len() != ends.len() || starts.len() != axes.len() || starts.len() != steps.len() {
        return None;
    }
    let mut out = x.to_vec();
    let mut seen = vec![];
    for i in 0..starts.len() {
        let a = axis(axes[i], x.len())?;
        if seen.contains(&a) || steps[i] <= 0 {
            return None;
        }
        seen.push(a);
        out[a] = clamp_position(ends[i], x[a])
            .saturating_sub(clamp_position(starts[i], x[a]))
            .max(0)
            .checked_add(steps[i] - 1)?
            / steps[i];
    }
    Some(out)
}

fn evaluate(n: &Node, s: &Shapes, c: &Constants, integer_output: bool) -> Option<Vec<f64>> {
    let x = n.inputs.first()?;
    match n.op_type.as_str() {
        "Add" | "Sub" | "Mul" | "Div" if integer_output => {
            let a = input_values(n, c, 0)?;
            let b = input_values(n, c, 1)?;
            if a.len() != b.len() && a.len() != 1 && b.len() != 1 {
                return None;
            }
            let mut out = vec![];
            for i in 0..a.len().max(b.len()) {
                let a = *a.get(if a.len() == 1 { 0 } else { i })?;
                let b = *b.get(if b.len() == 1 { 0 } else { i })?;
                let value = match n.op_type.as_str() {
                    "Add" => a.checked_add(b),
                    "Sub" => a.checked_sub(b),
                    "Mul" => a.checked_mul(b),
                    _ => a.checked_div(b),
                }?;
                if value.unsigned_abs() > 1u64 << 53 {
                    return None;
                }
                out.push(value as f64);
            }
            Some(out)
        }
        "Shape" => {
            let dims = s.get(x)?;
            let rank = dims.len() as i64;
            let start = clamp_position(attr(n, "start", 0), rank) as usize;
            let end = (clamp_position(attr(n, "end", rank), rank) as usize).max(start);
            Some(dims[start..end].iter().map(|d| *d as f64).collect())
        }
        "Gather" if s.get(x)?.len() == 1 && attr(n, "axis", 0) == 0 => {
            let values = c.get(x)?;
            input_values(n, c, 1)?
                .iter()
                .map(|v| values.get(axis(*v, values.len())?).copied())
                .collect()
        }
        "Concat"
            if attr(n, "axis", 0) == 0
                && n.inputs
                    .iter()
                    .all(|x| s.get(x).is_some_and(|s| s.len() == 1)) =>
        {
            let mut out = vec![];
            for x in &n.inputs {
                out.extend(c.get(x)?);
            }
            Some(out)
        }
        "Identity" | "Reshape" | "Unsqueeze" | "Squeeze" => c.get(x).cloned(),
        _ => None,
    }
}
