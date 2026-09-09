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
pub const PRELABEL_DYNAMIC_INPUT_OVERRIDE_REQUIRED: &str =
    "动态输入模型必须配置有效的输入宽度和高度";
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
pub const PRELABEL_SESSION_CACHE_LOCK_FAILED: &str = "预打标模型会话缓存不可用，请重启应用后重试";
pub fn prelabel_gpu_unavailable() -> String {
    "无法启用 GPU（DirectML）推理，请检查显卡驱动与图形环境，或改用「自动」或「CPU」设备"
        .to_string()
}

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
    let width = if width == 0 {
        "动态".to_string()
    } else {
        width.to_string()
    };
    let height = if height == 0 {
        "动态".to_string()
    } else {
        height.to_string()
    };
    format!("当前模型输入尺寸为 {width}×{height}；固定维度不能使用不同的尺寸覆盖")
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

pub fn prelabel_model_metadata_failed(path: &str, error: impl std::fmt::Display) -> String {
    format!("读取预打标模型文件信息 {path} 失败：{error}")
}

pub fn prelabel_model_modified_time_failed(path: &str, error: impl std::fmt::Display) -> String {
    format!("读取预打标模型修改时间 {path} 失败：{error}")
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

pub fn runtime_download_timed_out(file_name: &str) -> String {
    format!("下载 {file_name} 超时，请检查网络后重试")
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

pub const PT_CONVERSION_UNAVAILABLE: &str =
    "未检测到可用的 yolo 命令、可导入 ultralytics 的 Python 环境或 uv";
pub const PT_CONVERSION_LOCK_FAILED: &str = "模型转换任务锁不可用，请重启应用后重试";
pub const PT_CONVERSION_IMGSZ_INVALID: &str = "转换尺寸 imgsz 必须是大于 0 的 32 倍数";
pub const PT_CONVERSION_CANCELLED: &str = "模型转换已中止";
pub const PT_CONVERSION_ID_INVALID: &str = "模型转换任务 ID 不能为空";
pub const PT_CONVERSION_PLAN_INVALID: &str = "模型转换计划无效，请重新打开参数确认弹窗";

/// 通用后台任务注册表（预打标推理 / 运行时下载共用）
pub const TASK_LOCK_FAILED: &str = "后台任务注册表不可用，请重启应用后重试";
pub const TASK_ID_INVALID: &str = "任务 ID 不能为空";
pub const PRELABEL_TASK_LABEL: &str = "预打标";
pub const RUNTIME_DOWNLOAD_TASK_LABEL: &str = "ONNX Runtime 下载";
pub const MODEL_DOWNLOAD_TASK_LABEL: &str = "预打标模型下载";
pub fn task_id_already_running(label: &str, task_id: &str) -> String {
    format!("{label}任务已存在：{task_id}")
}

/// 手动更新预打标模型（从用户提供的 URL 下载）
pub const MODEL_SOURCE_URL_INVALID: &str = "模型更新地址无效，必须是以 http(s):// 开头的 URL";
pub const MODEL_TARGET_EXISTS: &str = "目标文件名已存在";
pub const MODEL_SOURCE_FILE_NAME_UNAVAILABLE: &str =
    "无法从更新地址确定模型文件名，请使用以 .onnx 结尾的直链";
pub fn model_app_data_failed(error: impl std::fmt::Display) -> String {
    format!("无法确定模型下载目录：{error}")
}

pub fn model_download_failed(error: impl std::fmt::Display) -> String {
    format!("下载预打标模型失败：{error}")
}

pub fn model_download_timed_out(file_name: &str) -> String {
    format!("下载 {file_name} 超时，请检查网络后重试")
}

pub fn model_size_limit_exceeded(limit: u64) -> String {
    format!("模型文件超过 {limit} 字节大小上限，已中止下载")
}

pub fn model_onnx_invalid(reason: impl std::fmt::Display) -> String {
    format!("下载内容不是有效的 YOLO ONNX 模型：{reason}")
}

pub fn model_create_dir_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("创建模型下载目录 {} 失败：{error}", path.display())
}

pub fn model_write_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("写入模型文件 {} 失败：{error}", path.display())
}

