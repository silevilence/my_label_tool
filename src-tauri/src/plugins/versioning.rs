//! Independent plugin contract version baselines. Application releases must
//! not change these constants unless the corresponding contract changes.

pub const CURRENT_HOST_API_VERSION: u32 = 1;
pub const SUPPORTED_HOST_API_VERSIONS: &[u32] = &[1];
pub const SUPPORTED_EXPORTER_API_VERSIONS: &[u32] = &[1];
pub const SUPPORTED_PRELABEL_API_VERSIONS: &[u32] = &[1];
pub const PLUGIN_PROTOCOL_VERSION: u32 = 1;
