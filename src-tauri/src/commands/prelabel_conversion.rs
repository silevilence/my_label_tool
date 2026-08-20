use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::{i18n::zh_cn as text, media::onnx_metadata::OnnxModelSummary};

use super::inspect_onnx_model;

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const CONVERSION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(50);
const LOG_TAIL_BYTES: u64 = 16 * 1024;
const TEMP_DIR_ATTEMPTS: u64 = 100;

static CONVERSION_TARGETS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PtConversionMethod {
    YoloCli,
    PythonUltralytics,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, PartialEq)]
struct ConversionCandidate {
    method: PtConversionMethod,
    executable: &'static str,
}

#[derive(Debug)]
struct ProcessOutcome {
    status: ExitStatus,
    log_tail: String,
}

struct ConversionReservation {
    target: PathBuf,
}

struct TemporaryDirectory {
    path: PathBuf,
}

const CANDIDATES: [ConversionCandidate; 4] = [
    ConversionCandidate {
        method: PtConversionMethod::YoloCli,
        executable: "yolo",
    },
    ConversionCandidate {
        method: PtConversionMethod::PythonUltralytics,
        executable: "python",
    },
    ConversionCandidate {
        method: PtConversionMethod::PythonUltralytics,
        executable: "python3",
    },
    ConversionCandidate {
        method: PtConversionMethod::PythonUltralytics,
        executable: "py",
    },
];

#[tauri::command]
pub async fn detect_pt_conversion_environment() -> Result<PtConversionEnvironment, String> {
    tauri::async_runtime::spawn_blocking(detect_environment)
        .await
        .map_err(text::pt_environment_worker_failed)
}

fn detect_environment() -> PtConversionEnvironment {
    detect_environment_with(|candidate, args| {
        probe_command(candidate.executable, args, PROBE_TIMEOUT)
    })
}

#[tauri::command]
pub async fn convert_pt_to_onnx(pt_path: PathBuf) -> Result<PtConversionResult, String> {
    tauri::async_runtime::spawn_blocking(move || convert_pt_to_onnx_blocking(&pt_path))
        .await
        .map_err(text::pt_conversion_worker_failed)?
}

fn convert_pt_to_onnx_blocking(pt_path: &Path) -> Result<PtConversionResult, String> {
    let environment = detect_environment();
    convert_pt_with_environment(pt_path, &environment)
}

fn convert_pt_with_environment(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
) -> Result<PtConversionResult, String> {
    convert_pt_with(
        pt_path,
        environment,
        run_conversion_process,
        inspect_onnx_model,
    )
}

fn convert_pt_with(
    pt_path: &Path,
    environment: &PtConversionEnvironment,
    runner: impl FnOnce(&str, &[String], &Path, &Path) -> Result<ProcessOutcome, String>,
    inspector: impl FnOnce(PathBuf) -> Result<OnnxModelSummary, String>,
) -> Result<PtConversionResult, String> {
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
    let temporary = TemporaryDirectory::create(parent)?;
    let file_name = canonical_pt
        .file_name()
        .ok_or_else(|| text::pt_file_missing(&canonical_pt))?;
    let staged_pt = temporary.path.join(file_name);
    fs::copy(&canonical_pt, &staged_pt)
        .map_err(|error| text::pt_conversion_stage_failed(&canonical_pt, error))?;
    let staged_onnx = staged_pt.with_extension("onnx");
    let log_path = temporary.path.join("conversion.log");
    let arguments = conversion_arguments(method, &staged_pt);
    let outcome = runner(executable, &arguments, &temporary.path, &log_path)?;
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

    publish_staged_output(&staged_onnx, &target)?;
    Ok(PtConversionResult {
        path: process_compatible_path(&target),
        method,
        summary,
    })
}