pub const PLUGIN_MANIFEST_MUST_BE_OBJECT: &str = "插件清单必须是 JSON 对象";
pub const PLUGIN_SCHEMA_VERSION_REQUIRED: &str = "缺少插件清单结构版本";
pub const PLUGIN_SCHEMA_VERSION_UNSUPPORTED: &str = "仅支持插件清单结构版本 1";
pub const PLUGIN_ID_INVALID: &str = "插件 ID 必须使用小写反向域名命名空间";
pub const PLUGIN_VERSION_INVALID: &str = "插件版本必须是有效的 semver";
pub const PLUGIN_EXTENSION_KIND_REQUIRED: &str = "缺少扩展类型";
pub const PLUGIN_EXTENSION_KIND_UNSUPPORTED: &str = "扩展类型不受支持";
pub const PLUGIN_DATA_RUNTIME_FORBIDDEN: &str = "数据型插件禁止声明运行时";
pub const PLUGIN_CODE_RUNTIME_REQUIRED: &str = "代码型插件必须声明运行时";
pub const PLUGIN_RUNTIME_UNSUPPORTED: &str = "插件系统 v1 仅支持 process 运行时";
pub const PLUGIN_DATA_ENTRY_FORBIDDEN: &str = "数据型插件禁止声明进程入口";
pub const PLUGIN_CODE_ENTRY_REQUIRED: &str = "代码型插件必须声明进程入口";
pub const PLUGIN_ENTRY_MUST_BE_OBJECT: &str = "进程入口必须是对象";
pub const PLUGIN_ENTRY_PATH_INVALID: &str = "入口命令必须是包内安全相对路径";
pub const PLUGIN_CAPABILITIES_MUST_BE_OBJECT: &str = "能力声明必须是对象";
pub const PLUGIN_PRELABEL_ANNOTATION_TYPES_REQUIRED: &str = "预打标插件必须声明至少一种标注类型";
pub const PLUGIN_CAPABILITY_VERSION_MUST_BE_OBJECT: &str = "业务能力版本声明必须是对象";
pub const PLUGIN_API_VERSION_REQUIRED: &str = "缺少目标宿主 API 版本";
pub const PLUGIN_API_VERSION_MUST_BE_OBJECT: &str = "目标宿主 API 版本必须是对象";
pub const PLUGIN_API_VERSION_INVALID: &str = "目标宿主 API 版本必须是 1 到 4294967295 的整数";
pub const PLUGIN_API_VERSION_ONLY_MIN: &str = "目标宿主 API 版本只允许 min 字段";
pub const PLUGIN_ANNOTATION_TYPES_MUST_BE_ARRAY: &str = "标注类型必须是数组";
pub const PLUGIN_ANNOTATION_TYPE_UNSUPPORTED: &str = "标注类型不受支持";
pub const PLUGIN_ANNOTATION_TYPE_DUPLICATE: &str = "标注类型不能重复声明";
pub const PLUGIN_PERMISSIONS_MUST_BE_ARRAY: &str = "权限授予声明必须是数组";
pub const PLUGIN_PERMISSION_UNKNOWN: &str = "包含未知或无效的权限面";
pub const PLUGIN_PERMISSION_DUPLICATE: &str = "权限授予声明不能重复";
pub const PLUGIN_PERMISSION_ROOT_INVALID: &str = "权限目录必须是规范化的绝对路径";
pub const PLUGIN_PERMISSION_PROJECT_REQUIRED: &str =
    "插件申请了项目目录权限，请先打开图片项目后再安装";
pub const PLUGIN_PERMISSION_GRANT_INVALID: &str = "插件权限授权包含非法目录或权限面";
pub const PLUGIN_PERMISSION_ACCESS_DENIED: &str = "插件未获授权访问该路径";
pub const PLUGIN_PERMISSION_PLACEHOLDER_ESCAPE: &str = "权限目录经符号链接解析后超出占位符对应目录";
pub const PLUGIN_PERMISSION_REAUTHORIZE_REQUIRED: &str =
    "该插件使用旧版占位符授权，已安全停用；请重新安装或更新插件并确认实际目录";
