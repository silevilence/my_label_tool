use label_script_host::protocol::{self, Failure, Limits, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::BufReader,
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub image_path: String,
    pub annotations: Vec<Value>,
}

enum HostMessage {
    Output(protocol::Result<Value>),
    WriteFailure(Failure),
    Closed,
}

fn write_sections(
    output: &mut impl std::io::Write,
    name: &str,
    items: Vec<Value>,
    chunk_size: usize,
) -> protocol::Result<()> {
    let mut chunk = Vec::new();
    let envelope_size = json!({"op":"section", "name":name, "items":[]})
        .to_string()
        .len()
        + 1;
    let mut bytes = envelope_size;
    for item in items {
        let item_bytes = serde_json::to_vec(&item)
            .map_err(|e| Failure::new("PROTOCOL_ERROR", e))?
            .len();
        if envelope_size + item_bytes > protocol::MAX_LINE {
            return Err(Failure::new("LINE_LIMIT", name));
        }
        if !chunk.is_empty()
            && (chunk.len() == chunk_size || bytes + item_bytes + 1 > protocol::MAX_LINE)
        {
            protocol::write_line(output, &json!({"op":"section", "name":name, "items":chunk}))?;
            chunk.clear();
            bytes = envelope_size;
        }
        bytes += item_bytes + usize::from(!chunk.is_empty());
        chunk.push(item);
    }
    if !chunk.is_empty() {
        protocol::write_line(output, &json!({"op":"section", "name":name, "items":chunk}))?;
    }
    Ok(())
}

