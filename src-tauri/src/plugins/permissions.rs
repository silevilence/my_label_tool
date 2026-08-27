// Permission parsing, install-time path freezing, runtime proxy enforcement,
// and their adversarial filesystem tests intentionally stay together so the
// authorization invariants can be audited as one security boundary.
use super::manifest::PluginPermission;
use super::protocol::{ProtocolError, ProtocolErrorCode, ResponseOutcome};
use crate::i18n::zh_cn as text;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::mpsc,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex, MutexGuard,
    },
    thread,
    time::{Duration, Instant},
};

pub(crate) const MAX_PROXY_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PROXY_WORKERS: usize = 4;
static ACTIVE_PROXY_WORKERS: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermissionGrant {
    pub permission: String,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginFsReadParams {
    pub path: String,
    #[serde(default)]
    pub encoding: PluginFsReadEncoding,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginFsReadEncoding {
    #[default]
    Utf8,
    Base64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginFsReadResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_utf8: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginFsWriteParams {
    pub path: String,
    pub content_utf8: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginFsWriteResult {
    pub written_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionRoots {
    pub project: Option<PathBuf>,
    pub models: PathBuf,
    pub app_data: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileAccess {
    Read,
    Write,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionErrorKind {
    InvalidRoot,
    PlaceholderUnavailable,
    InvalidGrant,
    DuplicateGrant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionError {
    pub kind: PermissionErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct PermissionPolicy {
    read_roots: Vec<PathBuf>,
    write_roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct FileProxyPolicy {
    read_roots: Vec<PathBuf>,
    write_roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyDispatchError {
    Timeout,
    Unavailable,
}

pub fn resolve_permission_grants(
    permissions: &[PluginPermission],
    roots: &PermissionRoots,
) -> Result<Vec<PluginPermissionGrant>, PermissionError> {
    let normalized_roots = PermissionRoots {
        project: roots
            .project
            .as_deref()
            .map(normalize_absolute)
            .transpose()?,
        models: normalize_absolute(&roots.models)?,
        app_data: normalize_absolute(&roots.app_data)?,
    };
    let mut seen = HashSet::new();
    let mut grants = Vec::with_capacity(permissions.len());
    for permission in permissions {
        let grant = match permission {
            PluginPermission::FsRead(target) => PluginPermissionGrant {
                permission: "fs.read".to_string(),
                target: Some(resolve_target(target, &normalized_roots)?),
            },
            PluginPermission::FsWrite(target) => PluginPermissionGrant {
                permission: "fs.write".to_string(),
                target: Some(resolve_target(target, &normalized_roots)?),
            },
            PluginPermission::Network => PluginPermissionGrant {
                permission: "network".to_string(),
                target: None,
            },
        };
        let key = (grant.permission.clone(), grant.target.clone());
        if !seen.insert(key) {
            return Err(permission_error(
                PermissionErrorKind::DuplicateGrant,
                text::PLUGIN_PERMISSION_DUPLICATE,
            ));
        }
        grants.push(grant);
    }
    Ok(grants)
}

pub fn resolve_permission_grants_for_install(
    permissions: &[PluginPermission],
    roots: &PermissionRoots,
) -> Result<Vec<PluginPermissionGrant>, PermissionError> {
    let mut grants = resolve_permission_grants(permissions, roots)?;
    for (permission, grant) in permissions.iter().zip(&mut grants) {
        let target = match permission {
            PluginPermission::FsRead(target) | PluginPermission::FsWrite(target) => target,
            PluginPermission::Network => continue,
        };
        let placeholder_root = placeholder_root(target, roots)?;
        let canonical_root = canonicalize_intended(&placeholder_root)?;
        let resolved = grant.target.as_deref().ok_or_else(|| {
            permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_GRANT_INVALID,
            )
        })?;
        let canonical_target = canonicalize_intended(Path::new(resolved))?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_PLACEHOLDER_ESCAPE,
            ));
        }
        grant.target = Some(canonical_target.to_string_lossy().into_owned());
    }
    Ok(grants)
}

impl PermissionPolicy {
    pub fn from_grants(grants: &[PluginPermissionGrant]) -> Result<Self, PermissionError> {
        let mut policy = Self::default();
        let mut seen = HashSet::new();
        for grant in grants {
            let target = match (grant.permission.as_str(), grant.target.as_deref()) {
                ("network", None) => None,
                ("fs.read" | "fs.write", Some(target)) => {
                    Some(normalize_for_comparison(Path::new(target)).map_err(|_| {
                        permission_error(
                            PermissionErrorKind::InvalidGrant,
                            text::PLUGIN_PERMISSION_GRANT_INVALID,
                        )
                    })?)
                }
                _ => {
                    return Err(permission_error(
                        PermissionErrorKind::InvalidGrant,
                        text::PLUGIN_PERMISSION_GRANT_INVALID,
                    ));
                }
            };
            let key = (grant.permission.clone(), target.clone());
            if !seen.insert(key) {
                return Err(permission_error(
                    PermissionErrorKind::DuplicateGrant,
                    text::PLUGIN_PERMISSION_DUPLICATE,
                ));
            }
            match (grant.permission.as_str(), target) {
                ("fs.read", Some(target)) => policy.read_roots.push(target),
                ("fs.write", Some(target)) => policy.write_roots.push(target),
                ("network", None) => {}
                _ => unreachable!("grant shape was validated above"),
            }
        }
        Ok(policy)
    }

    pub fn authorize_path(
        &self,
        access: FileAccess,
        path: &Path,
    ) -> Result<PathBuf, PermissionError> {
        let normalized = normalize_for_comparison(path).map_err(|_| {
            permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_ACCESS_DENIED,
            )
        })?;
        let roots = match access {
            FileAccess::Read => &self.read_roots,
            FileAccess::Write => &self.write_roots,
        };
        if roots.iter().any(|root| normalized.starts_with(root)) {
            Ok(normalized)
        } else {
            Err(permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_ACCESS_DENIED,
            ))
        }
    }
}

impl FileProxyPolicy {
    pub fn from_grants(grants: &[PluginPermissionGrant]) -> Result<Self, PermissionError> {
        let policy = PermissionPolicy::from_grants(grants)?;
        Ok(Self {
            read_roots: policy.read_roots,
            write_roots: policy.write_roots,
        })
    }

    fn authorize_path(&self, access: FileAccess, path: &Path) -> Result<PathBuf, PermissionError> {
        let roots = self.roots(access);
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else if roots.len() == 1
            && !path.as_os_str().is_empty()
            && path
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
        {
            roots[0].join(path)
        } else {
            return Err(permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_ACCESS_DENIED,
            ));
        };
        let normalized = normalize_for_comparison(&candidate).map_err(|_| {
            permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_ACCESS_DENIED,
            )
        })?;
        if roots.iter().any(|root| normalized.starts_with(root)) {
            Ok(normalized)
        } else {
            Err(permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_ACCESS_DENIED,
            ))
        }
    }

    fn roots(&self, access: FileAccess) -> &[PathBuf] {
        match access {
            FileAccess::Read => &self.read_roots,
            FileAccess::Write => &self.write_roots,
        }
    }
}

pub fn handle_file_proxy_request(
    policy: &FileProxyPolicy,
    method: &str,
    params: &Value,
) -> ResponseOutcome {
    handle_file_proxy_request_with_cancellation(policy, method, params, None)
}

fn handle_file_proxy_request_with_cancellation(
    policy: &FileProxyPolicy,
    method: &str,
    params: &Value,
    cancellation: Option<&ProxyCancellation>,
) -> ResponseOutcome {
    match method {
        "fs.read" => proxy_read(policy, params),
        "fs.write" => proxy_write(policy, params, cancellation),
        _ => ResponseOutcome::Error(ProtocolError::new(
            ProtocolErrorCode::MethodNotFound,
            text::PLUGIN_PROXY_METHOD_NOT_FOUND,
        )),
    }
}

pub fn dispatch_file_proxy_request(
    policy: FileProxyPolicy,
    method: String,
    params: Value,
    timeout: Duration,
) -> Result<ResponseOutcome, ProxyDispatchError> {
    dispatch_proxy_job(
        move |cancellation| {
            handle_file_proxy_request_with_cancellation(
                &policy,
                &method,
                &params,
                Some(&cancellation),
            )
        },
        timeout,
    )
}

fn dispatch_proxy_job(
    job: impl FnOnce(ProxyCancellation) -> ResponseOutcome + Send + 'static,
    timeout: Duration,
) -> Result<ResponseOutcome, ProxyDispatchError> {
    reserve_proxy_worker()?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let cancellation = ProxyCancellation::new(timeout);
    let worker_cancellation = cancellation.clone();
    let worker = thread::Builder::new()
        .name("plugin-file-proxy".to_string())
        .spawn(move || {
            let _lease = ProxyWorkerLease;
            let outcome = job(worker_cancellation.clone());
            let _ = sender.send(outcome);
            worker_cancellation.finish();
        });
    if worker.is_err() {
        ACTIVE_PROXY_WORKERS.fetch_sub(1, Ordering::AcqRel);
        return Err(ProxyDispatchError::Unavailable);
    }
    match receiver.recv_timeout(timeout) {
        Ok(outcome) => Ok(outcome),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            if cancellation.cancel_or_wait_for_commit() {
                receiver.recv().map_err(|_| ProxyDispatchError::Unavailable)
            } else {
                Err(ProxyDispatchError::Timeout)
            }
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(ProxyDispatchError::Unavailable),
    }
}

#[derive(Debug, Clone)]
struct ProxyCancellation {
    state: Arc<(Mutex<ProxyJobState>, Condvar)>,
    deadline: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProxyJobState {
    Pending,
    Cancelled,
    Committing,
    Finished,
}

impl ProxyCancellation {
    fn new(timeout: Duration) -> Self {
        Self {
            state: Arc::new((Mutex::new(ProxyJobState::Pending), Condvar::new())),
            deadline: Instant::now()
                .checked_add(timeout)
                .unwrap_or_else(Instant::now),
        }
    }

    #[cfg(test)]
    fn is_cancelled(&self) -> bool {
        self.state
            .0
            .lock()
            .map_or(true, |state| *state == ProxyJobState::Cancelled)
            || Instant::now() >= self.deadline
    }

    fn begin_commit(&self) -> Option<MutexGuard<'_, ProxyJobState>> {
        let mut state = self.state.0.lock().ok()?;
        if *state != ProxyJobState::Pending || Instant::now() >= self.deadline {
            return None;
        }
        *state = ProxyJobState::Committing;
        Some(state)
    }

    fn finish(&self) {
        let (state_lock, wake) = &*self.state;
        if let Ok(mut state) = state_lock.lock() {
            if *state != ProxyJobState::Cancelled {
                *state = ProxyJobState::Finished;
            }
            wake.notify_all();
        }
    }

    /// Returns true when a mutating operation had already entered its commit
    /// section. In that case the dispatcher waits for the actual outcome and
    /// never reports a timeout while the commit can still change the file.
    fn cancel_or_wait_for_commit(&self) -> bool {
        let (state_lock, wake) = &*self.state;
        let Ok(mut state) = state_lock.lock() else {
            return false;
        };
        loop {
            match *state {
                ProxyJobState::Pending => {
                    *state = ProxyJobState::Cancelled;
                    wake.notify_all();
                    return false;
                }
                ProxyJobState::Cancelled => return false,
                ProxyJobState::Finished => return true,
                ProxyJobState::Committing => {
                    let Ok(next) = wake.wait(state) else {
                        return false;
                    };
                    state = next;
                }
            }
        }
    }
}

struct ProxyWorkerLease;

impl Drop for ProxyWorkerLease {
    fn drop(&mut self) {
        ACTIVE_PROXY_WORKERS.fetch_sub(1, Ordering::AcqRel);
    }
}

fn reserve_proxy_worker() -> Result<(), ProxyDispatchError> {
    ACTIVE_PROXY_WORKERS
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
            (active < MAX_PROXY_WORKERS).then_some(active + 1)
        })
        .map(|_| ())
        .map_err(|_| ProxyDispatchError::Unavailable)
}

