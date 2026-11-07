pub const INVALID: &str = "恢复副本格式无效或已损坏，请保留副本后排查";
pub const STALE: &str =
    "[RECOVERY_CONFLICT] 恢复副本已由其他窗口更新。请保留双方副本后继续保存，或手动另存当前标注。";
pub const CAPACITY: &str = "恢复数据超过单个读取片段的容量限制，请保留当前标注并联系维护者";
#[cfg(not(windows))]
pub const OPEN_UNSUPPORTED: &str = "当前平台不支持打开恢复副本目录";
pub const FOLDER: &str = "恢复副本需要有效的项目绝对目录";
pub fn failed(error: impl std::fmt::Display) -> String {
    format!("恢复副本读写失败：{error}")
}
