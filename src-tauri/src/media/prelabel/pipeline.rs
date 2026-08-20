use std::io::Cursor;

use serde::Serialize;

use crate::i18n::zh_cn as text;
use crate::models::prelabel::YoloModelFormat;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub class_index: usize,
    pub confidence: f32,
    pub points: [f32; 4],
}

#[derive(Clone, Debug, PartialEq)]
pub struct LetterboxTransform {
    pub original_width: u32,
    pub original_height: u32,
    pub input_width: usize,
    pub input_height: usize,
    pub scale: f32,
    pub pad_x: f32,
    pub pad_y: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PreparedImage {
    pub tensor: Vec<f32>,
    pub shape: [usize; 4],
    pub transform: LetterboxTransform,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RawTensor {
    pub shape: Vec<usize>,
    pub data: Vec<f32>,
}

pub fn preprocess_image(
    image_bytes: &[u8],
    input_width: usize,
    input_height: usize,
) -> Result<PreparedImage, String> {
    const MAX_INPUT_EDGE: usize = 4_096;
    const MAX_INPUT_PIXELS: usize = 16_777_216;
    if input_width > MAX_INPUT_EDGE
        || input_height > MAX_INPUT_EDGE
        || input_width
            .checked_mul(input_height)
            .is_none_or(|pixels| pixels > MAX_INPUT_PIXELS)
    {
        return Err(text::PRELABEL_INPUT_SIZE_TOO_LARGE.to_string());
    }
    let target_width = u32::try_from(input_width)
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| text::PRELABEL_INPUT_SIZE_INVALID.to_string())?;
    let target_height = u32::try_from(input_height)
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| text::PRELABEL_INPUT_SIZE_INVALID.to_string())?;
    let dimensions_reader = image::ImageReader::new(Cursor::new(image_bytes))
        .with_guessed_format()
        .map_err(text::prelabel_image_decode_failed)?;
    let (source_width, source_height) = dimensions_reader
        .into_dimensions()
        .map_err(text::prelabel_image_decode_failed)?;
    validate_source_rgb_budget(source_width, source_height)?;
    let mut reader = image::ImageReader::new(Cursor::new(image_bytes))
        .with_guessed_format()
        .map_err(text::prelabel_image_decode_failed)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8_192);
    limits.max_image_height = Some(8_192);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let source = reader
        .decode()
        .map_err(text::prelabel_image_decode_failed)?
        .to_rgb8();
    let original_width = source.width();
    let original_height = source.height();
    if original_width == 0 || original_height == 0 {
        return Err(text::PRELABEL_EMPTY_IMAGE.to_string());
    }

    let scale = (target_width as f32 / original_width as f32)
        .min(target_height as f32 / original_height as f32);
    let resized_width = (original_width as f32 * scale).round().max(1.0) as u32;
    let resized_height = (original_height as f32 * scale).round().max(1.0) as u32;
    let resized = image::imageops::resize(
        &source,
        resized_width,
        resized_height,
        image::imageops::FilterType::Triangle,
    );
    let pad_width = target_width - resized_width;
    let pad_height = target_height - resized_height;
    let left = ((pad_width as f32 / 2.0) - 0.1).round().max(0.0) as u32;
    let top = ((pad_height as f32 / 2.0) - 0.1).round().max(0.0) as u32;
    let canvas_length = input_width
        .checked_mul(input_height)
        .and_then(|pixels| pixels.checked_mul(3))
        .ok_or_else(|| text::PRELABEL_INPUT_SIZE_INVALID.to_string())?;
    let mut canvas_bytes = Vec::new();
    canvas_bytes
        .try_reserve_exact(canvas_length)
        .map_err(text::prelabel_allocation_failed)?;
    canvas_bytes.resize(canvas_length, 114);
    let mut canvas = image::RgbImage::from_raw(target_width, target_height, canvas_bytes)
        .ok_or_else(|| text::PRELABEL_INPUT_SIZE_INVALID.to_string())?;
    image::imageops::replace(&mut canvas, &resized, i64::from(left), i64::from(top));

    let plane = input_width
        .checked_mul(input_height)
        .ok_or_else(|| text::PRELABEL_INPUT_SIZE_INVALID.to_string())?;
    let tensor_length = plane
        .checked_mul(3)
        .ok_or_else(|| text::PRELABEL_INPUT_SIZE_INVALID.to_string())?;
    let mut tensor = Vec::new();
    tensor
        .try_reserve_exact(tensor_length)
        .map_err(text::prelabel_allocation_failed)?;
    tensor.resize(tensor_length, 0.0_f32);
    for (x, y, pixel) in canvas.enumerate_pixels() {
        let position = y as usize * input_width + x as usize;
        tensor[position] = f32::from(pixel[0]) / 255.0;
        tensor[plane + position] = f32::from(pixel[1]) / 255.0;
        tensor[plane * 2 + position] = f32::from(pixel[2]) / 255.0;
    }

    Ok(PreparedImage {
        tensor,
        shape: [1, 3, input_height, input_width],
        transform: LetterboxTransform {
            original_width,
            original_height,
            input_width,
            input_height,
            scale,
            pad_x: left as f32,
            pad_y: top as f32,
        },
    })
}

