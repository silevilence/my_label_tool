//! Shared protobuf wire decoder for ONNX metadata and graph inspection.
use crate::i18n::zh_cn as text;

#[derive(Clone, Copy)]
pub(crate) enum WireValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed32([u8; 4]),
    Fixed64([u8; 8]),
}

pub(crate) fn protobuf_fields(data: &[u8]) -> Result<Vec<(u32, WireValue<'_>)>, String> {
    let mut fields = Vec::new();
    let mut cursor = 0;
    while cursor < data.len() {
        let key = read_varint(data, &mut cursor)?;
        if key >> 3 == 0 || key >> 3 > 0x1fff_ffff {
            return Err(text::onnx_graph_error(
                text::ONNX_CONTEXT_WIRE,
                cursor,
                text::ONNX_GRAPH_INVALID_FIELD,
            ));
        }
        let field = (key >> 3) as u32;
        match key & 0x07 {
            0 => fields.push((field, WireValue::Varint(read_varint(data, &mut cursor)?))),
            1 => {
                let end = cursor
                    .checked_add(8)
                    .filter(|end| *end <= data.len())
                    .ok_or_else(|| {
                        text::onnx_graph_error(
                            text::ONNX_CONTEXT_WIRE,
                            cursor,
                            text::ONNX_FIXED_FIELD_OUT_OF_BOUNDS,
                        )
                    })?;
                let mut value = [0; 8];
                value.copy_from_slice(&data[cursor..end]);
                fields.push((field, WireValue::Fixed64(value)));
                cursor = end;
            }
            2 => {
                let length = usize::try_from(read_varint(data, &mut cursor)?)
                    .map_err(|_| text::ONNX_FIELD_TOO_LARGE.to_string())?;
                let end = cursor
                    .checked_add(length)
                    .filter(|value| *value <= data.len())
                    .ok_or_else(|| text::ONNX_FIELD_OUT_OF_BOUNDS.to_string())?;
                fields.push((field, WireValue::Bytes(&data[cursor..end])));
                cursor = end;
            }
            5 => {
                let end = cursor
                    .checked_add(4)
                    .filter(|end| *end <= data.len())
                    .ok_or_else(|| {
                        text::onnx_graph_error(
                            text::ONNX_CONTEXT_WIRE,
                            cursor,
                            text::ONNX_FIXED_FIELD_OUT_OF_BOUNDS,
                        )
                    })?;
                let mut value = [0; 4];
                value.copy_from_slice(&data[cursor..end]);
                fields.push((field, WireValue::Fixed32(value)));
                cursor = end;
            }
            _ => return Err(text::ONNX_UNSUPPORTED_WIRE_TYPE.to_string()),
        }
    }
    Ok(fields)
}

pub(crate) fn read_varint(data: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0_u64;
    for shift in (0..70).step_by(7) {
        let byte = *data
            .get(*cursor)
            .ok_or_else(|| text::ONNX_TRUNCATED_VARINT.to_string())?;
        *cursor += 1;
        if shift == 63 && byte > 1 {
            return Err(text::ONNX_INVALID_VARINT.to_string());
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err(text::ONNX_INVALID_VARINT.to_string())
}

pub(crate) fn bytes_field(data: &[u8], expected: u32) -> Result<Vec<&[u8]>, String> {
    Ok(protobuf_fields(data)?
        .into_iter()
        .filter_map(|(field, value)| match (field, value) {
            (field, WireValue::Bytes(bytes)) if field == expected => Some(bytes),
            _ => None,
        })
        .collect())
}

pub(crate) fn first_varint(data: &[u8], expected: u32) -> Result<Option<u64>, String> {
    Ok(protobuf_fields(data)?
        .into_iter()
        .find_map(|(field, value)| match (field, value) {
            (field, WireValue::Varint(value)) if field == expected => Some(value),
            _ => None,
        }))
}

pub(crate) fn first_string(data: &[u8], expected: u32) -> Result<Option<String>, String> {
    bytes_field(data, expected)?
        .into_iter()
        .next()
        .map(|bytes| {
            std::str::from_utf8(bytes)
                .map(str::to_owned)
                .map_err(|_| text::ONNX_METADATA_INVALID_UTF8.to_string())
        })
        .transpose()
}

/// Preserve the protobuf distinction between a known value, a symbol and an absent value.
/// Import metadata may project unknown dimensions to its existing zero sentinel;
/// the inspector retains symbols for display. Both consume this same decoder.
pub(crate) enum TensorDimension {
    Known(u64),
    Symbol(String),
    Unknown,
}

pub(crate) fn tensor_dimensions(shape: &[u8]) -> Result<Vec<TensorDimension>, String> {
    bytes_field(shape, 1)?
        .into_iter()
        .map(|dimension| {
            Ok(if let Some(value) = first_varint(dimension, 1)? {
                TensorDimension::Known(value)
            } else if let Some(symbol) = first_string(dimension, 2)? {
                TensorDimension::Symbol(symbol)
            } else {
                TensorDimension::Unknown
            })
        })
        .collect()
}
