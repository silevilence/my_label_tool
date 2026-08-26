use std::process::Command;

pub const OFFLINE_ENVIRONMENT_OVERRIDES: [(&str, &str); 4] = [
    ("YOLO_AUTOINSTALL", "false"),
    ("YOLO_OFFLINE", "true"),
    ("PIP_NO_INDEX", "1"),
    ("HF_HUB_OFFLINE", "1"),
];

pub const PROXY_ENVIRONMENT_VARIABLES: [&str; 10] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "FTP_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "ftp_proxy",
    "no_proxy",
];

#[cfg_attr(windows, allow(dead_code))]
pub fn apply_offline_environment(command: &mut Command) {
    for (key, value) in OFFLINE_ENVIRONMENT_OVERRIDES {
        command.env(key, value);
    }
    for variable in PROXY_ENVIRONMENT_VARIABLES {
        command.env_remove(variable);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn command_environment_removes_all_proxy_spellings_and_sets_offline_flags() {
        let mut command = Command::new("plugin");
        apply_offline_environment(&mut command);
        let changes = command.get_envs().collect::<Vec<_>>();

        for variable in PROXY_ENVIRONMENT_VARIABLES {
            assert!(changes.iter().any(|(key, value)| {
                key.to_string_lossy().eq_ignore_ascii_case(variable) && value.is_none()
            }));
        }
        for (key, expected) in OFFLINE_ENVIRONMENT_OVERRIDES {
            assert!(changes.iter().any(|(actual, value)| {
                *actual == OsStr::new(key) && value == &Some(OsStr::new(expected))
            }));
        }
    }
}
