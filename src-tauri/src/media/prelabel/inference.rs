use std::{fs::File, io::Read, path::Path};

use ort::{session::Session, value::Tensor};

use crate::{
    i18n::zh_cn as text,
    media::prelabel::{
        pipeline::{decode_outputs, preprocess_image, Detection, RawTensor},
        runtime::{validate_session_contract, MAX_PRELABEL_OUTPUT_ELEMENTS},
    },
    models::prelabel::{PrelabelModelConfig, YoloModelFormat},
};

pub struct PrelabelSession {
    session: Session,
    format: YoloModelFormat,
    input_width: usize,
    input_height: usize,
    confidence_threshold: f32,
    iou_threshold: f32,
}

const MAX_ENCODED_IMAGE_BYTES: usize = 128 * 1024 * 1024;

impl PrelabelSession {
    pub fn from_config(config: &PrelabelModelConfig) -> Result<Self, String> {
        validate_config_basics(config)?;
        let session = Session::builder()
            .map_err(text::runtime_session_failed)?
            .commit_from_file(&config.path)
            .map_err(text::model_session_failed)?;
        let contract = validate_session_contract(&session, Some(config.format.clone()))?;
        validate_contract_class_count(config, contract.class_count)?;
        let [input_width, input_height] =
            resolve_input_size(config.input_size_override, &contract)?;
        Ok(Self {
            session,
            format: contract.format,
            input_width,
            input_height,
            confidence_threshold: config.confidence_threshold,
            iou_threshold: config.iou_threshold,
        })
    }

    pub fn infer_file(&mut self, image_path: &Path) -> Result<Vec<Detection>, String> {
        let bytes = read_image_file_limited(image_path)?;
        self.infer_bytes(&bytes)
    }

