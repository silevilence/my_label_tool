use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use ort::{
    session::Session,
    value::{TensorElementType, ValueType},
};
use serde::Serialize;

use crate::i18n::zh_cn as text;
use crate::models::prelabel::YoloModelFormat;

pub const MAX_PRELABEL_OUTPUT_ELEMENTS: usize = 10_000_000;
pub const MAX_PRELABEL_OUTPUT_CANDIDATES: usize = 100_000;

#[derive(Clone, Debug, PartialEq)]
pub struct TensorDescriptor {
    pub name: String,
    pub element_type: String,
    pub dimensions: Vec<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTensorContract {
    pub format: YoloModelFormat,
    pub class_count: usize,
    pub input_width: usize,
    pub input_height: usize,
    pub input_name: String,
    pub output_names: Vec<String>,
}

pub fn validate_tensor_contract(
    inputs: &[TensorDescriptor],
    outputs: &[TensorDescriptor],
    format_hint: Option<YoloModelFormat>,
) -> Result<ModelTensorContract, String> {
    if inputs.len() != 1 {
        return Err(text::YOLO_REQUIRES_ONE_INPUT.to_string());
    }
    let input = &inputs[0];
    if input.element_type != "f32"
        || input.dimensions.len() != 4
        || !matches!(input.dimensions[0], 1 | -1)
        || input.dimensions[1] != 3
        || input.dimensions[2] <= 0
        || input.dimensions[3] <= 0
    {
        return Err(text::YOLO_INPUT_CONTRACT.to_string());
    }
    if outputs.is_empty() || outputs.iter().any(|output| output.element_type != "f32") {
        return Err(text::YOLO_OUTPUT_FLOAT.to_string());
    }
    validate_output_resource_budget(outputs)?;

    let (format, class_count) = if outputs.len() == 1 {
        validate_single_output(&outputs[0], format_hint)?
    } else {
        validate_anchor_branches(outputs)?
    };

    Ok(ModelTensorContract {
        format,
        class_count,
        input_width: usize::try_from(input.dimensions[3])
            .map_err(|_| text::YOLO_INPUT_CONTRACT.to_string())?,
        input_height: usize::try_from(input.dimensions[2])
            .map_err(|_| text::YOLO_INPUT_CONTRACT.to_string())?,
        input_name: input.name.clone(),
        output_names: outputs.iter().map(|output| output.name.clone()).collect(),
    })
}

fn validate_output_resource_budget(outputs: &[TensorDescriptor]) -> Result<(), String> {
    let mut total_elements = 0_usize;
    let mut total_candidates = 0_usize;
    for output in outputs {
        if output.dimensions.is_empty()
            || output.dimensions[0] != 1
            || output.dimensions[1..]
                .iter()
                .any(|dimension| *dimension <= 0)
        {
            return Err(text::PRELABEL_OUTPUT_FIXED_SHAPE_REQUIRED.to_string());
        }
        let element_count = output
            .dimensions
            .iter()
            .try_fold(1_usize, |size, dimension| {
                usize::try_from(*dimension)
                    .ok()
                    .and_then(|dimension| size.checked_mul(dimension))
            });
        total_elements = total_elements
            .checked_add(element_count.ok_or_else(|| text::PRELABEL_OUTPUT_TOO_LARGE.to_string())?)
            .ok_or_else(|| text::PRELABEL_OUTPUT_TOO_LARGE.to_string())?;
        let candidates = match output.dimensions.as_slice() {
            [1, first, second] => usize::try_from((*first).max(*second)).ok(),
            [1, anchors, height, width, _] => usize::try_from(*anchors)
                .ok()
                .and_then(|value| value.checked_mul(usize::try_from(*height).ok()?))
                .and_then(|value| value.checked_mul(usize::try_from(*width).ok()?)),
            _ => None,
        }
        .ok_or_else(|| text::YOLO_OUTPUT_CONTRACT.to_string())?;
        total_candidates = total_candidates
            .checked_add(candidates)
            .ok_or_else(|| text::PRELABEL_OUTPUT_TOO_LARGE.to_string())?;
    }
    if total_elements > MAX_PRELABEL_OUTPUT_ELEMENTS
        || total_candidates > MAX_PRELABEL_OUTPUT_CANDIDATES
    {
        return Err(text::PRELABEL_OUTPUT_TOO_LARGE.to_string());
    }
    Ok(())
}

static LOAD_GUARD: Mutex<()> = Mutex::new(());
static LOADED_RUNTIME: OnceLock<PathBuf> = OnceLock::new();

pub fn is_runtime_loaded() -> bool {
    LOADED_RUNTIME.get().is_some()
}

pub fn load_runtime(dll_path: &Path) -> Result<(), String> {
    if let Some(loaded_path) = LOADED_RUNTIME.get() {
        return if loaded_path == dll_path {
            Ok(())
        } else {
            Err(text::runtime_already_loaded(loaded_path))
        };
    }
    let _guard = LOAD_GUARD
        .lock()
        .map_err(|_| text::RUNTIME_LOAD_LOCK_FAILED.to_string())?;
    if let Some(loaded_path) = LOADED_RUNTIME.get() {
        return if loaded_path == dll_path {
            Ok(())
        } else {
            Err(text::runtime_already_loaded(loaded_path))
        };
    }
    if !dll_path.is_file() {
        return Err(text::runtime_missing(dll_path));
    }
    let builder = ort::init_from(dll_path).map_err(text::runtime_load_failed)?;
    builder.commit();
    let _ = LOADED_RUNTIME.set(dll_path.to_path_buf());
    Ok(())
}

pub fn validate_model_with_runtime(
    model_path: &Path,
    format_hint: Option<YoloModelFormat>,
) -> Result<ModelTensorContract, String> {
    let session = Session::builder()
        .map_err(text::runtime_session_failed)?
        .commit_from_file(model_path)
        .map_err(text::model_session_failed)?;
    validate_session_contract(&session, format_hint)
}

pub fn validate_session_contract(
    session: &Session,
    format_hint: Option<YoloModelFormat>,
) -> Result<ModelTensorContract, String> {
    let inputs = session
        .inputs()
        .iter()
        .map(tensor_descriptor)
        .collect::<Result<Vec<_>, _>>()?;
    let outputs = session
        .outputs()
        .iter()
        .map(tensor_descriptor)
        .collect::<Result<Vec<_>, _>>()?;
    validate_tensor_contract(&inputs, &outputs, format_hint)
}

fn tensor_descriptor(outlet: &ort::value::Outlet) -> Result<TensorDescriptor, String> {
    match outlet.dtype() {
        ValueType::Tensor { ty, shape, .. } => Ok(TensorDescriptor {
            name: outlet.name().to_string(),
            element_type: if *ty == TensorElementType::Float32 {
                "f32".to_string()
            } else {
                ty.to_string()
            },
            dimensions: shape.iter().copied().collect(),
        }),
        _ => Err(text::YOLO_OUTPUT_CONTRACT.to_string()),
    }
}

fn validate_single_output(
    output: &TensorDescriptor,
    format_hint: Option<YoloModelFormat>,
) -> Result<(YoloModelFormat, usize), String> {
    let dimensions = &output.dimensions;
    if dimensions.len() != 3 || !matches!(dimensions[0], 1 | -1) {
        return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
    }
    let features_first = dimensions[1];
    let features_last = dimensions[2];
    if (features_last == 6 && (1..=300).contains(&features_first))
        || (features_first == 6 && (1..=300).contains(&features_last))
    {
        return Err(text::YOLO_EMBEDDED_NMS.to_string());
    }
    if features_first > features_last && features_last >= 6 {
        if matches!(
            format_hint,
            Some(YoloModelFormat::YoloV8 | YoloModelFormat::Yolo11)
        ) {
            return Err(text::YOLO_FORMAT_CONFLICT.to_string());
        }
        return Ok((
            YoloModelFormat::YoloV5,
            usize::try_from(features_last - 5)
                .map_err(|_| text::YOLO_OUTPUT_CONTRACT.to_string())?,
        ));
    }
    if features_last > features_first && features_first >= 5 {
        if matches!(format_hint, Some(YoloModelFormat::YoloV5)) {
            return Err(text::YOLO_FORMAT_CONFLICT.to_string());
        }
        return Ok((
            format_hint.unwrap_or(YoloModelFormat::YoloV8),
            usize::try_from(features_first - 4)
                .map_err(|_| text::YOLO_OUTPUT_CONTRACT.to_string())?,
        ));
    }
    Err(text::YOLO_OUTPUT_CONTRACT.to_string())
}

fn validate_anchor_branches(
    outputs: &[TensorDescriptor],
) -> Result<(YoloModelFormat, usize), String> {
    if outputs.len() != 3 {
        return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
    }
    let feature_counts: Option<Vec<i64>> = outputs
        .iter()
        .map(|output| {
            let dimensions = &output.dimensions;
            (dimensions.len() == 5
                && matches!(dimensions[0], 1 | -1)
                && dimensions[1] == 3
                && dimensions[2] > 0
                && dimensions[3] > 0
                && dimensions[4] >= 6)
                .then_some(dimensions[4])
        })
        .collect();
    let feature_counts = feature_counts.ok_or_else(|| text::YOLO_OUTPUT_CONTRACT.to_string())?;
    if feature_counts.windows(2).any(|pair| pair[0] != pair[1]) {
        return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
    }
    Ok((
        YoloModelFormat::YoloV5,
        usize::try_from(feature_counts[0] - 5)
            .map_err(|_| text::YOLO_OUTPUT_CONTRACT.to_string())?,
    ))
}

#[cfg(test)]
mod tests {
    use super::{load_runtime, validate_tensor_contract, TensorDescriptor};
    use crate::models::prelabel::YoloModelFormat;

