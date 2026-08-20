use serde::Serialize;
use std::collections::BTreeMap;

use crate::i18n::zh_cn as text;
use crate::models::prelabel::YoloModelFormat;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnnxModelSummary {
    pub format: YoloModelFormat,
    pub class_count: usize,
    pub input_width: usize,
    pub input_height: usize,
    pub class_names: Vec<String>,
}

pub fn inspect_onnx_bytes(bytes: &[u8], file_name: &str) -> Result<OnnxModelSummary, String> {
    let graph = bytes_field(bytes, 7)?
        .into_iter()
        .next()
        .ok_or_else(|| text::ONNX_MISSING_GRAPH.to_string())?;
    let input_shape = value_info_shapes(graph, 11)?
        .into_iter()
        .find(|shape| shape.len() == 4)
        .ok_or_else(|| text::ONNX_MISSING_IMAGE_INPUT.to_string())?;
    let output_shapes = value_info_shapes(graph, 12)?;

    let metadata = metadata_properties(bytes)?;
    let description = metadata
        .get("description")
        .map(String::as_str)
        .unwrap_or_default();
    let (format, inferred_class_count) =
        infer_output_contract(description, file_name, &output_shapes)?;
    let parsed_names = metadata
        .get("names")
        .map(|value| parse_class_names(value))
        .transpose()?;
    let class_names = match parsed_names {
        Some(names) if names.is_empty() => placeholder_names(inferred_class_count),
        Some(names) if names.len() != inferred_class_count => {
            return Err(text::onnx_names_count_mismatch(
                names.len(),
                inferred_class_count,
            ));
        }
        Some(names) => names,
        None => placeholder_names(inferred_class_count),
    };
    let class_count = class_names.len();

    let input_height = input_dimension(&input_shape, 2)?;
    let input_width = input_dimension(&input_shape, 3)?;

    Ok(OnnxModelSummary {
        format,
        class_count,
        input_width,
        input_height,
        class_names,
    })
}

#[derive(Clone, Copy)]
enum WireValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

fn protobuf_fields(data: &[u8]) -> Result<Vec<(u32, WireValue<'_>)>, String> {
    let mut fields = Vec::new();
    let mut cursor = 0;
    while cursor < data.len() {
        let key = read_varint(data, &mut cursor)?;
        let field = (key >> 3) as u32;
        match key & 0x07 {
            0 => fields.push((field, WireValue::Varint(read_varint(data, &mut cursor)?))),
            1 => {
                cursor = cursor
                    .checked_add(8)
                    .filter(|value| *value <= data.len())
                    .ok_or_else(|| text::ONNX_FIXED_FIELD_OUT_OF_BOUNDS.to_string())?;
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
                cursor = cursor
                    .checked_add(4)
                    .filter(|value| *value <= data.len())
                    .ok_or_else(|| text::ONNX_FIXED_FIELD_OUT_OF_BOUNDS.to_string())?;
            }
            _ => return Err(text::ONNX_UNSUPPORTED_WIRE_TYPE.to_string()),
        }
    }
    Ok(fields)
}