pub const PLUGIN_PROXY_METHOD_NOT_FOUND: &str = "宿主未实现该插件代理方法";
pub const PLUGIN_PROXY_ARGUMENT_INVALID: &str = "插件文件代理参数无效";
pub const PLUGIN_PROXY_FILE_INVALID: &str = "插件文件代理路径不存在、不是文件或超过大小限制";
pub const PLUGIN_PROXY_IO_FAILED: &str = "插件文件代理读写失败";
pub const PLUGIN_PROXY_BUDGET_EXCEEDED: &str = "单次插件调用的文件代理请求已超过数量或数据预算";
pub const PLUGIN_PROXY_WORKER_UNAVAILABLE: &str = "插件文件代理工作线程暂时不可用";
pub const PLUGIN_COMMAND_ARGUMENT_MUST_BE_STRING: &str = "命令参数必须是字符串";
pub const PLUGIN_EXPORTER_OPTIONS_FORBIDDEN: &str = "只有 exporter 扩展可以声明 exporterOptions";
pub const PLUGIN_EXPORTER_FORMATS_REQUIRED: &str = "exporterOptions.formats 必须是非空数组";
pub const PLUGIN_EXPORTER_FORMAT_INVALID: &str = "导出格式声明必须是对象";
pub const PLUGIN_EXPORTER_FORMAT_ID_INVALID: &str =
    "导出格式 ID 必须唯一且只含小写字母、数字、点、下划线或连字符";
pub const PLUGIN_EXPORTER_EXTENSIONS_INVALID: &str = "导出扩展名必须唯一、非空且不带点号";
pub const PLUGIN_PRELABEL_OPTIONS_FORBIDDEN: &str = "只有 prelabel 扩展可以声明 prelabelOptions";
pub const PLUGIN_PRELABEL_CLASS_NAMES_INVALID: &str =
    "prelabelOptions.classNames 必须是唯一的非空字符串数组";
pub const PLUGIN_PRELABEL_SOURCE_NOT_FOUND: &str = "预打标插件不存在或未声明 prelabel 能力";
pub const PLUGIN_PRELABEL_ARGUMENT_INVALID: &str = "预打标插件调用参数无效";
pub const PLUGIN_PRELABEL_READ_PERMISSION_REQUIRED: &str = "预打标插件缺少项目目录 fs.read 授权";
pub const PLUGIN_PRELABEL_RESULT_INVALID: &str = "预打标插件返回结果不符合契约";
pub const PLUGIN_PRELABEL_SHAPE_INVALID: &str = "预打标插件返回了非法坐标、类型或标签";
pub const PLUGIN_PRELABEL_ALREADY_RUNNING: &str = "同一预打标任务已在运行";
pub const PLUGIN_PRELABEL_SUCCESS_PERSIST_CONTEXT: &str = "插件预打标成功状态";
pub fn plugin_prelabel_task_failed(error: impl std::fmt::Display) -> String {
    format!("插件预打标任务异常结束：{error}")
}
pub const PLUGIN_EXPORT_FORMAT_NOT_FOUND: &str = "插件未声明该导出格式";
pub const PLUGIN_EXPORT_ARGUMENT_INVALID: &str = "插件导出参数或输出目录无效";
pub const PLUGIN_EXPORT_RESULT_INVALID: &str = "插件导出结果结构无效";
pub const PLUGIN_EXPORT_PATH_INVALID: &str = "插件返回了不安全或重复的相对路径";
pub const PLUGIN_EXPORT_EXTENSION_INVALID: &str = "插件返回文件的扩展名不在 manifest 声明中";
pub const PLUGIN_EXPORT_TOO_LARGE: &str = "插件导出文件超过大小或总量上限";
pub const PLUGIN_EXPORT_ALREADY_RUNNING: &str = "同一导出任务 ID 已在运行";
pub const PLUGIN_EXPORT_SUCCESS_PERSIST_CONTEXT: &str = "导出结果校验成功";
pub const PLUGIN_EXPORT_STAGING_FAILED: &str = "无法创建安全的导出暂存目录";

pub fn plugin_export_write_failed(error: impl std::fmt::Display) -> String {
    format!("写入插件导出文件失败：{error}")
}

pub fn plugin_export_task_failed(error: impl std::fmt::Display) -> String {
    format!("插件导出任务异常结束：{error}")
}

pub fn plugin_required_field(field: &str) -> String {
    format!("缺少{field}")
}

pub fn plugin_field_must_be_string(field: &str) -> String {
    format!("{field} 必须是字符串")
}

