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

const SAFE_HOST_ENVIRONMENT: [&str; 9] = [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "TZ",
    "NUMBER_OF_PROCESSORS",
];

#[cfg_attr(windows, allow(dead_code))]
pub fn apply_offline_environment(command: &mut Command) {
    command.env_clear();
    for key in SAFE_HOST_ENVIRONMENT {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
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
        let secret_key = "MY_LABEL_TOOL_TEST_SECRET";
        // SAFETY: this test is the only writer of its process-local test key.
        unsafe { std::env::set_var(secret_key, "must-not-reach-plugin") };
        let mut command = Command::new("plugin");
        apply_offline_environment(&mut command);
        let changes = command.get_envs().collect::<Vec<_>>();

        for variable in PROXY_ENVIRONMENT_VARIABLES {
            assert!(!changes.iter().any(|(key, value)| {
                key.to_string_lossy().eq_ignore_ascii_case(variable) && value.is_some()
            }));
        }
        for (key, expected) in OFFLINE_ENVIRONMENT_OVERRIDES {
            assert!(changes.iter().any(|(actual, value)| {
                *actual == OsStr::new(key) && value == &Some(OsStr::new(expected))
            }));
        }
        assert!(!changes
            .iter()
            .any(|(key, value)| *key == OsStr::new(secret_key) && value.is_some()));
        // SAFETY: restore the process environment after the assertion.
        unsafe { std::env::remove_var(secret_key) };
    }
}