    fn tensor(name: &str, dimensions: &[i64]) -> TensorDescriptor {
        TensorDescriptor {
            name: name.to_string(),
            element_type: "f32".to_string(),
            dimensions: dimensions.to_vec(),
        }
    }

    #[test]
    fn validates_a_standard_yolov8_or_yolo11_output() {
        let contract = validate_tensor_contract(
            &[tensor("images", &[1, 3, 640, 640])],
            &[tensor("output0", &[1, 84, 8400])],
            Some(YoloModelFormat::Yolo11),
        )
        .unwrap();

        assert_eq!(contract.format, YoloModelFormat::Yolo11);
        assert_eq!(contract.class_count, 80);
        assert_eq!((contract.input_width, contract.input_height), (640, 640));
    }

    #[test]
    fn validates_three_yolov5_anchor_branches() {
        let contract = validate_tensor_contract(
            &[tensor("images", &[1, 3, 640, 640])],
            &[
                tensor("small", &[1, 3, 80, 80, 85]),
                tensor("medium", &[1, 3, 40, 40, 85]),
                tensor("large", &[1, 3, 20, 20, 85]),
            ],
            None,
        )
        .unwrap();

        assert_eq!(contract.format, YoloModelFormat::YoloV5);
        assert_eq!(contract.class_count, 80);
        assert_eq!(contract.output_names, ["small", "medium", "large"]);
    }