    pub fn infer_bytes(&mut self, image_bytes: &[u8]) -> Result<Vec<Detection>, String> {
        validate_encoded_image_length(image_bytes.len())?;
        let prepared = preprocess_image(image_bytes, self.input_width, self.input_height)?;
        let input = Tensor::from_array((prepared.shape, prepared.tensor.into_boxed_slice()))
            .map_err(text::prelabel_input_tensor_failed)?;
        let outputs = self
            .session
            .run(ort::inputs![input])
            .map_err(text::prelabel_inference_failed)?;
        let mut total_elements = 0_usize;
        let raw_outputs = outputs
            .values()
            .map(|output| {
                let array = output
                    .try_extract_array::<f32>()
                    .map_err(text::prelabel_output_tensor_failed)?;
                total_elements = total_elements
                    .checked_add(array.len())
                    .ok_or_else(|| text::PRELABEL_OUTPUT_TOO_LARGE.to_string())?;
                if total_elements > MAX_PRELABEL_OUTPUT_ELEMENTS {
                    return Err(text::PRELABEL_OUTPUT_TOO_LARGE.to_string());
                }
                let mut data = Vec::new();
                data.try_reserve_exact(array.len())
                    .map_err(text::prelabel_output_allocation_failed)?;
                data.extend(array.iter().copied());
                Ok(RawTensor {
                    shape: array.shape().to_vec(),
                    data,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        decode_outputs(
            self.format.clone(),
            &raw_outputs,
            &prepared.transform,
            self.confidence_threshold,
            self.iou_threshold,
        )
    }
}

fn resolve_input_size(
    input_size_override: Option<[usize; 2]>,
    contract: &crate::media::prelabel::runtime::ModelTensorContract,
) -> Result<[usize; 2], String> {
    let resolved = input_size_override.unwrap_or([contract.input_width, contract.input_height]);
    if resolved[0] == 0 || resolved[1] == 0 {
        return Err(text::PRELABEL_DYNAMIC_INPUT_OVERRIDE_REQUIRED.to_string());
    }
    if (contract.input_width > 0 && resolved[0] != contract.input_width)
        || (contract.input_height > 0 && resolved[1] != contract.input_height)
    {
        return Err(text::prelabel_static_input_override(
            contract.input_width,
            contract.input_height,
        ));
    }
    Ok(resolved)
}

fn read_image_file_limited(image_path: &Path) -> Result<Vec<u8>, String> {
    let metadata = std::fs::metadata(image_path)
        .map_err(|error| text::prelabel_image_read_failed(image_path, error))?;
    let length = usize::try_from(metadata.len())
        .map_err(|_| text::PRELABEL_ENCODED_IMAGE_TOO_LARGE.to_string())?;
    validate_encoded_image_length(length)?;

    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(length)
        .map_err(|error| text::prelabel_image_file_allocation_failed(image_path, error))?;
    bytes.resize(length, 0);
    let mut file = File::open(image_path)
        .map_err(|error| text::prelabel_image_read_failed(image_path, error))?;
    file.read_exact(&mut bytes)
        .map_err(|error| text::prelabel_image_read_failed(image_path, error))?;
    let mut trailing = [0_u8; 1];
    if file
        .read(&mut trailing)
        .map_err(|error| text::prelabel_image_read_failed(image_path, error))?
        != 0
    {
        return Err(text::PRELABEL_ENCODED_IMAGE_TOO_LARGE.to_string());
    }
    Ok(bytes)
}

fn validate_encoded_image_length(length: usize) -> Result<(), String> {
    if length > MAX_ENCODED_IMAGE_BYTES {
        Err(text::PRELABEL_ENCODED_IMAGE_TOO_LARGE.to_string())
    } else {
        Ok(())
    }
}

fn validate_config_basics(config: &PrelabelModelConfig) -> Result<(), String> {
    if !(0.0..=1.0).contains(&config.confidence_threshold)
        || !(0.0..=1.0).contains(&config.iou_threshold)
    {
        return Err(text::PRELABEL_THRESHOLD_INVALID.to_string());
    }
    if config.class_count == 0 || config.class_names.len() != config.class_count {
        return Err(text::prelabel_class_names_count_mismatch(
            config.class_count,
            config.class_names.len(),
        ));
    }
    Ok(())
}

fn validate_contract_class_count(
    config: &PrelabelModelConfig,
    runtime_class_count: usize,
) -> Result<(), String> {
    if config.class_count != runtime_class_count {
        return Err(text::prelabel_model_class_count_mismatch(
            config.class_count,
            runtime_class_count,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        resolve_input_size, validate_config_basics, validate_contract_class_count,
        validate_encoded_image_length, PrelabelSession, MAX_ENCODED_IMAGE_BYTES,
    };
    use crate::{
        media::prelabel::runtime::{load_runtime, ModelTensorContract},
        models::prelabel::{PrelabelModelConfig, YoloModelFormat},
    };

    #[test]
    #[ignore = "requires external ONNX Runtime and ignored official YOLOv8/image fixtures"]
    fn reuses_a_session_and_matches_official_yolov8_expectations() {
        let runtime = fixture("MY_LABEL_TOOL_ORT_DLL");
        let image = fixture("MY_LABEL_TOOL_YOLO_IMAGE");
        load_runtime(&runtime).unwrap();

        let mut yolov8 = PrelabelSession::from_config(&config(
            fixture("MY_LABEL_TOOL_YOLOV8_ONNX"),
            YoloModelFormat::YoloV8,
            0.25,
        ))
        .unwrap();
        let first = yolov8.infer_file(&image).unwrap();
        let second = yolov8.infer_file(&image).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 5);
        assert_eq!(
            first
                .iter()
                .map(|item| item.class_index)
                .collect::<Vec<_>>(),
            [0, 0, 0, 5, 0]
        );
        assert!((first[0].confidence - 0.890_207).abs() < 0.02);
        assert_box_close(first[0].points, [670.449, 380.558, 139.47, 499.093], 5.0);
    }

    #[test]
    #[ignore = "requires external ONNX Runtime and official YOLOv5 ONNX/image fixtures"]
    fn matches_the_yolov5_fixture_expectations() {
        let runtime = fixture("MY_LABEL_TOOL_ORT_DLL");
        let image = fixture("MY_LABEL_TOOL_YOLO_IMAGE");
        load_runtime(&runtime).unwrap();

        let mut yolov5 = PrelabelSession::from_config(&config(
            fixture("MY_LABEL_TOOL_YOLOV5_ONNX"),
            YoloModelFormat::YoloV5,
            0.3,
        ))
        .unwrap();
        let v5_first = yolov5.infer_file(&image).unwrap();
        let v5_second = yolov5.infer_file(&image).unwrap();
        assert_eq!(v5_first, v5_second);
        assert_eq!(v5_first.len(), 4);
        assert_eq!(
            v5_first
                .iter()
                .map(|item| item.class_index)
                .collect::<Vec<_>>(),
            [0, 0, 0, 5]
        );
        assert!((v5_first[0].confidence - 0.812_13).abs() < 0.02);
        assert_box_close(v5_first[0].points, [49.944, 398.806, 156.785, 498.689], 5.0);
    }

    #[test]
    fn rejects_invalid_thresholds_and_class_tables_before_loading_a_model() {
        let mut invalid_threshold = config(
            PathBuf::from("not-loaded.onnx"),
            YoloModelFormat::YoloV8,
            1.5,
        );
        assert!(validate_config_basics(&invalid_threshold)
            .unwrap_err()
            .contains("0 到 1"));

        invalid_threshold.confidence_threshold = 0.25;
        invalid_threshold.class_names.pop();
        assert!(validate_config_basics(&invalid_threshold)
            .unwrap_err()
            .contains("类名"));

        let valid = config(
            PathBuf::from("not-loaded.onnx"),
            YoloModelFormat::YoloV8,
            0.25,
        );
        assert!(validate_contract_class_count(&valid, 79)
            .unwrap_err()
            .contains("重新导入"));
    }

    #[test]
    fn rejects_oversized_encoded_images_before_allocating_or_decoding() {
        assert!(validate_encoded_image_length(MAX_ENCODED_IMAGE_BYTES + 1)
            .unwrap_err()
            .contains("编码文件"));
    }

    #[test]
    fn resolves_dynamic_input_overrides_but_rejects_static_dimension_changes() {
        let dynamic = contract(0, 0);
        assert_eq!(
            resolve_input_size(Some([1280, 736]), &dynamic).unwrap(),
            [1280, 736]
        );
        assert!(resolve_input_size(None, &dynamic)
            .unwrap_err()
            .contains("动态输入"));

        let static_contract = contract(640, 640);
        assert_eq!(
            resolve_input_size(None, &static_contract).unwrap(),
            [640, 640]
        );
        assert!(resolve_input_size(Some([1280, 640]), &static_contract)
            .unwrap_err()
            .contains("固定"));
    }

    fn contract(input_width: usize, input_height: usize) -> ModelTensorContract {
        ModelTensorContract {
            format: YoloModelFormat::YoloV8,
            class_count: 80,
            input_width,
            input_height,
            input_name: "images".to_string(),
            output_names: vec!["output0".to_string()],
        }
    }

    fn config(path: PathBuf, format: YoloModelFormat, confidence: f32) -> PrelabelModelConfig {
        PrelabelModelConfig {
            id: "test-model".to_string(),
            name: "test model".to_string(),
            path: path.to_string_lossy().into_owned(),
            format,
            class_count: 80,
            input_width: 640,
            input_height: 640,
            input_size_override: None,
            class_names: (0..80).map(|index| format!("class_{index}")).collect(),
            confidence_threshold: confidence,
            iou_threshold: 0.7,
            added_at: "2026-08-20T00:00:00.000Z".to_string(),
        }
    }

    fn fixture(name: &str) -> PathBuf {
        let value = std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"));
        let path = PathBuf::from(value);
        if path.is_absolute() {
            path
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("workspace root")
                .join(path)
        }
    }

    fn assert_box_close(actual: [f32; 4], expected: [f32; 4], tolerance: f32) {
        for (actual, expected) in actual.into_iter().zip(expected) {
            assert!(
                (actual - expected).abs() <= tolerance,
                "box coordinate {actual} differs from official result {expected}"
            );
        }
    }
}
