FROM docker.io/library/rust:1-bookworm AS build
WORKDIR /work
COPY src-tauri/script-host/Cargo.toml src-tauri/script-host/Cargo.lock ./src-tauri/script-host/
COPY src-tauri/script-host/src ./src-tauri/script-host/src
COPY src-tauri/script-host/tests ./src-tauri/script-host/tests
COPY src/lib/defaults/script-limits.json ./src/lib/defaults/script-limits.json
COPY examples/scripts ./examples/scripts
RUN cargo test --locked --manifest-path src-tauri/script-host/Cargo.toml
RUN cargo build --locked --release --manifest-path src-tauri/script-host/Cargo.toml --bin label-script-host

FROM docker.io/library/debian:bookworm-slim
COPY --from=build /work/src-tauri/script-host/target/release/label-script-host /usr/local/bin/label-script-host
COPY src-tauri/script-tools/THIRD-PARTY-LICENSES.txt /usr/share/doc/label-script-host/THIRD-PARTY-LICENSES.txt
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/label-script-host"]