fn validate_source_rgb_budget(width: u32, height: u32) -> Result<(), String> {
    let source_rgb_bytes = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(3))
        .ok_or_else(|| text::PRELABEL_SOURCE_IMAGE_TOO_LARGE.to_string())?;
    if source_rgb_bytes > 128 * 1024 * 1024 {
        return Err(text::PRELABEL_SOURCE_IMAGE_TOO_LARGE.to_string());
    }
    Ok(())
}

pub fn decode_outputs(
    format: YoloModelFormat,
    outputs: &[RawTensor],
    transform: &LetterboxTransform,
    confidence_threshold: f32,
    iou_threshold: f32,
) -> Result<Vec<Detection>, String> {
    if !(0.0..=1.0).contains(&confidence_threshold) || !(0.0..=1.0).contains(&iou_threshold) {
        return Err(text::PRELABEL_THRESHOLD_INVALID.to_string());
    }
    for output in outputs {
        validate_tensor_data(output)?;
    }
    let candidates = match (format, outputs) {
        (YoloModelFormat::YoloV5, [output]) => decode_v5_single(output, confidence_threshold)?,
        (YoloModelFormat::YoloV5, outputs) if outputs.len() == 3 => {
            decode_v5_branches(outputs, transform, confidence_threshold)?
        }
        (YoloModelFormat::YoloV8 | YoloModelFormat::Yolo11, [output]) => {
            decode_v8_single(output, confidence_threshold)?
        }
        _ => return Err(text::YOLO_OUTPUT_CONTRACT.to_string()),
    };
    let restored = candidates
        .into_iter()
        .filter_map(|candidate| restore_detection(candidate, transform))
        .collect();
    Ok(non_max_suppression(restored, iou_threshold))
}

fn validate_tensor_data(output: &RawTensor) -> Result<(), String> {
    let expected = output
        .shape
        .iter()
        .try_fold(1_usize, |size, dimension| size.checked_mul(*dimension))
        .ok_or_else(|| text::PRELABEL_OUTPUT_SIZE_INVALID.to_string())?;
    if expected != output.data.len() {
        return Err(text::prelabel_output_length_mismatch(
            expected,
            output.data.len(),
        ));
    }
    Ok(())
}

