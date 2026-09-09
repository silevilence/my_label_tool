use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{ipc::Channel, Manager};

use crate::{
    i18n::zh_cn as text,
    media::{
        onnx_metadata::inspect_onnx_bytes,
        prelabel::{
            runtime_download::{download_bytes_from_url, HttpDownload, DOWNLOAD_TIMEOUTS},
            task::{AsyncCancellation, CancelHandle, TaskRegistry},
        },
    },
    models::prelabel::{PrelabelModelLibrary, YoloModelFormat},
};

/// Downloads are buffered in RAM before the ONNX payload is validated, so a hard cap keeps a
/// runaway response from exhausting memory. YOLO ONNX models are tens of MB; 2 GiB is a
/// generous ceiling.
pub const MAX_MODEL_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

static MODEL_DOWNLOAD_TASKS: OnceLock<TaskRegistry<AsyncCancellation>> = OnceLock::new();

fn model_download_tasks() -> &'static TaskRegistry<AsyncCancellation> {
    MODEL_DOWNLOAD_TASKS.get_or_init(|| TaskRegistry::new(text::MODEL_DOWNLOAD_TASK_LABEL))
}

/// Streamed progress events for an in-flight prelabel-model download.
#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModelDownloadEvent {
    Started {
        file_name: String,
    },
    Progress {
        file_name: String,
        downloaded: u64,
        total: Option<u64>,
    },
    Completed {
        file_name: String,
    },
}

/// The inspected ONNX summary plus the managed path the downloaded model was installed to.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadResult {
    pub path: String,
    pub format: YoloModelFormat,
    pub class_count: usize,
    pub input_width: usize,
    pub input_height: usize,
    pub class_names: Vec<String>,
}

/// Directory for downloaded model files, managed by the app (next to `onnxruntime/` and
/// `plugins/`). User-imported model files stay wherever the user chose; only updates pulled
/// from a URL land here.
pub(crate) fn managed_models_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("models"))
        .map_err(text::model_app_data_failed)
}

/// Downloads the model from `source_url`, validates it is a YOLO ONNX export, and installs it
/// atomically into the managed models directory. Previous models are retained until the model
/// library saves the new path successfully. A cancellation surfaces as `Ok(None)`.
pub async fn download_prelabel_model_task(
    app: tauri::AppHandle,
    download_id: String,
    source_url: String,
    on_progress: Channel<ModelDownloadEvent>,
) -> Result<Option<ModelDownloadResult>, String> {
    let handle = Arc::new(AsyncCancellation::new());
    model_download_tasks().register(&download_id, Arc::clone(&handle))?;
    let outcome = match managed_models_directory(&app) {
        Ok(directory) => download_model_file(&directory, &handle, &source_url, on_progress).await,
        Err(error) => Err(error),
    };
    model_download_tasks().remove(&download_id);
    outcome
}

/// `on_progress` is owned (not borrowed) across the async body: Tauri's [`Channel`] is `Send`
/// but not guaranteed `Sync`, so a shared `&Channel` would not be acceptable in a `Send` future.
async fn download_model_file(
    directory: &Path,
    handle: &AsyncCancellation,
    source_url: &str,
    on_progress: Channel<ModelDownloadEvent>,
) -> Result<Option<ModelDownloadResult>, String> {
    if handle.is_cancelled() {
        return Ok(None);
    }
    let file_name = download_file_name(source_url)?;
    let _ = on_progress.send(ModelDownloadEvent::Started {
        file_name: file_name.clone(),
    });
    let bytes = download_bytes_from_url(
        HttpDownload {
            handle,
            url: source_url.trim(),
            timeouts: DOWNLOAD_TIMEOUTS,
            max_bytes: Some(MAX_MODEL_DOWNLOAD_BYTES),
            timed_out: || text::model_download_timed_out(&file_name),
            map_error: |error| text::model_download_failed(error),
        },
        |downloaded, total| ModelDownloadEvent::Progress {
            file_name: file_name.clone(),
            downloaded,
            total,
        },
        |event| {
            let _ = on_progress.send(event);
        },
    )
    .await?;
    let Some(bytes) = bytes else {
        return Ok(None);
    };
    if handle.is_cancelled() {
        return Ok(None);
    }

    let summary = inspect_onnx_bytes(&bytes, &file_name).map_err(text::model_onnx_invalid)?;
    if handle.is_cancelled() {
        return Ok(None);
    }
    let path = install_model_file(directory, &file_name, &bytes)?;
    let _ = on_progress.send(ModelDownloadEvent::Completed {
        file_name: file_name.clone(),
    });
    Ok(Some(ModelDownloadResult {
        path,
        format: summary.format,
        class_count: summary.class_count,
        input_width: summary.input_width,
        input_height: summary.input_height,
        class_names: summary.class_names,
    }))
}