fn publish_staged_output(staged: &Path, target: &Path) -> Result<(), String> {
    fs::hard_link(staged, target).map_err(|error| text::pt_conversion_publish_failed(target, error))
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
    fn create(parent: &Path) -> Result<Self, String> {
        for _ in 0..TEMP_DIR_ATTEMPTS {
            let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!(
                ".my-label-tool-convert-{}-{counter}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(text::pt_conversion_temp_dir_failed(parent, error)),
            }
        }
        Err(text::pt_conversion_temp_dir_exhausted(parent))
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn detect_environment_with(
    mut probe: impl FnMut(ConversionCandidate, &[&str]) -> Result<(), String>,
) -> PtConversionEnvironment {
    let mut failures = Vec::new();
    for candidate in CANDIDATES {
        let arguments = match candidate.method {
            PtConversionMethod::YoloCli => ["--help", ""],
            PtConversionMethod::PythonUltralytics => ["-c", "import ultralytics"],
        };
        let arguments = if candidate.method == PtConversionMethod::YoloCli {
            &arguments[..1]
        } else {
            &arguments[..]
        };
        match probe(candidate, arguments) {
            Ok(()) => {
                return PtConversionEnvironment {
                    available: true,
                    method: Some(candidate.method),
                    executable: Some(candidate.executable.to_string()),
                    message: text::pt_conversion_available(candidate.executable),
                };
            }
            Err(error) => failures.push(format!("{}：{error}", candidate.executable)),
        }
    }
    PtConversionEnvironment {
        available: false,
        method: None,
        executable: None,
        message: text::pt_conversion_unavailable_with_details(&failures),
    }
}

fn conversion_arguments(method: PtConversionMethod, pt_path: &Path) -> Vec<String> {
    let path = process_compatible_path(pt_path);
    match method {
        PtConversionMethod::YoloCli => vec![
            "export".to_string(),
            format!("model={path}"),
            "format=onnx".to_string(),
            "imgsz=640".to_string(),
            "simplify=False".to_string(),
        ],
        PtConversionMethod::PythonUltralytics => vec![
            "-c".to_string(),
            "from ultralytics import YOLO; import sys; YOLO(sys.argv[1]).export(format='onnx', imgsz=640, simplify=False)"
                .to_string(),
            path,
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
    working_directory: &Path,
    log_path: &Path,
) -> Result<ProcessOutcome, String> {
    let log =
        File::create(log_path).map_err(|error| text::pt_conversion_log_failed(log_path, error))?;
    let stderr = log
        .try_clone()
        .map_err(|error| text::pt_conversion_log_failed(log_path, error))?;
    let mut child = offline_command(executable)
        .args(arguments)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| text::pt_conversion_start_failed(executable, error))?;
    let status = wait_for_child(&mut child, CONVERSION_TIMEOUT)?
        .ok_or_else(|| text::pt_conversion_timed_out(CONVERSION_TIMEOUT.as_secs()))?;
    Ok(ProcessOutcome {
        status,
        log_tail: read_log_tail(log_path),
    })
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
mod tests {
    use super::{
        conversion_arguments, convert_pt_to_onnx_blocking, convert_pt_with,
        convert_pt_with_environment, detect_environment, detect_environment_with, reserve_target,
        ProcessOutcome, PtConversionEnvironment, PtConversionMethod,
    };
    use crate::{media::onnx_metadata::OnnxModelSummary, models::prelabel::YoloModelFormat};
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::atomic::{AtomicU64, Ordering},
    };

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn environment(executable: impl Into<String>) -> PtConversionEnvironment {
        PtConversionEnvironment {
            available: true,
            method: Some(PtConversionMethod::PythonUltralytics),
            executable: Some(executable.into()),
            message: String::new(),
        }
    }

    fn summary() -> OnnxModelSummary {
        OnnxModelSummary {
            format: YoloModelFormat::YoloV8,
            class_count: 1,
            input_width: 640,
            input_height: 640,
            class_names: vec!["object".to_string()],
        }
    }

    fn test_directory(label: &str) -> PathBuf {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "my_label_tool_pt_conversion_{}_{}_{}",
            std::process::id(),
            label,
            counter
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    fn success_status() -> std::process::ExitStatus {
        if cfg!(windows) {
            Command::new("cmd")
                .args(["/C", "exit", "0"])
                .status()
                .unwrap()
        } else {
            Command::new("sh").args(["-c", "exit 0"]).status().unwrap()
        }
    }

    fn failure_status() -> std::process::ExitStatus {
        if cfg!(windows) {
            Command::new("cmd")
                .args(["/C", "exit", "7"])
                .status()
                .unwrap()
        } else {
            Command::new("sh").args(["-c", "exit 7"]).status().unwrap()
        }
    }

    #[test]
    fn detects_yolo_cli_before_python() {
        let environment = detect_environment_with(|candidate, arguments| {
            if candidate.executable == "yolo" && arguments == ["--help"] {
                Ok(())
            } else {
                Err("not available".to_string())
            }
        });
        assert!(environment.available);
        assert_eq!(environment.method, Some(PtConversionMethod::YoloCli));
        assert_eq!(environment.executable.as_deref(), Some("yolo"));
    }

    #[test]
    fn falls_back_to_a_python_ultralytics_import_probe() {
        let environment = detect_environment_with(|candidate, arguments| {
            if candidate.executable == "python3" && arguments == ["-c", "import ultralytics"] {
                Ok(())
            } else {
                Err("not available".to_string())
            }
        });
        assert!(environment.available);
        assert_eq!(
            environment.method,
            Some(PtConversionMethod::PythonUltralytics)
        );
        assert_eq!(environment.executable.as_deref(), Some("python3"));
    }

    #[test]
    fn reports_unavailable_when_all_probes_fail() {
        let environment = detect_environment_with(|candidate, _| {
            Err(format!("{} probe failed", candidate.executable))
        });
        assert!(!environment.available);
        assert_eq!(environment.method, None);
        assert_eq!(environment.executable, None);
        assert!(environment.message.contains("yolo probe failed"));
        assert!(environment.message.contains("python probe failed"));
    }

    #[test]
    fn builds_argument_vectors_without_shell_interpolation_and_disables_simplification() {
        let path = Path::new(r"C:\models with spaces\best.pt");
        assert_eq!(
            conversion_arguments(PtConversionMethod::YoloCli, path),
            vec![
                "export",
                r"model=C:\models with spaces\best.pt",
                "format=onnx",
                "imgsz=640",
                "simplify=False",
            ]
        );
        let python = conversion_arguments(PtConversionMethod::PythonUltralytics, path);
        assert_eq!(python[0], "-c");
        assert!(python[1].contains("simplify=False"));
        assert_eq!(python[2], r"C:\models with spaces\best.pt");
    }

    #[test]
    fn converts_in_a_temporary_directory_and_publishes_only_after_validation() {
        let root = test_directory("success");
        let pt = root.join("model.pt");
        fs::write(&pt, b"weights").unwrap();
        let canonical_root = root.canonicalize().unwrap();
        let result = convert_pt_with(
            &pt,
            &environment("python"),
            |_, arguments, working_directory, _| {
                assert!(working_directory.starts_with(&canonical_root));
                assert_ne!(arguments[2], pt.to_string_lossy());
                fs::write(Path::new(&arguments[2]).with_extension("onnx"), b"valid").unwrap();
                Ok(ProcessOutcome {
                    status: success_status(),
                    log_tail: String::new(),
                })
            },
            |_| Ok(summary()),
        )
        .unwrap();

        assert_eq!(Path::new(&result.path), root.join("model.onnx"));
        assert_eq!(fs::read(root.join("model.onnx")).unwrap(), b"valid");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_an_existing_target_without_running_conversion() {
        let root = test_directory("existing");
        let pt = root.join("model.pt");
        let onnx = root.join("model.onnx");
        fs::write(&pt, b"weights").unwrap();
        fs::write(&onnx, b"keep me").unwrap();
        let mut ran = false;
        let result = convert_pt_with(
            &pt,
            &environment("python"),
            |_, _, _, _| {
                ran = true;
                unreachable!()
            },
            |_| Ok(summary()),
        );

        assert!(result.is_err());
        assert!(!ran);
        assert_eq!(fs::read(onnx).unwrap(), b"keep me");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleans_staging_after_process_failure_missing_output_and_invalid_output() {
        for failure in ["process", "missing", "invalid"] {
            let root = test_directory(failure);
            let pt = root.join("model.pt");
            fs::write(&pt, b"weights").unwrap();
            let result = convert_pt_with(
                &pt,
                &environment("python"),
                |_, arguments, _, _| {
                    if failure == "invalid" {
                        fs::write(Path::new(&arguments[2]).with_extension("onnx"), b"invalid")
                            .unwrap();
                    }
                    Ok(ProcessOutcome {
                        status: if failure == "process" {
                            failure_status()
                        } else {
                            success_status()
                        },
                        log_tail: "conversion detail".to_string(),
                    })
                },
                |_| Err("invalid ONNX".to_string()),
            );

            assert!(result.is_err());
            assert!(!root.join("model.onnx").exists());
            assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn never_overwrites_a_target_created_while_conversion_is_running() {
        let root = test_directory("publish-race");
        let pt = root.join("model.pt");
        let onnx = root.join("model.onnx");
        fs::write(&pt, b"weights").unwrap();
        let result = convert_pt_with(
            &pt,
            &environment("python"),
            |_, arguments, _, _| {
                fs::write(
                    Path::new(&arguments[2]).with_extension("onnx"),
                    b"converted",
                )
                .unwrap();
                fs::write(&onnx, b"concurrent file").unwrap();
                Ok(ProcessOutcome {
                    status: success_status(),
                    log_tail: String::new(),
                })
            },
            |_| Ok(summary()),
        );

        assert!(result.is_err());
        assert_eq!(fs::read(&onnx).unwrap(), b"concurrent file");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prevents_two_conversions_for_the_same_target() {
        let root = test_directory("lock");
        let target = root.join("model.onnx");
        let first = reserve_target(&target).unwrap();
        assert!(reserve_target(&target).is_err());
        drop(first);
        assert!(reserve_target(&target).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires MY_LABEL_TOOL_ULTRALYTICS_PYTHON and MY_LABEL_TOOL_YOLO_PT"]
    fn converts_official_pt_with_real_ultralytics_when_fixture_available() {
        let executable = std::env::var("MY_LABEL_TOOL_ULTRALYTICS_PYTHON").unwrap();
        let source = PathBuf::from(std::env::var("MY_LABEL_TOOL_YOLO_PT").unwrap());
        let root = test_directory("official");
        let pt = root.join("official.pt");
        fs::copy(source, &pt).unwrap();

        let result = convert_pt_with_environment(&pt, &environment(executable)).unwrap();
        assert!(Path::new(&result.path).is_file());
        assert_eq!(result.summary.input_width, 640);
        assert_eq!(result.summary.input_height, 640);
        assert!(!result.summary.class_names.is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires a real yolo/Python executable on PATH and MY_LABEL_TOOL_YOLO_PT"]
    fn detects_real_environment_and_runs_the_complete_conversion_command_path() {
        let source = PathBuf::from(std::env::var("MY_LABEL_TOOL_YOLO_PT").unwrap());
        let detected = detect_environment();
        assert!(detected.available, "{}", detected.message);
        let root = test_directory("complete-command");
        let pt = root.join("official.pt");
        fs::copy(source, &pt).unwrap();

        let result = convert_pt_to_onnx_blocking(&pt).unwrap();
        assert!(Path::new(&result.path).is_file());
        assert_eq!(result.summary.input_width, 640);
        assert_eq!(result.summary.input_height, 640);
        assert!(!result.summary.class_names.is_empty());

        fs::remove_dir_all(root).unwrap();
    }
}