fn decode_v8_single(
    output: &RawTensor,
    confidence_threshold: f32,
) -> Result<Vec<Detection>, String> {
    let [batch, first, second] = output.shape.as_slice() else {
        return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
    };
    if *batch != 1 {
        return Err(text::PRELABEL_BATCH_SIZE_INVALID.to_string());
    }
    let (features, candidates, features_first) = if first < second {
        (*first, *second, true)
    } else {
        (*second, *first, false)
    };
    if features < 5 {
        return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
    }
    let value = |candidate: usize, feature: usize| {
        if features_first {
            output.data[feature * candidates + candidate]
        } else {
            output.data[candidate * features + feature]
        }
    };
    let scores_are_probabilities = score_matrix_is_probabilities(candidates, 4, features, value);
    let mut detections = Vec::new();
    for candidate in 0..candidates {
        let (class_index, confidence) = (4..features)
            .map(|feature| {
                (
                    feature - 4,
                    activate_score(value(candidate, feature), scores_are_probabilities),
                )
            })
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .ok_or_else(|| text::YOLO_CLASS_COUNT_UNAVAILABLE.to_string())?;
        if confidence >= confidence_threshold {
            // Standard Ultralytics exports already include the class sigmoid. Compatible raw
            // exports may expose logits, which `activate_score` converts with the same sigmoid.
            detections.push(model_detection(
                class_index,
                confidence,
                value(candidate, 0),
                value(candidate, 1),
                value(candidate, 2),
                value(candidate, 3),
            ));
        }
    }
    Ok(detections)
}

fn decode_v5_single(
    output: &RawTensor,
    confidence_threshold: f32,
) -> Result<Vec<Detection>, String> {
    let [batch, first, second] = output.shape.as_slice() else {
        return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
    };
    if *batch != 1 {
        return Err(text::PRELABEL_BATCH_SIZE_INVALID.to_string());
    }
    let (features, candidates, features_last) = if first > second {
        (*second, *first, true)
    } else {
        (*first, *second, false)
    };
    if features < 6 {
        return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
    }
    let value = |candidate: usize, feature: usize| {
        if features_last {
            output.data[candidate * features + feature]
        } else {
            output.data[feature * candidates + candidate]
        }
    };
    let scores_are_probabilities = score_matrix_is_probabilities(candidates, 4, features, value);
    let mut detections = Vec::new();
    for candidate in 0..candidates {
        let objectness = activate_score(value(candidate, 4), scores_are_probabilities);
        let (class_index, class_probability) = (5..features)
            .map(|feature| {
                (
                    feature - 5,
                    activate_score(value(candidate, feature), scores_are_probabilities),
                )
            })
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .ok_or_else(|| text::YOLO_CLASS_COUNT_UNAVAILABLE.to_string())?;
        let confidence = objectness * class_probability;
        if confidence >= confidence_threshold {
            detections.push(model_detection(
                class_index,
                confidence,
                value(candidate, 0),
                value(candidate, 1),
                value(candidate, 2),
                value(candidate, 3),
            ));
        }
    }
    Ok(detections)
}

