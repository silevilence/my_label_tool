//! Host-only text I/O. Adapter selection is independent of project/plugin contracts.
mod adapters;
mod bootstrap;
mod process;
#[cfg(test)]
mod tests;

use crate::i18n::zh_cn as text;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
pub(super) const MAX_BYTES: u64 = 64 * 1024 * 1024;
const CHECK_TEXT: &str = "读取自检：中文、é、🌍\r\n第二行\n";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub mode: String,
    pub values: HashMap<String, String>,
    pub timeout_ms: u64,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            mode: "native".into(),
            values: HashMap::new(),
            timeout_ms: 30_000,
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub required: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mode {
    pub id: String,
    pub name: String,
    pub fields: Vec<Field>,
    pub self_check: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub executable: Option<PathBuf>,
    pub arguments: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub config: Config,
    pub ok: bool,
    pub message: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub config: Config,
    pub modes: Vec<Mode>,
    pub last_check: Option<Check>,
    pub startup_error: Option<String>,
}
#[derive(Default)]
struct State {
    config: Config,
    checked: bool,
    check_failure: Option<String>,
    last_check: Option<Check>,
    startup_error: Option<String>,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static READ_GATE: Mutex<()> = Mutex::new(());
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
// IPC cancellation can arrive before a blocking worker registers its request.
// IDs are unique per frontend call; retain bounded, short-lived tombstones.
static EARLY_CANCEL: OnceLock<Mutex<HashMap<String, std::time::Instant>>> = OnceLock::new();
fn early_cancel() -> &'static Mutex<HashMap<String, std::time::Instant>> {
    EARLY_CANCEL.get_or_init(Mutex::default)
}
#[cfg(test)]
thread_local! { static TEST_CONFIG: std::cell::RefCell<Option<Config>> = const { std::cell::RefCell::new(None) }; }
#[cfg(test)]
pub(crate) fn with_test_config<T>(config: Config, action: impl FnOnce() -> T) -> T {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            TEST_CONFIG.with(|v| *v.borrow_mut() = None);
        }
    }
    TEST_CONFIG.with(|v| *v.borrow_mut() = Some(config));
    let _reset = Reset;
    action()
}
fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| Mutex::new(State::default()))
}
fn active() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    ACTIVE.get_or_init(Mutex::default)
}
pub(super) fn error(reason: impl std::fmt::Display) -> String {
    text::text_read_failed(reason)
}
pub(super) fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err(error(text::TEXT_READ_CANCELLED))
    } else {
        Ok(())
    }
}
pub fn initialize() {
    if let Ok(mut state) = state().lock() {
        match bootstrap::load().and_then(|config| {
            validate(&config)?;
            Ok(config)
        }) {
            Ok(config) => state.config = config,
            Err(error) => state.startup_error = Some(error),
        }
    }
}
fn adapter(config: &Config) -> Result<&'static dyn adapters::Adapter, String> {
    adapters::ADAPTERS
        .iter()
        .copied()
        .find(|a| a.metadata().id == config.mode)
        .ok_or_else(|| error(text::TEXT_READ_CONFIG_INVALID))
}
fn validate(config: &Config) -> Result<(), String> {
    let metadata = adapter(config)?.metadata();
    if !(100..=300_000).contains(&config.timeout_ms)
        || config
            .values
            .keys()
            .any(|key| !metadata.fields.iter().any(|f| &f.key == key))
    {
        return Err(error(text::TEXT_READ_CONFIG_INVALID));
    }
    for field in metadata.fields {
        let value = config
            .values
            .get(&field.key)
            .map(String::as_str)
            .unwrap_or_default();
        if field.required && value.trim().is_empty() {
            return Err(error(text::TEXT_READ_CONFIG_INVALID));
        }
        if !field.required && value.is_empty() {
            continue;
        }
        if field.kind == "stringArray" {
            serde_json::from_str::<Vec<String>>(value).map_err(error)?;
        }
    }
    Ok(())
}
pub fn settings() -> Result<Settings, String> {
    let state = state().lock().map_err(error)?;
    Ok(Settings {
        config: state.config.clone(),
        modes: adapters::ADAPTERS.iter().map(|a| a.metadata()).collect(),
        last_check: state.last_check.clone(),
        startup_error: state.startup_error.clone(),
    })
}
pub fn preview(config: &Config) -> Result<Plan, String> {
    validate(config)?;
    adapter(config)?.plan(config)
}
fn self_check(config: &Config, cancel: &AtomicBool) -> Result<(), String> {
    let directory = tempfile::tempdir().map_err(error)?;
    let path = directory.path().join("读取自检-é-🌍.txt");
    std::fs::write(&path, CHECK_TEXT).map_err(error)?;
    let result = adapter(config)?.read(config, &[path], cancel)?;
    if result != [CHECK_TEXT] {
        return Err(error(text::TEXT_READ_CHECK_MISMATCH));
    }
    Ok(())
}
fn record_check(state: &mut State, config: &Config, result: &Result<(), String>) {
    state.last_check = Some(Check {
        config: config.clone(),
        ok: result.is_ok(),
        message: result
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| text::TEXT_READ_CHECK_OK.into()),
    });
}
pub fn configure(config: Config, request_id: String, save: bool) -> Result<Check, String> {
    let request = Request::new(request_id)?;
    let _gate = read_gate(&request.cancel)?;
    validate(&config)?;
    let result = self_check(&config, &request.cancel);
    let mut state = state().lock().map_err(error)?;
    record_check(&mut state, &config, &result);
    if state.config == config && result.is_err() {
        state.checked = false;
        state.check_failure = result.as_ref().err().cloned();
    }
    result?;
    check_cancel(&request.cancel)?;
    if save {
        bootstrap::save(&config)?;
        state.config = config.clone();
        state.checked = false;
        state.check_failure = None;
        state.startup_error = None;
    } else if state.config == config {
        state.checked = true;
        state.check_failure = None;
    }
    Ok(Check {
        config,
        ok: true,
        message: text::TEXT_READ_CHECK_OK.into(),
    })
}
struct Request {
    id: String,
    cancel: Arc<AtomicBool>,
}
impl Request {
    fn new(id: String) -> Result<Self, String> {
        Self::with_cancel(id, Arc::new(AtomicBool::new(false)))
    }
    fn with_cancel(id: String, cancel: Arc<AtomicBool>) -> Result<Self, String> {
        let mut active = active().lock().map_err(error)?;
        if SHUTTING_DOWN.load(Ordering::SeqCst) {
            return Err(error(text::TEXT_READ_CANCELLED));
        }
        if active.contains_key(&id) {
            return Err(error(text::TEXT_READ_BUSY));
        }
        let mut early = early_cancel().lock().map_err(error)?;
        early.retain(|_, when| when.elapsed() < std::time::Duration::from_secs(300));
        if early.remove(&id).is_some() {
            cancel.store(true, Ordering::SeqCst);
        }
        active.insert(id.clone(), cancel.clone());
        Ok(Self { id, cancel })
    }
}
impl Drop for Request {
    fn drop(&mut self) {
        if let Ok(mut active) = active().lock() {
            active.remove(&self.id);
        }
    }
}
pub fn cancel(id: &str) -> Result<bool, String> {
    let active = active().lock().map_err(error)?;
    if let Some(cancel) = active.get(id) {
        cancel.store(true, Ordering::SeqCst);
        return Ok(true);
    }
    let mut early = early_cancel().lock().map_err(error)?;
    early.retain(|_, when| when.elapsed() < std::time::Duration::from_secs(300));
    if early.len() < 256 {
        early.insert(id.to_owned(), std::time::Instant::now());
    }
    Ok(false)
}
pub fn shutdown() {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if let Ok(active) = active().lock() {
        for cancel in active.values() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
}
pub fn read_many(paths: &[PathBuf], request_id: String) -> Result<Vec<String>, String> {
    read_many_cancellable(paths, request_id, Arc::new(AtomicBool::new(false)))
}
fn read_gate(cancel: &AtomicBool) -> Result<std::sync::MutexGuard<'static, ()>, String> {
    loop {
        check_cancel(cancel)?;
        match READ_GATE.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(std::sync::TryLockError::Poisoned(e)) => return Err(error(e)),
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(10))
            }
        }
    }
}
fn read_many_cancellable(
    paths: &[PathBuf],
    request_id: String,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<String>, String> {
    let request = Request::with_cancel(request_id, cancel)?;
    #[cfg(test)]
    if let Some(config) = TEST_CONFIG.with(|v| v.borrow().clone()) {
        return adapter(&config)?.read(&config, paths, &request.cancel);
    }
    let _gate = read_gate(&request.cancel)?;
    check_cancel(&request.cancel)?;
    let (config, checked) = {
        let state = state().lock().map_err(error)?;
        if let Some(error) = &state.startup_error {
            return Err(error.clone());
        }
        if let Some(error) = &state.check_failure {
            return Err(error.clone());
        }
        (state.config.clone(), state.checked)
    };
    if !checked {
        let result = self_check(&config, &request.cancel);
        let mut state = state().lock().map_err(error)?;
        record_check(&mut state, &config, &result);
        state.check_failure = result.as_ref().err().cloned();
        result?;
        state.checked = true;
    }
    let result = adapter(&config)?.read(&config, paths, &request.cancel)?;
    check_cancel(&request.cancel)?;
    Ok(result)
}
pub fn read(path: impl AsRef<Path>) -> Result<String, String> {
    read_cancellable(path, Arc::new(AtomicBool::new(false)))
}
pub(crate) fn read_cancellable(
    path: impl AsRef<Path>,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = format!("internal-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    read_many_cancellable(&[path.as_ref().to_path_buf()], id, cancel)?
        .pop()
        .ok_or_else(|| error(text::TEXT_READ_OUTPUT_INVALID))
}