pub fn plugin_field_must_not_be_empty(field: &str) -> String {
    format!("{field} 不能为空")
}

pub fn plugin_field_must_be_string_array(field: &str) -> String {
    format!("{field} 必须是字符串数组")
}

pub fn plugin_field_must_be_boolean(field: &str) -> String {
    format!("{field} 必须是布尔值")
}

pub fn plugin_field_must_be_bounded_integer(field: &str, minimum: u32, maximum: u32) -> String {
    format!("{field} 必须是 {minimum} 到 {maximum} 的整数")
}

pub fn plugin_api_version_unsupported(scope: &str, required: u32, supported: &[u32]) -> String {
    let versions = supported
        .iter()
        .map(|version| format!("v{version}"))
        .collect::<Vec<_>>()
        .join("、");
    format!("插件需要 {scope} v{required}，宿主支持 {versions}；请升级插件或使用兼容版本")
}

pub const PLUGIN_UNVERIFIED_AUTHOR_WARNING: &str =
    "未验证作者：代码型插件可能运行任意代码，请仅安装可信来源的插件";
pub const PLUGIN_ARCHIVE_MISSING_MANIFEST: &str = "插件包根目录缺少 manifest.json";
pub const PLUGIN_LABEL_PRESET_MISSING: &str = "预置标签插件包根目录缺少 labels.json";
pub const PLUGIN_LABEL_PRESET_EXTRA_ENTRY: &str =
    "预置标签插件只能包含包根 manifest.json 与 labels.json";
pub const PLUGIN_LABEL_PRESET_TOO_LARGE: &str = "labels.json 超过 1 MiB 安全上限";
pub const PLUGIN_LABEL_PRESET_ID_INVALID: &str = "模板 ID 必须使用插件 ID 命名空间";
pub const PLUGIN_LABEL_PRESET_NAME_REQUIRED: &str = "模板名称不能为空";
pub const PLUGIN_LABEL_PRESET_LABEL_COUNT_INVALID: &str = "预置标签数量必须为 1 到 1000 个";
pub const PLUGIN_LABEL_PRESET_LABEL_ID_INVALID: &str = "标签 ID 必须唯一且使用插件 ID 命名空间";
pub const PLUGIN_LABEL_PRESET_LABEL_NAME_REQUIRED: &str = "标签名称不能为空";
pub const PLUGIN_LABEL_PRESET_COLOR_INVALID: &str = "标签颜色必须为 #RRGGBB 格式";
pub const PLUGIN_LABEL_PRESET_SHAPE_INVALID: &str =
    "标签图形类型必须为 any、rect、polygon 或 point";
pub const PLUGIN_LABEL_PRESET_SHORTCUT_INVALID: &str = "标签快捷键必须是唯一的小写字母或数字";
pub const PLUGIN_ARCHIVE_UNSAFE_ENTRY: &str = "插件包包含不安全的路径或符号链接条目";
pub const PLUGIN_ARCHIVE_TOO_LARGE: &str = "插件包解压体积超过安全上限";
pub const PLUGIN_ARCHIVE_RATIO_TOO_HIGH: &str = "插件包压缩比异常，已拒绝解压";

pub fn plugin_archive_open_failed(error: impl std::fmt::Display) -> String {
    format!("无法打开插件包：{error}")
}

pub fn plugin_archive_read_failed(error: impl std::fmt::Display) -> String {
    format!("无法读取插件包：{error}")
}

pub fn plugin_archive_extract_failed(error: impl std::fmt::Display) -> String {
    format!("无法解压插件包：{error}")
}

pub fn plugin_label_preset_read_failed(error: impl std::fmt::Display) -> String {
    format!("无法读取 labels.json：{error}")
}

pub fn plugin_label_preset_json_failed(error: impl std::fmt::Display) -> String {
    format!("labels.json 结构无效：{error}")
}

pub fn plugin_label_preset_load_warning(plugin_name: &str, error: &str) -> String {
    format!("插件「{plugin_name}」的预置标签不可用：{error}")
}

pub fn plugin_validator_source_missing(path: &std::path::Path) -> String {
    format!("插件校验来源不存在：{}", path.display())
}