fn proxy_read(policy: &FileProxyPolicy, params: &Value) -> ResponseOutcome {
    let Ok(params) = serde_json::from_value::<PluginFsReadParams>(params.clone()) else {
        return invalid_proxy_argument();
    };
    let mut file = match open_authorized_read(policy, Path::new(&params.path)) {
        Ok(file) => file,
        Err(error) => return ResponseOutcome::Error(error),
    };
    let metadata = match file.metadata() {
        Ok(metadata) if metadata.is_file() && metadata.len() <= MAX_PROXY_FILE_BYTES => metadata,
        Ok(_) => {
            return ResponseOutcome::Error(ProtocolError::new(
                ProtocolErrorCode::InvalidArgument,
                text::PLUGIN_PROXY_FILE_INVALID,
            ));
        }
        Err(_) => return proxy_io_error(),
    };
    let mut content = Vec::with_capacity(metadata.len() as usize);
    if file
        .by_ref()
        .take(MAX_PROXY_FILE_BYTES + 1)
        .read_to_end(&mut content)
        .is_err()
        || content.len() as u64 > MAX_PROXY_FILE_BYTES
    {
        return proxy_io_error();
    }
    match params.encoding {
        PluginFsReadEncoding::Utf8 => match String::from_utf8(content) {
            Ok(content_utf8) => serialize_proxy_result(PluginFsReadResult {
                content_utf8: Some(content_utf8),
                content_base64: None,
            }),
            Err(_) => proxy_io_error(),
        },
        PluginFsReadEncoding::Base64 => serialize_proxy_result(PluginFsReadResult {
            content_utf8: None,
            content_base64: Some(base64::engine::general_purpose::STANDARD.encode(content)),
        }),
    }
}

