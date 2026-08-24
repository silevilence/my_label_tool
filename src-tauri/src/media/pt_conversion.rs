// 命令计划、任务注册与跨平台进程树共享同一取消/发布锁，以保证已接受的中止不会
// 产出 ONNX；为避免拆分后破坏该生命周期不变量，生产实现暂集中在本模块。
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use crate::{
    i18n::zh_cn as text,
    media::onnx_metadata::{inspect_onnx_bytes, OnnxModelSummary},
};
use serde::{Deserialize, Serialize};

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const LOCAL_CONVERSION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const UVX_CONVERSION_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(50);
const LOG_TAIL_BYTES: u64 = 16 * 1024;
const TEMP_DIR_ATTEMPTS: u64 = 100;

static CONVERSION_TARGETS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
static ACTIVE_CONVERSIONS: OnceLock<Mutex<HashMap<String, std::sync::Arc<ConversionControl>>>> =
    OnceLock::new();
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PtConversionMethod {
    YoloCli,
    PythonUltralytics,
    UvxYolo,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtConversionParameters {
    imgsz: u32,
    simplify: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtConversionPlan {
    parameters: PtConversionParameters,
    method: PtConversionMethod,
    executable: String,
    command: String,
    timeout_seconds: u64,
}

impl Default for PtConversionParameters {
    fn default() -> Self {
        Self {
            imgsz: 640,
            simplify: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtConversionEnvironment {
    available: bool,
    method: Option<PtConversionMethod>,
    executable: Option<String>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtConversionResult {
    path: String,
    method: PtConversionMethod,
    #[serde(flatten)]
    summary: OnnxModelSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtConversionCommandError {
    code: PtConversionErrorCode,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum PtConversionErrorCode {
    Cancelled,
    Failed,
}

impl From<String> for PtConversionCommandError {
    fn from(message: String) -> Self {
        let code = if message == text::PT_CONVERSION_CANCELLED {
            PtConversionErrorCode::Cancelled
        } else {
            PtConversionErrorCode::Failed
        };
        Self { code, message }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PtCancellationStatus {
    Accepted,
    AlreadyCompleted,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtCancellationResult {
    status: PtCancellationStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PtConversionEvent {
    Started {
        conversion_id: String,
        command: String,
        timeout_seconds: u64,
    },
    Output {
        conversion_id: String,
        line: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ConversionCandidate {
    method: PtConversionMethod,
    conversion_executable: &'static str,
    probes: &'static [ConversionProbe],
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ConversionProbe {
    executable: &'static str,
    arguments: &'static [&'static str],
}

#[derive(Debug)]
struct ProcessOutcome {
    status: ExitStatus,
    log_tail: String,
}

#[derive(Default)]
struct ConversionControl {
    cancelled: AtomicBool,
    completed: AtomicBool,
    finalize_lock: Mutex<()>,
}

impl ConversionControl {
    fn cancel(&self) -> Result<PtCancellationStatus, String> {
        let _guard = self
            .finalize_lock
            .lock()
            .map_err(|_| text::PT_CONVERSION_LOCK_FAILED.to_string())?;
        if self.completed.load(Ordering::Acquire) {
            return Ok(PtCancellationStatus::AlreadyCompleted);
        }
        self.cancelled.store(true, Ordering::Release);
        Ok(PtCancellationStatus::Accepted)
    }

    fn publish(&self, staged: &Path, target: &Path) -> Result<(), String> {
        let _guard = self
            .finalize_lock
            .lock()
            .map_err(|_| text::PT_CONVERSION_LOCK_FAILED.to_string())?;
        if self.cancelled.load(Ordering::Acquire) {
            return Err(text::PT_CONVERSION_CANCELLED.to_string());
        }
        publish_staged_output(staged, target)?;
        self.completed.store(true, Ordering::Release);
        Ok(())
    }
}

struct ConversionRegistration {
    conversion_id: String,
    control: std::sync::Arc<ConversionControl>,
}

fn register_conversion(conversion_id: &str) -> Result<ConversionRegistration, String> {
    if conversion_id.trim().is_empty() {
        return Err(text::PT_CONVERSION_ID_INVALID.to_string());
    }
    let conversions = ACTIVE_CONVERSIONS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut conversions = conversions
        .lock()
        .map_err(|_| text::PT_CONVERSION_LOCK_FAILED.to_string())?;
    if conversions.contains_key(conversion_id) {
        return Err(text::pt_conversion_id_already_running(conversion_id));
    }
    let control = std::sync::Arc::new(ConversionControl::default());
    conversions.insert(conversion_id.to_string(), std::sync::Arc::clone(&control));
    Ok(ConversionRegistration {
        conversion_id: conversion_id.to_string(),
        control,
    })
}

fn cancel_registered_conversion(conversion_id: &str) -> Result<PtCancellationResult, String> {
    let conversions = ACTIVE_CONVERSIONS.get_or_init(|| Mutex::new(HashMap::new()));
    let conversions = conversions
        .lock()
        .map_err(|_| text::PT_CONVERSION_LOCK_FAILED.to_string())?;
    let control = conversions
        .get(conversion_id)
        .ok_or_else(|| text::pt_conversion_id_missing(conversion_id))?;
    control
        .cancel()
        .map(|status| PtCancellationResult { status })
}

pub fn cancel_all_pt_conversions() {
    if let Some(conversions) = ACTIVE_CONVERSIONS.get() {
        if let Ok(conversions) = conversions.lock() {
            for control in conversions.values() {
                let _ = control.cancel();
            }
        }
    }
}

pub fn cancel_all_pt_conversions_and_wait() {
    cancel_all_pt_conversions();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let is_empty = ACTIVE_CONVERSIONS
            .get()
            .and_then(|conversions| conversions.lock().ok())
            .is_none_or(|conversions| conversions.is_empty());
        if is_empty {
            return;
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
}

impl Drop for ConversionRegistration {
    fn drop(&mut self) {
        if let Some(conversions) = ACTIVE_CONVERSIONS.get() {
            if let Ok(mut conversions) = conversions.lock() {
                conversions.remove(&self.conversion_id);
            }
        }
    }
}

#[derive(Default)]
struct OutputNormalizer {
    pending: Vec<u8>,
    skip_line_feed: bool,
}

impl OutputNormalizer {
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        for byte in bytes {
            if self.skip_line_feed {
                self.skip_line_feed = false;
                if *byte == b'\n' {
                    continue;
                }
            }
            if matches!(*byte, b'\r' | b'\n') {
                self.push_pending_line(&mut lines);
                self.skip_line_feed = *byte == b'\r';
            } else {
                self.pending.push(*byte);
            }
        }
        lines
    }

    fn finish(&mut self) -> Vec<String> {
        let mut lines = Vec::new();
        self.push_pending_line(&mut lines);
        lines
    }

    fn push_pending_line(&mut self, lines: &mut Vec<String>) {
        let line = String::from_utf8_lossy(&self.pending)
            .trim_end()
            .to_string();
        self.pending.clear();
        if !line.is_empty() {
            lines.push(line);
        }
    }
}

#[derive(Clone, Copy)]
enum OutputStream {
    Stdout,
    Stderr,
}

struct OutputChunk {
    stream: OutputStream,
    bytes: Vec<u8>,
}

struct ChildProcessGuard {
    child: Child,
    stdout_reader: Option<thread::JoinHandle<()>>,
    stderr_reader: Option<thread::JoinHandle<()>>,
    reaped: bool,
}

impl ChildProcessGuard {
    fn terminate(&mut self) -> Result<(), String> {
        let termination = terminate_process_tree(self.child.id());
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.reaped = true;
        self.join_readers();
        termination
    }

    fn finish(&mut self) {
        self.reaped = true;
        self.join_readers();
    }

    fn join_readers(&mut self) {
        join_output_readers(self.stdout_reader.take(), self.stderr_reader.take());
    }
}

impl Drop for ChildProcessGuard {
    fn drop(&mut self) {
        if !self.reaped {
            let _ = terminate_process_tree(self.child.id());
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.join_readers();
        }
    }
}

#[derive(Default)]
struct OutputNormalizers {
    stdout: OutputNormalizer,
    stderr: OutputNormalizer,
}

impl OutputNormalizers {
    fn push(&mut self, stream: OutputStream, bytes: &[u8]) -> Vec<String> {
        match stream {
            OutputStream::Stdout => self.stdout.push(bytes),
            OutputStream::Stderr => self.stderr.push(bytes),
        }
    }

    fn finish(&mut self) -> Vec<String> {
        let mut lines = self.stdout.finish();
        lines.extend(self.stderr.finish());
        lines
    }
}

struct ConversionReservation {
    target: PathBuf,
}

struct TemporaryDirectory {
    path: PathBuf,
    cleaned: bool,
}

const YOLO_PROBES: [ConversionProbe; 1] = [ConversionProbe {
    executable: "yolo",
    arguments: &["--help"],
}];
const PYTHON_PROBES: [ConversionProbe; 1] = [ConversionProbe {
    executable: "python",
    arguments: &["-c", "import ultralytics"],
}];
const PYTHON3_PROBES: [ConversionProbe; 1] = [ConversionProbe {
    executable: "python3",
    arguments: &["-c", "import ultralytics"],
}];
const PY_PROBES: [ConversionProbe; 1] = [ConversionProbe {
    executable: "py",
    arguments: &["-c", "import ultralytics"],
}];
const UVX_PROBES: [ConversionProbe; 2] = [
    ConversionProbe {
        executable: "uv",
        arguments: &["--version"],
    },
    ConversionProbe {
        executable: "uvx",
        arguments: &["--version"],
    },
];

const CANDIDATES: [ConversionCandidate; 5] = [
    ConversionCandidate {
        method: PtConversionMethod::YoloCli,
        conversion_executable: "yolo",
        probes: &YOLO_PROBES,
    },
    ConversionCandidate {
        method: PtConversionMethod::PythonUltralytics,
        conversion_executable: "python",
        probes: &PYTHON_PROBES,
    },
    ConversionCandidate {
        method: PtConversionMethod::PythonUltralytics,
        conversion_executable: "python3",
        probes: &PYTHON3_PROBES,
    },
    ConversionCandidate {
        method: PtConversionMethod::PythonUltralytics,
        conversion_executable: "py",
        probes: &PY_PROBES,
    },
    ConversionCandidate {
        method: PtConversionMethod::UvxYolo,
        conversion_executable: "uvx",
        probes: &UVX_PROBES,
    },
];

pub async fn detect_pt_conversion_environment() -> Result<PtConversionEnvironment, String> {
    tauri::async_runtime::spawn_blocking(detect_environment)
        .await
        .map_err(text::pt_environment_worker_failed)
}

pub fn preview_pt_conversion_command(
    pt_path: PathBuf,
    parameters: PtConversionParameters,
    conversion_id: String,
    environment: PtConversionEnvironment,
) -> Result<PtConversionPlan, String> {
    build_conversion_plan(&pt_path, parameters, &conversion_id, &environment)
}

fn detect_environment() -> PtConversionEnvironment {
    detect_environment_with(|executable, arguments| {
        probe_command(executable, arguments, PROBE_TIMEOUT)
    })
}

pub async fn convert_pt_to_onnx(
    pt_path: PathBuf,
    plan: PtConversionPlan,
    conversion_id: String,
    mut on_event: impl FnMut(PtConversionEvent) + Send + 'static,
) -> Result<PtConversionResult, String> {
    validate_conversion_plan(&pt_path, &conversion_id, &plan)?;
    let registration = register_conversion(&conversion_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _registration = registration;
        let environment = PtConversionEnvironment {
            available: true,
            method: Some(plan.method),
            executable: Some(plan.executable.clone()),
            message: String::new(),
        };
        convert_pt_with_progress(
            &pt_path,
            &environment,
            plan.parameters,
            &_registration.control,
            &conversion_id,
            &mut on_event,
        )
    })
    .await
    .map_err(text::pt_conversion_worker_failed)?
}

pub fn cancel_pt_conversion(conversion_id: String) -> Result<PtCancellationResult, String> {
    cancel_registered_conversion(&conversion_id)
}

#[cfg(test)]
fn convert_pt_to_onnx_blocking(pt_path: &Path) -> Result<PtConversionResult, String> {
    let environment = detect_environment();
    convert_pt_with_environment(pt_path, &environment)
}

#[cfg(test)]
fn convert_pt_with_environment(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
) -> Result<PtConversionResult, String> {
    let control = ConversionControl::default();
    convert_pt_with_environment_and_progress(
        pt_path,
        environment,
        PtConversionParameters::default(),
        &control,
        &mut |_| {},
    )
}

fn convert_pt_with_progress(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
    parameters: PtConversionParameters,
    control: &ConversionControl,
    conversion_id: &str,
    on_event: &mut impl FnMut(PtConversionEvent),
) -> Result<PtConversionResult, String> {
    let method = environment
        .method
        .ok_or_else(|| text::PT_CONVERSION_UNAVAILABLE.to_string())?;
    convert_pt_with_parameters_and_id(
        pt_path,
        environment,
        parameters,
        Some(conversion_id),
        || control.cancelled.load(Ordering::Acquire),
        |executable, arguments, working_directory, log_path| {
            on_event(PtConversionEvent::Started {
                conversion_id: conversion_id.to_string(),
                command: display_command(executable, arguments),
                timeout_seconds: conversion_timeout(method).as_secs(),
            });
            run_conversion_process(
                executable,
                arguments,
                method,
                working_directory,
                log_path,
                control,
                &mut |line| {
                    on_event(PtConversionEvent::Output {
                        conversion_id: conversion_id.to_string(),
                        line,
                    });
                },
            )
        },
        inspect_onnx_model,
        |staged, target| control.publish(staged, target),
    )
}

#[cfg(test)]
fn convert_pt_with_environment_and_progress(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
    parameters: PtConversionParameters,
    control: &ConversionControl,
    on_output: &mut impl FnMut(String),
) -> Result<PtConversionResult, String> {
    convert_pt_with_parameters(
        pt_path,
        environment,
        parameters,
        |executable, arguments, working_directory, log_path| {
            let method = environment
                .method
                .ok_or_else(|| text::PT_CONVERSION_UNAVAILABLE.to_string())?;
            run_conversion_process(
                executable,
                arguments,
                method,
                working_directory,
                log_path,
                control,
                on_output,
            )
        },
        inspect_onnx_model,
    )
}

#[cfg(test)]
fn convert_pt_with(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
    runner: impl FnOnce(&str, &[String], &Path, &Path) -> Result<ProcessOutcome, String>,
    inspector: impl FnOnce(PathBuf) -> Result<OnnxModelSummary, String>,
) -> Result<PtConversionResult, String> {
    convert_pt_with_parameters(
        pt_path,
        environment,
        PtConversionParameters::default(),
        runner,
        inspector,
    )
}

#[cfg(test)]
fn convert_pt_with_parameters(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
    parameters: PtConversionParameters,
    runner: impl FnOnce(&str, &[String], &Path, &Path) -> Result<ProcessOutcome, String>,
    inspector: impl FnOnce(PathBuf) -> Result<OnnxModelSummary, String>,
) -> Result<PtConversionResult, String> {
    convert_pt_with_parameters_and_id(
        pt_path,
        environment,
        parameters,
        None,
        || false,
        runner,
        inspector,
        publish_staged_output,
    )
}

// Test seams keep process execution, inspection, and publishing replaceable so
// cancellation can be verified at every lifecycle boundary.
#[allow(clippy::too_many_arguments)]
fn convert_pt_with_parameters_and_id(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
    parameters: PtConversionParameters,
    conversion_id: Option<&str>,
    is_cancelled: impl Fn() -> bool,
    runner: impl FnOnce(&str, &[String], &Path, &Path) -> Result<ProcessOutcome, String>,
    inspector: impl FnOnce(PathBuf) -> Result<OnnxModelSummary, String>,
    publisher: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> Result<PtConversionResult, String> {
    validate_conversion_parameters(parameters)?;
    if is_cancelled() {
        return Err(text::PT_CONVERSION_CANCELLED.to_string());
    }
    let canonical_pt = ensure_pt_file(pt_path)?;
    let target = canonical_pt.with_extension("onnx");
    if target.exists() {
        return Err(text::pt_conversion_target_exists(&target));
    }
    let _reservation = reserve_target(&target)?;
    let method = environment
        .method
        .ok_or_else(|| text::PT_CONVERSION_UNAVAILABLE.to_string())?;
    let executable = environment
        .executable
        .as_deref()
        .ok_or_else(|| text::PT_CONVERSION_UNAVAILABLE.to_string())?;

    let parent = canonical_pt.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = TemporaryDirectory::create(parent, conversion_id)?;
    let conversion_result = (|| -> Result<PtConversionResult, String> {
        let file_name = canonical_pt
            .file_name()
            .ok_or_else(|| text::pt_file_missing(&canonical_pt))?;
        let staged_pt = temporary.path.join(file_name);
        fs::copy(&canonical_pt, &staged_pt)
            .map_err(|error| text::pt_conversion_stage_failed(&canonical_pt, error))?;
        let staged_onnx = staged_pt.with_extension("onnx");
        let log_path = temporary.path.join("conversion.log");
        let arguments = conversion_arguments(method, &staged_pt, parameters);
        let outcome = runner(executable, &arguments, parent, &log_path)?;
        if is_cancelled() {
            return Err(text::PT_CONVERSION_CANCELLED.to_string());
        }
        if !outcome.status.success() {
            return Err(text::pt_conversion_exit_failed(
                outcome.status.code(),
                &outcome.log_tail,
            ));
        }
        if !staged_onnx.is_file() {
            return Err(text::pt_conversion_output_missing(&staged_onnx));
        }
        let summary = inspector(staged_onnx.clone())?;
        if is_cancelled() {
            return Err(text::PT_CONVERSION_CANCELLED.to_string());
        }

        publisher(&staged_onnx, &target)?;
        Ok(PtConversionResult {
            path: process_compatible_path(&target),
            method,
            summary,
        })
    })();
    let cleanup_result = temporary.cleanup();
    match (conversion_result, cleanup_result) {
        (Ok(result), Ok(())) => Ok(result),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(cleanup_error)) => Err(cleanup_error),
        (Err(error), Err(cleanup_error)) => Err(text::pt_conversion_and_cleanup_failed(
            &error,
            &cleanup_error,
        )),
    }
}

fn publish_staged_output(staged: &Path, target: &Path) -> Result<(), String> {
    fs::hard_link(staged, target).map_err(|error| text::pt_conversion_publish_failed(target, error))
}

fn inspect_onnx_model(path: PathBuf) -> Result<OnnxModelSummary, String> {
    let bytes = fs::read(&path).map_err(text::read_onnx_failed)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    inspect_onnx_bytes(&bytes, file_name)
}

fn ensure_pt_file(path: &Path) -> Result<PathBuf, String> {
    let valid_extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pt"));
    if !valid_extension {
        return Err(text::select_extension("pt"));
    }
    if !path.is_file() {
        return Err(text::pt_file_missing(path));
    }
    path.canonicalize()
        .map_err(|error| text::pt_file_resolve_failed(path, error))
}

fn reserve_target(target: &Path) -> Result<ConversionReservation, String> {
    let targets = CONVERSION_TARGETS.get_or_init(|| Mutex::new(HashSet::new()));
    let mut targets = targets
        .lock()
        .map_err(|_| text::PT_CONVERSION_LOCK_FAILED.to_string())?;
    if !targets.insert(target.to_path_buf()) {
        return Err(text::pt_conversion_already_running(target));
    }
    Ok(ConversionReservation {
        target: target.to_path_buf(),
    })
}

impl Drop for ConversionReservation {
    fn drop(&mut self) {
        if let Some(targets) = CONVERSION_TARGETS.get() {
            if let Ok(mut targets) = targets.lock() {
                targets.remove(&self.target);
            }
        }
    }
}

impl TemporaryDirectory {
    fn create(parent: &Path, conversion_id: Option<&str>) -> Result<Self, String> {
        if let Some(conversion_id) = conversion_id {
            validate_conversion_id(conversion_id)?;
            let path = parent.join(format!(".my-label-tool-convert-{conversion_id}"));
            fs::create_dir(&path)
                .map_err(|error| text::pt_conversion_temp_dir_failed(parent, error))?;
            return Ok(Self {
                path,
                cleaned: false,
            });
        }
        for _ in 0..TEMP_DIR_ATTEMPTS {
            let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!(
                ".my-label-tool-convert-{}-{counter}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => {
                    return Ok(Self {
                        path,
                        cleaned: false,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(text::pt_conversion_temp_dir_failed(parent, error)),
            }
        }
        Err(text::pt_conversion_temp_dir_exhausted(parent))
    }

    fn cleanup(&mut self) -> Result<(), String> {
        for _ in 0..40 {
            match fs::remove_dir_all(&self.path) {
                Ok(()) => {
                    self.cleaned = true;
                    return Ok(());
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    self.cleaned = true;
                    return Ok(());
                }
                Err(_) => thread::sleep(PROCESS_POLL_INTERVAL),
            }
        }
        Err(text::pt_conversion_cleanup_failed(&self.path))
    }
}

fn validate_conversion_id(conversion_id: &str) -> Result<(), String> {
    if conversion_id.is_empty()
        || conversion_id.len() > 64
        || !conversion_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(text::PT_CONVERSION_ID_INVALID.to_string());
    }
    Ok(())
}

fn build_conversion_plan(
    pt_path: &Path,
    parameters: PtConversionParameters,
    conversion_id: &str,
    environment: &PtConversionEnvironment,
) -> Result<PtConversionPlan, String> {
    validate_conversion_parameters(parameters)?;
    validate_conversion_id(conversion_id)?;
    let canonical_pt = ensure_pt_file(pt_path)?;
    let method = environment
        .method
        .ok_or_else(|| text::PT_CONVERSION_UNAVAILABLE.to_string())?;
    let executable = environment
        .executable
        .clone()
        .ok_or_else(|| text::PT_CONVERSION_UNAVAILABLE.to_string())?;
    let parent = canonical_pt.parent().unwrap_or_else(|| Path::new("."));
    let file_name = canonical_pt
        .file_name()
        .ok_or_else(|| text::pt_file_missing(&canonical_pt))?;
    let staged_pt = parent
        .join(format!(".my-label-tool-convert-{conversion_id}"))
        .join(file_name);
    let arguments = conversion_arguments(method, &staged_pt, parameters);
    Ok(PtConversionPlan {
        parameters,
        method,
        executable: executable.clone(),
        command: display_command(&executable, &arguments),
        timeout_seconds: conversion_timeout(method).as_secs(),
    })
}

fn validate_conversion_plan(
    pt_path: &Path,
    conversion_id: &str,
    plan: &PtConversionPlan,
) -> Result<(), String> {
    let valid_executable = match plan.method {
        PtConversionMethod::YoloCli => plan.executable == "yolo",
        PtConversionMethod::PythonUltralytics => {
            matches!(plan.executable.as_str(), "python" | "python3" | "py")
        }
        PtConversionMethod::UvxYolo => plan.executable == "uvx",
    };
    if !valid_executable {
        return Err(text::PT_CONVERSION_PLAN_INVALID.to_string());
    }
    let environment = PtConversionEnvironment {
        available: true,
        method: Some(plan.method),
        executable: Some(plan.executable.clone()),
        message: String::new(),
    };
    let expected = build_conversion_plan(pt_path, plan.parameters, conversion_id, &environment)?;
    if &expected != plan {
        return Err(text::PT_CONVERSION_PLAN_INVALID.to_string());
    }
    Ok(())
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        if !self.cleaned {
            if let Err(error) = self.cleanup() {
                eprintln!("{error}");
            }
        }
    }
}

fn detect_environment_with(
    mut probe: impl FnMut(&str, &[&str]) -> Result<(), String>,
) -> PtConversionEnvironment {
    let mut failures = Vec::new();
    for candidate in CANDIDATES {
        let result = candidate.probes.iter().try_for_each(|command| {
            probe(command.executable, command.arguments)
                .map_err(|error| format!("{}：{error}", command.executable))
        });
        match result {
            Ok(()) => {
                return PtConversionEnvironment {
                    available: true,
                    method: Some(candidate.method),
                    executable: Some(candidate.conversion_executable.to_string()),
                    message: text::pt_conversion_available(
                        candidate.conversion_executable,
                        candidate.method == PtConversionMethod::UvxYolo,
                    ),
                };
            }
            Err(error) => failures.push(error),
        }
    }
    PtConversionEnvironment {
        available: false,
        method: None,
        executable: None,
        message: text::pt_conversion_unavailable_with_details(&failures),
    }
}

fn validate_conversion_parameters(parameters: PtConversionParameters) -> Result<(), String> {
    if parameters.imgsz == 0 || !parameters.imgsz.is_multiple_of(32) {
        return Err(text::PT_CONVERSION_IMGSZ_INVALID.to_string());
    }
    Ok(())
}

fn conversion_arguments(
    method: PtConversionMethod,
    pt_path: &Path,
    parameters: PtConversionParameters,
) -> Vec<String> {
    let path = process_compatible_path(pt_path);
    let imgsz = format!("imgsz={}", parameters.imgsz);
    let simplify = format!(
        "simplify={}",
        if parameters.simplify { "True" } else { "False" }
    );
    match method {
        PtConversionMethod::YoloCli => vec![
            "export".to_string(),
            format!("model={path}"),
            "format=onnx".to_string(),
            imgsz,
            simplify,
        ],
        PtConversionMethod::PythonUltralytics => vec![
            "-c".to_string(),
            "from ultralytics import YOLO; import sys; YOLO(sys.argv[1]).export(format='onnx', imgsz=int(sys.argv[2]), simplify=sys.argv[3] == 'true')"
                .to_string(),
            path,
            parameters.imgsz.to_string(),
            parameters.simplify.to_string(),
        ],
        PtConversionMethod::UvxYolo => vec![
            "--from".to_string(),
            "ultralytics".to_string(),
            "yolo".to_string(),
            "export".to_string(),
            format!("model={path}"),
            "format=onnx".to_string(),
            imgsz,
            simplify,
        ],
    }
}

fn process_compatible_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(network_path) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{network_path}");
        }
        if let Some(local_path) = path.strip_prefix(r"\\?\") {
            return local_path.to_string();
        }
    }
    path.into_owned()
}

fn display_command(executable: &str, arguments: &[String]) -> String {
    std::iter::once(executable.to_string())
        .chain(arguments.iter().map(|argument| {
            if argument.chars().any(char::is_whitespace) {
                format!("\"{}\"", argument.replace('"', "\\\""))
            } else {
                argument.clone()
            }
        }))
        .collect::<Vec<_>>()
        .join(" ")
}

fn probe_command(executable: &str, arguments: &[&str], timeout: Duration) -> Result<(), String> {
    let mut child = offline_command(executable)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| text::pt_conversion_start_failed(executable, error))?;
    match wait_for_child(&mut child, timeout)? {
        Some(status) if status.success() => Ok(()),
        Some(status) => Err(text::pt_probe_exit_failed(status.code())),
        None => Err(text::pt_probe_timed_out(timeout.as_secs())),
    }
}

fn run_conversion_process(
    executable: &str,
    arguments: &[String],
    method: PtConversionMethod,
    working_directory: &Path,
    log_path: &Path,
    control: &ConversionControl,
    on_output: &mut impl FnMut(String),
) -> Result<ProcessOutcome, String> {
    let mut log =
        File::create(log_path).map_err(|error| text::pt_conversion_log_failed(log_path, error))?;
    let timeout = conversion_timeout(method);
    let mut command = conversion_command(executable, method);
    command
        .args(arguments)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| text::pt_conversion_start_failed(executable, error))?;
    let (sender, receiver) = mpsc::channel();
    let stdout_reader = child
        .stdout
        .take()
        .map(|stdout| spawn_output_reader(stdout, OutputStream::Stdout, sender.clone()));
    let stderr_reader = child
        .stderr
        .take()
        .map(|stderr| spawn_output_reader(stderr, OutputStream::Stderr, sender.clone()));
    drop(sender);
    let mut process = ChildProcessGuard {
        child,
        stdout_reader,
        stderr_reader,
        reaped: false,
    };

    let started = Instant::now();
    let mut normalizers = OutputNormalizers::default();
    let status = loop {
        drain_output(&receiver, &mut normalizers, &mut log, on_output)?;
        if control.cancelled.load(Ordering::Acquire) {
            let termination = process.terminate();
            drain_output(&receiver, &mut normalizers, &mut log, on_output)?;
            finish_output(&mut normalizers, &mut log, on_output)?;
            thread::sleep(PROCESS_POLL_INTERVAL);
            termination?;
            return Err(text::PT_CONVERSION_CANCELLED.to_string());
        }
        match process.child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(PROCESS_POLL_INTERVAL),
            Ok(None) => {
                let termination = process.terminate();
                drain_output(&receiver, &mut normalizers, &mut log, on_output)?;
                finish_output(&mut normalizers, &mut log, on_output)?;
                thread::sleep(PROCESS_POLL_INTERVAL);
                termination?;
                return Err(text::pt_conversion_timed_out(timeout.as_secs()));
            }
            Err(error) => return Err(text::pt_conversion_wait_failed(error)),
        }
    };
    process.finish();
    drain_output(&receiver, &mut normalizers, &mut log, on_output)?;
    finish_output(&mut normalizers, &mut log, on_output)?;
    Ok(ProcessOutcome {
        status,
        log_tail: read_log_tail(log_path),
    })
}

fn spawn_output_reader(
    mut reader: impl Read + Send + 'static,
    stream: OutputStream,
    sender: mpsc::Sender<OutputChunk>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(length) => {
                    if sender
                        .send(OutputChunk {
                            stream,
                            bytes: buffer[..length].to_vec(),
                        })
                        .is_err()
                    {
                        return;
                    }
                }
            }
        }
    })
}

fn join_output_readers(
    stdout_reader: Option<thread::JoinHandle<()>>,
    stderr_reader: Option<thread::JoinHandle<()>>,
) {
    if let Some(reader) = stdout_reader {
        let _ = reader.join();
    }
    if let Some(reader) = stderr_reader {
        let _ = reader.join();
    }
}

fn drain_output(
    receiver: &mpsc::Receiver<OutputChunk>,
    normalizers: &mut OutputNormalizers,
    log: &mut File,
    on_output: &mut impl FnMut(String),
) -> Result<(), String> {
    while let Ok(chunk) = receiver.try_recv() {
        emit_output_lines(normalizers.push(chunk.stream, &chunk.bytes), log, on_output)?;
    }
    Ok(())
}

fn finish_output(
    normalizers: &mut OutputNormalizers,
    log: &mut File,
    on_output: &mut impl FnMut(String),
) -> Result<(), String> {
    emit_output_lines(normalizers.finish(), log, on_output)
}

fn emit_output_lines(
    lines: Vec<String>,
    log: &mut File,
    on_output: &mut impl FnMut(String),
) -> Result<(), String> {
    for line in lines {
        writeln!(log, "{line}").map_err(text::pt_conversion_log_write_failed)?;
        log.flush().map_err(text::pt_conversion_log_write_failed)?;
        on_output(line);
    }
    Ok(())
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(_: &mut Command) {}

#[cfg(windows)]
fn terminate_process_tree(process_id: u32) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(text::pt_process_tree_termination_failed)?;
    if status.success() {
        Ok(())
    } else {
        Err(text::pt_process_tree_termination_exit_failed(status.code()))
    }
}

#[cfg(unix)]
fn terminate_process_tree(process_id: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .args(["-KILL", &format!("-{process_id}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(text::pt_process_tree_termination_failed)?;
    if status.success() {
        Ok(())
    } else {
        Err(text::pt_process_tree_termination_exit_failed(status.code()))
    }
}

fn offline_command(executable: &str) -> Command {
    let mut command = Command::new(executable);
    command
        .env("YOLO_AUTOINSTALL", "false")
        .env("YOLO_OFFLINE", "true")
        .env("PIP_NO_INDEX", "1")
        .env("HF_HUB_OFFLINE", "1");
    command
}

fn conversion_command(executable: &str, method: PtConversionMethod) -> Command {
    let mut command = offline_command(executable);
    if method == PtConversionMethod::UvxYolo {
        command
            .env_remove("PIP_NO_INDEX")
            .env_remove("HF_HUB_OFFLINE");
    }
    command
}

fn conversion_timeout(method: PtConversionMethod) -> Duration {
    if method == PtConversionMethod::UvxYolo {
        UVX_CONVERSION_TIMEOUT
    } else {
        LOCAL_CONVERSION_TIMEOUT
    }
}

fn wait_for_child(child: &mut Child, timeout: Duration) -> Result<Option<ExitStatus>, String> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) if started.elapsed() < timeout => thread::sleep(PROCESS_POLL_INTERVAL),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(None);
            }
            Err(error) => return Err(text::pt_conversion_wait_failed(error)),
        }
    }
}

fn read_log_tail(path: &Path) -> String {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return String::new(),
    };
    let length = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    if length > LOG_TAIL_BYTES && file.seek(SeekFrom::Start(length - LOG_TAIL_BYTES)).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes).trim().to_string()
}

#[cfg(test)]
#[path = "pt_conversion_tests.rs"]
mod tests;
