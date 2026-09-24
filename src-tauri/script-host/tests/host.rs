use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
};

fn run(
    source: &str,
    chunk: usize,
    memory: u64,
    extra_images: usize,
) -> (std::process::ExitStatus, Vec<Value>) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_label-script-host"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    writeln!(
        input,
        "{}",
        json!({"op":"hello","version":1,"limits":{"maxMemoryMiB":memory,"timeoutSeconds":if extra_images > 0 { 30 } else { 2 }}})
    )
    .unwrap();
    writeln!(input, "{}", json!({"op":"section","name":"labels","items":[{"id":"random","name":"车辆","shapeType":"rect"}]})).unwrap();
    let images: Vec<_> = (0..4).map(|i| json!({"path":format!("{i}.png"),"name":format!("{i}.png"),"annotations":[{"id":"box","labelId":"random","type":"rect","points":[1,2,3,4]}]})).collect();
    for items in images.chunks(chunk) {
        writeln!(
            input,
            "{}",
            json!({"op":"section","name":"images","items":items})
        )
        .unwrap();
    }
    for i in 0..extra_images {
        if writeln!(input, "{}", json!({"op":"section","name":"images","items":[{"path":format!("extra-{i}"),"annotations":[],"padding":"x".repeat(1024*1024)}]})).is_err() { break; }
    }
    let _ = writeln!(input, "{}", json!({"op":"execute","source":source}));
    drop(input);
    let mut output = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut output)
        .unwrap();
    (
        child.wait().unwrap(),
        output
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect(),
    )
}

#[test]
fn real_process_result_does_not_depend_on_chunk_size() {
    let source = include_str!("../../../examples/scripts/numbering.lua");
    let (status, one) = run(source, 1, 256, 0);
    assert!(status.success());
    assert_eq!(one, run(source, 4, 256, 0).1);
    assert_eq!(one.iter().filter(|e| e["event"] == "result").count(), 4);
    assert_eq!(one.last().unwrap()["event"], "done");
}
#[test]
fn watchdog_and_whole_process_memory_limit_are_enforced() {
    assert_eq!(
        run(
            "while true do pcall(function() while true do end end) end",
            4,
            256,
            0
        )
        .0
        .code(),
        Some(124)
    );
    // Lua has not started: this exhausts Rust's snapshot allocation, proving the
    // configured memory limit is not merely the VM heap or transmission chunk size.
    assert_eq!(run("", 4, 64, 150).0.code(), Some(125));
}