pub const PLUGIN_VALIDATOR_USAGE: &str =
    "用法：plugin-validator <插件目录或 zip>；退出码 0=通过，1=校验失败，2=调用错误";
pub const PLUGIN_VALIDATOR_DUPLICATE_ENTRY: &str = "插件包包含重复路径条目";

pub fn plugin_validator_read_failed(
    path: &std::path::Path,
    error: impl std::fmt::Display,
) -> String {
    format!("读取插件校验来源 {} 失败：{error}", path.display())
}

pub fn plugin_validator_archive_failed(
    path: &std::path::Path,
    error: impl std::fmt::Display,
) -> String {
    format!("读取插件压缩包 {} 失败：{error}", path.display())
}

pub fn plugin_validator_manifest_json_failed(
    path: &std::path::Path,
    error: impl std::fmt::Display,
) -> String {
    format!(
        "解析插件压缩包 {} 中的 manifest.json 失败：{error}",
        path.display()
    )
}

pub fn plugin_validator_unsafe_directory_entry(path: &std::path::Path) -> String {
    format!("插件目录包含符号链接或不安全条目：{}", path.display())
}

pub fn plugin_manifest_invalid(reasons: &str) -> String {
    format!("插件清单校验失败：{reasons}")
}

pub const PLUGIN_INSTALL_TOKEN_INVALID: &str = "插件安装令牌无效或已过期";
pub const PLUGIN_GRANTS_MISMATCH: &str = "权限授予必须与插件清单声明逐项一致";
pub const PLUGIN_PYTHON_RUNTIME_MISSING: &str = "未检测到插件所需的 Python 3 运行环境";
pub const PLUGIN_ENTRY_MISSING: &str = "插件入口文件不存在或不是普通文件";
pub const PLUGIN_EXECUTABLE_RUNTIME_UNAVAILABLE: &str =
    "插件独立入口无法启动；请确认文件完整、架构匹配且具备执行权限";
pub const PLUGIN_EXECUTABLE_FORMAT_INVALID: &str =
    "插件独立入口不是有效的本机可执行文件；完整启动与握手将在首次调用时验证";
pub fn plugin_executable_inspection_failed(error: impl std::fmt::Display) -> String {
    format!("无法检查插件独立入口：{error}")
}
pub const PLUGIN_PENDING_PACKAGE_CHANGED: &str =
    "插件包在权限预览后发生变化，已取消安装；请重新选择插件包";
pub const PLUGIN_REGISTRY_LOAD_WARNING: &str = "插件注册表损坏，已跳过加载且不影响应用启动";
pub const PLUGIN_REGISTRY_SEMANTIC_INVALID: &str =
    "插件注册表包含非法 ID、入口或权限授权，已按损坏注册表处理";
pub const PLUGIN_REGISTRY_CORRUPT_WRITE_BLOCKED: &str =
    "插件注册表损坏，为保护已有注册数据已拒绝写入；请先备份并修复或移除该文件";
pub const PLUGIN_REGISTRY_LOCK_POISONED: &str = "插件注册表暂时不可用";
pub fn plugin_registry_load_failed(error: impl std::fmt::Display) -> String {
    format!("加载插件注册表失败：{error}")
}
pub fn plugin_app_data_dir_failed(error: impl std::fmt::Display) -> String {
    format!("无法确定插件应用数据目录：{error}")
}

pub fn plugin_settings_read_failed(error: impl std::fmt::Display) -> String {
    format!("读取插件运行设置失败：{error}")
}

pub fn plugin_settings_write_failed(error: impl std::fmt::Display) -> String {
    format!("保存插件运行设置失败：{error}")
}

pub const PLUGIN_SAFE_MODE_CODE_INSTALL_BLOCKED: &str =
    "安全模式已开启，不能安装或更新代码型插件；请先退出安全模式";