fn proxy_write(
    policy: &FileProxyPolicy,
    params: &Value,
    cancellation: Option<&ProxyCancellation>,
) -> ResponseOutcome {
    let Ok(params) = serde_json::from_value::<PluginFsWriteParams>(params.clone()) else {
        return invalid_proxy_argument();
    };
    if params.content_utf8.len() as u64 > MAX_PROXY_FILE_BYTES {
        return ResponseOutcome::Error(ProtocolError::new(
            ProtocolErrorCode::InvalidArgument,
            text::PLUGIN_PROXY_FILE_INVALID,
        ));
    }
    let path = match policy.authorize_path(FileAccess::Write, Path::new(&params.path)) {
        Ok(path) => path,
        Err(error) => return ResponseOutcome::Error(permission_denied(error)),
    };
    if !is_existing_regular_file_without_link(&path) {
        return ResponseOutcome::Error(permission_denied(PermissionError {
            kind: PermissionErrorKind::InvalidGrant,
            message: text::PLUGIN_PERMISSION_ACCESS_DENIED.to_string(),
        }));
    }
    let mut file = match fs::OpenOptions::new().write(true).open(&path) {
        Ok(file) => file,
        Err(_) => return proxy_io_error(),
    };
    let final_path = match opened_file_path(&file) {
        Ok(path) => path,
        Err(_) => return proxy_io_error(),
    };
    if ensure_opened_path_allowed(policy, FileAccess::Write, &final_path).is_err() {
        return ResponseOutcome::Error(permission_denied(PermissionError {
            kind: PermissionErrorKind::InvalidGrant,
            message: text::PLUGIN_PERMISSION_ACCESS_DENIED.to_string(),
        }));
    }
    if !file.metadata().is_ok_and(|metadata| metadata.is_file()) {
        return proxy_io_error();
    }
    let _commit = if let Some(cancellation) = cancellation {
        let Some(commit) = cancellation.begin_commit() else {
            return ResponseOutcome::Error(ProtocolError::new(
                ProtocolErrorCode::Timeout,
                text::PLUGIN_RUNTIME_TIMEOUT,
            ));
        };
        Some(commit)
    } else {
        None
    };
    if file.set_len(0).is_err() {
        return proxy_io_error();
    }
    if std::io::Write::write_all(&mut file, params.content_utf8.as_bytes()).is_err()
        || std::io::Write::flush(&mut file).is_err()
    {
        return proxy_io_error();
    }
    serialize_proxy_result(PluginFsWriteResult {
        written_bytes: params.content_utf8.len(),
    })
}

