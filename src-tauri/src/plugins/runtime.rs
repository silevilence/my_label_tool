// This module intentionally keeps lifecycle implementation and its platform
// regression fixtures together so the process/session safety invariants can be
// audited in one place; splitting them would duplicate private test seams.
use crate::i18n::zh_cn as text;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Condvar, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;

use super::{
    manifest::{PluginCapabilities, PluginExtensionKind},
    permissions::{
        dispatch_file_proxy_request, FileProxyPolicy, ProxyDispatchError, MAX_PROXY_FILE_BYTES,
    },
    process_environment::{OFFLINE_ENVIRONMENT_OVERRIDES, PROXY_ENVIRONMENT_VARIABLES},
    protocol::{
        encode_message, host_hello_request, negotiate_hello_response, NdjsonDecoder,
        NegotiatedSession, PluginMessage, ResponseOutcome, PLUGIN_PROTOCOL_VERSION,
    },
    registry::{
        get_registered_plugin, record_plugin_runtime_failure, record_plugin_runtime_success,
        PluginRegistryEntry, PluginRegistryError, PluginState,
    },
};

#[cfg(unix)]
use super::process_environment::apply_offline_environment;

#[cfg(windows)]
use crate::process_control::PipedJobProcess;
#[cfg(unix)]
use crate::process_control::{configure_process_group, terminate_process_tree};
#[cfg(unix)]
use std::process::{Child, Command, Stdio};

const SETTINGS_FILE: &str = "plugin-settings.json";
const STDERR_LOG_LINES: usize = 500;
const STDERR_LINE_BYTES: usize = 64 * 1024;
const RUNTIME_MESSAGE_QUEUE_CAPACITY: usize = 8;
const MAX_PROXY_REQUESTS_PER_CALL: usize = 8;
const MAX_PROXY_BYTES_PER_CALL: u64 = MAX_PROXY_FILE_BYTES * MAX_PROXY_REQUESTS_PER_CALL as u64;
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static RUNTIME: OnceLock<Mutex<PluginRuntimeManager>> = OnceLock::new();
static MAINTENANCE: OnceLock<PluginMaintenanceCoordinator> = OnceLock::new();
static SETTINGS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginRuntimeSettings {
    #[serde(default)]
    pub safe_mode: bool,
}

pub fn load_plugin_runtime_settings(
    app_data_dir: &Path,
) -> Result<PluginRuntimeSettings, PluginRegistryError> {
    let _guard = settings_lock()
        .lock()
        .map_err(|_| settings_error(text::PLUGIN_SETTINGS_LOCK_POISONED.to_string()))?;
    load_plugin_runtime_settings_unlocked(app_data_dir)
}

fn load_plugin_runtime_settings_unlocked(
    app_data_dir: &Path,
) -> Result<PluginRuntimeSettings, PluginRegistryError> {
    let path = app_data_dir.join(SETTINGS_FILE);
    if !path.is_file() {
        return Ok(PluginRuntimeSettings::default());
    }
    let file = fs::File::open(path)
        .map_err(|error| settings_error(text::plugin_settings_read_failed(error)))?;
    serde_json::from_reader(file)
        .map_err(|error| settings_error(text::plugin_settings_read_failed(error)))
}

pub fn save_plugin_runtime_settings(
    app_data_dir: &Path,
    settings: PluginRuntimeSettings,
) -> Result<PluginRuntimeSettings, PluginRegistryError> {
    let _guard = settings_lock()
        .lock()
        .map_err(|_| settings_error(text::PLUGIN_SETTINGS_LOCK_POISONED.to_string()))?;
    fs::create_dir_all(app_data_dir)
        .map_err(|error| settings_error(text::plugin_settings_write_failed(error)))?;
    let path = app_data_dir.join(SETTINGS_FILE);
    let temporary = app_data_dir.join("plugin-settings.json.tmp");
    let mut file = fs::File::create(&temporary)
        .map_err(|error| settings_error(text::plugin_settings_write_failed(error)))?;
    serde_json::to_writer_pretty(&mut file, &settings)
        .map_err(|error| settings_error(text::plugin_settings_write_failed(error)))?;
    file.flush()
        .map_err(|error| settings_error(text::plugin_settings_write_failed(error)))?;
    let backup = app_data_dir.join("plugin-settings.json.bak");
    let had_existing = path.is_file();
    if had_existing {
        if backup.exists() {
            fs::remove_file(&backup)
                .map_err(|error| settings_error(text::plugin_settings_write_failed(error)))?;
        }
        fs::rename(&path, &backup)
            .map_err(|error| settings_error(text::plugin_settings_write_failed(error)))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if had_existing {
            let _ = fs::rename(&backup, &path);
        }
        return Err(settings_error(text::plugin_settings_write_failed(error)));
    }
    if had_existing {
        let _ = fs::remove_file(backup);
    }
    Ok(settings)
}

fn settings_lock() -> &'static Mutex<()> {
    SETTINGS_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginCallError {
    pub code: String,
    pub message: String,
    #[serde(skip)]
    counts_as_failure: bool,
}

/// Invokes a code-plugin capability. This is the only process-runtime entry
/// point; callers on application start/project open/save paths must never call
/// it because it may start a process and wait up to the manifest timeout.
pub fn invoke_plugin(
    app_data_dir: &Path,
    plugin_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, PluginCallError> {
    let control = runtime_manager()
        .lock()
        .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?
        .control_token(plugin_id);
    let entry = get_registered_plugin(app_data_dir, plugin_id).map_err(registry_call_error)?;
    ensure_invocable(app_data_dir, &entry)?;
    let timeout = Duration::from_millis(u64::from(entry.timeout_ms));
    let session = runtime_manager()
        .lock()
        .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?
        .get_or_spawn(app_data_dir, &entry, control)?;
    if !runtime_manager()
        .lock()
        .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?
        .control_matches(plugin_id, control)
    {
        return Err(call_error("CANCELLED", text::PLUGIN_RUNTIME_STATE_CHANGED));
    }
    let mut session_guard = session
        .session
        .lock()
        .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?;
    let result = session_guard.invoke(
        &entry.extension_kind,
        &entry.capabilities,
        method,
        params,
        timeout,
    );
    match result {
        Ok(value) => {
            if entry.failure_count > 0 {
                record_plugin_runtime_success(app_data_dir, plugin_id)
                    .map_err(registry_call_error)?;
            }
            Ok(value)
        }
        Err(error) => {
            if error.counts_as_failure {
                let persisted =
                    record_plugin_runtime_failure(app_data_dir, plugin_id, &error.message);
                drop(session_guard);
                remove_matching_session(plugin_id, &session);
                persisted.map_err(|persist_error| {
                    internal_call_error(text::plugin_failure_persist_failed(
                        &error.message,
                        persist_error.message,
                    ))
                })?;
            }
            Err(error)
        }
    }
}

pub fn plugin_runtime_logs(plugin_id: &str) -> Vec<String> {
    runtime_manager()
        .lock()
        .ok()
        .and_then(|manager| {
            manager
                .sessions
                .get(plugin_id)
                .map(|session| session.logs())
                .or_else(|| manager.diagnostics.get(plugin_id).cloned())
        })
        .unwrap_or_default()
}

pub fn stop_plugin_process(plugin_id: &str) {
    if let Ok(mut manager) = runtime_manager().lock() {
        manager.bump_plugin_control(plugin_id);
        if let Some(session) = manager.remove(plugin_id) {
            let _ = session.terminate();
        }
    }
}

pub struct PluginMaintenanceGuard {
    plugin_id: String,
}

#[derive(Default)]
struct PluginMaintenanceCoordinator {
    active_plugins: Mutex<HashMap<String, ()>>,
    changed: Condvar,
}

pub fn begin_plugin_maintenance(
    plugin_id: &str,
) -> Result<PluginMaintenanceGuard, PluginCallError> {
    let coordinator = maintenance_coordinator();
    let mut active_plugins = coordinator
        .active_plugins
        .lock()
        .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?;
    while active_plugins.contains_key(plugin_id) {
        active_plugins = coordinator
            .changed
            .wait(active_plugins)
            .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?;
    }
    active_plugins.insert(plugin_id.to_string(), ());
    drop(active_plugins);
    let guard = PluginMaintenanceGuard {
        plugin_id: plugin_id.to_string(),
    };
    let session = {
        let mut manager = runtime_manager()
            .lock()
            .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?;
        manager.bump_plugin_control(plugin_id);
        let leases = manager
            .blocked_plugins
            .entry(plugin_id.to_string())
            .or_insert(0);
        *leases = leases.saturating_add(1);
        manager.remove(plugin_id)
    };
    if let Some(session) = session {
        session.terminate()?;
    }
    Ok(guard)
}

impl Drop for PluginMaintenanceGuard {
    fn drop(&mut self) {
        if let Ok(mut manager) = runtime_manager().lock() {
            if let Some(leases) = manager.blocked_plugins.get_mut(&self.plugin_id) {
                *leases = leases.saturating_sub(1);
                if *leases == 0 {
                    manager.blocked_plugins.remove(&self.plugin_id);
                    manager.bump_plugin_control(&self.plugin_id);
                }
            }
        }
        let coordinator = maintenance_coordinator();
        let mut active_plugins = coordinator
            .active_plugins
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        active_plugins.remove(&self.plugin_id);
        coordinator.changed.notify_all();
    }
}

pub fn shutdown_all_plugin_processes() {
    if let Ok(mut manager) = runtime_manager().lock() {
        manager.bump_global_control();
        let sessions = manager.drain();
        drop(manager);
        for session in sessions {
            let _ = session.terminate();
        }
    }
}

fn remove_matching_session(plugin_id: &str, expected: &Arc<ManagedSession>) {
    if let Ok(mut manager) = runtime_manager().lock() {
        let should_remove = manager
            .sessions
            .get(plugin_id)
            .is_some_and(|current| Arc::ptr_eq(current, expected));
        if should_remove {
            if let Some(session) = manager.remove(plugin_id) {
                let _ = session.terminate();
            }
        }
    }
}

fn runtime_manager() -> &'static Mutex<PluginRuntimeManager> {
    RUNTIME.get_or_init(|| Mutex::new(PluginRuntimeManager::default()))
}

