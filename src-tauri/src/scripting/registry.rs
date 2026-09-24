use label_script_host::protocol::{Failure, Result};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

fn runs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}
pub struct Registration {
    pub id: String,
    pub cancelled: Arc<AtomicBool>,
}
impl Registration {
    pub fn new(id: String) -> Result<Self> {
        let mut runs = runs()
            .lock()
            .map_err(|e| Failure::new("PROTOCOL_ERROR", e))?;
        if id.is_empty() || !runs.is_empty() {
            return Err(Failure::new("INVALID_ARGUMENT", "runId"));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        runs.insert(id.clone(), cancelled.clone());
        Ok(Self { id, cancelled })
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut runs) = runs().lock() {
            runs.remove(&self.id);
        }
    }
}
pub fn cancel(id: &str) {
    if let Ok(runs) = runs().lock() {
        if let Some(flag) = runs.get(id) {
            flag.store(true, Ordering::Release);
        }
    }
}
pub fn shutdown() {
    if let Ok(runs) = runs().lock() {
        for flag in runs.values() {
            flag.store(true, Ordering::Release);
        }
    }
    // Keep the application alive until runner guards have killed and reaped children.
    loop {
        if runs().lock().map(|runs| runs.is_empty()).unwrap_or(true) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