fn read_varint(data: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value = 0_u64;
    for shift in (0..70).step_by(7) {
        let byte = *data
            .get(*cursor)
            .ok_or_else(|| text::ONNX_TRUNCATED_VARINT.to_string())?;
        *cursor += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err(text::ONNX_INVALID_VARINT.to_string())
}

fn bytes_field(data: &[u8], expected: u32) -> Result<Vec<&[u8]>, String> {
    Ok(protobuf_fields(data)?
        .into_iter()
        .filter_map(|(field, value)| match (field, value) {
            (field, WireValue::Bytes(bytes)) if field == expected => Some(bytes),
            _ => None,
        })
        .collect())
}

fn first_varint(data: &[u8], expected: u32) -> Result<Option<u64>, String> {
    Ok(protobuf_fields(data)?
        .into_iter()
        .find_map(|(field, value)| match (field, value) {
            (field, WireValue::Varint(value)) if field == expected => Some(value),
            _ => None,
        }))
}

fn first_string(data: &[u8], expected: u32) -> Result<Option<String>, String> {
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

fn metadata_properties(model: &[u8]) -> Result<BTreeMap<String, String>, String> {
    let mut properties = BTreeMap::new();
    for entry in bytes_field(model, 14)? {
        if let (Some(key), Some(value)) = (first_string(entry, 1)?, first_string(entry, 2)?) {
            properties.insert(key, value);
        }
    }
    Ok(properties)
}

fn value_info_shapes(graph: &[u8], field: u32) -> Result<Vec<Vec<u64>>, String> {
    bytes_field(graph, field)?
        .into_iter()
        .map(|value_info| {
            let type_proto = bytes_field(value_info, 2)?
                .into_iter()
                .next()
                .ok_or_else(|| text::ONNX_VALUE_INFO_MISSING_TYPE.to_string())?;
            let tensor_type = bytes_field(type_proto, 1)?
                .into_iter()
                .next()
                .ok_or_else(|| text::ONNX_VALUE_NOT_TENSOR.to_string())?;
            let shape = bytes_field(tensor_type, 2)?
                .into_iter()
                .next()
                .ok_or_else(|| text::ONNX_TENSOR_MISSING_SHAPE.to_string())?;
            bytes_field(shape, 1)?
                .into_iter()
                .map(|dimension| Ok(first_varint(dimension, 1)?.unwrap_or(0)))
                .collect()
        })
        .collect()
}

fn detect_format(
    description: &str,
    file_name: &str,
    output: &[u64],
) -> Result<YoloModelFormat, String> {
    let hint = format!("{description} {file_name}").to_ascii_lowercase();
    if hint.contains("yolo11") {
        return Ok(YoloModelFormat::Yolo11);
    }
    if hint.contains("yolov8") || hint.contains("yolo v8") {
        return Ok(YoloModelFormat::YoloV8);
    }
    if hint.contains("yolov5") || hint.contains("yolo v5") {
        return Ok(YoloModelFormat::YoloV5);
    }
    if output[1] > output[2] && (6..=1000).contains(&output[2]) {
        return Ok(YoloModelFormat::YoloV5);
    }
    if (5..=1000).contains(&output[1]) && output[2] > output[1] {
        return Ok(YoloModelFormat::YoloV8);
    }
    Err(text::ONNX_UNRECOGNIZED_YOLO.to_string())
}

fn infer_output_contract(
    description: &str,
    file_name: &str,
    outputs: &[Vec<u64>],
) -> Result<(YoloModelFormat, usize), String> {
    if outputs.iter().any(|shape| {
        matches!(shape.as_slice(), [1, candidates, 6] if (1..=300).contains(candidates))
            || matches!(shape.as_slice(), [1, 6, candidates] if (1..=300).contains(candidates))
    }) {
        return Err(text::YOLO_EMBEDDED_NMS.to_string());
    }
    if outputs.len() == 3
        && outputs.iter().all(|shape| {
            shape.len() == 5
                && shape[0] == 1
                && shape[1] == 3
                && shape[2] > 0
                && shape[3] > 0
                && shape[4] >= 6
        })
        && outputs.windows(2).all(|pair| pair[0][4] == pair[1][4])
    {
        let class_count = usize::try_from(outputs[0][4] - 5)
            .map_err(|_| text::YOLO_CLASS_COUNT_TOO_LARGE.to_string())?;
        return Ok((YoloModelFormat::YoloV5, class_count));
    }

    let output = outputs
        .iter()
        .find(|shape| shape.len() == 3)
        .ok_or_else(|| text::ONNX_MISSING_DETECTION_OUTPUT.to_string())?;
    let format = detect_format(description, file_name, output)?;
    let class_count = infer_class_count(&format, output)?;
    Ok((format, class_count))
}

fn infer_class_count(format: &YoloModelFormat, output: &[u64]) -> Result<usize, String> {
    let raw_count = if matches!(format, YoloModelFormat::YoloV5) {
        output[2].checked_sub(5)
    } else {
        output[1].checked_sub(4)
    }
    .filter(|count| *count > 0)
    .ok_or_else(|| text::YOLO_CLASS_COUNT_UNAVAILABLE.to_string())?;
    usize::try_from(raw_count).map_err(|_| text::YOLO_CLASS_COUNT_TOO_LARGE.to_string())
}

fn placeholder_names(class_count: usize) -> Vec<String> {
    (0..class_count)
        .map(|index| format!("class_{index}"))
        .collect()
}

fn input_dimension(shape: &[u64], index: usize) -> Result<usize, String> {
    usize::try_from(shape[index]).map_err(|_| text::YOLO_INPUT_CONTRACT.to_string())
}

fn parse_class_names(raw: &str) -> Result<Vec<String>, String> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        match value {
            serde_json::Value::Array(values) => {
                return values
                    .into_iter()
                    .map(|value| {
                        value
                            .as_str()
                            .map(str::to_owned)
                            .ok_or_else(|| text::ONNX_NAMES_ARRAY_INVALID.to_string())
                    })
                    .collect();
            }
            serde_json::Value::Object(values) => {
                let mut indexed = BTreeMap::new();
                for (key, value) in values {
                    let index = key
                        .parse::<usize>()
                        .map_err(|_| text::ONNX_NAMES_KEY_INVALID.to_string())?;
                    let name = value
                        .as_str()
                        .ok_or_else(|| text::ONNX_NAMES_VALUE_INVALID.to_string())?;
                    indexed.insert(index, name.to_string());
                }
                return contiguous_names(indexed);
            }
            _ => {}
        }
    }

    let mut indexed = BTreeMap::new();
    for item in raw
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .split(',')
    {
        let (index, name) = item
            .split_once(':')
            .ok_or_else(|| text::ONNX_NAMES_UNPARSABLE.to_string())?;
        let index = index
            .trim()
            .trim_matches(['\'', '"'])
            .parse::<usize>()
            .map_err(|_| text::ONNX_NAMES_INDEX_INVALID.to_string())?;
        let name = name.trim().trim_matches(['\'', '"']);
        if name.is_empty() {
            return Err(text::ONNX_NAMES_EMPTY.to_string());
        }
        indexed.insert(index, name.to_string());
    }
    contiguous_names(indexed)
}

