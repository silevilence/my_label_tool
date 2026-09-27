use super::*;
use std::{fs, sync::atomic::AtomicUsize, thread, time::Duration};

fn python() -> String {
    std::env::var("TEXT_READ_TEST_PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into())
}
fn config(mode: &str) -> Config {
    Config {
        mode: mode.into(),
        values: HashMap::from([("executable".into(), python())]),
        timeout_ms: 10_000,
    }
}
fn command(script: &str) -> Config {
    let mut config = config("command");
    config.values.insert(
        "arguments".into(),
        serde_json::to_string(&["-I", "-X", "utf8", "-c", script]).unwrap(),
    );
    config
}
#[test]
fn real_modes_read_unicode_and_preserve_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("中文 ' $ ` 文件.txt");
    let content = "\u{feff}中文🌍\r\né\n\0";
    fs::write(&path, content).unwrap();
    let python = config("python");
    let plan = preview(&python).unwrap();
    let mut cmd = config("command");
    cmd.values.insert(
        "arguments".into(),
        serde_json::to_string(&plan.arguments).unwrap(),
    );
    for config in [Config::default(), python, cmd] {
        validate(&config).unwrap();
        self_check(&config, &AtomicBool::new(false)).unwrap();
        let values = adapter(&config)
            .unwrap()
            .read(
                &config,
                &[path.clone(), path.clone()],
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_eq!(values, [content, content]);
    }
}
#[test]
fn batch_starts_one_process_and_arguments_are_literal() {
    let directory = tempfile::tempdir().unwrap();
    let count = directory.path().join("starts.txt");
    let script = format!("import json,sys\nwith open({},'a') as f: f.write('1')\nr=json.load(sys.stdin)\nassert sys.argv[1]=='a & echo injected'\nprint(json.dumps(['明文']*len(r['paths'])))", serde_json::to_string(&count.to_string_lossy()).unwrap());
    let mut config = command(&script);
    let mut args: Vec<String> = serde_json::from_str(&config.values["arguments"]).unwrap();
    args.push("a & echo injected".into());
    config
        .values
        .insert("arguments".into(), serde_json::to_string(&args).unwrap());
    let values = adapter(&config)
        .unwrap()
        .read(
            &config,
            &vec![directory.path().join("密文.txt"); 200],
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(values, vec!["明文"; 200]);
    assert_eq!(fs::read_to_string(count).unwrap(), "1");
}
#[test]
fn bad_program_encoding_protocol_and_self_check_never_fall_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("valid.txt");
    fs::write(&path, "valid").unwrap();
    for script in [
        "import sys;sys.stdout.buffer.write(b'\\xff')",
        "print('{}')",
        "print('[]')",
        "print('[1]')",
        "print('[\"wrong\"]')",
    ] {
        let config = command(script);
        assert!(self_check(&config, &AtomicBool::new(false)).is_err());
    }
    let mut config = config("python");
    config.values.insert(
        "executable".into(),
        dir.path()
            .join("missing.exe")
            .to_string_lossy()
            .into_owned(),
    );
    assert!(preview(&config).is_err());
    assert!(adapter(&config)
        .unwrap()
        .read(&config, &[path], &AtomicBool::new(false))
        .is_err());
    assert!(self_check(&Config::default(), &AtomicBool::new(false)).is_ok());
}
#[test]
fn timeout_and_cancel_terminate_process_tree() {
    let directory = tempfile::tempdir().unwrap();
    for cancelled in [false, true] {
        let marker = directory.path().join(format!("child-{cancelled}.txt"));
        let child = format!(
            "import time,pathlib;time.sleep(2);pathlib.Path({}).write_text('leaked')",
            serde_json::to_string(&marker.to_string_lossy()).unwrap()
        );
        let script = format!(
            "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',{}]);time.sleep(20)",
            serde_json::to_string(&child).unwrap()
        );
        let mut config = command(&script);
        config.timeout_ms = if cancelled { 10_000 } else { 400 };
        let cancel = Arc::new(AtomicBool::new(false));
        let signal = cancel.clone();
        let worker = thread::spawn(move || {
            adapter(&config)
                .unwrap()
                .read(&config, &[PathBuf::from("test")], &signal)
        });
        if cancelled {
            thread::sleep(Duration::from_millis(400));
            cancel.store(true, Ordering::SeqCst);
        }
        let error = worker.join().unwrap().unwrap_err();
        assert!(error.contains(if cancelled {
            text::TEXT_READ_CANCELLED
        } else {
            text::TEXT_READ_TIMEOUT
        }));
        thread::sleep(Duration::from_millis(2200));
        assert!(!marker.exists());
    }
}
#[test]
fn registry_drives_fields_validation_and_preview() {
    for adapter in adapters::ADAPTERS {
        let metadata = adapter.metadata();
        assert!(!metadata.name.is_empty());
        assert!(!metadata.self_check.is_empty());
        if !metadata.fields.is_empty() {
            assert!(validate(&Config {
                mode: metadata.id,
                ..Config::default()
            })
            .is_err());
        }
    }
    let mut config = Config::default();
    config.values.insert("unsupported".into(), "value".into());
    assert!(validate(&config).is_err());
    config.values.clear();
    config.timeout_ms = 0;
    assert!(validate(&config).is_err());
    config.timeout_ms = 1000;
    config.mode = "missing".into();
    assert!(validate(&config).is_err());
    assert!(preview(&command("pass"))
        .unwrap()
        .executable
        .unwrap()
        .is_absolute());
}
#[test]
fn requests_cancel_independently_and_release_ids() {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let id = format!("test-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let request = Request::new(id.clone()).unwrap();
    assert!(Request::new(id.clone()).is_err());
    assert!(cancel(&id).unwrap());
    assert!(check_cancel(&request.cancel).is_err());
    drop(request);
    assert!(!cancel(&id).unwrap());
    let queued = format!("{id}-queued");
    assert!(!cancel(&queued).unwrap());
    let request = Request::new(queued).unwrap();
    assert!(check_cancel(&request.cancel).is_err());
}
#[test]
fn bounded_output_and_invalid_native_utf8_fail() {
    assert!(process::read_bounded(&b"1234"[..], 3).is_err());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("invalid.txt");
    fs::write(&path, [0xff]).unwrap();
    assert!(read(&path).is_err());
    fs::write(&path, CHECK_TEXT).unwrap();
    assert_eq!(read(&path).unwrap(), CHECK_TEXT);
    assert_eq!(fs::read(&path).unwrap(), CHECK_TEXT.as_bytes());
}