fn is_existing_regular_file_without_link(path: &Path) -> bool {
    is_local_proxy_path(path)
        && fs::symlink_metadata(path)
            .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
}

#[cfg(windows)]
fn is_local_proxy_path(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumePathNameW},
    };

    const DRIVE_UNKNOWN: u32 = 0;
    const DRIVE_NO_ROOT_DIR: u32 = 1;
    const DRIVE_REMOTE: u32 = 4;
    let mut path_wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    path_wide.push(0);
    let mut volume = vec![0_u16; 512];
    // SAFETY: both buffers are NUL-terminated/initialized for the duration of
    // the calls. Failure is handled by denying the proxy operation.
    if unsafe { GetVolumePathNameW(PCWSTR(path_wide.as_ptr()), &mut volume) }.is_err() {
        return false;
    }
    // SAFETY: GetVolumePathNameW populated `volume` as a NUL-terminated buffer,
    // which remains allocated and immutable for the duration of this call.
    let drive_type = unsafe { GetDriveTypeW(PCWSTR(volume.as_ptr())) };
    !matches!(drive_type, DRIVE_UNKNOWN | DRIVE_NO_ROOT_DIR | DRIVE_REMOTE)
}

#[cfg(unix)]
fn is_local_proxy_path(_path: &Path) -> bool {
    true
}

fn open_authorized_read(policy: &FileProxyPolicy, path: &Path) -> Result<fs::File, ProtocolError> {
    let lexical = policy
        .authorize_path(FileAccess::Read, path)
        .map_err(permission_denied)?;
    if !is_existing_regular_file_without_link(&lexical) {
        return Err(ProtocolError::new(
            ProtocolErrorCode::InvalidArgument,
            text::PLUGIN_PROXY_FILE_INVALID,
        ));
    }
    let file = fs::File::open(lexical).map_err(|_| {
        ProtocolError::new(
            ProtocolErrorCode::InvalidArgument,
            text::PLUGIN_PROXY_FILE_INVALID,
        )
    })?;
    let final_path = opened_file_path(&file).map_err(|_| {
        ProtocolError::new(
            ProtocolErrorCode::InvalidArgument,
            text::PLUGIN_PROXY_FILE_INVALID,
        )
    })?;
    ensure_opened_path_allowed(policy, FileAccess::Read, &final_path)?;
    Ok(file)
}

fn ensure_opened_path_allowed(
    policy: &FileProxyPolicy,
    access: FileAccess,
    path: &Path,
) -> Result<(), ProtocolError> {
    let comparable = normalize_for_comparison(path).map_err(|_| {
        permission_denied(PermissionError {
            kind: PermissionErrorKind::InvalidGrant,
            message: text::PLUGIN_PERMISSION_ACCESS_DENIED.to_string(),
        })
    })?;
    let allowed = policy
        .roots(access)
        .iter()
        .any(|root| comparable.starts_with(root));
    if allowed {
        Ok(())
    } else {
        Err(permission_denied(PermissionError {
            kind: PermissionErrorKind::InvalidGrant,
            message: text::PLUGIN_PERMISSION_ACCESS_DENIED.to_string(),
        }))
    }
}

#[cfg(windows)]
pub(crate) fn opened_file_path(file: &fs::File) -> std::io::Result<PathBuf> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt, os::windows::io::AsRawHandle};
    use windows::Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED, VOLUME_NAME_DOS},
    };

    let mut buffer = vec![0_u16; 512];
    loop {
        // SAFETY: the File owns a valid handle for the duration of the call,
        // and the Windows binding receives the initialized mutable slice.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                HANDLE(file.as_raw_handle()),
                &mut buffer,
                windows::Win32::Storage::FileSystem::GETFINALPATHNAMEBYHANDLE_FLAGS(
                    FILE_NAME_NORMALIZED.0 | VOLUME_NAME_DOS.0,
                ),
            )
        } as usize;
        if length == 0 {
            return Err(std::io::Error::last_os_error());
        }
        if length < buffer.len() {
            buffer.truncate(length);
            return Ok(PathBuf::from(OsString::from_wide(&buffer)));
        }
        buffer.resize(length + 1, 0);
    }
}