/// Derives the target file name from the URL path. Direct links to `.onnx` files name the file
/// naturally; anything else is rejected so a redirect page or bare domain cannot become
/// `model.onnx` in the managed directory.
pub(crate) fn download_file_name(source_url: &str) -> Result<String, String> {
    let source_url = source_url.trim();
    let lower = source_url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err(text::MODEL_SOURCE_URL_INVALID.to_string());
    }
    let url =
        reqwest::Url::parse(source_url).map_err(|_| text::MODEL_SOURCE_URL_INVALID.to_string())?;
    if url.host_str().is_none() {
        return Err(text::MODEL_SOURCE_URL_INVALID.to_string());
    }
    let file_name = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .unwrap_or_default();
    let valid = file_name.len() > 5 && file_name.to_ascii_lowercase().ends_with(".onnx");
    if valid {
        Ok(file_name.to_string())
    } else {
        Err(text::MODEL_SOURCE_FILE_NAME_UNAVAILABLE.to_string())
    }
}

/// Writes validated bytes atomically (staging file + rename), retaining previous files until
/// the model library commits the new path. An existing file with
/// the same name is never overwritten — the new copy gets a timestamped name instead, which
/// also sidesteps Windows file locks held by a loaded ONNX session.
fn install_model_file(directory: &Path, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    fs::create_dir_all(directory)
        .map_err(|error| text::model_create_dir_failed(directory, error))?;

    let mut target = directory.join(file_name);
    if target.exists() {
        target = unique_target(directory, file_name)?;
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let stem = file_name
        .trim_end_matches(".onnx")
        .trim_end_matches(".ONNX");
    let staging = directory.join(format!(
        ".{stem}.downloading-{}-{nonce}",
        std::process::id()
    ));
    fs::write(&staging, bytes).map_err(|error| {
        let _ = fs::remove_file(&staging);
        text::model_write_failed(&staging, error)
    })?;
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_file(&staging);
        return Err(text::model_write_failed(&target, error));
    }

    Ok(target.to_string_lossy().into_owned())
}

fn unique_target(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let stem = file_name
        .strip_suffix(".onnx")
        .or_else(|| file_name.strip_suffix(".ONNX"))
        .unwrap_or(file_name);
    let candidate = directory.join(format!("{stem}-{nonce}.onnx"));
    if candidate.exists() {
        return Err(text::model_write_failed(
            &candidate,
            text::MODEL_TARGET_EXISTS,
        ));
    }
    Ok(candidate)
}

/// Called only after the new library is persisted. Only replaced, unreferenced managed files
/// are eligible; deletion alone does not delete a user's model file. Cleanup is best effort.
pub(crate) fn remove_replaced_managed_models(
    directory: &Path,
    previous: &PrelabelModelLibrary,
    next: &PrelabelModelLibrary,
) {
    let Ok(managed) = directory.canonicalize() else {
        return;
    };
    for old in &previous.models {
        if !next
            .models
            .iter()
            .any(|model| model.id == old.id && model.path != old.path)
        {
            continue;
        }
        let Ok(resolved) = Path::new(&old.path).canonicalize() else {
            continue;
        };
        if resolved.starts_with(&managed)
            && !next.models.iter().any(|model| {
                model.path == old.path
                    || Path::new(&model.path)
                        .canonicalize()
                        .is_ok_and(|path| path == resolved)
            })
        {
            let _ = fs::remove_file(&old.path);
        }
    }
}

/// Flags any in-flight model download as cancelled. Used on app exit so a stalled connection
/// cannot keep the process alive.
pub fn cancel_all_model_downloads() {
    model_download_tasks().cancel_all();
}