fn maintenance_coordinator() -> &'static PluginMaintenanceCoordinator {
    MAINTENANCE.get_or_init(PluginMaintenanceCoordinator::default)
}

fn ensure_invocable(
    app_data_dir: &Path,
    entry: &PluginRegistryEntry,
) -> Result<(), PluginCallError> {
    if entry.extension_kind == PluginExtensionKind::LabelPreset || entry.entry.is_none() {
        return Err(call_error(
            "INVALID_ARGUMENT",
            text::PLUGIN_RUNTIME_DATA_PLUGIN,
        ));
    }
    if load_plugin_runtime_settings(app_data_dir)
        .map_err(registry_call_error)?
        .safe_mode
    {
        return Err(call_error("SAFE_MODE", text::PLUGIN_RUNTIME_SAFE_MODE));
    }
    match entry.state {
        PluginState::Enabled => Ok(()),
        PluginState::Disabled => Err(call_error("PLUGIN_DISABLED", text::PLUGIN_RUNTIME_DISABLED)),
        PluginState::AutoDisabled => Err(call_error(
            "PLUGIN_AUTO_DISABLED",
            text::PLUGIN_RUNTIME_AUTO_DISABLED,
        )),
        PluginState::PendingMigration => Err(call_error(
            "CONFIG_MIGRATION_REQUIRED",
            text::PLUGIN_CONFIG_MIGRATION_REQUIRED,
        )),
    }
}

#[derive(Default)]
struct PluginRuntimeManager {
    sessions: HashMap<String, Arc<ManagedSession>>,
    diagnostics: HashMap<String, Vec<String>>,
    plugin_generations: HashMap<String, u64>,
    global_generation: u64,
    blocked_plugins: HashMap<String, u32>,
}

#[derive(Clone, Copy)]
struct ControlToken {
    global: u64,
    plugin: u64,
}

impl PluginRuntimeManager {
    fn get_or_spawn(
        &mut self,
        app_data_dir: &Path,
        entry: &PluginRegistryEntry,
        control: ControlToken,
    ) -> Result<Arc<ManagedSession>, PluginCallError> {
        if self.blocked_plugins.contains_key(&entry.id) {
            return Err(call_error(
                "PLUGIN_DISABLED",
                text::PLUGIN_RUNTIME_MAINTENANCE,
            ));
        }
        if self
            .sessions
            .get(&entry.id)
            .is_some_and(|session| session.has_exited())
        {
            if let Some(session) = self.remove(&entry.id) {
                session.terminate()?;
            }
        }
        if let Some(session) = self.sessions.get(&entry.id) {
            return Ok(Arc::clone(session));
        }
        if !self.control_matches(&entry.id, control) {
            return Err(call_error("CANCELLED", text::PLUGIN_RUNTIME_STATE_CHANGED));
        }
        let session = ManagedSession::spawn(app_data_dir, entry)?;
        if !self.control_matches(&entry.id, control) {
            session.terminate()?;
            return Err(call_error("CANCELLED", text::PLUGIN_RUNTIME_STATE_CHANGED));
        }
        self.sessions.insert(entry.id.clone(), Arc::clone(&session));
        Ok(session)
    }

    fn control_token(&self, plugin_id: &str) -> ControlToken {
        ControlToken {
            global: self.global_generation,
            plugin: self.plugin_generations.get(plugin_id).copied().unwrap_or(0),
        }
    }

    fn control_matches(&self, plugin_id: &str, expected: ControlToken) -> bool {
        let current = self.control_token(plugin_id);
        current.global == expected.global && current.plugin == expected.plugin
    }

    fn bump_plugin_control(&mut self, plugin_id: &str) {
        let generation = self
            .plugin_generations
            .entry(plugin_id.to_string())
            .or_insert(0);
        *generation = generation.saturating_add(1);
    }

    fn bump_global_control(&mut self) {
        self.global_generation = self.global_generation.saturating_add(1);
    }

    fn remove(&mut self, plugin_id: &str) -> Option<Arc<ManagedSession>> {
        if let Some(session) = self.sessions.remove(plugin_id) {
            let logs = session.logs();
            if !logs.is_empty() {
                self.diagnostics.insert(plugin_id.to_string(), logs);
            }
            Some(session)
        } else {
            None
        }
    }

    fn drain(&mut self) -> Vec<Arc<ManagedSession>> {
        let plugin_ids = self.sessions.keys().cloned().collect::<Vec<_>>();
        plugin_ids
            .into_iter()
            .filter_map(|plugin_id| self.remove(&plugin_id))
            .collect()
    }

    #[cfg(test)]
    fn invoke(
        &mut self,
        app_data_dir: &Path,
        entry: &PluginRegistryEntry,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, PluginCallError> {
        let control = self.control_token(&entry.id);
        let session = self.get_or_spawn(app_data_dir, entry, control)?;
        let result = session
            .session
            .lock()
            .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?
            .invoke(
                &entry.extension_kind,
                &entry.capabilities,
                method,
                params,
                timeout,
            );
        if result.as_ref().is_err_and(|error| error.counts_as_failure) {
            if let Some(removed) = self.remove(&entry.id) {
                let _ = removed.terminate();
            }
        }
        result
    }
}

struct ManagedSession {
    session: Mutex<PluginSession>,
    process: Arc<Mutex<RuntimeProcess>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

impl ManagedSession {
    fn spawn(
        app_data_dir: &Path,
        entry: &PluginRegistryEntry,
    ) -> Result<Arc<Self>, PluginCallError> {
        let (session, process, stderr) = PluginSession::spawn(app_data_dir, entry)?;
        Ok(Arc::new(Self {
            session: Mutex::new(session),
            process,
            stderr,
        }))
    }