#[cfg(unix)]
pub(crate) fn opened_file_path(file: &fs::File) -> std::io::Result<PathBuf> {
    use std::os::fd::AsRawFd;

    let descriptor = file.as_raw_fd();
    fs::read_link(format!("/proc/self/fd/{descriptor}"))
        .or_else(|_| fs::read_link(format!("/dev/fd/{descriptor}")))
}

fn serialize_proxy_result(result: impl Serialize) -> ResponseOutcome {
    match serde_json::to_value(result) {
        Ok(value) => ResponseOutcome::Result(value),
        Err(_) => proxy_io_error(),
    }
}

fn invalid_proxy_argument() -> ResponseOutcome {
    ResponseOutcome::Error(ProtocolError::new(
        ProtocolErrorCode::InvalidArgument,
        text::PLUGIN_PROXY_ARGUMENT_INVALID,
    ))
}

fn proxy_io_error() -> ResponseOutcome {
    ResponseOutcome::Error(ProtocolError::new(
        ProtocolErrorCode::InternalError,
        text::PLUGIN_PROXY_IO_FAILED,
    ))
}

fn permission_denied(_error: PermissionError) -> ProtocolError {
    ProtocolError::new(
        ProtocolErrorCode::PermissionDenied,
        text::PLUGIN_PERMISSION_ACCESS_DENIED,
    )
}

fn placeholder_root(target: &str, roots: &PermissionRoots) -> Result<PathBuf, PermissionError> {
    match target.replace('\\', "/").split('/').next() {
        Some("%PROJECT%") => roots.project.clone().ok_or_else(|| {
            permission_error(
                PermissionErrorKind::PlaceholderUnavailable,
                text::PLUGIN_PERMISSION_PROJECT_REQUIRED,
            )
        }),
        Some("%MODELS%") => Ok(roots.models.clone()),
        Some("%APP_DATA%") => Ok(roots.app_data.clone()),
        _ => Err(permission_error(
            PermissionErrorKind::InvalidGrant,
            text::PLUGIN_PERMISSION_GRANT_INVALID,
        )),
    }
}

fn canonicalize_intended(path: &Path) -> Result<PathBuf, PermissionError> {
    let normalized = normalize_absolute(path)?;
    let mut existing = normalized.as_path();
    let mut missing = Vec::new();
    loop {
        match fs::symlink_metadata(existing) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() && fs::canonicalize(existing).is_err() {
                    return Err(permission_error(
                        PermissionErrorKind::InvalidGrant,
                        text::PLUGIN_PERMISSION_PLACEHOLDER_ESCAPE,
                    ));
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let name = existing.file_name().ok_or_else(|| {
                    permission_error(
                        PermissionErrorKind::InvalidGrant,
                        text::PLUGIN_PERMISSION_GRANT_INVALID,
                    )
                })?;
                missing.push(name.to_os_string());
                existing = existing.parent().ok_or_else(|| {
                    permission_error(
                        PermissionErrorKind::InvalidGrant,
                        text::PLUGIN_PERMISSION_GRANT_INVALID,
                    )
                })?;
            }
            Err(_) => {
                return Err(permission_error(
                    PermissionErrorKind::InvalidGrant,
                    text::PLUGIN_PERMISSION_GRANT_INVALID,
                ));
            }
        }
    }
    let mut canonical = fs::canonicalize(existing).map_err(|_| {
        permission_error(
            PermissionErrorKind::InvalidGrant,
            text::PLUGIN_PERMISSION_GRANT_INVALID,
        )
    })?;
    for component in missing.into_iter().rev() {
        canonical.push(component);
    }
    Ok(canonical)
}

fn resolve_target(target: &str, roots: &PermissionRoots) -> Result<String, PermissionError> {
    let normalized = target.replace('\\', "/");
    let mut segments = normalized.split('/');
    let placeholder = segments.next().unwrap_or_default();
    let base = match placeholder {
        "%PROJECT%" => roots.project.as_ref().ok_or_else(|| {
            permission_error(
                PermissionErrorKind::PlaceholderUnavailable,
                text::PLUGIN_PERMISSION_PROJECT_REQUIRED,
            )
        })?,
        "%MODELS%" => &roots.models,
        "%APP_DATA%" => &roots.app_data,
        _ => {
            return Err(permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_GRANT_INVALID,
            ));
        }
    };
    let mut resolved = base.clone();
    for segment in segments {
        if segment.is_empty() || matches!(segment, "." | "..") {
            return Err(permission_error(
                PermissionErrorKind::InvalidGrant,
                text::PLUGIN_PERMISSION_GRANT_INVALID,
            ));
        }
        resolved.push(segment);
    }
    Ok(resolved.to_string_lossy().into_owned())
}

