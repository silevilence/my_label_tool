//! Developer verification CLI; uses the exact media seam called by the UI.
fn main() -> Result<(), String> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("usage: inspect_onnx_graph model.onnx")?;
    let graph = my_label_tool_lib::inspect_onnx_graph_file(std::path::Path::new(&path))?;
    println!(
        "{}",
        serde_json::to_string(&graph).map_err(|e| e.to_string())?
    );
    Ok(())
}