fn contiguous_names(indexed: BTreeMap<usize, String>) -> Result<Vec<String>, String> {
    if indexed.is_empty() || indexed.keys().copied().eq(0..indexed.len()) {
        return Ok(indexed.into_values().collect());
    }
    Err(text::ONNX_NAMES_NOT_CONTIGUOUS.to_string())
}

#[cfg(test)]
mod tests {
    use super::{inspect_onnx_bytes, OnnxModelSummary};
    use crate::models::prelabel::YoloModelFormat;

    fn varint(mut value: u64) -> Vec<u8> {
        let mut bytes = Vec::new();
        loop {
            let mut byte = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            bytes.push(byte);
            if value == 0 {
                return bytes;
            }
        }
    }

    fn length_delimited(field: u64, value: &[u8]) -> Vec<u8> {
        let mut bytes = varint((field << 3) | 2);
        bytes.extend(varint(value.len() as u64));
        bytes.extend(value);
        bytes
    }

    fn varint_field(field: u64, value: u64) -> Vec<u8> {
        let mut bytes = varint(field << 3);
        bytes.extend(varint(value));
        bytes
    }

    fn value_info(name: &str, dimensions: &[u64]) -> Vec<u8> {
        let mut shape = Vec::new();
        for dimension in dimensions {
            shape.extend(length_delimited(1, &varint_field(1, *dimension)));
        }
        let mut tensor = varint_field(1, 1);
        tensor.extend(length_delimited(2, &shape));
        let type_proto = length_delimited(1, &tensor);
        let mut value = length_delimited(1, name.as_bytes());
        value.extend(length_delimited(2, &type_proto));
        value
    }

    fn metadata(key: &str, value: &str) -> Vec<u8> {
        let mut entry = length_delimited(1, key.as_bytes());
        entry.extend(length_delimited(2, value.as_bytes()));
        length_delimited(14, &entry)
    }

    fn model_with_outputs(
        input: &[u64],
        outputs: &[&[u64]],
        description: &str,
        names: Option<&str>,
    ) -> Vec<u8> {
        let mut graph = length_delimited(11, &value_info("images", input));
        for (index, output) in outputs.iter().enumerate() {
            graph.extend(length_delimited(
                12,
                &value_info(&format!("output{index}"), output),
            ));
        }
        let mut model = length_delimited(7, &graph);
        model.extend(metadata("description", description));
        if let Some(names) = names {
            model.extend(metadata("names", names));
        }
        model
    }

    fn model(input: &[u64], output: &[u64], description: &str, names: Option<&str>) -> Vec<u8> {
        model_with_outputs(input, &[output], description, names)
    }

    #[test]
    fn inspects_ultralytics_yolo11_metadata() {
        let bytes = model(
            &[1, 3, 640, 640],
            &[1, 6, 8400],
            "Ultralytics YOLO11n model",
            Some("{0: 'person', 1: 'bicycle'}"),
        );

        assert_eq!(
            inspect_onnx_bytes(&bytes, "yolo11n.onnx").unwrap(),
            OnnxModelSummary {
                format: YoloModelFormat::Yolo11,
                class_count: 2,
                input_width: 640,
                input_height: 640,
                class_names: vec!["person".to_string(), "bicycle".to_string()],
            }
        );
    }