    fn terminate(&self) -> Result<(), PluginCallError> {
        self.process
            .lock()
            .map_err(|_| internal_call_error(text::PLUGIN_RUNTIME_LOCK_POISONED))?
            .terminate_tree()
            .map_err(|message| runtime_call_error("INTERNAL_ERROR", &message))
    }

    fn has_exited(&self) -> bool {
        self.process
            .lock()
            .is_ok_and(|mut process| process.try_wait().is_ok_and(|status| status.is_some()))
    }

    fn logs(&self) -> Vec<String> {
        self.stderr
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .unwrap_or_default()
    }
}

struct PluginSession {
    process: Arc<Mutex<RuntimeProcess>>,
    stdin: Box<dyn Write + Send>,
    messages: Receiver<Result<PluginMessage, PluginCallError>>,
    negotiated: Option<NegotiatedSession>,
    permissions: FileProxyPolicy,
}

#[derive(Debug, Default)]
struct ProxyCallBudget {
    requests: usize,
    bytes: u64,
}

impl ProxyCallBudget {
    fn reserve(&mut self, method: &str, params: &Value) -> bool {
        let bytes = match method {
            "fs.read" => MAX_PROXY_FILE_BYTES,
            "fs.write" => params
                .get("contentUtf8")
                .and_then(Value::as_str)
                .map_or(0, |content| content.len() as u64),
            _ => 0,
        };
        let Some(next_bytes) = self.bytes.checked_add(bytes) else {
            return false;
        };
        if self.requests >= MAX_PROXY_REQUESTS_PER_CALL || next_bytes > MAX_PROXY_BYTES_PER_CALL {
            return false;
        }
        self.requests += 1;
        self.bytes = next_bytes;
        true
    }
}

impl PluginSession {
    fn spawn(
        app_data_dir: &Path,
        entry: &PluginRegistryEntry,
    ) -> Result<SessionParts, PluginCallError> {
        let permissions = FileProxyPolicy::from_grants(&entry.grants)
            .map_err(|error| call_error("PERMISSION_DENIED", &error.message))?;
        let package_root = app_data_dir.join("plugins").join(&entry.id);
        let declared = entry
            .entry
            .as_ref()
            .ok_or_else(|| call_error("INVALID_ARGUMENT", text::PLUGIN_RUNTIME_ENTRY_MISSING))?;
        #[cfg(test)]
        let is_test_system_command = declared.command == "powershell.exe";
        #[cfg(not(test))]
        let is_test_system_command = false;
        let executable = if matches!(declared.command.as_str(), "python" | "python3" | "py") {
            PathBuf::from(&declared.command)
        } else if is_test_system_command {
            PathBuf::from("powershell")
        } else {
            package_root.join(&declared.command)
        };
        let plugin_dir = package_root.to_string_lossy().into_owned();
        let (process, stdin, stdout, stderr) =
            RuntimeProcess::spawn(&executable, &declared.args, &package_root, &plugin_dir)
                .map_err(|message| runtime_call_error("RUNTIME_UNAVAILABLE", &message))?;
        let process = Arc::new(Mutex::new(process));
        let (sender, receiver) = mpsc::sync_channel(RUNTIME_MESSAGE_QUEUE_CAPACITY);
        thread::spawn(move || read_stdout(stdout, sender));
        let stderr_lines = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_LOG_LINES)));
        let reader_lines = Arc::clone(&stderr_lines);
        thread::spawn(move || read_stderr(stderr, reader_lines));
        Ok((
            Self {
                process: Arc::clone(&process),
                stdin,
                messages: receiver,
                negotiated: None,
                permissions,
            },
            process,
            stderr_lines,
        ))
    }

    fn handshake_before(
        &mut self,
        deadline: Instant,
        proxy_budget: &mut ProxyCallBudget,
    ) -> Result<(), PluginCallError> {
        let id = next_request_id("hello");
        self.send(&host_hello_request(id.clone()))?;
        let response = self.receive_response(&id, deadline, proxy_budget)?;
        let negotiated = negotiate_hello_response(&response, &id).map_err(protocol_call_error)?;
        self.negotiated = Some(negotiated);
        Ok(())
    }

    fn invoke(
        &mut self,
        extension_kind: &PluginExtensionKind,
        declared_capabilities: &PluginCapabilities,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, PluginCallError> {
        let deadline = Instant::now() + timeout;
        let watchdog = CallWatchdog::start(Arc::clone(&self.process), timeout);
        let mut proxy_budget = ProxyCallBudget::default();
        let result = self.invoke_before(
            extension_kind,
            declared_capabilities,
            method,
            params,
            deadline,
            &mut proxy_budget,
        );
        if watchdog.finish() {
            Err(runtime_call_error("TIMEOUT", text::PLUGIN_RUNTIME_TIMEOUT))
        } else {
            result
        }
    }

    fn invoke_before(
        &mut self,
        extension_kind: &PluginExtensionKind,
        declared_capabilities: &PluginCapabilities,
        method: &str,
        params: Value,
        deadline: Instant,
        proxy_budget: &mut ProxyCallBudget,
    ) -> Result<Value, PluginCallError> {
        if self.negotiated.is_none() {
            self.handshake_before(deadline, proxy_budget)?;
        }
        self.ensure_capability(extension_kind, declared_capabilities, method)?;
        self.call(method, params, deadline, proxy_budget)
    }

    fn ensure_capability(
        &self,
        extension_kind: &PluginExtensionKind,
        declared_capabilities: &PluginCapabilities,
        method: &str,
    ) -> Result<(), PluginCallError> {
        let capabilities = &self
            .negotiated
            .as_ref()
            .ok_or_else(|| runtime_call_error("PROTOCOL_ERROR", text::PLUGIN_RUNTIME_NOT_READY))?
            .capabilities;
        let supported = match method {
            "exporter.export" => {
                *extension_kind == PluginExtensionKind::Exporter && capabilities.exporter
            }
            "prelabel.run" => {
                *extension_kind == PluginExtensionKind::Prelabel && capabilities.prelabel
            }
            "config.migrate" => {
                declared_capabilities.config_migration && capabilities.config_migration
            }
            _ => false,
        };
        if supported {
            Ok(())
        } else {
            Err(call_error(
                "METHOD_NOT_FOUND",
                text::PLUGIN_RUNTIME_CAPABILITY_UNAVAILABLE,
            ))
        }
    }

    fn call(
        &mut self,
        method: &str,
        params: Value,
        deadline: Instant,
        proxy_budget: &mut ProxyCallBudget,
    ) -> Result<Value, PluginCallError> {
        let id = next_request_id("call");
        self.send(&PluginMessage::Request {
            v: PLUGIN_PROTOCOL_VERSION,
            id: Some(id.clone()),
            method: method.to_string(),
            params,
        })?;
        match self.receive_response(&id, deadline, proxy_budget)? {
            PluginMessage::Response {
                outcome: ResponseOutcome::Result(value),
                ..
            } => Ok(value),
            PluginMessage::Response {
                outcome: ResponseOutcome::Error(error),
                ..
            } => Err(call_error(error.code.as_str(), &error.message)),
            _ => Err(runtime_call_error(
                "PROTOCOL_ERROR",
                text::PLUGIN_RUNTIME_RESPONSE_INVALID,
            )),
        }
    }

    fn send(&mut self, message: &PluginMessage) -> Result<(), PluginCallError> {
        let encoded = encode_message(message).map_err(protocol_call_error)?;
        self.stdin
            .write_all(encoded.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| {
                runtime_call_error("INTERNAL_ERROR", &text::plugin_runtime_write_failed(error))
            })
    }

    fn receive_response(
        &mut self,
        expected_id: &str,
        deadline: Instant,
        proxy_budget: &mut ProxyCallBudget,
    ) -> Result<PluginMessage, PluginCallError> {
        loop {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                self.terminate();
                return Err(runtime_call_error("TIMEOUT", text::PLUGIN_RUNTIME_TIMEOUT));
            };
            match self
                .messages
                .recv_timeout(remaining.min(Duration::from_millis(25)))
            {
                Ok(Ok(message)) => match message {
                    PluginMessage::Response { ref id, .. }
                        if id.as_deref() == Some(expected_id) =>
                    {
                        return Ok(message);
                    }
                    PluginMessage::Event { .. } => {}
                    PluginMessage::Request {
                        id: Some(id),
                        method,
                        params,
                        ..
                    } => {
                        let outcome = if proxy_budget.reserve(&method, &params) {
                            let Some(proxy_timeout) =
                                deadline.checked_duration_since(Instant::now())
                            else {
                                self.terminate();
                                return Err(runtime_call_error(
                                    "TIMEOUT",
                                    text::PLUGIN_RUNTIME_TIMEOUT,
                                ));
                            };
                            match dispatch_file_proxy_request(
                                self.permissions.clone(),
                                method,
                                params,
                                proxy_timeout,
                            ) {
                                Ok(outcome) => outcome,
                                Err(ProxyDispatchError::Timeout) => {
                                    self.terminate();
                                    return Err(runtime_call_error(
                                        "TIMEOUT",
                                        text::PLUGIN_RUNTIME_TIMEOUT,
                                    ));
                                }
                                Err(ProxyDispatchError::Unavailable) => {
                                    self.terminate();
                                    return Err(runtime_call_error(
                                        "INTERNAL_ERROR",
                                        text::PLUGIN_PROXY_WORKER_UNAVAILABLE,
                                    ));
                                }
                            }
                        } else {
                            ResponseOutcome::Error(super::protocol::ProtocolError::new(
                                super::protocol::ProtocolErrorCode::InvalidArgument,
                                text::PLUGIN_PROXY_BUDGET_EXCEEDED,
                            ))
                        };
                        self.send(&PluginMessage::Response {
                            v: PLUGIN_PROTOCOL_VERSION,
                            id: Some(id),
                            outcome,
                        })?;
                    }
                    _ => {
                        return Err(runtime_call_error(
                            "PROTOCOL_ERROR",
                            text::PLUGIN_RUNTIME_RESPONSE_INVALID,
                        ));
                    }
                },
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => {
                    if self.has_exited() {
                        return Err(runtime_call_error(
                            "INTERNAL_ERROR",
                            text::PLUGIN_RUNTIME_EXITED,
                        ));
                    }
                    if Instant::now() >= deadline {
                        self.terminate();
                        return Err(runtime_call_error("TIMEOUT", text::PLUGIN_RUNTIME_TIMEOUT));
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(runtime_call_error(
                        "INTERNAL_ERROR",
                        text::PLUGIN_RUNTIME_EXITED,
                    ));
                }
            }
        }
    }

    fn has_exited(&mut self) -> bool {
        self.process
            .lock()
            .is_ok_and(|mut process| process.try_wait().is_ok_and(|status| status.is_some()))
    }

    fn terminate(&self) {
        if let Ok(mut process) = self.process.lock() {
            let _ = process.terminate_tree();
        }
    }
}

