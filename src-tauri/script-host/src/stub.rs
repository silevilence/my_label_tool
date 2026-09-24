use label_script_host::protocol::*;
use serde_json::json;
fn main() {
    let mut output = std::io::stdout().lock();
    let result = receive_with_init(&mut std::io::stdin().lock(), &mut output, |limits| {
        // Integration fixture: simulate a hard memory-cap exit during snapshot input.
        if limits.max_memory_mi_b == 65 {
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(20));
                std::process::exit(125);
            });
        }
        Ok(())
    }).and_then(|(snapshot, source, _)| {
        match source.as_str() {
            "timeout" => std::thread::sleep(std::time::Duration::from_secs(60)),
            "crash" => std::process::exit(2),
            "line-limit" => { use std::io::Write; let _ = output.write_all(&vec![b'x'; MAX_LINE + 2]); },
            _ => for image in snapshot.images { write_line(&mut output, &json!({"event":"result", "imagePath": image["path"], "annotations": image["annotations"]}))?; },
        }
        write_line(&mut output, &json!({"event":"done"}))
    });
    if let Err(error) = result {
        let _ = write_line(&mut output, &json!({"event":"failed", "errors":[error]}));
    }
}
