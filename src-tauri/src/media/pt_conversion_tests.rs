use super::{
    build_conversion_plan, cancel_all_pt_conversions, cancel_registered_conversion,
    conversion_arguments, conversion_command, conversion_timeout, convert_pt_to_onnx_blocking,
    convert_pt_with, convert_pt_with_environment, convert_pt_with_parameters,
    convert_pt_with_parameters_and_id, detect_environment, detect_environment_with,
    register_conversion, reserve_target, run_conversion_process, validate_conversion_parameters,
    ChildProcessGuard, ConversionControl, OutputNormalizer, OutputNormalizers, OutputStream,
    ProcessOutcome, PtCancellationStatus, PtConversionCommandError, PtConversionEnvironment,
    PtConversionEvent, PtConversionMethod, PtConversionParameters,
};
use crate::{
    media::onnx_metadata::OnnxModelSummary,
    models::prelabel::YoloModelFormat,
    process_control::{configure_process_group, terminate_process_tree},
};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
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
    let environment = detect_environment_with(|executable, arguments| {
        if executable == "yolo" && arguments == ["--help"] {
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
    let environment = detect_environment_with(|executable, arguments| {
        if executable == "python3" && arguments == ["-c", "import ultralytics"] {
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
fn falls_back_to_uv_without_installing_ultralytics_during_detection() {
    let mut probes = Vec::new();
    let environment = detect_environment_with(|executable, arguments| {
        probes.push((
            executable.to_string(),
            arguments
                .iter()
                .map(|argument| (*argument).to_string())
                .collect::<Vec<_>>(),
        ));
        if matches!(executable, "uv" | "uvx") && arguments == ["--version"] {
            Ok(())
        } else {
            Err("not available".to_string())
        }
    });

    assert_eq!(environment.method, Some(PtConversionMethod::UvxYolo));
    assert_eq!(environment.executable.as_deref(), Some("uvx"));
    assert_eq!(
        probes.last(),
        Some(&("uvx".to_string(), vec!["--version".to_string()]))
    );
    assert!(!probes
        .iter()
        .any(|(_, arguments)| arguments.iter().any(|argument| argument == "ultralytics")));
}

#[test]
fn reports_uvx_missing_instead_of_selecting_an_unrunnable_uv_fallback() {
    let environment = detect_environment_with(|executable, _| {
        if executable == "uv" {
            Ok(())
        } else {
            Err("not available".to_string())
        }
    });

    assert!(!environment.available);
    assert!(environment.message.contains("uvx：not available"));
}

#[test]
fn reports_unavailable_when_all_probes_fail() {
    let environment =
        detect_environment_with(|executable, _| Err(format!("{executable} probe failed")));
    assert!(!environment.available);
    assert_eq!(environment.method, None);
    assert_eq!(environment.executable, None);
    assert!(environment.message.contains("yolo probe failed"));
    assert!(environment.message.contains("python probe failed"));
}

#[test]
fn builds_argument_vectors_from_confirmed_parameters_without_shell_interpolation() {
    let path = Path::new(r"C:\models with spaces\best.pt");
    let parameters = PtConversionParameters {
        imgsz: 1280,
        simplify: true,
    };
    assert_eq!(
        conversion_arguments(PtConversionMethod::YoloCli, path, parameters),
        vec![
            "export",
            r"model=C:\models with spaces\best.pt",
            "format=onnx",
            "imgsz=1280",
            "simplify=True",
        ]
    );
    let python = conversion_arguments(PtConversionMethod::PythonUltralytics, path, parameters);
    assert_eq!(python[0], "-c");
    assert!(python[1].contains("imgsz=int(sys.argv[2])"));
    assert!(python[1].contains("simplify=sys.argv[3] == 'true'"));
    assert_eq!(python[2], r"C:\models with spaces\best.pt");
    assert_eq!(python[3..], ["1280", "true"]);
    assert_eq!(
        conversion_arguments(PtConversionMethod::UvxYolo, path, parameters),
        vec![
            "--from",
            "ultralytics",
            "yolo",
            "export",
            r"model=C:\models with spaces\best.pt",
            "format=onnx",
            "imgsz=1280",
            "simplify=True",
        ]
    );
}

#[test]
fn rejects_imgsz_that_is_not_a_positive_multiple_of_32() {
    assert!(validate_conversion_parameters(PtConversionParameters {
        imgsz: 0,
        simplify: false,
    })
    .is_err());
    assert!(validate_conversion_parameters(PtConversionParameters {
        imgsz: 641,
        simplify: false,
    })
    .is_err());
    assert!(validate_conversion_parameters(PtConversionParameters {
        imgsz: 640,
        simplify: false,
    })
    .is_ok());
}

#[test]
fn streams_carriage_return_progress_as_normalized_lines_across_chunks() {
    let mut normalizer = OutputNormalizer::default();

    assert_eq!(
        normalizer.push(b"Downloading 10%\rDownloading "),
        vec!["Downloading 10%"]
    );
    assert_eq!(
        normalizer.push(b"20%\r\nready\npartial"),
        vec!["Downloading 20%", "ready"]
    );
    assert_eq!(normalizer.finish(), vec!["partial"]);
}

#[test]
fn keeps_partial_stdout_and_stderr_lines_separate() {
    let mut normalizers = OutputNormalizers::default();

    assert!(normalizers.push(OutputStream::Stdout, b"out").is_empty());
    assert_eq!(
        normalizers.push(OutputStream::Stderr, b"warning\n"),
        vec!["warning"]
    );
    assert_eq!(
        normalizers.push(OutputStream::Stdout, b"put\n"),
        vec!["output"]
    );
}

#[test]
fn serializes_stream_events_with_the_frontend_channel_contract() {
    let event = serde_json::to_value(PtConversionEvent::Started {
        conversion_id: "conversion-1".to_string(),
        command: "uvx --from ultralytics yolo export".to_string(),
        timeout_seconds: 1_200,
    })
    .unwrap();

    assert_eq!(event["event"], "started");
    assert_eq!(event["conversionId"], "conversion-1");
    assert_eq!(event["timeoutSeconds"], 1_200);
    assert!(event.get("conversion_id").is_none());
}

#[test]
fn keeps_local_conversion_offline_but_allows_uvx_dependency_downloads() {
    let local = conversion_command("yolo", PtConversionMethod::YoloCli);
    let local_env = local
        .get_envs()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect::<HashMap<_, _>>();
    assert_eq!(local_env.get("PIP_NO_INDEX"), Some(&Some("1".to_string())));
    assert_eq!(
        local_env.get("HF_HUB_OFFLINE"),
        Some(&Some("1".to_string()))
    );

    let uvx = conversion_command("uvx", PtConversionMethod::UvxYolo);
    let uvx_env = uvx
        .get_envs()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect::<HashMap<_, _>>();
    assert_eq!(uvx_env.get("PIP_NO_INDEX"), Some(&None));
    assert_eq!(uvx_env.get("HF_HUB_OFFLINE"), Some(&None));
}

#[test]
fn uses_a_longer_timeout_for_uvx_first_run() {
    assert_eq!(
        conversion_timeout(PtConversionMethod::YoloCli).as_secs(),
        10 * 60
    );
    assert_eq!(
        conversion_timeout(PtConversionMethod::PythonUltralytics).as_secs(),
        10 * 60
    );
    assert_eq!(
        conversion_timeout(PtConversionMethod::UvxYolo).as_secs(),
        20 * 60
    );
}

#[test]
fn streams_normalized_output_from_a_real_conversion_process() {
    let root = test_directory("stream-output");
    let log_path = root.join("conversion.log");
    let (executable, arguments) = output_fixture_command();
    let control = ConversionControl::default();
    let mut lines = Vec::new();

    let outcome = run_conversion_process(
        executable,
        &arguments,
        PtConversionMethod::YoloCli,
        &root,
        &log_path,
        &control,
        &mut |line| lines.push(line),
    )
    .unwrap();

    assert!(outcome.status.success());
    assert_eq!(lines, ["Downloading 10%", "Downloading 20%", "ready"]);
    assert!(outcome.log_tail.contains("ready"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_terminates_the_conversion_process_tree_and_releases_control() {
    let root = test_directory("cancel-tree");
    let log_path = root.join("conversion.log");
    let process_id_path = root.join("child.pid");
    let (executable, arguments) = process_tree_fixture_command(&process_id_path);
    let working_directory = root.parent().unwrap().to_path_buf();
    let control = Arc::new(ConversionControl::default());
    let watcher_control = Arc::clone(&control);
    let watcher = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(raw_process_id) = fs::read_to_string(&process_id_path) {
                if let Ok(process_id) = raw_process_id.trim().parse::<u32>() {
                    watcher_control.cancelled.store(true, Ordering::Release);
                    return process_id;
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
        0
    });
    let started = Instant::now();

    let result = run_conversion_process(
        executable,
        &arguments,
        PtConversionMethod::YoloCli,
        &working_directory,
        &log_path,
        &control,
        &mut |_| {},
    );

    let child_process_id = watcher.join().unwrap();
    let child_still_running = process_exists(child_process_id);
    if child_still_running {
        let _ = terminate_process_tree(child_process_id);
    }
    let error = result.unwrap_err();
    assert!(
        error.contains("中止") || error.contains("进程树失败"),
        "{error}"
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_ne!(child_process_id, 0);
    assert!(!child_still_running);
    remove_test_directory_with_retry(&root);
}

#[test]
fn process_guard_drop_reaps_the_tree_on_an_early_error_path() {
    let root = test_directory("guard-drop");
    let process_id_path = root.join("child.pid");
    let (executable, arguments) = process_tree_fixture_command(&process_id_path);
    let mut command = Command::new(executable);
    command
        .args(&arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_process_group(&mut command);
    let child = command.spawn().unwrap();
    let guard = ChildProcessGuard {
        child,
        stdout_reader: None,
        stderr_reader: None,
        reaped: false,
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    let child_process_id = loop {
        if let Ok(raw_process_id) = fs::read_to_string(&process_id_path) {
            if let Ok(process_id) = raw_process_id.trim().parse::<u32>() {
                break process_id;
            }
        }
        assert!(Instant::now() < deadline, "fixture child did not start");
        thread::sleep(Duration::from_millis(20));
    };

    drop(guard);

    let child_still_running = process_exists(child_process_id);
    if child_still_running {
        let _ = terminate_process_tree(child_process_id);
    }
    assert!(!child_still_running);
    remove_test_directory_with_retry(&root);
}

#[test]
fn registered_conversion_can_be_cancelled_and_is_released_for_retry() {
    let first = register_conversion("conversion-test-registration").unwrap();
    assert!(!first.control.cancelled.load(Ordering::Acquire));

    assert_eq!(
        cancel_registered_conversion("conversion-test-registration")
            .unwrap()
            .status,
        PtCancellationStatus::Accepted
    );
    assert!(first.control.cancelled.load(Ordering::Acquire));
    drop(first);

    let retry = register_conversion("conversion-test-registration").unwrap();
    cancel_all_pt_conversions();
    assert!(retry.control.cancelled.load(Ordering::Acquire));
    drop(retry);
}

#[test]
fn cancellation_after_publish_reports_completion_without_marking_the_task_cancelled() {
    let root = test_directory("cancel-after-publish");
    let staged = root.join("staged.onnx");
    let target = root.join("target.onnx");
    fs::write(&staged, b"valid").unwrap();
    let control = ConversionControl::default();

    control.publish(&staged, &target).unwrap();

    assert_eq!(
        control.cancel().unwrap(),
        PtCancellationStatus::AlreadyCompleted
    );
    assert!(!control.cancelled.load(Ordering::Acquire));
    assert!(target.is_file());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn conversion_command_errors_serialize_a_stable_code_separate_from_the_message() {
    let error = PtConversionCommandError::from("模型转换已中止".to_string());

    assert_eq!(
        serde_json::to_value(error).unwrap(),
        serde_json::json!({
            "code": "cancelled",
            "message": "模型转换已中止"
        })
    );
}

#[cfg(windows)]
fn output_fixture_command() -> (&'static str, Vec<String>) {
    (
        "powershell",
        vec![
            "-NoProfile".to_string(),
            "-Command".to_string(),
            "[Console]::Out.Write(\"Downloading 10%`rDownloading 20%`r`nready`n\")".to_string(),
        ],
    )
}

#[cfg(windows)]
fn process_tree_fixture_command(process_id_path: &Path) -> (&'static str, Vec<String>) {
    let process_id_path = process_id_path.to_string_lossy().replace('\'', "''");
    (
        "powershell",
        vec![
            "-NoProfile".to_string(),
            "-Command".to_string(),
            format!("$child = Start-Process -PassThru -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30'; Set-Content -Encoding ascii -LiteralPath '{process_id_path}' -Value $child.Id; Wait-Process -Id $child.Id"),
        ],
    )
}

#[cfg(windows)]
fn process_exists(process_id: u32) -> bool {
    if process_id == 0 {
        return false;
    }
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {process_id}"), "/NH"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).contains(&process_id.to_string())
}

fn remove_test_directory_with_retry(path: &Path) {
    for _ in 0..40 {
        match fs::remove_dir_all(path) {
            Ok(()) => return,
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
    fs::remove_dir_all(path).unwrap();
}

#[cfg(not(windows))]
fn output_fixture_command() -> (&'static str, Vec<String>) {
    (
        "sh",
        vec![
            "-c".to_string(),
            "printf 'Downloading 10%%\\rDownloading 20%%\\r\\nready\\n'".to_string(),
        ],
    )
}

#[cfg(not(windows))]
fn process_tree_fixture_command(process_id_path: &Path) -> (&'static str, Vec<String>) {
    let process_id_path = process_id_path.to_string_lossy().replace('\'', "'\\''");
    (
        "sh",
        vec![
            "-c".to_string(),
            format!("sleep 30 & child=$!; printf '%s\\n' \"$child\" > '{process_id_path}'; wait \"$child\""),
        ],
    )
}

#[cfg(not(windows))]
fn process_exists(process_id: u32) -> bool {
    process_id != 0
        && Command::new("kill")
            .args(["-0", &process_id.to_string()])
            .status()
            .is_ok_and(|status| status.success())
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

    assert_eq!(
        Path::new(&result.path).canonicalize().unwrap(),
        root.join("model.onnx").canonicalize().unwrap()
    );
    assert_eq!(fs::read(root.join("model.onnx")).unwrap(), b"valid");
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn applies_confirmed_parameters_to_the_export_and_validated_metadata() {
    let root = test_directory("parameters");
    let pt = root.join("model.pt");
    fs::write(&pt, b"weights").unwrap();
    let result = convert_pt_with_parameters(
        &pt,
        &environment("python"),
        PtConversionParameters {
            imgsz: 1280,
            simplify: true,
        },
        |_, arguments, _, _| {
            assert_eq!(arguments[3..], ["1280", "true"]);
            fs::write(Path::new(&arguments[2]).with_extension("onnx"), b"valid").unwrap();
            Ok(ProcessOutcome {
                status: success_status(),
                log_tail: String::new(),
            })
        },
        |_| {
            Ok(OnnxModelSummary {
                input_width: 1280,
                input_height: 1280,
                ..summary()
            })
        },
    )
    .unwrap();

    assert_eq!(
        (result.summary.input_width, result.summary.input_height),
        (1280, 1280)
    );
    assert!(root.join("model.onnx").is_file());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn backend_plan_previews_the_exact_isolated_command_path() {
    let root = test_directory("plan");
    let pt = root.join("model.pt");
    fs::write(&pt, b"weights").unwrap();
    let environment = PtConversionEnvironment {
        available: true,
        method: Some(PtConversionMethod::UvxYolo),
        executable: Some("uvx".to_string()),
        message: String::new(),
    };

    let plan = build_conversion_plan(
        &pt,
        PtConversionParameters::default(),
        "conversion-1",
        &environment,
    )
    .unwrap();

    assert!(plan
        .command
        .starts_with("uvx --from ultralytics yolo export"));
    assert!(plan.command.contains(".my-label-tool-convert-conversion-1"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancellation_during_validation_prevents_publishing_an_onnx() {
    let root = test_directory("cancel-validation");
    let pt = root.join("model.pt");
    fs::write(&pt, b"weights").unwrap();
    let cancelled = AtomicBool::new(false);
    let published = AtomicBool::new(false);

    let result = convert_pt_with_parameters_and_id(
        &pt,
        &environment("python"),
        PtConversionParameters::default(),
        Some("conversion-1"),
        || cancelled.load(Ordering::Acquire),
        |_, arguments, _, _| {
            fs::write(Path::new(&arguments[2]).with_extension("onnx"), b"valid").unwrap();
            Ok(ProcessOutcome {
                status: success_status(),
                log_tail: String::new(),
            })
        },
        |_| {
            cancelled.store(true, Ordering::Release);
            Ok(summary())
        },
        |_, _| {
            published.store(true, Ordering::Release);
            Ok(())
        },
    );

    assert!(result.unwrap_err().contains("中止"));
    assert!(!published.load(Ordering::Acquire));
    assert!(!root.join("model.onnx").exists());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
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
                    fs::write(Path::new(&arguments[2]).with_extension("onnx"), b"invalid").unwrap();
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
