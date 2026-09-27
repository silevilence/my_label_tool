use super::{error, Plan, MAX_BYTES};
use crate::i18n::zh_cn as text;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, mpsc},
    thread,
    time::{Duration, Instant},
};

pub(super) fn resolve(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    let candidates = if path.is_absolute() {
        vec![path.to_path_buf()]
    } else if path.components().count() == 1 {
        std::env::var_os("PATH")
            .map(|paths| {
                std::env::split_paths(&paths)
                    .flat_map(|dir| {
                        let mut result = vec![dir.join(path)];
                        if cfg!(windows) && path.extension().is_none() {
                            result.push(dir.join(format!("{value}.exe")));
                        }
                        result
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        return Err(error(text::TEXT_READ_EXECUTABLE_INVALID));
    };
    let found = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| error(text::TEXT_READ_EXECUTABLE_INVALID))?;
    // Windows CreateProcess must never reinterpret a batch file through cmd.exe.
    if cfg!(windows)
        && !found
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
    {
        return Err(error(text::TEXT_READ_EXECUTABLE_INVALID));
    }
    found.canonicalize().map_err(error)
}
pub(super) fn read_bounded(reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > limit {
        return Err(error(text::TEXT_READ_TOO_LARGE));
    }
    Ok(bytes)
}

pub(super) fn run(
    plan: &Plan,
    timeout_ms: u64,
    paths: &[PathBuf],
    cancel: &AtomicBool,
) -> Result<Vec<String>, String> {
    super::check_cancel(cancel)?;
    if paths.is_empty() {
        return Ok(vec![]);
    }
    let executable = plan
        .executable
        .as_ref()
        .ok_or_else(|| error(text::TEXT_READ_CONFIG_INVALID))?;
    let paths = paths
        .iter()
        .map(std::path::absolute)
        .collect::<Result<Vec<_>, _>>()
        .map_err(error)?;
    let input = serde_json::to_vec(&serde_json::json!({ "paths": paths })).map_err(error)?;
    if input.len() > 8 * 1024 * 1024 {
        return Err(error(text::TEXT_READ_TOO_LARGE));
    }
    let started = Instant::now();
    #[cfg(windows)]
    let mut child = crate::process_control::PipedJobProcess::spawn_host(
        executable,
        &plan.arguments,
        &std::env::temp_dir(),
    )
    .map_err(error)?;
    #[cfg(unix)]
    let mut child = UnixProcess::spawn(executable, &plan.arguments)?;
    let mut stdin = child
        .take_stdin()
        .ok_or_else(|| error(text::TEXT_READ_OUTPUT_INVALID))?;
    let stdout = child
        .take_stdout()
        .ok_or_else(|| error(text::TEXT_READ_OUTPUT_INVALID))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| error(text::TEXT_READ_OUTPUT_INVALID))?;
    let (tx, rx) = mpsc::channel();
    let writer = tx.clone();
    let write_thread = thread::spawn(move || {
        let result = stdin.write_all(&input).map(|()| Vec::new()).map_err(error);
        drop(stdin);
        let _ = writer.send((0, result));
    });
    let output = tx.clone();
    let out_thread = thread::spawn(move || {
        let _ = output.send((1, read_bounded(stdout, MAX_BYTES)));
    });
    let err_thread = thread::spawn(move || {
        let _ = tx.send((2, read_bounded(stderr, 64 * 1024)));
    });
    let mut outputs: [Option<Vec<u8>>; 3] = [None, None, None];
    let result = (|| loop {
        super::check_cancel(cancel)?;
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            return Err(error(text::TEXT_READ_TIMEOUT));
        }
        while let Ok((index, result)) = rx.try_recv() {
            outputs[index] = Some(result?);
        }
        if let Some(status) = child.try_wait().map_err(error)? {
            if outputs.iter().all(Option::is_some) {
                if status != 0 {
                    return Err(error(text::TEXT_READ_PROCESS_FAILED));
                }
                let bytes = outputs[1].take().unwrap_or_default();
                let utf8 = String::from_utf8(bytes).map_err(error)?;
                let values: Vec<String> = serde_json::from_str(&utf8).map_err(error)?;
                if values.len() != paths.len() {
                    return Err(error(text::TEXT_READ_OUTPUT_INVALID));
                }
                return Ok(values);
            }
        }
        thread::sleep(Duration::from_millis(10));
    })();
    let _ = child.terminate_tree();
    let _ = write_thread.join();
    let _ = out_thread.join();
    let _ = err_thread.join();
    result
}

#[cfg(unix)]
struct UnixProcess(std::process::Child);
#[cfg(unix)]
impl UnixProcess {
    fn spawn(executable: &Path, arguments: &[String]) -> Result<Self, String> {
        let mut command = std::process::Command::new(executable);
        command
            .args(arguments)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        crate::process_control::configure_process_group(&mut command);
        command.spawn().map(Self).map_err(error)
    }
    fn take_stdin(&mut self) -> Option<std::process::ChildStdin> {
        self.0.stdin.take()
    }
    fn take_stdout(&mut self) -> Option<std::process::ChildStdout> {
        self.0.stdout.take()
    }
    fn take_stderr(&mut self) -> Option<std::process::ChildStderr> {
        self.0.stderr.take()
    }
    fn try_wait(&mut self) -> Result<Option<i32>, std::io::Error> {
        self.0.try_wait().map(|v| v.map(|s| s.code().unwrap_or(-1)))
    }
    fn terminate_tree(&mut self) -> Result<(), String> {
        let _ = crate::process_control::terminate_process_tree(self.0.id());
        self.0.wait().map(|_| ()).map_err(error)
    }
}
#[cfg(unix)]
impl Drop for UnixProcess {
    fn drop(&mut self) {
        let _ = self.terminate_tree();
    }
}
