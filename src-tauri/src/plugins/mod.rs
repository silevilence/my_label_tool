pub mod config;
pub mod developer_tools;
pub mod manifest;
pub mod permissions;
pub(crate) mod process_environment;
pub mod protocol;
pub mod registry;
pub mod runtime;
pub(crate) mod runtime_probe;
pub mod versioning;

#[cfg(test)]
mod config_tests;