struct CallWatchdog {
    state: Arc<(Mutex<bool>, Condvar)>,
    timed_out: Arc<std::sync::atomic::AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl CallWatchdog {
    fn start(process: Arc<Mutex<RuntimeProcess>>, timeout: Duration) -> Self {
        let state = Arc::new((Mutex::new(false), Condvar::new()));
        let timed_out = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let worker_state = Arc::clone(&state);
        let worker_timed_out = Arc::clone(&timed_out);
        let worker = thread::spawn(move || {
            let (done_lock, wake) = &*worker_state;
            let Ok(done) = done_lock.lock() else {
                return;
            };
            let Ok((done, wait)) = wake.wait_timeout_while(done, timeout, |done| !*done) else {
                return;
            };
            if wait.timed_out() && !*done {
                worker_timed_out.store(true, Ordering::Release);
                drop(done);
                if let Ok(mut process) = process.lock() {
                    let _ = process.terminate_tree();
                }
            }
        });
        Self {
            state,
            timed_out,
            worker: Some(worker),
        }
    }

    fn finish(mut self) -> bool {
        let (done_lock, wake) = &*self.state;
        if let Ok(mut done) = done_lock.lock() {
            *done = true;
            wake.notify_one();
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        self.timed_out.load(Ordering::Acquire)
    }
}

type SessionParts = (
    PluginSession,
    Arc<Mutex<RuntimeProcess>>,
    Arc<Mutex<VecDeque<String>>>,
);

fn read_stdout(
    mut stdout: Box<dyn Read + Send>,
    sender: mpsc::SyncSender<Result<PluginMessage, PluginCallError>>,
) {
    let mut decoder = NdjsonDecoder::default();
    let mut buffer = [0_u8; 8192];
    loop {
        match stdout.read(&mut buffer) {
            Ok(0) => {
                for message in decoder.finish() {
                    let _ = sender.send(message.map_err(protocol_call_error));
                }
                return;
            }
            Ok(read) => {
                for message in decoder.push(&buffer[..read]) {
                    if sender.send(message.map_err(protocol_call_error)).is_err() {
                        return;
                    }
                }
            }
            Err(error) => {
                let _ = sender.send(Err(internal_call_error(text::plugin_runtime_read_failed(
                    error,
                ))));
                return;
            }
        }
    }
}

fn read_stderr(mut stderr: Box<dyn Read + Send>, lines: Arc<Mutex<VecDeque<String>>>) {
    let mut chunk = [0_u8; 8192];
    let mut line = Vec::with_capacity(1024);
    let mut truncated = false;
    loop {
        match stderr.read(&mut chunk) {
            Ok(0) => {
                if !line.is_empty() || truncated {
                    push_stderr_line(&lines, &line, truncated);
                }
                return;
            }
            Ok(read) => {
                for byte in &chunk[..read] {
                    if *byte == b'\n' {
                        push_stderr_line(&lines, &line, truncated);
                        line.clear();
                        truncated = false;
                    } else if line.len() < STDERR_LINE_BYTES {
                        line.push(*byte);
                    } else {
                        truncated = true;
                    }
                }
            }
            Err(_) => return,
        }
    }
}

fn push_stderr_line(lines: &Arc<Mutex<VecDeque<String>>>, bytes: &[u8], truncated: bool) {
    let mut value = String::from_utf8_lossy(bytes)
        .trim_end_matches('\r')
        .to_string();
    if truncated {
        value.push_str(text::PLUGIN_RUNTIME_STDERR_TRUNCATED);
    }
    if let Ok(mut log) = lines.lock() {
        if log.len() == STDERR_LOG_LINES {
            log.pop_front();
        }
        log.push_back(value);
    }
}

fn next_request_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}",
        std::process::id(),
        REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(windows)]
struct RuntimeProcess {
    inner: PipedJobProcess,
}