fn decode_v5_branches(
    outputs: &[RawTensor],
    transform: &LetterboxTransform,
    confidence_threshold: f32,
) -> Result<Vec<Detection>, String> {
    const ANCHORS: [[(f32, f32); 3]; 3] = [
        [(10.0, 13.0), (16.0, 30.0), (33.0, 23.0)],
        [(30.0, 61.0), (62.0, 45.0), (59.0, 119.0)],
        [(116.0, 90.0), (156.0, 198.0), (373.0, 326.0)],
    ];
    let mut ordered: Vec<&RawTensor> = outputs.iter().collect();
    ordered.sort_by_key(|output| std::cmp::Reverse(output.shape.get(2).copied().unwrap_or(0)));
    let mut detections = Vec::new();
    for (branch_index, output) in ordered.into_iter().enumerate() {
        let [batch, anchors, height, width, features] = output.shape.as_slice() else {
            return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
        };
        if *batch != 1 || *anchors != 3 || *features < 6 || *height == 0 || *width == 0 {
            return Err(text::YOLO_OUTPUT_CONTRACT.to_string());
        }
        let stride_x = transform.input_width as f32 / *width as f32;
        let stride_y = transform.input_height as f32 / *height as f32;
        for (anchor, (anchor_width, anchor_height)) in
            ANCHORS[branch_index].iter().copied().enumerate()
        {
            for y in 0..*height {
                for x in 0..*width {
                    let offset = ((anchor * *height + y) * *width + x) * *features;
                    let objectness = sigmoid(output.data[offset + 4]);
                    let (class_index, class_probability) = (5..*features)
                        .map(|feature| (feature - 5, sigmoid(output.data[offset + feature])))
                        .max_by(|left, right| left.1.total_cmp(&right.1))
                        .ok_or_else(|| text::YOLO_CLASS_COUNT_UNAVAILABLE.to_string())?;
                    let confidence = objectness * class_probability;
                    if confidence < confidence_threshold {
                        continue;
                    }
                    let center_x = (sigmoid(output.data[offset]) * 2.0 - 0.5 + x as f32) * stride_x;
                    let center_y =
                        (sigmoid(output.data[offset + 1]) * 2.0 - 0.5 + y as f32) * stride_y;
                    let width = (sigmoid(output.data[offset + 2]) * 2.0).powi(2) * anchor_width;
                    let height = (sigmoid(output.data[offset + 3]) * 2.0).powi(2) * anchor_height;
                    detections.push(model_detection(
                        class_index,
                        confidence,
                        center_x,
                        center_y,
                        width,
                        height,
                    ));
                }
            }
        }
    }
    Ok(detections)
}

fn model_detection(
    class_index: usize,
    confidence: f32,
    center_x: f32,
    center_y: f32,
    width: f32,
    height: f32,
) -> Detection {
    Detection {
        class_index,
        confidence,
        points: [
            center_x - width / 2.0,
            center_y - height / 2.0,
            width,
            height,
        ],
    }
}

fn restore_detection(
    mut detection: Detection,
    transform: &LetterboxTransform,
) -> Option<Detection> {
    let [x, y, width, height] = detection.points;
    if ![x, y, width, height, detection.confidence]
        .into_iter()
        .all(f32::is_finite)
    {
        return None;
    }
    let x1 = ((x - transform.pad_x) / transform.scale).clamp(0.0, transform.original_width as f32);
    let y1 = ((y - transform.pad_y) / transform.scale).clamp(0.0, transform.original_height as f32);
    let x2 = ((x + width - transform.pad_x) / transform.scale)
        .clamp(0.0, transform.original_width as f32);
    let y2 = ((y + height - transform.pad_y) / transform.scale)
        .clamp(0.0, transform.original_height as f32);
    if x2 <= x1 || y2 <= y1 {
        return None;
    }
    detection.points = [x1, y1, x2 - x1, y2 - y1];
    Some(detection)
}

fn non_max_suppression(mut detections: Vec<Detection>, iou_threshold: f32) -> Vec<Detection> {
    const MAX_NMS_CANDIDATES: usize = 30_000;
    detections.sort_by(|left, right| right.confidence.total_cmp(&left.confidence));
    detections.truncate(MAX_NMS_CANDIDATES);
    let mut selected: Vec<Detection> = Vec::new();
    for detection in detections {
        if selected.len() == 300 {
            break;
        }
        if selected.iter().any(|candidate| {
            candidate.class_index == detection.class_index
                && intersection_over_union(candidate.points, detection.points) > iou_threshold
        }) {
            continue;
        }
        selected.push(detection);
    }
    selected
}

fn intersection_over_union(left: [f32; 4], right: [f32; 4]) -> f32 {
    let intersection_width = (left[0] + left[2]).min(right[0] + right[2]) - left[0].max(right[0]);
    let intersection_height = (left[1] + left[3]).min(right[1] + right[3]) - left[1].max(right[1]);
    if intersection_width <= 0.0 || intersection_height <= 0.0 {
        return 0.0;
    }
    let intersection = intersection_width * intersection_height;
    intersection / (left[2] * left[3] + right[2] * right[3] - intersection)
}

