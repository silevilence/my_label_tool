use label_script_host::protocol::{Limits, Snapshot};
use my_label_tool_lib::scripting::runner::run;
use serde_json::json;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

fn snapshot() -> Snapshot {
    Snapshot {
        labels: vec![],
        images: vec![
            json!({"path":"a.png","annotations":[]}),
            json!({"path":"b.png","annotations":[]}),
        ],
    }
}
#[test]
fn runner_buffers_success_and_rejects_timeout_crash_and_line_overflow() {
    let exe = Path::new(env!("CARGO_BIN_EXE_script-conformance-stub"));
    let limits = Limits {
        max_memory_mi_b: 256,
        timeout_seconds: 1,
    };
    let run_case = |source: &str| {
        run(
            exe,
            snapshot(),
            source.into(),
            limits.clone(),
            1,
            &AtomicBool::new(false),
            &mut |_| {},
        )
    };
    assert_eq!(run_case("normal").unwrap().len(), 2);
    assert_eq!(run_case("timeout").unwrap_err()[0].code, "TIMEOUT");
    assert_eq!(run_case("crash").unwrap_err()[0].code, "PROTOCOL_ERROR");
    assert_eq!(run_case("line-limit").unwrap_err()[0].code, "LINE_LIMIT");
}
#[test]
fn cancellation_terminates_the_child_and_exposes_no_partial_results() {
    let flag = Arc::new(AtomicBool::new(false));
    let cancellation = flag.clone();
    let worker = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        cancellation.store(true, Ordering::Release);
    });
    let result = run(
        Path::new(env!("CARGO_BIN_EXE_script-conformance-stub")),
        snapshot(),
        "timeout".into(),
        Limits {
            max_memory_mi_b: 256,
            timeout_seconds: 30,
        },
        1,
        &flag,
        &mut |_| {},
    );
    worker.join().unwrap();
    assert_eq!(result.unwrap_err()[0].code, "CANCELLED");
}

#[test]
fn chunk_byte_limits_do_not_change_a_valid_snapshot_result() {
    let snapshot = Snapshot {
        labels: vec![],
        images: (0..12).map(|n| json!({"path":format!("{n}.png"), "annotations":[], "padding":"x".repeat(1024*1024)})).collect(),
    };
    let run_case = |chunk_size| {
        run(
            Path::new(env!("CARGO_BIN_EXE_script-conformance-stub")),
            snapshot.clone(),
            "normal".into(),
            Limits {
                max_memory_mi_b: 256,
                timeout_seconds: 30,
            },
            chunk_size,
            &AtomicBool::new(false),
            &mut |_| {},
        )
    };
    let one = serde_json::to_value(run_case(1).unwrap()).unwrap();
    assert_eq!(one, serde_json::to_value(run_case(16).unwrap()).unwrap());
}

#[test]
fn memory_exit_during_input_is_not_reported_as_a_broken_pipe() {
    let snapshot = Snapshot {
        labels: vec![],
        images: (0..100).map(|n| json!({"path":format!("{n}.png"), "annotations":[], "padding":"x".repeat(1024*1024)})).collect(),
    };
    let result = run(
        Path::new(env!("CARGO_BIN_EXE_script-conformance-stub")),
        snapshot,
        "normal".into(),
        Limits {
            max_memory_mi_b: 65,
            timeout_seconds: 30,
        },
        16,
        &AtomicBool::new(false),
        &mut |_| {},
    );
    assert_eq!(result.unwrap_err()[0].code, "MEMORY_LIMIT");
}
