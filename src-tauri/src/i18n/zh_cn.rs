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
pub const YOLO_REQUIRES_ONE_INPUT: &str = "YOLO 模型必须只有一个图像输入";
pub const YOLO_INPUT_CONTRACT: &str = "YOLO 输入必须是 f32 NCHW 张量 [1, 3, height, width]";
pub const YOLO_OUTPUT_FLOAT: &str = "YOLO 输出必须是 f32 张量";
pub const YOLO_EMBEDDED_NMS: &str = "检测到内置 NMS 输出；仅支持不含 NMS 的标准导出模型";
pub const YOLO_OUTPUT_CONTRACT: &str = "输出张量不符合 YOLOv5/v8/v11 标准导出结构";
pub const YOLO_FORMAT_CONFLICT: &str = "ONNX 元数据格式与输出张量结构不一致";
pub const RUNTIME_LOAD_LOCK_FAILED: &str = "ONNX Runtime 加载锁不可用，请重启应用后重试";
pub const RUNTIME_SELECT_DLL: &str = "请选择名为 onnxruntime.dll 的运行时文件";
pub const RUNTIME_AVAILABLE: &str = "ONNX Runtime 已就绪";
pub const MODEL_METADATA_RUNTIME_MISMATCH: &str = "ONNX 元数据与运行时张量信息不一致";
pub const MODEL_FORMAT_RUNTIME_MISMATCH: &str = "ONNX 元数据中的 YOLO 版本与运行时输出结构不一致";

pub fn runtime_missing(path: &std::path::Path) -> String {
    format!("缺少 ONNX Runtime，请下载或手动放置到 {}", path.display())
}

pub fn runtime_app_data_failed(error: impl std::fmt::Display) -> String {
    format!("无法确定 ONNX Runtime 的应用数据目录：{error}")
}

pub fn runtime_load_failed(error: impl std::fmt::Display) -> String {
    format!("ONNX Runtime DLL 加载失败：{error}")
}

pub fn runtime_already_loaded(path: &std::path::Path) -> String {
    format!("当前进程已从 {} 加载 ONNX Runtime", path.display())
}

pub fn runtime_session_failed(error: impl std::fmt::Display) -> String {
    format!("无法创建 ONNX Runtime 会话构建器：{error}")
}

pub fn model_session_failed(error: impl std::fmt::Display) -> String {
    format!("模型加载失败：{error}。仅支持不含内置 NMS 的标准 YOLO 导出")
}

pub fn runtime_download_failed(error: impl std::fmt::Display) -> String {
    format!("从项目 Release 下载 ONNX Runtime 失败：{error}")
}

pub fn runtime_checksum_mismatch(expected: &str, actual: &str) -> String {
    format!("ONNX Runtime SHA-256 校验失败：预期 {expected}，实际 {actual}")
}

pub fn runtime_source_missing(path: &std::path::Path) -> String {
    format!("运行时文件不存在：{}", path.display())
}

pub fn runtime_read_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("读取运行时文件 {} 失败：{error}", path.display())
}

pub fn runtime_invalid_target(path: &std::path::Path) -> String {
    format!("运行时目标目录无效：{}", path.display())
}

pub fn runtime_create_dir_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("创建运行时目录 {} 失败：{error}", path.display())
}

pub fn runtime_write_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("写入运行时文件 {} 失败：{error}", path.display())
}

pub fn runtime_replace_blocked(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!(
        "无法开始替换运行时目录 {}，原有文件未变更：{error}",
        path.display()
    )
}

pub fn runtime_install_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("安装运行时到 {} 失败：{error}", path.display())
}

pub fn runtime_replace_restored(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!(
        "替换运行时目录 {} 失败，已恢复原有文件：{error}",
        path.display()
    )
}

pub fn runtime_rollback_failed(
    path: &std::path::Path,
    backup: &std::path::Path,
    replace_error: impl std::fmt::Display,
    rollback_error: impl std::fmt::Display,
) -> String {
    format!(
        "替换运行时目录 {} 失败，且自动恢复失败；原文件保留在 {}。替换错误：{}；恢复错误：{}",
        path.display(),
        backup.display(),
        replace_error,
        rollback_error
    )
}

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
