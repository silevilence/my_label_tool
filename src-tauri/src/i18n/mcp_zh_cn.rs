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