/// Owns a single child until it has exited. No result escapes before done + successful exit.
pub fn run(
    executable: &Path,
    snapshot: Snapshot,
    source: String,
    limits: Limits,
    chunk_size: usize,
    cancelled: &AtomicBool,
    emit: &mut impl FnMut(Value),
) -> Result<Vec<ScriptResult>, Vec<Failure>> {
    label_script_host::limits::validate(&limits).map_err(|e| vec![e])?;
    if chunk_size == 0 || chunk_size > 1024 {
        return Err(vec![Failure::new("INVALID_ARGUMENT", "chunkSize")]);
    }
    if cancelled.load(Ordering::Acquire) {
        return Err(vec![Failure::new("CANCELLED", "")]);
    }
    let started = Instant::now();
    let allowed: HashSet<String> = snapshot
        .images
        .iter()
        .filter_map(|i| i["path"].as_str().map(str::to_owned))
        .collect();
    if allowed.len() != snapshot.images.len() {
        return Err(vec![Failure::new("INVALID_ARGUMENT", "images")]);
    }
    let budget = limits.max_memory_mi_b as usize * 1024 * 1024;
    let timeout = Duration::from_secs(limits.timeout_seconds);
    let mut command = Command::new(executable);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::process_control::configure_process_group(&mut command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| vec![Failure::new("HOST_UNAVAILABLE", e)])?;
    let Some(mut input) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(vec![Failure::new("PROTOCOL_ERROR", "stdin")]);
    };
    let Some(output) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(vec![Failure::new("PROTOCOL_ERROR", "stdout")]);
    };
    let (tx, rx) = mpsc::sync_channel(8);
    let (ready_tx, ready_rx) = mpsc::channel();
    let mut ready_tx = Some(ready_tx);
    let writer_tx = tx.clone();
    let writer = std::thread::spawn(move || {
        let result = (|| {
            protocol::write_line(
                &mut input,
                &json!({"op":"hello", "version":1,"limits":limits}),
            )?;
            // A mismatched host must not receive the project snapshot.
            if ready_rx.recv().is_err() {
                return Ok(());
            }
            for (name, items) in [("labels", snapshot.labels), ("images", snapshot.images)] {
                write_sections(&mut input, name, items, chunk_size)?;
            }
            protocol::write_line(&mut input, &json!({"op":"execute","source":source}))
        })();
        if let Err(error) = result {
            let _ = writer_tx.send(HostMessage::WriteFailure(error));
        }
    });
    let reader = std::thread::spawn(move || {
        let mut output = BufReader::new(output);
        loop {
            match protocol::read_line(&mut output) {
                Ok(Some(value)) => {
                    if tx.send(HostMessage::Output(Ok(value))).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = tx.send(HostMessage::Output(Err(error)));
                    break;
                }
            }
        }
        let _ = tx.send(HostMessage::Closed);
    });
    let result = (|| {
        let mut ready = false;
        let mut done = false;
        let mut results = vec![];
        let mut seen = HashSet::new();
        let mut bytes = 0usize;
        let mut write_failure = None;
        loop {
            if cancelled.load(Ordering::Acquire) {
                return Err(vec![Failure::new("CANCELLED", "")]);
            }
            if started.elapsed() >= timeout {
                return Err(vec![Failure::new("TIMEOUT", "")]);
            }
            match rx.recv_timeout(Duration::from_millis(15)) {
                Ok(HostMessage::Closed) => {
                    ready_tx.take();
                }
                Ok(HostMessage::WriteFailure(error)) if error.code == "PROTOCOL_ERROR" => {
                    // Broken pipe can be a consequence of the host's hard memory cap.
                    // Drain its final error/exit before classifying this transport symptom.
                    write_failure = Some(error);
                }
                Ok(HostMessage::WriteFailure(error) | HostMessage::Output(Err(error))) => {
                    return Err(vec![error])
                }
                Ok(HostMessage::Output(Ok(value))) => {
                    bytes = bytes.saturating_add(value.to_string().len());
                    if bytes > budget {
                        return Err(vec![Failure::new("MEMORY_LIMIT", "results")]);
                    }
                    if done {
                        return Err(vec![Failure::new("PROTOCOL_ERROR", "after done")]);
                    }
                    match value["event"].as_str() {
                        Some("ready") if !ready && value["version"] == protocol::VERSION => {
                            ready = true;
                            if let Some(sender) = ready_tx.take() {
                                let _ = sender.send(());
                            }
                        }
                        Some("failed") => {
                            return Err(serde_json::from_value::<Vec<Failure>>(
                                value["errors"].clone(),
                            )
                            .ok()
                            .filter(|e| !e.is_empty())
                            .unwrap_or_else(|| vec![Failure::new("PROTOCOL_ERROR", "errors")]))
                        }
                        Some("result") if ready => {
                            let result: ScriptResult = serde_json::from_value(value)
                                .map_err(|e| vec![Failure::new("PROTOCOL_ERROR", e)])?;
                            if !allowed.contains(&result.image_path)
                                || !seen.insert(result.image_path.clone())
                            {
                                return Err(vec![Failure::new("PROTOCOL_ERROR", "imagePath")]);
                            }
                            results.push(result);
                        }
                        Some("progress" | "log") if ready => emit(value),
                        Some("done") if ready => done = true,
                        _ => return Err(vec![Failure::new("PROTOCOL_ERROR", "event")]),
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // EOF alone is not success: wait for a clean exit, still honoring cancellation.
                    if let Some(status) = child
                        .try_wait()
                        .map_err(|e| vec![Failure::new("PROTOCOL_ERROR", e)])?
                    {
                        if status.success() && done && write_failure.is_none() {
                            return Ok(results);
                        }
                        let code = match status.code() {
                            Some(124) => "TIMEOUT",
                            Some(125) => "MEMORY_LIMIT",
                            _ => {
                                if let Some(error) = write_failure {
                                    return Err(vec![error]);
                                }
                                "PROTOCOL_ERROR"
                            }
                        };
                        return Err(vec![Failure::new(code, status)]);
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    })();
    // Kill also closes blocked pipes; drop receiver before joining backpressured readers.
    if child.try_wait().ok().flatten().is_none() {
        let _ = crate::process_control::terminate_process_tree(child.id());
        let _ = child.kill();
    }
    let _ = child.wait();
    drop(ready_tx);
    drop(rx);
    let _ = writer.join();
    let _ = reader.join();
    result
}
