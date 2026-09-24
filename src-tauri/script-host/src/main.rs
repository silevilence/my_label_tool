use label_script_host::{limits, protocol::*, vm};
use serde_json::json;

// Rust snapshot/result buffers also live under the OS process limit. Allocation
// failure exits without allocating an error string; the runner maps 125 to MEMORY_LIMIT.
struct FallibleHostAllocator;
unsafe impl std::alloc::GlobalAlloc for FallibleHostAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        let ptr = std::alloc::System.alloc(layout);
        if ptr.is_null() {
            std::process::exit(125);
        }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        std::alloc::System.dealloc(ptr, layout);
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        let ptr = std::alloc::System.realloc(ptr, layout, size);
        if ptr.is_null() {
            std::process::exit(125);
        }
        ptr
    }
}
#[global_allocator]
static ALLOCATOR: FallibleHostAllocator = FallibleHostAllocator;

fn main() {
    let mut output = std::io::stdout().lock();
    let mut process_limit = None;
    let result = receive_with_init(&mut std::io::stdin().lock(), &mut output, |limits| {
        process_limit = Some(limits::install(limits)?);
        let timeout = limits.timeout_seconds;
        // Covers parsing, snapshot collection, native Lua calls and pcall loops too.
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(timeout));
            std::process::exit(124);
        });
        Ok(())
    })
    .and_then(|(snapshot, source, limits)| {
        let context = vm::execute(snapshot, &source, &limits, &mut |event| {
            write_line(&mut output, &event)
        })?;
        if !context.failures.is_empty() {
            return write_line(
                &mut output,
                &json!({"event":"failed", "errors":context.failures}),
            );
        }
        for (path, annotations) in context.results {
            write_line(
                &mut output,
                &json!({"event":"result", "imagePath":path, "annotations":annotations}),
            )?;
        }
        write_line(&mut output, &json!({"event":"done"}))
    });
    if let Err(error) = result {
        let _ = write_line(&mut output, &json!({"event":"failed", "errors":[error]}));
    }
}