pub const PLUGIN_RUNTIME_LOCK_POISONED: &str = "插件运行时状态不可用";
pub const PLUGIN_RUNTIME_DATA_PLUGIN: &str = "数据型插件没有可调用的进程运行时";
pub const PLUGIN_RUNTIME_SAFE_MODE: &str = "安全模式已开启，代码型插件不会运行";
pub const PLUGIN_RUNTIME_DISABLED: &str = "插件已停用";
pub const PLUGIN_RUNTIME_AUTO_DISABLED: &str = "插件连续失败，已自动停用";
pub const PLUGIN_RUNTIME_ENTRY_MISSING: &str = "插件缺少进程入口";
pub const PLUGIN_RUNTIME_RESPONSE_INVALID: &str = "插件返回了不匹配的协议消息";
pub const PLUGIN_RUNTIME_TIMEOUT: &str = "插件调用超时，进程树已终止";
pub const PLUGIN_RUNTIME_CANCELLED: &str = "插件调用已取消，进程树已终止";
pub const PLUGIN_RUNTIME_EXITED: &str = "插件进程在返回结果前退出";
pub const PLUGIN_RUNTIME_STDIO_MISSING: &str = "无法建立插件进程标准输入输出管道";
pub const PLUGIN_SETTINGS_LOCK_POISONED: &str = "插件运行设置暂时不可用";
pub const PLUGIN_RUNTIME_STATE_CHANGED: &str = "插件状态已变更，本次调用已取消";
pub const PLUGIN_RUNTIME_MAINTENANCE: &str = "插件正在安装、更新或卸载，暂时不可调用";
pub const PLUGIN_RUNTIME_NOT_READY: &str = "插件握手尚未完成";
pub const PLUGIN_RUNTIME_CAPABILITY_UNAVAILABLE: &str = "插件未在握手中声明此项能力";
pub const PLUGIN_RUNTIME_STDERR_TRUNCATED: &str = "…（该行过长，已截断）";
pub fn plugin_failure_persist_failed(
    call_error: impl std::fmt::Display,
    persist_error: impl std::fmt::Display,
) -> String {
    format!("插件调用失败（{call_error}），且无法保存失败计数：{persist_error}")
}
pub fn plugin_runtime_write_failed(error: impl std::fmt::Display) -> String {
    format!("向插件进程写入请求失败：{error}")
}
pub fn plugin_runtime_read_failed(error: impl std::fmt::Display) -> String {
    format!("读取插件进程输出失败：{error}")
}
pub const PLUGIN_NOT_FOUND: &str = "插件未注册或已卸载";
pub const PLUGIN_AUTO_DISABLED_REQUIRES_CLEAR: &str = "插件已自动禁用，请先清除失败记录";
pub const PLUGIN_CONFIG_MIGRATION_REQUIRED: &str = "插件配置等待迁移，迁移完成前不能更改启用状态";
pub const PLUGIN_CONFIG_MIGRATION_CAPABILITY_MISSING: &str =
    "插件未声明配置迁移能力，无法使用旧版本插件配置";
pub const PLUGIN_CONFIG_MIGRATION_RESULT_INVALID: &str = "插件返回的配置迁移结果结构无效";
pub const PLUGIN_CONFIG_REGISTRY_UNAVAILABLE: &str =
    "插件注册表不可用，配置迁移已跳过，项目仍可继续打开";
pub fn plugin_config_newer_than_plugin(project_version: u32, plugin_version: u32) -> String {
    format!("项目中的插件配置版本 {project_version} 高于当前插件版本 {plugin_version}，无法降级")
}
pub fn plugin_config_migration_params_failed(error: impl std::fmt::Display) -> String {
    format!("无法序列化插件配置迁移参数：{error}")
}
pub fn plugin_config_migration_task_failed(error: impl std::fmt::Display) -> String {
    format!("插件配置迁移任务异常结束：{error}")
}

pub fn plugin_registry_write_failed(error: impl std::fmt::Display) -> String {
    format!("无法保存插件注册表：{error}")
}

pub fn plugin_package_replace_failed(error: impl std::fmt::Display) -> String {
    format!("无法发布插件包：{error}")
}

pub fn plugin_uninstall_rollback_failed(error: impl std::fmt::Display) -> String {
    format!("清理插件包失败且无法完整回滚卸载状态，请备份插件注册表后重试：{error}")
}

pub fn process_tree_termination_failed(error: impl std::fmt::Display) -> String {
    format!("终止进程树失败：{error}")
}

pub fn process_tree_termination_exit_failed(code: Option<i32>) -> String {
    format!(
        "终止进程树失败，退出码：{}",
        code.map_or_else(|| "未知".to_string(), |value| value.to_string())
    )
}

pub fn process_job_creation_failed(error: impl std::fmt::Display) -> String {
    format!("无法创建进程隔离作业：{error}")
}

