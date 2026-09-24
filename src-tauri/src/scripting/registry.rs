use label_script_host::protocol::{Failure, Result};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

#[derive(Default)]
struct Runs {
    active: HashMap<String, Arc<AtomicBool>>,
    cancelled_before_start: VecDeque<String>,
    shutting_down: bool,
}
impl Runs {
    fn register(&mut self, id: &str) -> Result<Arc<AtomicBool>> {
        if id.is_empty() || !self.active.is_empty() || self.shutting_down {
            return Err(Failure::new("INVALID_ARGUMENT", "runId"));
        }
        let cancelled = self.cancelled_before_start.iter().any(|value| value == id);
        self.cancelled_before_start.retain(|value| value != id);
        let flag = Arc::new(AtomicBool::new(cancelled));
        self.active.insert(id.to_owned(), flag.clone());
        Ok(flag)
    }
    fn cancel(&mut self, id: &str) {
        if let Some(flag) = self.active.get(id) {
            flag.store(true, Ordering::Release);
        } else if !id.is_empty() && !self.cancelled_before_start.iter().any(|value| value == id) {
            // Preparation can be cancelled before Tauri dispatches run_script. Bound
            // abandoned IDs (e.g. cancelled dimension loading that never starts a host).
            self.cancelled_before_start.push_back(id.to_owned());
            while self.cancelled_before_start.len() > 64 {
                self.cancelled_before_start.pop_front();
            }
        }
    }
}
fn runs() -> &'static Mutex<Runs> {
    static RUNS: OnceLock<Mutex<Runs>> = OnceLock::new();
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
        let cancelled = runs.register(&id)?;
        Ok(Self { id, cancelled })
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut runs) = runs().lock() {
            runs.active.remove(&self.id);
        }
    }
}
pub fn cancel(id: &str) {
    if let Ok(mut runs) = runs().lock() {
        runs.cancel(id);
    }
}
pub fn shutdown() {
    if let Ok(mut runs) = runs().lock() {
        runs.shutting_down = true;
        for flag in runs.active.values() {
            flag.store(true, Ordering::Release);
        }
    }
    // Keep the application alive until runner guards have killed and reaped children.
    loop {
        if runs()
            .lock()
            .map(|runs| runs.active.is_empty())
            .unwrap_or(true)
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_survives_dispatch_order_and_preparation() {
        let mut runs = Runs::default();
        runs.cancel("early");
        assert!(runs.register("early").unwrap().load(Ordering::Acquire));
        runs.active.clear();
        let flag = runs.register("preparing").unwrap();
        runs.cancel("preparing");
        assert!(flag.load(Ordering::Acquire));
        runs.active.clear();
        assert!(!runs.register("next").unwrap().load(Ordering::Acquire));
        for n in 0..100 {
            runs.cancel(&format!("abandoned-{n}"));
        }
        assert_eq!(runs.cancelled_before_start.len(), 64);
        runs.active.clear();
        runs.shutting_down = true;
        assert!(runs.register("shutdown").is_err());
    }
}