    #[test]
    fn rejects_models_with_embedded_nms() {
        let error = validate_tensor_contract(
            &[tensor("images", &[1, 3, 640, 640])],
            &[tensor("output0", &[1, 300, 6])],
            None,
        )
        .unwrap_err();

        assert!(error.contains("NMS"));
        assert!(error.contains("标准导出"));
    }

    #[test]
    fn rejects_non_float_or_non_nchw_inputs() {
        let mut input = tensor("images", &[1, 640, 640, 3]);
        input.element_type = "u8".to_string();

        let error = validate_tensor_contract(&[input], &[tensor("output0", &[1, 84, 8400])], None)
            .unwrap_err();

        assert!(error.contains("NCHW"));
        assert!(error.contains("f32"));
    }

    #[test]
    fn rejects_dynamic_or_oversized_output_resources() {
        let dynamic_error = validate_tensor_contract(
            &[tensor("images", &[1, 3, 640, 640])],
            &[tensor("output0", &[1, 84, -1])],
            Some(YoloModelFormat::YoloV8),
        )
        .unwrap_err();
        assert!(dynamic_error.contains("固定"));

        let oversized_error = validate_tensor_contract(
            &[tensor("images", &[1, 3, 640, 640])],
            &[tensor("output0", &[1, 84, 1_000_000])],
            Some(YoloModelFormat::YoloV8),
        )
        .unwrap_err();
        assert!(oversized_error.contains("过大"));
    }

    #[test]
    fn missing_runtime_error_is_actionable() {
        let missing = std::env::temp_dir().join(format!(
            "my-label-tool-missing-runtime-{}\\onnxruntime.dll",
            std::process::id()
        ));

        let error = load_runtime(&missing).unwrap_err();

        assert!(error.contains("缺少 ONNX Runtime"));
        assert!(error.contains("下载或手动放置"));
        assert!(error.contains("onnxruntime.dll"));
    }
}
