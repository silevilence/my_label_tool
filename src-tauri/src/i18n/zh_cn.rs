pub const ONNX_MISSING_GRAPH: &str = "ONNX 模型缺少计算图";
pub const ONNX_MISSING_IMAGE_INPUT: &str = "ONNX 模型缺少标准的 NCHW 图像输入";
pub const ONNX_MISSING_DETECTION_OUTPUT: &str = "未识别到标准 YOLO 检测输出（需要三维输出张量）";
pub const ONNX_FIXED_FIELD_OUT_OF_BOUNDS: &str = "ONNX protobuf 固定长度字段越界";
pub const ONNX_FIELD_TOO_LARGE: &str = "ONNX protobuf 字段过大";
pub const ONNX_FIELD_OUT_OF_BOUNDS: &str = "ONNX protobuf 字段越界";
pub const ONNX_UNSUPPORTED_WIRE_TYPE: &str = "ONNX protobuf 包含不支持的 wire type";
pub const ONNX_TRUNCATED_VARINT: &str = "ONNX protobuf varint 截断";
pub const ONNX_INVALID_VARINT: &str = "ONNX protobuf varint 无效";
pub const ONNX_METADATA_INVALID_UTF8: &str = "ONNX 元数据不是有效 UTF-8";
pub const ONNX_VALUE_INFO_MISSING_TYPE: &str = "ONNX ValueInfo 缺少类型";
pub const ONNX_VALUE_NOT_TENSOR: &str = "ONNX 输入输出不是张量";
pub const ONNX_TENSOR_MISSING_SHAPE: &str = "ONNX 张量缺少形状";
pub const ONNX_UNRECOGNIZED_YOLO: &str = "未识别到标准 YOLOv5/v8/v11 检测输出";
pub const YOLO_CLASS_COUNT_UNAVAILABLE: &str = "YOLO 输出张量无法推断类别数";
pub const YOLO_CLASS_COUNT_TOO_LARGE: &str = "YOLO 类别数过大";
pub const ONNX_NAMES_ARRAY_INVALID: &str = "ONNX names 数组必须只包含字符串";
pub const ONNX_NAMES_KEY_INVALID: &str = "ONNX names 对象的键必须是类别序号";
pub const ONNX_NAMES_VALUE_INVALID: &str = "ONNX names 对象的值必须是字符串";
pub const ONNX_NAMES_UNPARSABLE: &str = "无法解析 ONNX names 元数据";
pub const ONNX_NAMES_INDEX_INVALID: &str = "ONNX names 包含无效类别序号";
pub const ONNX_NAMES_EMPTY: &str = "ONNX names 包含空类名";
pub const ONNX_NAMES_NOT_CONTIGUOUS: &str = "ONNX names 类别序号必须从 0 连续排列";
pub const INPUT_HEIGHT: &str = "输入高度";
pub const INPUT_WIDTH: &str = "输入宽度";
pub const MODEL_ID_INVALID: &str = "模型 id 不能为空且不能重复";
pub const MODEL_NAME_OR_PATH_EMPTY: &str = "模型名称和路径不能为空";
pub const MODEL_CLASSES_MISMATCH: &str = "模型类别数与类名表不一致";
pub const MODEL_INPUT_SIZE_INVALID: &str = "模型输入尺寸必须大于 0";
pub const MODEL_CLASS_NAME_EMPTY: &str = "模型类名不能为空";
pub const MODEL_THRESHOLDS_INVALID: &str = "conf 与 IoU 阈值必须位于 0 到 1 之间";
pub const CURRENT_MODEL_MISSING: &str = "当前模型不存在于模型库中";

pub fn onnx_names_count_mismatch(actual: usize, inferred: usize) -> String {
    format!("ONNX names 包含 {actual} 个类，但输出张量推断为 {inferred} 个类")
}

pub fn dynamic_dimension(label: &str) -> String {
    format!("{label}为动态维度，请在导入表中手动覆盖")
}

pub fn read_onnx_failed(error: impl std::fmt::Display) -> String {
    format!("无法读取 ONNX 模型：{error}")
}

pub fn select_extension(expected: &str) -> String {
    format!("请选择 .{expected} 文件")
}

pub fn invalid_library(error: impl std::fmt::Display) -> String {
    format!("预打标模型配置无效：{error}")
}

pub fn unsupported_library_version(version: u32) -> String {
    format!("不支持模型库版本 {version}")
}
