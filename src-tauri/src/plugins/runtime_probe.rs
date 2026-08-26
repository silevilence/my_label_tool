use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

use crate::i18n::zh_cn as text;
#[cfg(windows)]
use crate::process_control::SuspendedJobProcess;
#[cfg(unix)]
use crate::process_control::{configure_process_group, terminate_process_tree};
#[cfg(unix)]
use std::process::{Child, Command, Stdio};

const STARTUP_WINDOW: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Starts the declared command and arguments without shell interpolation. A
/// conforming process remains alive waiting for the first NDJSON request.
pub fn probe_plugin_process_available(
    executable: &Path,
    arguments: &[String],
    working_directory: &Path,
) -> Result<(), String> {
    probe_plugin_process_with_window(executable, arguments, working_directory, STARTUP_WINDOW)
}

fn probe_plugin_process_with_window(
    executable: &Path,
    arguments: &[String],
    working_directory: &Path,
    startup_window: Duration,
) -> Result<(), String> {
    #[cfg(windows)]
    let mut process = SuspendedJobProcess::spawn(
        executable,
        arguments,
        working_directory,
        &[
            ("YOLO_AUTOINSTALL", "false"),
            ("YOLO_OFFLINE", "true"),
            ("PIP_NO_INDEX", "1"),
            ("HF_HUB_OFFLINE", "1"),
        ],
    )?;

    #[cfg(unix)]
    let mut process = RuntimeProbeGuard::spawn(executable, arguments, working_directory)?;

    let started = Instant::now();
    loop {
        match probe_status(&mut process) {
            Ok(ProbeStatus::Exited(exit_code)) => {
                let _ = process.terminate_tree();
                return Err(text::plugin_runtime_exited(exit_code));
            }
            Ok(ProbeStatus::Running) if started.elapsed() < startup_window => {
                thread::sleep(POLL_INTERVAL);
            }
            Ok(ProbeStatus::Running) => {
                let _ = process.terminate_tree();
                return Ok(());
            }
            Err(error) => {
                let _ = process.terminate_tree();
                return Err(error);
            }
        }
    }
}

enum ProbeStatus {
    Running,
    Exited(Option<i32>),
}

#[cfg(windows)]
fn probe_status(process: &mut SuspendedJobProcess) -> Result<ProbeStatus, String> {
    process.try_wait().map(|status| {
        status.map_or(ProbeStatus::Running, |exit_code| {
            ProbeStatus::Exited(Some(exit_code))
        })
    })
}

#[cfg(unix)]
fn probe_status(process: &mut RuntimeProbeGuard) -> Result<ProbeStatus, String> {
    process.try_wait()
}

#[cfg(unix)]
struct RuntimeProbeGuard {
    child: Child,
    child_reaped: bool,
    tree_terminated: bool,
}

#[cfg(unix)]
impl RuntimeProbeGuard {
    fn spawn(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
    ) -> Result<Self, String> {
        let display = executable.to_string_lossy();
        let mut command = Command::new(executable);
        command
            .args(arguments)
            .current_dir(working_directory)
            .env("YOLO_AUTOINSTALL", "false")
            .env("YOLO_OFFLINE", "true")
            .env("PIP_NO_INDEX", "1")
            .env("HF_HUB_OFFLINE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_process_group(&mut command);
        let child = command
            .spawn()
            .map_err(|error| text::plugin_runtime_start_failed(&display, error))?;
        Ok(Self {
            child,
            child_reaped: false,
            tree_terminated: false,
        })
    }

    fn try_wait(&mut self) -> Result<ProbeStatus, String> {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                self.child_reaped = true;
                Ok(ProbeStatus::Exited(status.code()))
            }
            Ok(None) => Ok(ProbeStatus::Running),
            Err(error) => Err(text::plugin_runtime_wait_failed(error)),
        }
    }

    fn terminate_tree(&mut self) -> Result<(), String> {
        if self.tree_terminated {
            return Ok(());
        }
        let termination = terminate_process_tree(self.child.id());
        if !self.child_reaped {
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.child_reaped = true;
        }
        self.tree_terminated = true;
        termination
    }
}

#[cfg(unix)]
impl Drop for RuntimeProbeGuard {
    fn drop(&mut self) {
        let _ = self.terminate_tree();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command, time::SystemTime};

    #[test]
    fn declared_waiting_process_is_reaped() {
        let root = std::env::temp_dir();
        let (executable, arguments) = waiting_command();
        probe_plugin_process_available(Path::new(executable), &arguments, &root)
            .expect("startup probe");
    }

    #[test]
    fn early_exit_parent_cannot_leave_a_background_child() {
        let root = test_directory("early-exit-child");
        fs::create_dir_all(&root).expect("create fixture directory");
        let process_id_path = root.join("child.pid");
        let (executable, arguments) = early_exit_command(&process_id_path);

        let error = probe_plugin_process_with_window(
            Path::new(executable),
            &arguments,
            &root,
            Duration::from_secs(10),
        )
        .expect_err("early exit must fail the startup probe");
        assert!(error.contains("退出码：7"), "unexpected error: {error}");

        let process_id = fs::read_to_string(&process_id_path)
            .expect("background child PID")
            .trim()
            .parse::<u32>()
            .expect("numeric background child PID");
        let deadline = Instant::now() + Duration::from_secs(5);
        while process_exists(process_id) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        if process_exists(process_id) {
            force_terminate(process_id);
            panic!("background child {process_id} survived the startup probe");
        }
        fs::remove_dir_all(root).expect("remove fixture directory");
    }

    #[cfg(windows)]
    fn waiting_command() -> (&'static str, Vec<String>) {
        (
            "powershell",
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                "$input | Out-Null".to_string(),
            ],
        )
    }

    #[cfg(windows)]
    fn early_exit_command(process_id_path: &Path) -> (&'static str, Vec<String>) {
        let process_id_path = process_id_path.to_string_lossy().replace('\'', "''");
        (
            "powershell",
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                format!(
                    "$child = Start-Process -PassThru -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30'; Set-Content -LiteralPath '{process_id_path}' -Value $child.Id; exit 7"
                ),
            ],
        )
    }

    #[cfg(windows)]
    fn process_exists(process_id: u32) -> bool {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {process_id}"), "/FO", "CSV", "/NH"])
            .output()
            .expect("query process list");
        String::from_utf8_lossy(&output.stdout).contains(&format!("\"{process_id}\""))
    }

    #[cfg(windows)]
    fn force_terminate(process_id: u32) {
        let _ = Command::new("taskkill")
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .status();
    }

    #[cfg(not(windows))]
    fn waiting_command() -> (&'static str, Vec<String>) {
        ("sh", vec!["-c".to_string(), "cat >/dev/null".to_string()])
    }

    #[cfg(not(windows))]
    fn early_exit_command(process_id_path: &Path) -> (&'static str, Vec<String>) {
        let process_id_path = process_id_path.to_string_lossy().replace('\'', "'\\''");
        (
            "sh",
            vec![
                "-c".to_string(),
                format!(
                    "sleep 0.2; sleep 30 & child=$!; printf '%s\\n' \"$child\" > '{process_id_path}'; exit 7"
                ),
            ],
        )
    }

    #[cfg(not(windows))]
    fn process_exists(process_id: u32) -> bool {
        Command::new("kill")
            .args(["-0", &process_id.to_string()])
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(not(windows))]
    fn force_terminate(process_id: u32) {
        let _ = Command::new("kill")
            .args(["-KILL", &process_id.to_string()])
            .status();
    }

    fn test_directory(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "my-label-tool-runtime-probe-{name}-{}-{nonce}",
            std::process::id()
        ))
    }
}