fn activate_score(value: f32, already_probability: bool) -> f32 {
    if already_probability {
        if value.is_finite() {
            value.clamp(0.0, 1.0)
        } else {
            0.0
        }
    } else {
        sigmoid(value)
    }
}

fn score_matrix_is_probabilities(
    candidates: usize,
    feature_start: usize,
    feature_end: usize,
    value: impl Fn(usize, usize) -> f32,
) -> bool {
    let mut total = 0_usize;
    let mut outliers = 0_usize;
    for candidate in 0..candidates {
        for feature in feature_start..feature_end {
            total += 1;
            let score = value(candidate, feature);
            if !score.is_finite() || !(0.0..=1.0).contains(&score) {
                outliers += 1;
            }
        }
    }
    total > 0 && outliers <= (total / 1_000).max(1)
}

fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value).exp())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{DynamicImage, ImageFormat, Rgb, RgbImage};

    use super::{
        decode_outputs, preprocess_image, validate_source_rgb_budget, LetterboxTransform, RawTensor,
    };
    use crate::models::prelabel::YoloModelFormat;

    #[test]
    fn letterbox_centers_gray_padding_and_emits_normalized_chw() {
        let mut source = RgbImage::new(4, 2);
        for pixel in source.pixels_mut() {
            *pixel = Rgb([255, 0, 127]);
        }
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(source)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();

        let prepared = preprocess_image(bytes.get_ref(), 4, 4).unwrap();

        assert_eq!(prepared.shape, [1, 3, 4, 4]);
        assert_eq!(prepared.transform.scale, 1.0);
        assert_eq!(
            (prepared.transform.pad_x, prepared.transform.pad_y),
            (0.0, 1.0)
        );
        assert!((prepared.tensor[0] - 114.0 / 255.0).abs() < 1e-6);
        assert_eq!(prepared.tensor[4], 1.0);
        assert_eq!(prepared.tensor[16 + 4], 0.0);
        assert!((prepared.tensor[32 + 4] - 127.0 / 255.0).abs() < 1e-6);
    }

    #[test]
    fn decodes_v8_output_runs_class_aware_nms_and_restores_pixel_coordinates() {
        let transform = LetterboxTransform {
            original_width: 320,
            original_height: 160,
            input_width: 640,
            input_height: 640,
            scale: 2.0,
            pad_x: 0.0,
            pad_y: 160.0,
        };
        let output = RawTensor {
            shape: vec![1, 6, 10],
            data: vec![
                320.0, 322.0, 320.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // cx
                320.0, 322.0, 320.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // cy
                200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // width
                100.0, 100.0, 100.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // height
                0.9, 0.8, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // class 0
                0.1, 0.1, 0.85, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // class 1
            ],
        };

        let detections =
            decode_outputs(YoloModelFormat::YoloV8, &[output], &transform, 0.25, 0.5).unwrap();

        assert_eq!(detections.len(), 2);
        assert_eq!(detections[0].class_index, 0);
        assert!((detections[0].confidence - 0.9).abs() < 1e-6);
        assert_close(detections[0].points, [110.0, 55.0, 100.0, 50.0]);
        assert_eq!(detections[1].class_index, 1);
    }

    #[test]
    fn decodes_yolov5_anchor_branches() {
        let mut small = vec![-20.0; 1 * 3 * 80 * 80 * 7];
        let offset = (((2 * 80 + 1) * 7) + 0) as usize;
        small[offset..offset + 4].fill(0.0);
        small[offset + 4] = 10.0;
        small[offset + 5] = 10.0;
        let outputs = vec![
            RawTensor {
                shape: vec![1, 3, 80, 80, 7],
                data: small,
            },
            RawTensor {
                shape: vec![1, 3, 40, 40, 7],
                data: vec![-20.0; 1 * 3 * 40 * 40 * 7],
            },
            RawTensor {
                shape: vec![1, 3, 20, 20, 7],
                data: vec![-20.0; 1 * 3 * 20 * 20 * 7],
            },
        ];
        let transform = LetterboxTransform {
            original_width: 320,
            original_height: 320,
            input_width: 640,
            input_height: 640,
            scale: 2.0,
            pad_x: 0.0,
            pad_y: 0.0,
        };

        let detections =
            decode_outputs(YoloModelFormat::YoloV5, &outputs, &transform, 0.25, 0.5).unwrap();

        assert_eq!(detections.len(), 1);
        assert_eq!(detections[0].class_index, 0);
        assert!(detections[0].confidence > 0.99);
        assert_close(detections[0].points, [3.5, 6.75, 5.0, 6.5]);
    }

    #[test]
    fn applies_sigmoid_consistently_when_single_output_contains_logits() {
        let mut data = vec![0.0; 5 * 10];
        data[0] = 50.0;
        data[10] = 50.0;
        data[20] = 20.0;
        data[30] = 20.0;
        data[40] = 2.0;
        data[41..50].fill(-20.0);
        let transform = LetterboxTransform {
            original_width: 100,
            original_height: 100,
            input_width: 100,
            input_height: 100,
            scale: 1.0,
            pad_x: 0.0,
            pad_y: 0.0,
        };

        let detections = decode_outputs(
            YoloModelFormat::YoloV8,
            &[RawTensor {
                shape: vec![1, 5, 10],
                data,
            }],
            &transform,
            0.5,
            0.5,
        )
        .unwrap();

        assert_eq!(detections.len(), 1);
        assert!((detections[0].confidence - 0.880_797).abs() < 1e-5);
    }

    #[test]
    fn one_outlier_does_not_flip_probability_outputs_to_sigmoid() {
        let mut data = vec![0.0; 5 * 10];
        data[0] = 50.0;
        data[10] = 50.0;
        data[20] = 20.0;
        data[30] = 20.0;
        data[40] = 0.9;
        data[49] = -0.01;
        let transform = LetterboxTransform {
            original_width: 100,
            original_height: 100,
            input_width: 100,
            input_height: 100,
            scale: 1.0,
            pad_x: 0.0,
            pad_y: 0.0,
        };

        let detections = decode_outputs(
            YoloModelFormat::YoloV8,
            &[RawTensor {
                shape: vec![1, 5, 10],
                data,
            }],
            &transform,
            0.8,
            0.5,
        )
        .unwrap();

        assert_eq!(detections.len(), 1);
        assert!((detections[0].confidence - 0.9).abs() < 1e-6);
    }

    #[test]
    fn rejects_oversized_inputs_before_decoding_or_allocating() {
        let error = preprocess_image(&[], 4097, 640).unwrap_err();

        assert!(error.contains("过大"));
    }

    #[test]
    fn rejects_non_singleton_output_batches() {
        let transform = LetterboxTransform {
            original_width: 100,
            original_height: 100,
            input_width: 100,
            input_height: 100,
            scale: 1.0,
            pad_x: 0.0,
            pad_y: 0.0,
        };
        let error = decode_outputs(
            YoloModelFormat::YoloV8,
            &[RawTensor {
                shape: vec![2, 5, 10],
                data: vec![0.0; 100],
            }],
            &transform,
            0.25,
            0.5,
        )
        .unwrap_err();

        assert!(error.contains("batch=1"));
    }

    #[test]
    fn rejects_source_dimensions_that_would_expand_past_rgb_budget() {
        let error = validate_source_rgb_budget(8192, 8192).unwrap_err();

        assert!(error.contains("源图片"));
        assert!(error.contains("超过 128 MiB"));
    }

    fn assert_close(actual: [f32; 4], expected: [f32; 4]) {
        for (actual, expected) in actual.into_iter().zip(expected) {
            assert!((actual - expected).abs() < 1e-4, "{actual} != {expected}");
        }
    }
}
