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
pub const PRELABEL_INPUT_SIZE_INVALID: &str = "预打标输入尺寸必须是有效的正整数";
pub const PRELABEL_INPUT_SIZE_TOO_LARGE: &str =
    "预打标输入尺寸过大，单边不得超过 4096 且总像素不得超过 16777216";
pub const PRELABEL_EMPTY_IMAGE: &str = "无法对空图片执行预打标";
pub const PRELABEL_THRESHOLD_INVALID: &str = "预打标置信度与 IoU 阈值必须位于 0 到 1 之间";
pub const PRELABEL_OUTPUT_SIZE_INVALID: &str = "模型输出张量尺寸过大或无效";
pub const PRELABEL_BATCH_SIZE_INVALID: &str = "预打标模型输出仅支持 batch=1";
pub const PRELABEL_OUTPUT_FIXED_SHAPE_REQUIRED: &str =
    "预打标模型输出必须是 batch=1 的固定形状张量，以确保资源占用可控";
pub const PRELABEL_OUTPUT_TOO_LARGE: &str = "预打标模型输出规模过大，已拒绝加载以避免内存耗尽";
pub const PRELABEL_SOURCE_IMAGE_TOO_LARGE: &str =
    "源图片解码为 RGB 后超过 128 MiB，已拒绝处理以避免内存耗尽";
pub const PRELABEL_ENCODED_IMAGE_TOO_LARGE: &str =
    "源图片编码文件超过 128 MiB，已拒绝读取以避免内存耗尽";

pub fn prelabel_image_decode_failed(error: impl std::fmt::Display) -> String {
    format!("图片解码失败：{error}")
}

pub fn prelabel_output_length_mismatch(expected: usize, actual: usize) -> String {
    format!("模型输出张量数据长度不匹配：形状需要 {expected}，实际 {actual}")
}

pub fn prelabel_allocation_failed(error: impl std::fmt::Display) -> String {
    format!("预打标图像内存分配失败，请降低模型输入尺寸：{error}")
}

pub fn prelabel_static_input_override(width: usize, height: usize) -> String {
    format!("当前模型输入尺寸固定为 {width}×{height}，不能使用不同的输入尺寸覆盖")
}

pub fn prelabel_class_names_count_mismatch(class_count: usize, names_count: usize) -> String {
    format!("模型配置声明 {class_count} 类，但类名表包含 {names_count} 项")
}

pub fn prelabel_model_class_count_mismatch(configured: usize, runtime: usize) -> String {
    format!("模型配置声明 {configured} 类，但当前 ONNX 输出包含 {runtime} 类；请重新导入模型")
}

pub fn prelabel_image_read_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("读取待推理图片 {} 失败：{error}", path.display())
}

pub fn prelabel_image_file_allocation_failed(
    path: &std::path::Path,
    error: impl std::fmt::Display,
) -> String {
    format!("为图片文件 {} 分配读取内存失败：{error}", path.display())
}

pub fn prelabel_input_tensor_failed(error: impl std::fmt::Display) -> String {
    format!("构造预打标输入张量失败：{error}")
}

pub fn prelabel_inference_failed(error: impl std::fmt::Display) -> String {
    format!("ONNX 模型推理失败：{error}")
}

pub fn prelabel_worker_failed(error: impl std::fmt::Display) -> String {
    format!("预打标后台任务异常结束：{error}")
}

pub fn prelabel_output_tensor_failed(error: impl std::fmt::Display) -> String {
    format!("读取预打标输出张量失败：{error}")
}

pub fn prelabel_output_allocation_failed(error: impl std::fmt::Display) -> String {
    format!("复制预打标输出张量时内存分配失败：{error}")
}

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