pub fn process_job_configuration_failed(error: impl std::fmt::Display) -> String {
    format!("无法配置进程隔离作业：{error}")
}

pub fn process_job_assignment_failed(error: impl std::fmt::Display) -> String {
    format!("无法将插件进程加入隔离作业：{error}")
}

pub fn process_job_termination_failed(error: impl std::fmt::Display) -> String {
    format!("无法终止插件进程隔离作业：{error}")
}

pub fn process_stdio_setup_failed(error: impl std::fmt::Display) -> String {
    format!("无法配置插件进程标准输入输出：{error}")
}

pub fn process_resume_failed(error: impl std::fmt::Display) -> String {
    format!("插件进程加入隔离作业后无法恢复运行：{error}")
}

pub const PLUGIN_SANDBOX_PACKAGE_MISSING: &str = "插件隔离目录不存在";
pub const PLUGIN_SANDBOX_SYMLINK_REJECTED: &str = "插件包包含隔离边界不允许的符号链接";

pub fn plugin_sandbox_profile_failed(error: impl std::fmt::Display) -> String {
    format!("无法创建插件 AppContainer 隔离配置：{error}")
}

pub fn plugin_sandbox_profile_delete_failed(error: impl std::fmt::Display) -> String {
    format!("无法删除插件 AppContainer 隔离配置：{error}")
}

pub fn plugin_sandbox_capability_failed(error: impl std::fmt::Display) -> String {
    format!("无法创建插件隔离能力：{error}")
}

pub fn plugin_sandbox_acl_failed(error: impl std::fmt::Display) -> String {
    format!("无法授权插件包进入隔离容器：{error}")
}

pub fn plugin_sandbox_launch_failed(error: impl std::fmt::Display) -> String {
    format!("无法应用插件 AppContainer 隔离：{error}")
}

pub fn plugin_python_resolution_failed(error: impl std::fmt::Display) -> String {
    format!("无法解析插件所需的 Python 3 解释器：{error}")
}

pub fn process_argument_contains_nul() -> String {
    "插件入口命令、参数、环境或工作目录包含非法空字符".to_string()
}

pub const PLUGIN_PROTOCOL_ENVELOPE_MUST_BE_OBJECT: &str = "插件协议每行必须是 JSON 对象";

pub fn plugin_protocol_serialize_failed(error: impl std::fmt::Display) -> String {
    format!("序列化插件协议消息失败：{error}")
}

pub fn plugin_protocol_parse_failed(error: impl std::fmt::Display) -> String {
    format!("解析插件协议 JSON 失败：{error}")
}

pub fn plugin_protocol_envelope_version_unsupported(version: u32) -> String {
    format!("不支持插件协议信封版本 v{version}")
}

pub fn plugin_protocol_field_invalid(field: &str) -> String {
    format!("插件协议字段缺失或非法：{field}")
}

pub fn plugin_protocol_line_too_long(max_bytes: usize) -> String {
    format!("插件协议单行超过 {max_bytes} 字节上限，已丢弃该行")
}

pub fn plugin_protocol_hello_version_unsupported(actual: u32, supported: u32) -> String {
    format!("插件 hello 响应协议版本为 v{actual}，宿主仅支持 v{supported}，请升级插件")
}

pub fn plugin_runtime_start_failed(
    executable: impl std::fmt::Display,
    error: impl std::fmt::Display,
) -> String {
    format!("无法启动插件入口 {executable}：{error}")
}

pub fn plugin_runtime_exited(code: Option<i32>) -> String {
    format!(
        "插件入口在等待协议握手前退出，退出码：{}",
        code.map_or_else(|| "未知".to_string(), |value| value.to_string())
    )
}

pub fn plugin_runtime_wait_failed(error: impl std::fmt::Display) -> String {
    format!("等待插件入口启动失败：{error}")
}

pub fn pt_conversion_id_already_running(conversion_id: &str) -> String {
    format!("模型转换任务已存在：{conversion_id}")
}

pub fn pt_conversion_id_missing(conversion_id: &str) -> String {
    format!("模型转换任务不存在或已结束：{conversion_id}")
}

