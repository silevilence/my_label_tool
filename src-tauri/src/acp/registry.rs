use crate::i18n::zh_cn as text;
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

#[derive(Default)]
pub struct Control {
    pub cancelled: AtomicBool,
    permissions: Mutex<HashMap<String, Option<Option<String>>>>,
}
impl Control {
    pub fn register_permission(&self, id: &str) -> Result<(), String> {
        let mut pending = self.permissions.lock().map_err(|_| text::ACP_PROTOCOL)?;
        if pending.len() >= 16 || pending.contains_key(id) {
            return Err(text::ACP_PROTOCOL.into());
        }
        pending.insert(id.to_owned(), None);
        Ok(())
    }
    pub fn respond(&self, id: &str, option: Option<String>) -> Result<(), String> {
        let mut pending = self.permissions.lock().map_err(|_| text::ACP_PROTOCOL)?;
        let response = pending
            .get_mut(id)
            .filter(|value| value.is_none())
            .ok_or(text::ACP_PERMISSION_EXPIRED)?;
        *response = Some(option);
        Ok(())
    }
    pub fn take_responses(&self) -> Result<Vec<(String, Option<String>)>, String> {
        let mut pending = self.permissions.lock().map_err(|_| text::ACP_PROTOCOL)?;
        let mut ready = vec![];
        pending.retain(|id, response| {
            if let Some(option) = response.take() {
                ready.push((id.clone(), option));
                false
            } else {
                true
            }
        });
        Ok(ready)
    }
}

#[derive(Default)]
struct Runs {
    active: HashMap<String, Arc<Control>>,
    early: VecDeque<String>,
    stopping: bool,
}
fn runs() -> &'static Mutex<Runs> {
    static RUNS: OnceLock<Mutex<Runs>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}
pub struct Registration {
    pub id: String,
    pub control: Arc<Control>,
}
impl Registration {
    pub fn new(id: String) -> Result<Self, String> {
        let mut runs = runs().lock().map_err(|_| text::ACP_PROTOCOL)?;
        if id.is_empty() || id.len() > 128 || !runs.active.is_empty() || runs.stopping {
            return Err(text::ACP_BUSY.into());
        }
        let control = Arc::new(Control::default());
        control
            .cancelled
            .store(runs.early.contains(&id), Ordering::Release);
        runs.early.retain(|value| value != &id);
        runs.active.insert(id.clone(), control.clone());
        Ok(Self { id, control })
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
        if let Some(control) = runs.active.get(id) {
            control.cancelled.store(true, Ordering::Release);
        } else if !id.is_empty() && id.len() <= 128 {
            runs.early.push_back(id.to_owned());
            while runs.early.len() > 64 {
                runs.early.pop_front();
            }
        }
    }
}
pub fn respond(id: &str, request: &str, option: Option<String>) -> Result<(), String> {
    runs()
        .lock()
        .map_err(|_| text::ACP_PROTOCOL)?
        .active
        .get(id)
        .ok_or(text::ACP_PERMISSION_EXPIRED)?
        .respond(request, option)
}
pub fn shutdown() {
    if let Ok(mut runs) = runs().lock() {
        runs.stopping = true;
        for control in runs.active.values() {
            control.cancelled.store(true, Ordering::Release);
        }
    }
    while runs()
        .lock()
        .map(|runs| !runs.active.is_empty())
        .unwrap_or(false)
    {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permission_response_is_single_use_and_late_responses_are_rejected() {
        let control = Control::default();
        assert!(control.respond("missing", Some("yes".into())).is_err());
        control.register_permission("one").unwrap();
        assert!(control.take_responses().unwrap().is_empty());
        assert!(control.register_permission("one").is_err());
        control.respond("one", None).unwrap();
        assert!(control.respond("one", Some("yes".into())).is_err());
        assert_eq!(
            control.take_responses().unwrap(),
            vec![("one".into(), None)]
        );
        assert!(control.respond("one", Some("yes".into())).is_err());
    }
    #[test]
    fn cancellation_before_dispatch_is_latched_and_registration_is_exclusive() {
        cancel("early-acp-test");
        let registration = Registration::new("early-acp-test".into()).unwrap();
        assert!(registration.control.cancelled.load(Ordering::Acquire));
        assert!(Registration::new("concurrent-acp-test".into()).is_err());
        drop(registration);
        let next = Registration::new("next-acp-test".into()).unwrap();
        assert!(!next.control.cancelled.load(Ordering::Acquire));
    }
}