    #[test]
    fn infers_yolov5_classes_and_uses_placeholders_without_names() {
        let bytes = model(&[1, 3, 320, 640], &[1, 12600, 8], "YOLOv5 export", None);

        let summary = inspect_onnx_bytes(&bytes, "custom.onnx").unwrap();

        assert_eq!(summary.format, YoloModelFormat::YoloV5);
        assert_eq!(summary.class_count, 3);
        assert_eq!(summary.input_width, 640);
        assert_eq!(summary.input_height, 320);
        assert_eq!(summary.class_names, vec!["class_0", "class_1", "class_2"]);
    }

    #[test]
    fn inspects_three_branch_yolov5_exports() {
        let small = [1, 3, 80, 80, 8];
        let medium = [1, 3, 40, 40, 8];
        let large = [1, 3, 20, 20, 8];
        let bytes = model_with_outputs(
            &[1, 3, 640, 640],
            &[&small, &medium, &large],
            "YOLOv5 export",
            None,
        );

        let summary = inspect_onnx_bytes(&bytes, "custom.onnx").unwrap();

        assert_eq!(summary.format, YoloModelFormat::YoloV5);
        assert_eq!(summary.class_count, 3);
        assert_eq!(summary.class_names, ["class_0", "class_1", "class_2"]);
    }

    #[test]
    fn inspects_ultralytics_yolov8_metadata() {
        let bytes = model(
            &[1, 3, 640, 640],
            &[1, 7, 8400],
            "Ultralytics YOLOv8n model",
            Some("{0: 'person', 1: 'bicycle', 2: 'car'}"),
        );

        let summary = inspect_onnx_bytes(&bytes, "yolov8n.onnx").unwrap();

        assert_eq!(summary.format, YoloModelFormat::YoloV8);
        assert_eq!(summary.class_count, 3);
        assert_eq!(summary.class_names, vec!["person", "bicycle", "car"]);
    }

    #[test]
    fn rejects_non_detection_output_shapes() {
        let bytes = model(&[1, 3, 224, 224], &[1, 1000], "classifier", None);

        let error = inspect_onnx_bytes(&bytes, "classifier.onnx").unwrap_err();

        assert!(error.contains("YOLO"));
    }

    #[test]
    fn preserves_dynamic_input_dimensions_for_an_import_override() {
        let bytes = model(
            &[1, 3, 0, 0],
            &[1, 84, 8400],
            "Ultralytics YOLOv8 model",
            None,
        );

        let summary = inspect_onnx_bytes(&bytes, "dynamic-yolov8.onnx").unwrap();

        assert_eq!((summary.input_width, summary.input_height), (0, 0));
    }

    #[test]
    fn rejects_embedded_nms_during_metadata_only_import() {
        let bytes = model(
            &[1, 3, 640, 640],
            &[1, 300, 6],
            "Ultralytics YOLOv8 model",
            None,
        );

        let error = inspect_onnx_bytes(&bytes, "nms-yolov8.onnx").unwrap_err();

        assert!(error.contains("NMS"));
        assert!(error.contains("标准导出"));
    }

    #[test]
    fn rejects_names_that_disagree_with_the_detection_tensor() {
        let bytes = model(
            &[1, 3, 640, 640],
            &[1, 84, 8400],
            "Ultralytics YOLO11n model",
            Some("{0: 'person', 1: 'bicycle'}"),
        );

        let error = inspect_onnx_bytes(&bytes, "yolo11n.onnx").unwrap_err();

        assert!(error.contains("2 个类"));
        assert!(error.contains("80 个类"));
    }

    #[test]
    #[ignore = "requires an external official Ultralytics ONNX fixture"]
    fn inspects_official_ultralytics_model_when_fixture_is_available() {
        let path = std::env::var("MY_LABEL_TOOL_YOLO_ONNX")
            .expect("MY_LABEL_TOOL_YOLO_ONNX must point to an official YOLO ONNX model");
        let fixture_path = std::path::PathBuf::from(path);
        let fixture_path = if fixture_path.is_absolute() {
            fixture_path
        } else {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(fixture_path)
        };
        let bytes = std::fs::read(fixture_path).unwrap();

        let summary = inspect_onnx_bytes(&bytes, "yolo11n.onnx").unwrap();

        assert_eq!(summary.format, YoloModelFormat::Yolo11);
        assert_eq!(summary.class_count, 80);
        assert_eq!((summary.input_width, summary.input_height), (640, 640));
        assert_eq!(
            summary.class_names.first().map(String::as_str),
            Some("person")
        );
        assert_eq!(
            summary.class_names.last().map(String::as_str),
            Some("toothbrush")
        );
    }
}
