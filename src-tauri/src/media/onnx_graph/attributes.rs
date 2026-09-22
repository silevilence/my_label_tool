use super::proto_types::{attribute as attr_type, tensor as data_type};
use super::Weight;
use crate::{i18n::zh_cn as text, media::onnx_wire::*};
use serde_json::{json, Value};

pub(super) fn ints(raw: &[u8], field: u32) -> Result<Vec<i64>, String> {
    let mut result = vec![];
    for (key, value) in protobuf_fields(raw)? {
        if key != field {
            continue;
        }
        match value {
            WireValue::Varint(v) => result.push(v as i64),
            WireValue::Bytes(bytes) => {
                let mut cursor = 0;
                while cursor < bytes.len() {
                    result.push(read_varint(bytes, &mut cursor)? as i64);
                }
            }
            _ => return Err(text::ONNX_GRAPH_INVALID_FIELD.into()),
        }
    }
    Ok(result)
}

pub(super) fn floats(raw: &[u8], field: u32) -> Result<Vec<f32>, String> {
    let mut result = vec![];
    for (key, value) in protobuf_fields(raw)? {
        if key != field {
            continue;
        }
        match value {
            WireValue::Fixed32(v) => result.push(f32::from_le_bytes(v)),
            WireValue::Bytes(bytes) if bytes.len() % 4 == 0 => {
                for chunk in bytes.chunks_exact(4) {
                    result.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                }
            }
            _ => return Err(text::ONNX_GRAPH_INVALID_FIELD.into()),
        }
    }
    Ok(result)
}

pub(super) fn weight(raw: &[u8]) -> Result<Weight, String> {
    let shape = ints(raw, 1)?;
    if shape.iter().any(|v| *v < 0) {
        return Err(text::ONNX_GRAPH_INVALID_SHAPE.into());
    }
    let data_type = first_varint(raw, 2)?.ok_or(text::ONNX_GRAPH_INVALID_FIELD)?;
    let bits = data_type::bits(data_type);
    let count = shape.iter().try_fold(1u64, |n, v| n.checked_mul(*v as u64));
    let byte_size = count
        .zip(bits)
        .and_then(|(n, b)| n.checked_mul(b)?.checked_add(7).map(|v| v / 8));
    if bits.is_some() && byte_size.is_none() {
        return Err(text::ONNX_GRAPH_INVALID_SHAPE.into());
    }
    if let Some(raw_data) = bytes_field(raw, 9)?.first() {
        if byte_size.is_some_and(|expected| expected != raw_data.len() as u64) {
            return Err(text::ONNX_GRAPH_INVALID_FIELD.into());
        }
    }
    Ok(Weight {
        name: first_string(raw, 8)?.unwrap_or_default(),
        shape,
        data_type,
        byte_size,
        external: first_varint(raw, 14)? == Some(1),
    })
}

pub(super) fn attribute(raw: &[u8]) -> Result<Value, String> {
    Ok(match first_varint(raw, 20)?.unwrap_or(0) {
        attr_type::FLOAT => floats(raw, 2)?
            .first()
            .map(|v| json!(v))
            .unwrap_or(Value::Null),
        attr_type::INT => first_varint(raw, 3)?
            .map(|v| json!(v as i64))
            .unwrap_or(Value::Null),
        attr_type::STRING => json!(first_string(raw, 4)?),
        attr_type::TENSOR => match bytes_field(raw, 5)?.first() {
            Some(t) => json!(weight(t)?),
            None => Value::Null,
        },
        attr_type::FLOATS => json!(floats(raw, 7)?),
        attr_type::INTS => json!(ints(raw, 8)?),
        attr_type::STRINGS => json!(super::strings(raw, 9)?),
        attr_type::TENSORS => json!(bytes_field(raw, 10)?
            .iter()
            .map(|t| weight(t))
            .collect::<Result<Vec<_>, _>>()?),
        kind => json!({ "attributeType": kind, "messageBytes": raw.len() }),
    })
}

/// Small shape/scale constants stay inside the parser, never serialized over IPC.
/// Large tensors are deliberately not decoded or copied.
pub(super) fn numbers(raw: &[u8]) -> Result<Option<Vec<f64>>, String> {
    let w = weight(raw)?;
    let count = w
        .shape
        .iter()
        .try_fold(1usize, |n, d| n.checked_mul(*d as usize));
    let Some(count) = count.filter(|n| *n <= 128) else {
        return Ok(None);
    };
    if w.external {
        return Ok(None);
    }
    let values = if let Some(data) = bytes_field(raw, 9)?.first() {
        let size = match w.data_type {
            data_type::FLOAT | data_type::INT32 => 4,
            data_type::INT64 | data_type::DOUBLE => 8,
            _ => return Ok(None),
        };
        if data.len() != count * size {
            return Err(text::ONNX_GRAPH_INVALID_FIELD.into());
        }
        if w.data_type == data_type::INT64
            && data.chunks_exact(8).any(|chunk| {
                let mut bytes = [0; 8];
                bytes.copy_from_slice(chunk);
                i64::from_le_bytes(bytes).unsigned_abs() > 1u64 << 53
            })
        {
            return Ok(None);
        }
        data.chunks_exact(size)
            .map(|chunk| {
                let mut bytes = [0; 8];
                bytes[..size].copy_from_slice(chunk);
                match w.data_type {
                    data_type::FLOAT => {
                        f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64
                    }
                    data_type::INT32 => {
                        i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64
                    }
                    data_type::INT64 => i64::from_le_bytes(bytes) as f64,
                    _ => f64::from_le_bytes(bytes),
                }
            })
            .collect::<Vec<_>>()
    } else {
        match w.data_type {
            data_type::FLOAT => floats(raw, 4)?.into_iter().map(f64::from).collect(),
            data_type::INT32 => ints(raw, 5)?.into_iter().map(|v| v as f64).collect(),
            data_type::INT64 => {
                let values = ints(raw, 7)?;
                if values.iter().any(|v| v.unsigned_abs() > 1u64 << 53) {
                    return Ok(None);
                }
                values.into_iter().map(|v| v as f64).collect()
            }
            data_type::DOUBLE => {
                let mut values = vec![];
                for (key, value) in protobuf_fields(raw)? {
                    if key == 10 {
                        match value {
                            WireValue::Fixed64(v) => values.push(f64::from_le_bytes(v)),
                            WireValue::Bytes(bytes) if bytes.len() % 8 == 0 => {
                                for chunk in bytes.chunks_exact(8) {
                                    let mut bytes = [0; 8];
                                    bytes.copy_from_slice(chunk);
                                    values.push(f64::from_le_bytes(bytes));
                                }
                            }
                            _ => return Err(text::ONNX_GRAPH_INVALID_FIELD.into()),
                        }
                    }
                }
                values
            }
            _ => return Ok(None),
        }
    };
    Ok((values.len() == count
        && values
            .iter()
            .all(|v| v.is_finite() && v.abs() <= (1u64 << 53) as f64))
    .then_some(values))
}