#[cfg(windows)]
impl RuntimeProcess {
    fn spawn(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
        plugin_dir: &str,
    ) -> Result<RuntimeIo, String> {
        let mut inner = PipedJobProcess::spawn(
            executable,
            arguments,
            working_directory,
            &[
                ("MY_LABEL_TOOL_PLUGIN_DIR", plugin_dir),
                OFFLINE_ENVIRONMENT_OVERRIDES[0],
                OFFLINE_ENVIRONMENT_OVERRIDES[1],
                OFFLINE_ENVIRONMENT_OVERRIDES[2],
                OFFLINE_ENVIRONMENT_OVERRIDES[3],
            ],
            &PROXY_ENVIRONMENT_VARIABLES,
        )?;
        let stdin = inner
            .take_stdin()
            .ok_or(text::PLUGIN_RUNTIME_STDIO_MISSING)?;
        let stdout = inner
            .take_stdout()
            .ok_or(text::PLUGIN_RUNTIME_STDIO_MISSING)?;
        let stderr = inner
            .take_stderr()
            .ok_or(text::PLUGIN_RUNTIME_STDIO_MISSING)?;
        Ok((
            Self { inner },
            Box::new(stdin),
            Box::new(stdout),
            Box::new(stderr),
        ))
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        self.inner.try_wait()
    }

    fn terminate_tree(&mut self) -> Result<(), String> {
        self.inner.terminate_tree()
    }
}

#[cfg(unix)]
struct RuntimeProcess {
    child: Child,
    reaped: bool,
    tree_terminated: bool,
}

#[cfg(unix)]
impl RuntimeProcess {
    fn spawn(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
        plugin_dir: &str,
    ) -> Result<RuntimeIo, String> {
        let display = executable.to_string_lossy();
        let mut command = Command::new(executable);
        command
            .args(arguments)
            .current_dir(working_directory)
            .env("MY_LABEL_TOOL_PLUGIN_DIR", plugin_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_offline_environment(&mut command);
        configure_process_group(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| text::plugin_runtime_start_failed(&display, error))?;
        let stdin = child
            .stdin
            .take()
            .ok_or(text::PLUGIN_RUNTIME_STDIO_MISSING)?;
        let stdout = child
            .stdout
            .take()
            .ok_or(text::PLUGIN_RUNTIME_STDIO_MISSING)?;
        let stderr = child
            .stderr
            .take()
            .ok_or(text::PLUGIN_RUNTIME_STDIO_MISSING)?;
        Ok((
            Self {
                child,
                reaped: false,
                tree_terminated: false,
            },
            Box::new(stdin),
            Box::new(stdout),
            Box::new(stderr),
        ))
    }

    fn try_wait(&mut self) -> Result<Option<i32>, String> {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                self.reaped = true;
                Ok(Some(status.code().unwrap_or(-1)))
            }
            Ok(None) => Ok(None),
            Err(error) => Err(text::plugin_runtime_wait_failed(error)),
        }
    }

    fn terminate_tree(&mut self) -> Result<(), String> {
        if self.tree_terminated {
            return Ok(());
        }
        let result = terminate_process_tree(self.child.id());
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.reaped = true;
        self.tree_terminated = true;
        result
    }
}

#[cfg(unix)]
impl Drop for RuntimeProcess {
    fn drop(&mut self) {
        let _ = self.terminate_tree();
    }
}

type RuntimeIo = (
    RuntimeProcess,
    Box<dyn Write + Send>,
    Box<dyn Read + Send>,
    Box<dyn Read + Send>,
);

fn registry_call_error(error: PluginRegistryError) -> PluginCallError {
    call_error(&error.code, &error.message)
}

fn protocol_call_error(error: super::protocol::ProtocolError) -> PluginCallError {
    runtime_call_error(error.code.as_str(), &error.message)
}

fn internal_call_error(message: impl Into<String>) -> PluginCallError {
    let message = message.into();
    runtime_call_error("INTERNAL_ERROR", &message)
}

fn call_error(code: &str, message: &str) -> PluginCallError {
    PluginCallError {
        code: code.to_string(),
        message: message.to_string(),
        counts_as_failure: false,
    }
}

fn runtime_call_error(code: &str, message: &str) -> PluginCallError {
    PluginCallError {
        code: code.to_string(),
        message: message.to_string(),
        counts_as_failure: true,
    }
}

