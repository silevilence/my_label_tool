use my_label_tool_lib::acp::{client::run, registry::Control, Config};
use serde_json::Value;
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
fn config(mode: &str) -> Config {
    Config {
        executable: env!("CARGO_BIN_EXE_acp-conformance-stub").into(),
        args: vec![mode.into()],
        timeout_seconds: 1,
    }
}
#[test]
fn handshake_session_and_streaming() {
    let directory = tempfile::tempdir().unwrap();
    let mut events = vec![];
    let outcome = run(
        &config("normal"),
        directory.path(),
        "test",
        &Control::default(),
        &mut |event| events.push(event),
    )
    .unwrap();
    assert_eq!(outcome.stop_reason, "end_turn");
    assert_eq!(events[0]["event"], "session");
    assert_eq!(
        events
            .iter()
            .filter(|event| event["event"] == "update")
            .count(),
        2
    );
}
#[test]
fn failures_are_explicit_and_bounded() {
    let directory = tempfile::tempdir().unwrap();
    for (mode, expected) in [
        ("version", "版本"),
        ("crash", "中断"),
        ("disconnect", "中断"),
        ("timeout", "超时"),
        ("init-timeout", "超时"),
        ("invalid", "协议"),
        ("line-limit", "容量"),
        ("wrong-session", "协议"),
        ("error", "请求失败"),
    ] {
        let error = run(
            &config(mode),
            directory.path(),
            "test",
            &Control::default(),
            &mut |_| {},
        )
        .unwrap_err();
        assert!(error.contains(expected), "{mode}: {error}");
    }
}
#[test]
fn permissions_require_each_explicit_response_and_never_grant_always() {
    let directory = tempfile::tempdir().unwrap();
    for selection in [Some("yes"), Some("no"), Some("forever"), None] {
        let control = Control::default();
        let result = run(
            &config("permission"),
            directory.path(),
            "test",
            &control,
            &mut |event: Value| {
                if event["event"] == "permission" {
                    assert_eq!(event["details"]["rawInput"]["command"], "read private-file");
                    control
                        .respond(
                            event["requestId"].as_str().unwrap(),
                            selection.map(str::to_owned),
                        )
                        .unwrap();
                }
            },
        );
        assert_eq!(result.is_ok(), selection == Some("yes"));
    }
    let error = run(
        &config("permission"),
        directory.path(),
        "test",
        &Control::default(),
        &mut |_| {},
    )
    .unwrap_err();
    assert!(error.contains("超时"));
}
#[test]
fn file_requests_are_denied_without_touching_files() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("private-file"), "private").unwrap();
    run(
        &config("read"),
        directory.path(),
        "test",
        &Control::default(),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(directory.path().join("private-file")).unwrap(),
        "private"
    );
}
#[test]
fn cancel_in_flight_and_before_start() {
    let directory = tempfile::tempdir().unwrap();
    let control = Arc::new(Control::default());
    let cancellation = control.clone();
    let worker = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        cancellation.cancelled.store(true, Ordering::Release);
    });
    assert!(run(
        &config("timeout"),
        directory.path(),
        "test",
        &control,
        &mut |_| {}
    )
    .unwrap_err()
    .contains("取消"));
    worker.join().unwrap();
    assert!(run(
        &config("normal"),
        directory.path(),
        "test",
        &control,
        &mut |_| {}
    )
    .unwrap_err()
    .contains("取消"));
}

#[test]
fn parent_crash_cannot_leave_descendant_holding_pipes() {
    let directory = tempfile::tempdir().unwrap();
    let start = std::time::Instant::now();
    assert!(run(
        &config("orphan-crash"),
        directory.path(),
        "test",
        &Control::default(),
        &mut |_| {}
    )
    .is_err());
    assert!(start.elapsed() < Duration::from_secs(5));
}
