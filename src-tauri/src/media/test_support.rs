//! Test-only helpers shared across media modules: a local HTTP test server for download
//! tests and builders for minimal ONNX protobuf samples.

use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};

/// Spawns a one-shot HTTP server on an ephemeral local port and returns its base URL plus
/// the server thread. `serve` handles the single accepted connection (request read, response
/// write, stall, etc.).
pub(crate) fn spawn_http_server(
    serve: impl FnOnce(TcpStream) + Send + 'static,
) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).unwrap();
                    serve(stream);
                    return;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "test client did not connect");
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("test server accept failed: {error}"),
            }
        }
    });
    (format!("http://{address}/fixture.onnx"), server)
}

pub(crate) fn read_request(stream: &mut TcpStream) {
    let mut request = [0_u8; 1024];
    let _ = stream.read(&mut request).unwrap();
}

/// Minimal ONNX protobuf builders (see onnx_metadata.rs for the parsed fields).
pub(crate) fn varint(mut value: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        bytes.push(byte);
        if value == 0 {
            return bytes;
        }
    }
}

pub(crate) fn length_delimited(field: u64, value: &[u8]) -> Vec<u8> {
    let mut bytes = varint((field << 3) | 2);
    bytes.extend(varint(value.len() as u64));
    bytes.extend(value);
    bytes
}

pub(crate) fn varint_field(field: u64, value: u64) -> Vec<u8> {
    let mut bytes = varint(field << 3);
    bytes.extend(varint(value));
    bytes
}

fn value_info(name: &str, dimensions: &[u64]) -> Vec<u8> {
    let mut shape = Vec::new();
    for dimension in dimensions {
        shape.extend(length_delimited(1, &varint_field(1, *dimension)));
    }
    let mut tensor = varint_field(1, 1);
    tensor.extend(length_delimited(2, &shape));
    let type_proto = length_delimited(1, &tensor);
    let mut value = length_delimited(1, name.as_bytes());
    value.extend(length_delimited(2, &type_proto));
    value
}

fn metadata(key: &str, value: &str) -> Vec<u8> {
    let mut entry = length_delimited(1, key.as_bytes());
    entry.extend(length_delimited(2, value.as_bytes()));
    length_delimited(14, &entry)
}

pub(crate) fn model_with_outputs(
    input: &[u64],
    outputs: &[&[u64]],
    description: &str,
    names: Option<&str>,
) -> Vec<u8> {
    let mut graph = length_delimited(11, &value_info("images", input));
    for (index, output) in outputs.iter().enumerate() {
        graph.extend(length_delimited(
            12,
            &value_info(&format!("output{index}"), output),
        ));
    }
    let mut model = length_delimited(7, &graph);
    model.extend(metadata("description", description));
    if let Some(names) = names {
        model.extend(metadata("names", names));
    }
    model
}

/// A single-output YOLO ONNX sample with the given input/output shapes.
pub(crate) fn onnx_model(
    input: &[u64],
    output: &[u64],
    description: &str,
    names: Option<&str>,
) -> Vec<u8> {
    model_with_outputs(input, &[output], description, names)
}