pub fn pt_conversion_available(executable: &str, first_run_network: bool) -> String {
    if first_run_network {
        format!("可使用 {executable} 转换 .pt 模型；首次转换将联网下载 ultralytics 依赖")
    } else {
        format!("可使用 {executable} 转换 .pt 模型")
    }
}

pub fn pt_conversion_unavailable_with_details(failures: &[String]) -> String {
    if failures.is_empty() {
        PT_CONVERSION_UNAVAILABLE.to_string()
    } else {
        format!(
            "{}。探测详情：{}",
            PT_CONVERSION_UNAVAILABLE,
            failures.join("；")
        )
    }
}

pub fn pt_probe_exit_failed(code: Option<i32>) -> String {
    format!(
        "探测进程退出码 {}",
        code.map_or_else(|| "未知".to_string(), |value| value.to_string())
    )
}

pub fn pt_probe_timed_out(seconds: u64) -> String {
    format!("探测超过 {seconds} 秒，已终止进程")
}

pub fn pt_file_missing(path: &std::path::Path) -> String {
    format!(".pt 模型文件不存在：{}", path.display())
}

pub fn pt_file_resolve_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("无法解析 .pt 模型路径 {}：{error}", path.display())
}

pub fn pt_conversion_target_exists(path: &std::path::Path) -> String {
    format!(
        "同名 ONNX 文件已存在，未执行转换以免覆盖：{}。可直接检查并加入该文件",
        path.display()
    )
}

pub fn pt_conversion_already_running(path: &std::path::Path) -> String {
    format!("该模型正在转换：{}", path.display())
}

pub fn pt_conversion_temp_dir_failed(
    parent: &std::path::Path,
    error: impl std::fmt::Display,
) -> String {
    format!("无法在 {} 创建隔离转换目录：{error}", parent.display())
}

pub fn pt_conversion_temp_dir_exhausted(parent: &std::path::Path) -> String {
    format!("无法在 {} 分配唯一的隔离转换目录", parent.display())
}

pub fn pt_conversion_cleanup_failed(path: &std::path::Path) -> String {
    format!("模型转换临时目录清理失败：{}", path.display())
}

pub fn pt_conversion_and_cleanup_failed(error: &str, cleanup_error: &str) -> String {
    format!("{error}；{cleanup_error}")
}

pub fn pt_conversion_stage_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!(
        "无法复制 .pt 模型到隔离转换目录 {}：{error}",
        path.display()
    )
}

pub fn pt_conversion_start_failed(executable: &str, error: impl std::fmt::Display) -> String {
    format!("无法启动 {executable} 进行模型转换：{error}")
}

pub fn pt_conversion_exit_failed(code: Option<i32>, detail: &str) -> String {
    let code = code.map_or_else(|| "未知".to_string(), |value| value.to_string());
    if detail.is_empty() {
        format!("模型转换失败，进程退出码：{code}")
    } else {
        format!("模型转换失败，进程退出码：{code}；日志末尾：{detail}")
    }
}

pub fn pt_conversion_output_missing(path: &std::path::Path) -> String {
    format!("转换完成但未找到 ONNX 产物：{}", path.display())
}

pub fn pt_conversion_publish_failed(
    path: &std::path::Path,
    error: impl std::fmt::Display,
) -> String {
    format!(
        "ONNX 已在隔离目录通过校验，但无法安全发布到 {}（不会覆盖已有文件）：{error}",
        path.display()
    )
}

pub fn pt_conversion_log_failed(path: &std::path::Path, error: impl std::fmt::Display) -> String {
    format!("无法创建模型转换日志 {}：{error}", path.display())
}

pub fn pt_conversion_log_write_failed(error: impl std::fmt::Display) -> String {
    format!("写入模型转换日志失败：{error}")
}

pub fn pt_conversion_timed_out(seconds: u64) -> String {
    format!("模型转换超过 {seconds} 秒，已终止子进程")
}

pub fn pt_conversion_wait_failed(error: impl std::fmt::Display) -> String {
    format!("等待模型转换进程失败：{error}")
}

pub fn pt_conversion_worker_failed(error: impl std::fmt::Display) -> String {
    format!("模型转换后台任务异常结束：{error}")
}

pub fn pt_environment_worker_failed(error: impl std::fmt::Display) -> String {
    format!("转换环境检测后台任务异常结束：{error}")
}
