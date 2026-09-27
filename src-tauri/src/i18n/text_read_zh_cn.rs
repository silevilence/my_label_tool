pub const TEXT_READ_NATIVE: &str = "原生";
pub const TEXT_READ_PYTHON: &str = "Python";
pub const TEXT_READ_COMMAND: &str = "命令";
pub const TEXT_READ_INTERPRETER: &str = "Python 解释器路径";
pub const TEXT_READ_EXECUTABLE: &str = "可执行文件路径";
pub const TEXT_READ_ARGUMENTS: &str = "参数数组（JSON）";
pub const TEXT_READ_CHECK_DESCRIPTION: &str = "写出含中文、多字节字符的临时文本，再读取并逐字比对";
pub const TEXT_READ_CONFIG_INVALID: &str = "读取模式配置无效，超时须为 100–300000 毫秒";
pub const TEXT_READ_EXECUTABLE_INVALID: &str =
    "找不到可执行程序，请填写绝对路径或 PATH 中的程序名；Windows 仅支持 EXE";
pub const TEXT_READ_CANCELLED: &str = "读取已取消";
pub const TEXT_READ_BUSY: &str = "读取请求标识已被占用";
pub const TEXT_READ_TIMEOUT: &str = "读取程序超时";
pub const TEXT_READ_TOO_LARGE: &str = "读取内容超过大小限制";
pub const TEXT_READ_PROCESS_FAILED: &str = "读取程序退出失败，请检查参数与文件访问权限";
pub const TEXT_READ_OUTPUT_INVALID: &str =
    "输出须为 UTF-8 JSON 字符串数组，数量和顺序与输入路径一致";
pub const TEXT_READ_CHECK_MISMATCH: &str = "读取自检内容不一致，可能读到了密文或乱码";
pub const TEXT_READ_CHECK_OK: &str = "读取自检通过";
pub fn text_read_failed(reason: impl std::fmt::Display) -> String {
    format!(
        "文本读取失败：{reason}。请在设置中检查读取模式、解释器路径与 DLP 策略，重新自检后重试。"
    )
}
