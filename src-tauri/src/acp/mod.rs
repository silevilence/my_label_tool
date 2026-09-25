//! Host-only ACP client. One explicitly started session per prompt, no project data access.
pub mod client;
pub mod registry;
mod transport;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub timeout_seconds: u64,
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.executable.as_os_str().is_empty()
            || self.args.len() > 64
            || self
                .args
                .iter()
                .any(|arg| arg.len() > 8192 || arg.contains('\0'))
            || !(1..=600).contains(&self.timeout_seconds)
        {
            return Err(crate::i18n::zh_cn::ACP_CONFIG.into());
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub session_id: String,
    pub stop_reason: String,
}