fn normalize_absolute(path: &Path) -> Result<PathBuf, PermissionError> {
    if !path.is_absolute() {
        return Err(permission_error(
            PermissionErrorKind::InvalidRoot,
            text::PLUGIN_PERMISSION_ROOT_INVALID,
        ));
    }
    let mut normalized = PathBuf::new();
    let mut normal_depth = 0_usize;
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                normalized.push(component.as_os_str());
            }
            Component::Normal(_) => {
                normalized.push(component.as_os_str());
                normal_depth += 1;
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if normal_depth == 0 || !normalized.pop() {
                    return Err(permission_error(
                        PermissionErrorKind::InvalidRoot,
                        text::PLUGIN_PERMISSION_ROOT_INVALID,
                    ));
                }
                normal_depth -= 1;
            }
        }
    }
    Ok(normalized)
}

pub(crate) fn normalize_for_comparison(path: &Path) -> Result<PathBuf, PermissionError> {
    let normalized = normalize_absolute(path)?;
    #[cfg(windows)]
    {
        let value = normalized.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{rest}")));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(rest));
        }
    }
    Ok(normalized)
}

fn permission_error(kind: PermissionErrorKind, message: &str) -> PermissionError {
    PermissionError {
        kind,
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::AtomicBool;

    static TEST_ROOT_SEQUENCE: AtomicUsize = AtomicUsize::new(1);

    #[test]
    fn resolves_placeholders_to_absolute_preview_and_persisted_grants() {
        let base = test_root("resolve");
        let roots = PermissionRoots {
            project: Some(base.join("project")),
            models: base.join("models"),
            app_data: base.join("app-data"),
        };
        let permissions = vec![
            PluginPermission::FsRead("%PROJECT%/images".to_string()),
            PluginPermission::FsWrite("%MODELS%/exports".to_string()),
            PluginPermission::FsRead("%APP_DATA%/cache".to_string()),
            PluginPermission::Network,
        ];

        let grants = resolve_permission_grants(&permissions, &roots).expect("resolved grants");

        assert_eq!(grants[0].permission, "fs.read");
        assert_eq!(
            grants[0].target.as_deref(),
            path_text(&base.join("project").join("images"))
        );
        assert_eq!(
            grants[1].target.as_deref(),
            path_text(&base.join("models").join("exports"))
        );
        assert_eq!(
            grants[2].target.as_deref(),
            path_text(&base.join("app-data").join("cache"))
        );
        assert_eq!(grants[3].permission, "network");
        assert_eq!(grants[3].target, None);
    }

    #[test]
    fn project_placeholder_requires_an_open_project() {
        let base = test_root("missing-project");
        let roots = PermissionRoots {
            project: None,
            models: base.join("models"),
            app_data: base.join("app-data"),
        };

        let error = resolve_permission_grants(
            &[PluginPermission::FsRead("%PROJECT%/images".to_string())],
            &roots,
        )
        .expect_err("project placeholder must fail closed");

        assert_eq!(error.kind, PermissionErrorKind::PlaceholderUnavailable);
    }

    #[test]
    fn default_deny_and_directory_boundaries_are_pure_and_access_specific() {
        let base = test_root("authorize");
        let read_root = base.join("project/images");
        let write_root = base.join("exports");
        let policy = PermissionPolicy::from_grants(&[
            grant("fs.read", &read_root),
            grant("fs.write", &write_root),
        ])
        .expect("permission policy");

        assert_eq!(
            policy
                .authorize_path(FileAccess::Read, &read_root.join("nested/image.jpg"))
                .expect("read inside grant"),
            read_root.join("nested/image.jpg")
        );
        assert!(policy
            .authorize_path(FileAccess::Read, &base.join("project/secret.txt"))
            .is_err());
        assert!(policy
            .authorize_path(FileAccess::Read, &read_root.join("../../secret.txt"))
            .is_err());
        assert!(policy
            .authorize_path(FileAccess::Write, &read_root.join("new.txt"))
            .is_err());
        assert!(PermissionPolicy::default()
            .authorize_path(FileAccess::Read, &read_root.join("image.jpg"))
            .is_err());
    }

    #[test]
    fn invalid_and_duplicate_persisted_grants_fail_closed() {
        let base = test_root("invalid-grants");
        let duplicate = grant("fs.read", &base);
        let error = PermissionPolicy::from_grants(&[duplicate.clone(), duplicate])
            .expect_err("duplicate grants must be rejected");
        assert_eq!(error.kind, PermissionErrorKind::DuplicateGrant);

        let error = PermissionPolicy::from_grants(&[PluginPermissionGrant {
            permission: "fs.read".to_string(),
            target: Some("relative/path".to_string()),
        }])
        .expect_err("relative persisted grants must be rejected");
        assert_eq!(error.kind, PermissionErrorKind::InvalidGrant);
    }

    #[test]
    fn file_proxy_reads_and_writes_only_through_matching_grants() {
        let base = test_root("file-proxy");
        let read_root = base.join("read");
        let write_root = base.join("write");
        fs::create_dir_all(&read_root).expect("create read root");
        fs::create_dir_all(&write_root).expect("create write root");
        fs::write(read_root.join("input.txt"), "hello").expect("write fixture");
        fs::write(write_root.join("output.txt"), "old").expect("write output fixture");
        let policy = FileProxyPolicy::from_grants(&[
            grant(
                "fs.read",
                &fs::canonicalize(&read_root).expect("canonical read root"),
            ),
            grant(
                "fs.write",
                &fs::canonicalize(&write_root).expect("canonical write root"),
            ),
        ])
        .expect("permission policy");

        assert_eq!(
            handle_file_proxy_request(
                &policy,
                "fs.read",
                &json!({ "path": read_root.join("input.txt") }),
            ),
            ResponseOutcome::Result(json!({ "contentUtf8": "hello" }))
        );
        assert_eq!(
            handle_file_proxy_request(
                &policy,
                "fs.write",
                &json!({
                    "path": write_root.join("output.txt"),
                    "contentUtf8": "saved",
                }),
            ),
            ResponseOutcome::Result(json!({ "writtenBytes": 5 }))
        );
        assert_eq!(
            fs::read_to_string(write_root.join("output.txt")).expect("written file"),
            "saved"
        );
        let denied = handle_file_proxy_request(
            &policy,
            "fs.read",
            &json!({ "path": base.join("secret.txt") }),
        );
        assert!(matches!(
            denied,
            ResponseOutcome::Error(ProtocolError {
                code: ProtocolErrorCode::PermissionDenied,
                ..
            })
        ));
        let unknown = handle_file_proxy_request(&policy, "network.fetch", &Value::Null);
        assert!(matches!(
            unknown,
            ResponseOutcome::Error(ProtocolError {
                code: ProtocolErrorCode::MethodNotFound,
                ..
            })
        ));
        fs::remove_dir_all(base).expect("remove fixture");
    }

    #[test]
    fn file_proxy_reads_binary_project_relative_paths_as_base64() {
        let base = test_root("relative-binary-read");
        let project = base.join("project");
        fs::create_dir_all(project.join("images")).expect("create project images");
        fs::write(project.join("images/a.bin"), [0_u8, 0xff, 7]).expect("write binary fixture");
        let policy = FileProxyPolicy::from_grants(&[grant(
            "fs.read",
            &fs::canonicalize(&project).expect("canonical project"),
        )])
        .expect("permission policy");

        assert_eq!(
            handle_file_proxy_request(
                &policy,
                "fs.read",
                &json!({ "path": "images/a.bin", "encoding": "base64" }),
            ),
            ResponseOutcome::Result(json!({ "contentBase64": "AP8H" }))
        );
        assert!(matches!(
            handle_file_proxy_request(
                &policy,
                "fs.read",
                &json!({ "path": "../secret.bin", "encoding": "base64" }),
            ),
            ResponseOutcome::Error(ProtocolError {
                code: ProtocolErrorCode::PermissionDenied,
                ..
            })
        ));
        fs::remove_dir_all(base).expect("remove fixture");
    }

    #[test]
    fn install_resolution_rejects_a_symlink_escape() {
        let base = test_root("install-symlink-escape");
        let project = base.join("project");
        let outside = base.join("outside");
        fs::create_dir_all(&project).expect("create project");
        fs::create_dir_all(&outside).expect("create outside");
        if !create_directory_symlink(&outside, &project.join("linked")) {
            fs::remove_dir_all(base).expect("remove skipped fixture");
            return;
        }
        let roots = PermissionRoots {
            project: Some(project),
            models: base.join("models"),
            app_data: base.join("app-data"),
        };

        let error = resolve_permission_grants_for_install(
            &[PluginPermission::FsRead("%PROJECT%/linked".to_string())],
            &roots,
        )
        .expect_err("symlink escape must not be persisted as a grant");

        assert_eq!(error.kind, PermissionErrorKind::InvalidGrant);
        fs::remove_dir_all(base).expect("remove fixture");
    }

    #[test]
    fn file_proxy_does_not_follow_a_dangling_write_symlink() {
        let base = test_root("dangling-write-symlink");
        let write_root = base.join("write");
        let outside = base.join("outside");
        fs::create_dir_all(&write_root).expect("create write root");
        fs::create_dir_all(&outside).expect("create outside");
        let outside_file = outside.join("created.txt");
        let link = write_root.join("link.txt");
        if !create_file_symlink(&outside_file, &link) {
            fs::remove_dir_all(base).expect("remove skipped fixture");
            return;
        }
        let policy = FileProxyPolicy::from_grants(&[grant(
            "fs.write",
            &fs::canonicalize(&write_root).expect("canonical write root"),
        )])
        .expect("proxy policy");

        let outcome = handle_file_proxy_request(
            &policy,
            "fs.write",
            &json!({ "path": link, "contentUtf8": "must-not-escape" }),
        );

        assert!(matches!(
            outcome,
            ResponseOutcome::Error(ProtocolError {
                code: ProtocolErrorCode::PermissionDenied,
                ..
            })
        ));
        assert!(!outside_file.exists());
        fs::remove_dir_all(base).expect("remove fixture");
    }

    #[test]
    fn file_proxy_validates_the_opened_write_handle_before_modifying_content() {
        let base = test_root("opened-write-handle");
        let write_root = base.join("write");
        let outside = base.join("outside");
        fs::create_dir_all(&write_root).expect("create write root");
        fs::create_dir_all(&outside).expect("create outside");
        let outside_file = outside.join("protected.txt");
        fs::write(&outside_file, "unchanged").expect("write outside fixture");
        if !create_directory_symlink(&outside, &write_root.join("linked")) {
            fs::remove_dir_all(base).expect("remove skipped fixture");
            return;
        }
        let policy = FileProxyPolicy::from_grants(&[grant(
            "fs.write",
            &fs::canonicalize(&write_root).expect("canonical write root"),
        )])
        .expect("proxy policy");

        let outcome = handle_file_proxy_request(
            &policy,
            "fs.write",
            &json!({
                "path": write_root.join("linked/protected.txt"),
                "contentUtf8": "must-not-escape",
            }),
        );

        assert!(matches!(
            outcome,
            ResponseOutcome::Error(ProtocolError {
                code: ProtocolErrorCode::PermissionDenied,
                ..
            })
        ));
        assert_eq!(
            fs::read_to_string(&outside_file).expect("read protected fixture"),
            "unchanged"
        );
        fs::remove_dir_all(base).expect("remove fixture");
    }

    #[test]
    fn typed_file_proxy_payloads_round_trip_with_the_public_field_names() {
        let read = PluginFsReadParams {
            path: "C:/data/input.txt".to_string(),
            encoding: PluginFsReadEncoding::Utf8,
        };
        let write = PluginFsWriteParams {
            path: "C:/data/output.txt".to_string(),
            content_utf8: "saved".to_string(),
        };

        assert_eq!(
            serde_json::to_value(&read).expect("serialize read params"),
            json!({ "path": "C:/data/input.txt", "encoding": "utf8" })
        );
        assert_eq!(
            serde_json::to_value(&write).expect("serialize write params"),
            json!({ "path": "C:/data/output.txt", "contentUtf8": "saved" })
        );
        assert_eq!(
            serde_json::from_value::<PluginFsWriteResult>(json!({ "writtenBytes": 5 }))
                .expect("parse write result"),
            PluginFsWriteResult { written_bytes: 5 }
        );
    }

    #[test]
    fn proxy_worker_timeout_returns_without_waiting_for_the_worker() {
        let started = std::time::Instant::now();
        let outcome = dispatch_proxy_job(
            |_| {
                thread::sleep(Duration::from_millis(100));
                ResponseOutcome::Result(Value::Null)
            },
            Duration::from_millis(5),
        );

        assert_eq!(outcome, Err(ProxyDispatchError::Timeout));
        assert!(started.elapsed() < Duration::from_millis(75));
    }

    #[test]
    fn timed_out_proxy_job_cancels_before_commit_and_releases_its_worker_slot() {
        let committed = Arc::new(AtomicBool::new(false));
        let worker_committed = Arc::clone(&committed);
        let baseline = ACTIVE_PROXY_WORKERS.load(Ordering::Acquire);

        let outcome = dispatch_proxy_job(
            move |cancellation| {
                thread::sleep(Duration::from_millis(40));
                if !cancellation.is_cancelled() {
                    worker_committed.store(true, Ordering::Release);
                }
                ResponseOutcome::Result(Value::Null)
            },
            Duration::from_millis(5),
        );

        assert_eq!(outcome, Err(ProxyDispatchError::Timeout));
        thread::sleep(Duration::from_millis(60));
        assert!(!committed.load(Ordering::Acquire));
        assert!(ACTIVE_PROXY_WORKERS.load(Ordering::Acquire) <= baseline);
    }

    #[test]
    fn dispatcher_waits_for_a_commit_that_won_the_timeout_race() {
        let committed = Arc::new(AtomicBool::new(false));
        let worker_committed = Arc::clone(&committed);
        let started = Instant::now();

        let outcome = dispatch_proxy_job(
            move |cancellation| {
                let _commit = cancellation.begin_commit().expect("begin commit");
                thread::sleep(Duration::from_millis(40));
                worker_committed.store(true, Ordering::Release);
                ResponseOutcome::Result(Value::String("committed".to_string()))
            },
            Duration::from_millis(5),
        );

        assert_eq!(
            outcome,
            Ok(ResponseOutcome::Result(Value::String(
                "committed".to_string()
            )))
        );
        assert!(committed.load(Ordering::Acquire));
        assert!(started.elapsed() >= Duration::from_millis(35));
    }

    #[cfg(windows)]
    fn create_directory_symlink(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_dir(target, link).is_ok()
    }

    #[cfg(unix)]
    fn create_directory_symlink(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[cfg(windows)]
    fn create_file_symlink(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }

    #[cfg(unix)]
    fn create_file_symlink(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    fn grant(permission: &str, target: &Path) -> PluginPermissionGrant {
        PluginPermissionGrant {
            permission: permission.to_string(),
            target: Some(target.to_string_lossy().into_owned()),
        }
    }

    fn path_text(path: &Path) -> Option<&str> {
        path.to_str()
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "my-label-tool-permissions-{name}-{}-{}",
            std::process::id(),
            TEST_ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }
}