fn settings_error(message: String) -> PluginRegistryError {
    PluginRegistryError {
        code: "INTERNAL_ERROR".to_string(),
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::{
        manifest::{
            PluginApiVersionTarget, PluginCapabilities, PluginCapabilityVersion, PluginEntry,
        },
        registry::{clear_registered_plugin_failures, get_registered_plugin},
    };
    use std::sync::atomic::AtomicUsize;
    use std::sync::{MutexGuard, OnceLock};
    use std::time::SystemTime;

    #[test]
    fn safe_mode_defaults_off_and_round_trips() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("round-trip");
        assert_eq!(
            load_plugin_runtime_settings(&root).expect("default settings"),
            PluginRuntimeSettings { safe_mode: false }
        );
        save_plugin_runtime_settings(&root, PluginRuntimeSettings { safe_mode: true })
            .expect("save settings");
        assert!(
            load_plugin_runtime_settings(&root)
                .expect("saved settings")
                .safe_mode
        );
        save_plugin_runtime_settings(&root, PluginRuntimeSettings { safe_mode: false })
            .expect("replace settings");
        assert!(
            !load_plugin_runtime_settings(&root)
                .expect("replaced settings")
                .safe_mode
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn reverse_file_proxy_budget_is_bounded_per_host_call() {
        let mut budget = ProxyCallBudget::default();
        for _ in 0..MAX_PROXY_REQUESTS_PER_CALL {
            assert!(budget.reserve("fs.read", &Value::Null));
        }
        assert_eq!(budget.requests, MAX_PROXY_REQUESTS_PER_CALL);
        assert_eq!(budget.bytes, MAX_PROXY_BYTES_PER_CALL);
        assert!(!budget.reserve("fs.read", &Value::Null));

        let mut next_call = ProxyCallBudget::default();
        assert!(next_call.reserve("fs.write", &serde_json::json!({ "contentUtf8": "saved" })));
    }

    #[cfg(windows)]
    #[test]
    fn process_session_handshakes_reuses_and_exposes_plugin_directory() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("reuse");
        let entry = test_entry(
            "dev.test.reuse",
            powershell_plugin(
                "$script:count++; $result = @{ count = $script:count; pluginDir = $env:MY_LABEL_TOOL_PLUGIN_DIR; value = $msg.params.value }",
            ),
            2_000,
        );
        create_package(&root, &entry.id);
        let mut manager = PluginRuntimeManager::default();

        let first = manager
            .invoke(
                &root,
                &entry,
                "exporter.export",
                serde_json::json!({"value": 7}),
                Duration::from_secs(2),
            )
            .expect("first call");
        let second = manager
            .invoke(
                &root,
                &entry,
                "exporter.export",
                serde_json::json!({"value": 8}),
                Duration::from_secs(2),
            )
            .expect("second call");

        assert_eq!(first["count"], 1);
        assert_eq!(second["count"], 2);
        assert_eq!(first["value"], 7);
        assert_eq!(
            PathBuf::from(first["pluginDir"].as_str().expect("plugin directory")),
            root.join("plugins").join(&entry.id)
        );
        manager.remove(&entry.id);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn timeout_crash_and_garbage_remove_the_session() {
        let _runtime_test_guard = runtime_test_guard();
        for (name, body, expected, timeout) in [
            (
                "timeout",
                "Start-Sleep -Seconds 30",
                "TIMEOUT",
                Duration::from_millis(100),
            ),
            (
                "crash",
                "Stop-Process -Id $PID -Force",
                "INTERNAL_ERROR",
                Duration::from_secs(2),
            ),
        ] {
            let root = test_directory(name);
            let entry = test_entry(&format!("dev.test.{name}"), powershell_plugin(body), 100);
            create_package(&root, &entry.id);
            let mut manager = PluginRuntimeManager::default();
            let error = manager
                .invoke(&root, &entry, "exporter.export", Value::Null, timeout)
                .expect_err("broken plugin must fail");
            assert_eq!(error.code, expected);
            assert!(!manager.sessions.contains_key(&entry.id));
            fs::remove_dir_all(root).expect("remove fixture");
        }

        let root = test_directory("garbage");
        let entry = test_entry(
            "dev.test.garbage",
            "while (($line = [Console]::In.ReadLine()) -ne $null) { [Console]::Out.WriteLine('not-json') }".to_string(),
            1_000,
        );
        create_package(&root, &entry.id);
        let mut manager = PluginRuntimeManager::default();
        let error = manager
            .invoke(
                &root,
                &entry,
                "exporter.export",
                Value::Null,
                Duration::from_secs(1),
            )
            .expect_err("garbage output must fail");
        assert_eq!(error.code, "PARSE_ERROR");
        assert!(!manager.sessions.contains_key(&entry.id));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn timeout_terminates_the_parent_and_descendant_processes() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("timeout-tree");
        let process_ids = root.join("process-ids.txt");
        let escaped_path = process_ids.to_string_lossy().replace('\'', "''");
        let body = format!(
            "$child = Start-Process -PassThru -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30'; [System.IO.File]::WriteAllText('{escaped_path}', \"$PID`n$($child.Id)\"); Start-Sleep -Seconds 30"
        );
        let entry = test_entry("dev.test.timeouttree", powershell_plugin(&body), 1_000);
        create_package(&root, &entry.id);
        let mut manager = PluginRuntimeManager::default();
        let error = manager
            .invoke(
                &root,
                &entry,
                "exporter.export",
                Value::Null,
                Duration::from_secs(1),
            )
            .expect_err("timeout must fail");
        assert_eq!(error.code, "TIMEOUT");
        let ids = fs::read_to_string(&process_ids)
            .expect("plugin and child process IDs")
            .lines()
            .map(|value| value.parse::<u32>().expect("numeric process ID"))
            .collect::<Vec<_>>();
        assert_eq!(ids.len(), 2);
        let deadline = Instant::now() + Duration::from_secs(5);
        while ids.iter().any(|id| process_exists(*id)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            ids.iter().all(|id| !process_exists(*id)),
            "timeout left a plugin process alive: {ids:?}"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn timeout_covers_a_blocked_stdin_write_after_hello() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("blocked-stdin");
        let marker = root.join("hello-complete.txt");
        let escaped = marker.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$line = [Console]::In.ReadLine(); $msg = $line | ConvertFrom-Json; $response = @{{ v = 1; id = $msg.id; type = 'response'; result = @{{ protocolVersion = 1; capabilities = @{{ exporter = $true }} }} }}; [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush(); [System.IO.File]::WriteAllText('{escaped}', 'ready'); Start-Sleep -Seconds 30"
        );
        let entry = test_entry("dev.test.blockedstdin", script, 1_500);
        create_package(&root, &entry.id);
        let mut manager = PluginRuntimeManager::default();
        let started = Instant::now();
        let error = manager
            .invoke(
                &root,
                &entry,
                "exporter.export",
                serde_json::json!({ "payload": "x".repeat(4 * 1024 * 1024) }),
                Duration::from_millis(1_500),
            )
            .expect_err("blocked stdin write must time out");
        assert_eq!(error.code, "TIMEOUT");
        assert!(marker.is_file(), "hello must complete before stdin blocks");
        assert!(started.elapsed() < Duration::from_secs(4));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn exited_process_restarts_on_the_next_call() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("restart");
        let entry = test_entry(
            "dev.test.restart",
            powershell_plugin("$result = @{ count = 1 }; $exitAfterResponse = $true"),
            2_000,
        );
        create_package(&root, &entry.id);
        let mut manager = PluginRuntimeManager::default();
        manager
            .invoke(
                &root,
                &entry,
                "exporter.export",
                Value::Null,
                Duration::from_secs(2),
            )
            .expect("first call");
        thread::sleep(Duration::from_millis(200));
        manager
            .invoke(
                &root,
                &entry,
                "exporter.export",
                Value::Null,
                Duration::from_secs(2),
            )
            .expect("restarted call");
        manager.remove(&entry.id);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn failures_auto_disable_and_a_later_success_clears_the_counter() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("failures");
        let failing = test_entry(
            "dev.test.failures",
            powershell_plugin("Start-Sleep -Seconds 30"),
            75,
        );
        let recovering = PluginRegistryEntry {
            failure_count: 2,
            last_error: Some("旧失败".to_string()),
            ..test_entry(
                "dev.test.recovery",
                powershell_plugin("$result = @{ ok = $true }"),
                2_000,
            )
        };
        create_package(&root, &failing.id);
        create_package(&root, &recovering.id);
        write_registry(&root, &[failing.clone(), recovering.clone()]);

        for _ in 0..3 {
            let error = invoke_plugin(&root, &failing.id, "exporter.export", Value::Null)
                .expect_err("timed out call");
            assert_eq!(error.code, "TIMEOUT");
        }
        let disabled = get_registered_plugin(&root, &failing.id).expect("disabled entry");
        assert_eq!(disabled.failure_count, 3);
        assert_eq!(disabled.state, PluginState::AutoDisabled);
        clear_registered_plugin_failures(&root, &failing.id).expect("manual recovery");
        assert_eq!(
            get_registered_plugin(&root, &failing.id)
                .expect("re-enabled entry")
                .state,
            PluginState::Enabled
        );

        invoke_plugin(&root, &recovering.id, "exporter.export", Value::Null)
            .expect("successful call");
        let recovered = get_registered_plugin(&root, &recovering.id).expect("recovered entry");
        assert_eq!(recovered.failure_count, 0);
        assert_eq!(recovered.last_error, None);
        stop_plugin_process(&failing.id);
        stop_plugin_process(&recovering.id);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn negotiated_capabilities_gate_calls_and_business_errors_do_not_break_the_session() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("capability-gate");
        let unavailable = test_entry(
            "dev.test.capabilitygate",
            powershell_plugin_with_exporter("$result = @{ ok = $true }", false),
            2_000,
        );
        create_package(&root, &unavailable.id);
        let mut manager = PluginRuntimeManager::default();
        let error = manager
            .invoke(
                &root,
                &unavailable,
                "exporter.export",
                Value::Null,
                Duration::from_secs(2),
            )
            .expect_err("undeclared capability must be rejected");
        assert_eq!(error.code, "METHOD_NOT_FOUND");
        assert!(!error.counts_as_failure);
        assert!(manager.sessions.contains_key(&unavailable.id));
        manager.remove(&unavailable.id);

        let business_error = test_entry(
            "dev.test.businesserror",
            powershell_error_plugin("INVALID_ARGUMENT"),
            2_000,
        );
        create_package(&root, &business_error.id);
        for _ in 0..3 {
            let error = manager
                .invoke(
                    &root,
                    &business_error,
                    "exporter.export",
                    Value::Null,
                    Duration::from_secs(2),
                )
                .expect_err("plugin business error");
            assert_eq!(error.code, "INVALID_ARGUMENT");
            assert!(!error.counts_as_failure);
        }
        assert!(manager.sessions.contains_key(&business_error.id));
        manager.remove(&business_error.id);

        let undeclared_migration = test_entry(
            "dev.test.migrationgate",
            powershell_plugin_with_capabilities("$result = @{ ok = $true }", true, true),
            2_000,
        );
        create_package(&root, &undeclared_migration.id);
        let error = manager
            .invoke(
                &root,
                &undeclared_migration,
                "config.migrate",
                Value::Null,
                Duration::from_secs(2),
            )
            .expect_err("manifest must also declare migration capability");
        assert_eq!(error.code, "METHOD_NOT_FOUND");
        manager.remove(&undeclared_migration.id);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn file_proxy_returns_only_authorized_content_and_denies_outside_paths() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("file-proxy");
        let allowed = root.join("project").join("images");
        let outside = root.join("outside");
        fs::create_dir_all(&allowed).expect("create allowed directory");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::write(outside.join("secret.txt"), "never-disclose-this").expect("write secret file");
        let mut entry = test_entry("dev.test.fileproxy", powershell_file_proxy_plugin(), 2_000);
        entry.grants = vec![crate::plugins::permissions::PluginPermissionGrant {
            permission: "fs.read".to_string(),
            target: Some(allowed.to_string_lossy().into_owned()),
        }];
        create_package(&root, &entry.id);
        write_registry(&root, std::slice::from_ref(&entry));

        let denied = invoke_plugin(
            &root,
            &entry.id,
            "exporter.export",
            serde_json::json!({ "path": outside.join("secret.txt") }),
        )
        .expect("denied proxy response is returned to the plugin");
        assert_eq!(
            denied.pointer("/error/code"),
            Some(&Value::String("PERMISSION_DENIED".to_string())),
            "proxy response: {denied}"
        );
        assert!(!denied.to_string().contains("never-disclose-this"));
        stop_plugin_process(&entry.id);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn out_of_band_termination_interrupts_a_long_call_without_waiting_for_timeout() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("out-of-band-stop");
        let marker = root.join("started.txt");
        let escaped = marker.to_string_lossy().replace('\'', "''");
        let entry = test_entry(
            "dev.test.outofband",
            powershell_plugin(&format!(
                "[System.IO.File]::WriteAllText('{escaped}', 'started'); Start-Sleep -Seconds 30"
            )),
            30_000,
        );
        create_package(&root, &entry.id);
        let session = ManagedSession::spawn(&root, &entry).expect("spawn session");
        let calling = Arc::clone(&session);
        let declared_capabilities = entry.capabilities.clone();
        let task = thread::spawn(move || {
            calling.session.lock().expect("call session").invoke(
                &PluginExtensionKind::Exporter,
                &declared_capabilities,
                "exporter.export",
                Value::Null,
                Duration::from_secs(30),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while !marker.is_file() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
        }
        assert!(marker.is_file(), "plugin call did not start");
        let started = Instant::now();
        session.terminate().expect("terminate session");
        assert!(started.elapsed() < Duration::from_secs(1));
        let error = task
            .join()
            .expect("join call")
            .expect_err("terminated call must fail");
        assert!(error.counts_as_failure);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn concurrent_settings_updates_remain_valid_and_fail_closed_during_replacement() {
        let _runtime_test_guard = runtime_test_guard();
        let root = Arc::new(test_directory("concurrent-settings"));
        let tasks = (0..8)
            .map(|index| {
                let root = Arc::clone(&root);
                thread::spawn(move || {
                    save_plugin_runtime_settings(
                        &root,
                        PluginRuntimeSettings {
                            safe_mode: index % 2 == 0,
                        },
                    )
                })
            })
            .collect::<Vec<_>>();
        for task in tasks {
            task.join()
                .expect("join settings writer")
                .expect("save settings");
        }
        load_plugin_runtime_settings(&root).expect("valid final settings");
        fs::remove_dir_all(root.as_ref()).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn control_generation_prevents_a_waiting_call_from_spawning_after_state_change() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("state-generation");
        let entry = test_entry(
            "dev.test.stategeneration",
            powershell_plugin("$result = @{ ok = $true }"),
            2_000,
        );
        create_package(&root, &entry.id);
        let mut manager = PluginRuntimeManager::default();
        let stale_control = manager.control_token(&entry.id);
        manager.bump_plugin_control(&entry.id);
        let error = match manager.get_or_spawn(&root, &entry, stale_control) {
            Ok(_) => panic!("stale call must not spawn"),
            Err(error) => error,
        };
        assert_eq!(error.code, "CANCELLED");
        assert!(manager.sessions.is_empty());

        let mut manager = PluginRuntimeManager::default();
        let stale_control = manager.control_token(&entry.id);
        manager.bump_global_control();
        let error = match manager.get_or_spawn(&root, &entry, stale_control) {
            Ok(_) => panic!("global state change must prevent a stale spawn"),
            Err(error) => error,
        };
        assert_eq!(error.code, "CANCELLED");
        assert!(manager.sessions.is_empty());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn maintenance_gate_serializes_termination_and_the_whole_package_transaction() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("maintenance-gate");
        let entry = test_entry(
            "dev.test.maintenancegate",
            powershell_plugin("$result = @{ ok = $true }"),
            2_000,
        );
        create_package(&root, &entry.id);
        let session = ManagedSession::spawn(&root, &entry).expect("spawn session");
        let process = Arc::clone(&session.process);
        let process_guard = process.lock().expect("hold process termination");
        runtime_manager()
            .lock()
            .expect("runtime manager")
            .sessions
            .insert(entry.id.clone(), session);

        let (first_sender, first_receiver) = mpsc::channel();
        let first_plugin_id = entry.id.clone();
        thread::spawn(move || {
            first_sender
                .send(begin_plugin_maintenance(&first_plugin_id))
                .expect("report first maintenance result");
        });
        let wait_started = Instant::now();
        while !runtime_manager()
            .lock()
            .expect("runtime manager")
            .blocked_plugins
            .contains_key(&entry.id)
        {
            assert!(
                wait_started.elapsed() < Duration::from_secs(2),
                "first maintenance did not reach process termination"
            );
            thread::yield_now();
        }

        let (second_sender, second_receiver) = mpsc::channel();
        let second_plugin_id = entry.id.clone();
        thread::spawn(move || {
            second_sender
                .send(begin_plugin_maintenance(&second_plugin_id))
                .expect("report second maintenance result");
        });
        assert!(matches!(
            second_receiver.recv_timeout(Duration::from_millis(100)),
            Err(RecvTimeoutError::Timeout)
        ));

        drop(process_guard);
        let first_guard = first_receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("first maintenance completes termination")
            .expect("first maintenance succeeds");
        assert!(matches!(
            second_receiver.recv_timeout(Duration::from_millis(100)),
            Err(RecvTimeoutError::Timeout)
        ));
        drop(first_guard);
        let second_guard = second_receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("second maintenance enters after the first transaction")
            .expect("second maintenance succeeds");
        drop(second_guard);
        assert!(!runtime_manager()
            .lock()
            .expect("runtime manager")
            .blocked_plugins
            .contains_key(&entry.id));
        assert!(!maintenance_coordinator()
            .active_plugins
            .lock()
            .expect("maintenance coordinator")
            .contains_key(&entry.id));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(windows)]
    #[test]
    fn maintenance_aborts_and_releases_the_gate_when_termination_fails() {
        let _runtime_test_guard = runtime_test_guard();
        let root = test_directory("maintenance-termination-failure");
        let entry = test_entry(
            "dev.test.maintenancefailure",
            powershell_plugin("$result = @{ ok = $true }"),
            2_000,
        );
        create_package(&root, &entry.id);
        let session = ManagedSession::spawn(&root, &entry).expect("spawn session");
        let process = Arc::clone(&session.process);
        let _ = thread::spawn(move || {
            let _guard = process.lock().expect("process lock");
            panic!("poison process lock for regression test");
        })
        .join();
        runtime_manager()
            .lock()
            .expect("runtime manager")
            .sessions
            .insert(entry.id.clone(), session);

        let error = match begin_plugin_maintenance(&entry.id) {
            Ok(_) => panic!("termination failure must abort maintenance"),
            Err(error) => error,
        };
        assert_eq!(error.code, "INTERNAL_ERROR");
        assert!(!runtime_manager()
            .lock()
            .expect("runtime manager")
            .blocked_plugins
            .contains_key(&entry.id));
        assert!(!maintenance_coordinator()
            .active_plugins
            .lock()
            .expect("maintenance coordinator")
            .contains_key(&entry.id));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn stderr_ring_keeps_only_the_last_five_hundred_lines() {
        let _runtime_test_guard = runtime_test_guard();
        let input = (0..600)
            .map(|line| format!("line-{line}\n"))
            .collect::<String>();
        let lines = Arc::new(Mutex::new(VecDeque::new()));
        read_stderr(
            Box::new(std::io::Cursor::new(input.into_bytes())),
            Arc::clone(&lines),
        );
        let lines = lines.lock().expect("stderr log");
        assert_eq!(lines.len(), 500);
        assert_eq!(lines.front().map(String::as_str), Some("line-100"));
        assert_eq!(lines.back().map(String::as_str), Some("line-599"));

        drop(lines);
        let lines = Arc::new(Mutex::new(VecDeque::new()));
        read_stderr(
            Box::new(std::io::Cursor::new(vec![b'x'; STDERR_LINE_BYTES * 16])),
            Arc::clone(&lines),
        );
        let lines = lines.lock().expect("bounded stderr log");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].len() < STDERR_LINE_BYTES + 100);
        assert!(lines[0].ends_with(text::PLUGIN_RUNTIME_STDERR_TRUNCATED));
    }

    #[test]
    fn stdout_reader_applies_backpressure_when_the_bounded_queue_is_full() {
        let _runtime_test_guard = runtime_test_guard();
        let reads = Arc::new(AtomicUsize::new(0));
        let reader = ChunkCountingReader {
            reads: Arc::clone(&reads),
            remaining: RUNTIME_MESSAGE_QUEUE_CAPACITY * 4,
            line: b"{\"v\":1,\"id\":null,\"type\":\"control\",\"action\":\"heartbeat\"}\n",
        };
        let (sender, receiver) = mpsc::sync_channel(RUNTIME_MESSAGE_QUEUE_CAPACITY);
        let worker = thread::spawn(move || read_stdout(Box::new(reader), sender));
        let deadline = Instant::now() + Duration::from_secs(2);
        while reads.load(Ordering::Acquire) < RUNTIME_MESSAGE_QUEUE_CAPACITY + 1
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            reads.load(Ordering::Acquire),
            RUNTIME_MESSAGE_QUEUE_CAPACITY + 1
        );
        thread::sleep(Duration::from_millis(25));
        assert_eq!(
            reads.load(Ordering::Acquire),
            RUNTIME_MESSAGE_QUEUE_CAPACITY + 1,
            "reader must stop pulling bytes while the queue is saturated"
        );
        drop(receiver);
        worker.join().expect("join stdout reader");
    }

    struct ChunkCountingReader {
        reads: Arc<AtomicUsize>,
        remaining: usize,
        line: &'static [u8],
    }

    impl Read for ChunkCountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if self.remaining == 0 {
                return Ok(0);
            }
            self.remaining -= 1;
            self.reads.fetch_add(1, Ordering::Release);
            buffer[..self.line.len()].copy_from_slice(self.line);
            Ok(self.line.len())
        }
    }

    #[cfg(windows)]
    fn runtime_test_guard() -> MutexGuard<'static, ()> {
        static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn powershell_plugin(call_body: &str) -> String {
        powershell_plugin_with_exporter(call_body, true)
    }

    #[cfg(windows)]
    fn powershell_plugin_with_exporter(call_body: &str, exporter: bool) -> String {
        powershell_plugin_with_capabilities(call_body, exporter, false)
    }

    #[cfg(windows)]
    fn powershell_plugin_with_capabilities(
        call_body: &str,
        exporter: bool,
        config_migration: bool,
    ) -> String {
        let exporter = if exporter { "$true" } else { "$false" };
        let config_migration = if config_migration { "$true" } else { "$false" };
        format!(
            "$script:count = 0; while (($line = [Console]::In.ReadLine()) -ne $null) {{ $msg = $line | ConvertFrom-Json; $exitAfterResponse = $false; if ($msg.method -eq 'hello') {{ $result = @{{ protocolVersion = 1; capabilities = @{{ exporter = {exporter}; configMigration = {config_migration} }} }} }} else {{ {call_body} }}; $response = @{{ v = 1; id = $msg.id; type = 'response'; result = $result }}; [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush(); if ($exitAfterResponse) {{ Stop-Process -Id $PID -Force }} }}"
        )
    }

    #[cfg(windows)]
    fn powershell_error_plugin(code: &str) -> String {
        format!(
            "while (($line = [Console]::In.ReadLine()) -ne $null) {{ $msg = $line | ConvertFrom-Json; if ($msg.method -eq 'hello') {{ $response = @{{ v = 1; id = $msg.id; type = 'response'; result = @{{ protocolVersion = 1; capabilities = @{{ exporter = $true }} }} }} }} else {{ $response = @{{ v = 1; id = $msg.id; type = 'response'; error = @{{ code = '{code}'; message = 'expected business error' }} }} }}; [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }}"
        )
    }

    #[cfg(windows)]
    fn powershell_file_proxy_plugin() -> String {
        "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $helloLine = [Console]::In.ReadLine(); $hello = $helloLine | ConvertFrom-Json; $helloResponse = @{ v = 1; id = $hello.id; type = 'response'; result = @{ protocolVersion = 1; capabilities = @{ exporter = $true } } }; [Console]::Out.WriteLine(($helloResponse | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush(); $callLine = [Console]::In.ReadLine(); $call = $callLine | ConvertFrom-Json; $proxy = @{ v = 1; id = 'proxy-read'; type = 'request'; method = 'fs.read'; params = @{ path = $call.params.path } }; [Console]::Out.WriteLine(($proxy | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush(); $proxyLine = [Console]::In.ReadLine(); $proxyResponse = $proxyLine | ConvertFrom-Json; $response = @{ v = 1; id = $call.id; type = 'response'; result = $proxyResponse }; [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8)); [Console]::Out.Flush(); Start-Sleep -Seconds 30".to_string()
    }

    #[cfg(windows)]
    fn test_entry(id: &str, script: String, timeout_ms: u32) -> PluginRegistryEntry {
        let capability = PluginCapabilityVersion {
            api_version: PluginApiVersionTarget { min: 1 },
        };
        PluginRegistryEntry {
            id: id.to_string(),
            name: id.to_string(),
            version: "1.0.0".to_string(),
            extension_kind: PluginExtensionKind::Exporter,
            entry: Some(PluginEntry {
                command: "powershell.exe".to_string(),
                args: vec![
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-Command".to_string(),
                    script,
                ],
            }),
            capabilities: PluginCapabilities {
                annotation_types: Vec::new(),
                batch: false,
                progress: false,
                cancel: false,
                config_migration: false,
                exporter: capability.clone(),
                prelabel: capability,
            },
            grants: Vec::new(),
            state: PluginState::Enabled,
            failure_count: 0,
            last_error: None,
            config_version: 0,
            timeout_ms,
            installed_at: "1".to_string(),
            updated_at: "1".to_string(),
        }
    }

    #[cfg(windows)]
    fn create_package(root: &Path, plugin_id: &str) {
        fs::create_dir_all(root.join("plugins").join(plugin_id)).expect("create plugin package");
    }

    #[cfg(windows)]
    fn write_registry(root: &Path, entries: &[PluginRegistryEntry]) {
        fs::create_dir_all(root).expect("create app data");
        let file = fs::File::create(root.join("plugin-registry.json")).expect("create registry");
        serde_json::to_writer_pretty(file, entries).expect("write registry");
    }

    #[cfg(windows)]
    fn process_exists(process_id: u32) -> bool {
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {process_id}"), "/FO", "CSV", "/NH"])
            .output()
            .is_ok_and(|output| {
                String::from_utf8_lossy(&output.stdout).contains(&format!("\"{process_id}\""))
            })
    }

    fn test_directory(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "my-label-tool-plugin-runtime-{name}-{}-{nonce}",
            std::process::id()
        ))
    }
}
