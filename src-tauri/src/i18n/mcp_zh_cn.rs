pub const INVALID: &str = "MCP 参数或协议消息无效";
pub const LOOPBACK: &str = "MCP 仅允许监听本机回环地址，端口须为 1–65535";
pub const AUTH: &str = "MCP 令牌缺失或无效";
pub const ORIGIN: &str = "MCP 请求来源或 Host 不被允许";
pub const SESSION: &str = "MCP 会话已失效，请重新初始化";
pub const READY: &str = "MCP 宿主尚未就绪或已停止";
pub const LIMIT: &str = "MCP 请求数量或大小超过限制";
pub const TIMEOUT: &str = "MCP 请求超时，请先读取状态确认结果";
pub const INTERNAL: &str = "MCP 内部状态不可用";
pub const METHOD: &str = "MCP 方法不存在或不支持";
pub fn failed(error: impl std::fmt::Display) -> String {
    format!("MCP 服务失败：{error}")
}
pub const OUTPUT_PATH: &str = "MCP 输出路径无效，或经过符号链接/重解析点";
pub const OUTPUT_CANCELLED: &str = "MCP 输出已取消或操作权限失效";
pub const OUTPUT_CHANGED: &str = "MCP 输出文件已变化或尚未确认覆盖，请重新执行";
pub const OUTPUT_ROLLBACK: &str = "MCP 文件写入失败且回滚未全部成功，请检查目标目录";
pub fn output_rollback(paths: &[std::path::PathBuf]) -> String {
    format!("{}：{:?}", OUTPUT_ROLLBACK, paths)
}