/// Cancels the in-flight download with the given id, exposing the shared registry so the
/// command layer stays thin. See [`TaskRegistry::cancel`](TaskRegistry::cancel).
pub fn cancel_model_download(
    download_id: &str,
) -> Result<crate::media::prelabel::task::CancellationResult, String> {
    model_download_tasks().cancel(download_id)
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write, sync::Arc};

    use super::{
        download_file_name, download_model_file, install_model_file, MAX_MODEL_DOWNLOAD_BYTES,
    };
    use crate::media::{
        onnx_metadata::inspect_onnx_bytes,
        prelabel::task::{AsyncCancellation, CancelHandle},
        test_support::{onnx_model, read_request, spawn_http_server},
    };

    fn sample_onnx() -> Vec<u8> {
        onnx_model(
            &[1, 3, 640, 640],
            &[1, 6, 8400],
            "Ultralytics YOLO11n model",
            Some("{0: 'person', 1: 'bicycle'}"),
        )
    }

    /// Serves the body once. The server thread is detached, not joined: joining before the
    /// client connects would deadlock the test (the server waits for the request while the
    /// test waits for the server thread).
    fn serve_bytes(body: Vec<u8>) -> String {
        let (url, _server) = spawn_http_server(move |mut stream| {
            read_request(&mut stream);
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .unwrap();
            stream.write_all(&body).unwrap();
            stream.flush().unwrap();
        });
        url
    }

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "my-label-tool-model-download-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[tokio::test]
    async fn downloads_validates_and_installs_the_model() {
        let sample = sample_onnx();
        let url = serve_bytes(sample.clone());
        let directory = temporary_directory("install");

        let result = download_model_file(
            &directory,
            &AsyncCancellation::new(),
            &url,
            tauri::ipc::Channel::new(|_message| Ok(())),
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(result.class_count, 2);
        assert_eq!(result.input_width, 640);
        assert!(result.path.ends_with("fixture.onnx"), "{}", result.path);
        let installed = fs::read(&result.path).unwrap();
        assert_eq!(installed, sample);
        assert_eq!(inspect_onnx_bytes(&installed, "fixture.onnx").unwrap(), {
            use crate::media::onnx_metadata::OnnxModelSummary;
            OnnxModelSummary {
                format: crate::models::prelabel::YoloModelFormat::Yolo11,
                class_count: 2,
                input_width: 640,
                input_height: 640,
                class_names: vec!["person".to_string(), "bicycle".to_string()],
            }
        });
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn rejects_a_payload_that_is_not_an_onnx_model() {
        let url = serve_bytes(b"definitely not onnx".to_vec());
        let directory = temporary_directory("reject");

        let error = download_model_file(
            &directory,
            &AsyncCancellation::new(),
            &url,
            tauri::ipc::Channel::new(|_message| Ok(())),
        )
        .await
        .unwrap_err();

        assert!(error.contains("YOLO ONNX"));
        assert!(!directory.exists());
    }

    #[tokio::test]
    async fn aborts_when_the_content_length_exceeds_the_size_limit() {
        let (url, _server) = spawn_http_server(move |mut stream| {
            read_request(&mut stream);
            // Announce a body beyond the cap. The client must abort from Content-Length alone;
            // never stream the body here, a blocked write to the closed peer would deadlock.
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                    MAX_MODEL_DOWNLOAD_BYTES + 1
                )
                .as_bytes(),
            );
        });
        let directory = temporary_directory("limit");

        let error = download_model_file(
            &directory,
            &AsyncCancellation::new(),
            &url,
            tauri::ipc::Channel::new(|_message| Ok(())),
        )
        .await
        .unwrap_err();

        assert!(error.contains("大小上限"));
        assert!(!directory.exists());
    }

    #[test]
    fn derives_and_validates_the_target_file_name_from_the_url() {
        assert_eq!(
            download_file_name("https://example.com/models/yolo11n.onnx").unwrap(),
            "yolo11n.onnx"
        );
        assert_eq!(
            download_file_name("https://example.com/yolo11n.onnx?token=abc#frag").unwrap(),
            "yolo11n.onnx"
        );
        assert!(download_file_name("https://example.com/releases/latest").is_err());
        assert!(download_file_name("https://example.com/not-a-model.bin").is_err());
        assert!(download_file_name("https://example.com/model.onnx/download").is_err());
        assert!(download_file_name("https://example.com/model.onnx/").is_err());
        assert!(download_file_name("https://example.com/.onnx").is_err());
        assert!(download_file_name("https://model.onnx").is_err());
        assert_eq!(
            download_file_name(" HTTPS://example.com/model.ONNX?token=abc#file ").unwrap(),
            "model.ONNX"
        );
    }

    #[test]
    fn rejects_non_http_source_urls() {
        assert!(download_file_name("https://example.com/a.onnx").is_ok());
        assert!(download_file_name("http://example.com/a.onnx").is_ok());
        assert!(download_file_name("file:///etc/passwd").is_err());
        assert!(download_file_name("ftp://example.com/a.onnx").is_err());
        assert!(download_file_name("https://").is_err());
    }

    #[test]
    fn install_retains_previous_models_until_the_library_is_saved() {
        let directory = temporary_directory("replace");
        fs::create_dir_all(&directory).unwrap();
        let first = install_model_file(&directory, "yolo11n.onnx", b"first").unwrap();
        assert!(first.ends_with("yolo11n.onnx"));

        // Same file name must not be overwritten; the new copy gets a unique name and the
        // previous managed file is retained until the library commits the replacement.
        let second = install_model_file(&directory, "yolo11n.onnx", b"second").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&second).unwrap(), b"second");
        assert_eq!(fs::read(&first).unwrap(), b"first");

        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn cancellation_before_download_returns_none() {
        let handle = Arc::new(AsyncCancellation::new());
        CancelHandle::cancel(handle.as_ref());
        let directory = temporary_directory("cancelled");

        let result = download_model_file(
            &directory,
            &handle,
            "https://example.com/yolo11n.onnx",
            tauri::ipc::Channel::new(|_message| Ok(())),
        )
        .await
        .unwrap();

        assert!(result.is_none());
        assert!(!directory.exists());
    }
}
