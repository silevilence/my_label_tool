use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use serde::Serialize;
use tokio::sync::Notify;

use crate::i18n::zh_cn as text;

/// Cancellation status reported when a cancel request is accepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CancellationStatus {
    Accepted,
    AlreadyCompleted,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancellationResult {
    pub status: CancellationStatus,
}

/// A hand-rolled cancellation flag suitable for CPU-bound blocking work. The worker
/// checks [`is_cancelled`](Self::is_cancelled) at safe points (e.g. once per image).
pub struct CancellationToken {
    state: AtomicBool,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            state: AtomicBool::new(false),
        }
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Async cancellation handle used for network work (the runtime download). In addition to
/// the atomic flag it carries a [`Notify`] so an awaiting future can be woken immediately
/// instead of waiting for the next stream chunk or a timeout.
pub struct AsyncCancellation {
    token: CancellationToken,
    notify: Notify,
}

impl AsyncCancellation {
    pub fn new() -> Self {
        Self {
            token: CancellationToken::new(),
            notify: Notify::new(),
        }
    }

    /// Resolves as soon as this handle has been cancelled.
    pub async fn cancelled(&self) {
        self.notify.notified().await;
    }
}

/// Anything that can be flagged for cancellation.
pub trait CancelHandle: Send + Sync {
    fn cancel(&self);
    fn is_cancelled(&self) -> bool;
}

impl CancelHandle for CancellationToken {
    fn cancel(&self) {
        self.state.store(true, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.state.load(Ordering::Acquire)
    }
}

impl CancelHandle for AsyncCancellation {
    fn cancel(&self) {
        self.token.cancel();
        self.notify.notify_one();
    }

    fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }
}

/// A thread-safe map of active task handles keyed by an application-generated task id.
///
/// Semantics mirror [`crate::media::pt_conversion`]'s conversion registry: registering a
/// duplicate id fails, cancelling an unknown id fails, and cancelling twice reports
/// [`CancellationStatus::AlreadyCompleted`]. Workers remove their entry on completion so
/// the map does not grow without bound. `label` is embedded in error messages (e.g.
/// "预打标任务…" / "ONNX Runtime 下载任务…").
pub struct TaskRegistry<T> {
    inner: Mutex<HashMap<String, Arc<T>>>,
    label: &'static str,
}

impl<T: CancelHandle> TaskRegistry<T> {
    pub fn new(label: &'static str) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            label,
        }
    }

    fn guard(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Arc<T>>>, String> {
        self.inner.lock().map_err(|_| text::TASK_LOCK_FAILED.to_string())
    }

    /// Registers a new task handle. Fails if `task_id` is empty or already running.
    pub fn register(&self, task_id: &str, handle: Arc<T>) -> Result<(), String> {
        if task_id.trim().is_empty() {
            return Err(text::TASK_ID_INVALID.to_string());
        }
        let mut tasks = self.guard()?;
        if tasks.contains_key(task_id) {
            return Err(text::task_id_already_running(self.label, task_id));
        }
        tasks.insert(task_id.to_string(), handle);
        Ok(())
    }

    pub fn get(&self, task_id: &str) -> Result<Arc<T>, String> {
        self.guard()?
            .get(task_id)
            .cloned()
            .ok_or_else(|| text::task_id_missing(self.label, task_id))
    }

    /// Flags the handle as cancelled and returns whether it was already cancelled.
    pub fn cancel(&self, task_id: &str) -> Result<CancellationResult, String> {
        let handle = self.get(task_id)?;
        let already = handle.is_cancelled();
        handle.cancel();
        Ok(CancellationResult {
            status: if already {
                CancellationStatus::AlreadyCompleted
            } else {
                CancellationStatus::Accepted
            },
        })
    }

    /// Flags every active handle as cancelled. Used on window/app exit.
    pub fn cancel_all(&self) {
        if let Ok(tasks) = self.inner.lock() {
            for handle in tasks.values() {
                handle.cancel();
            }
        }
    }

    pub fn remove(&self, task_id: &str) {
        if let Ok(mut tasks) = self.inner.lock() {
            tasks.remove(task_id);
        }
    }
}


#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use super::{
        AsyncCancellation, CancellationResult, CancellationToken, TaskRegistry, CancellationStatus,
    };

    fn registry() -> TaskRegistry<CancellationToken> {
        TaskRegistry::new("预打标")
    }

    #[test]
    fn register_rejects_duplicate_and_cancel_reports_status() {
        let reg = registry();
        reg.register("a", Arc::new(CancellationToken::new())).unwrap();
        let error = reg
            .register("a", Arc::new(CancellationToken::new()))
            .unwrap_err();
        assert!(error.contains("已存在"), "{error}");
        assert!(reg
            .register("", Arc::new(CancellationToken::new()))
            .unwrap_err()
            .contains("不能为空"));

        assert_eq!(
            reg.cancel("a").unwrap().status,
            CancellationStatus::Accepted
        );
        assert_eq!(
            reg.cancel("a").unwrap().status,
            CancellationStatus::AlreadyCompleted
        );
    }

    #[test]
    fn cancel_unknown_id_fails_and_remove_drops_entry() {
        let reg = registry();
        assert!(reg
            .cancel("missing")
            .unwrap_err()
            .contains("不存在或已结束"));
        reg.register("a", Arc::new(CancellationToken::new())).unwrap();
        reg.remove("a");
        assert!(reg.cancel("a").is_err());
    }

    #[test]
    fn cancel_flags_token() {
        let token = Arc::new(CancellationToken::new());
        let reg = registry();
        reg.register("a", Arc::clone(&token)).unwrap();
        assert!(!token.is_cancelled());
        reg.cancel("a").unwrap();
        assert!(token.is_cancelled());
    }

    #[test]
    fn cancel_all_flags_every_token() {
        let reg = registry();
        let tokens: Vec<_> = (0..3)
            .map(|i| {
                let token = Arc::new(CancellationToken::new());
                reg.register(&i.to_string(), Arc::clone(&token)).unwrap();
                token
            })
            .collect();
        reg.cancel_all();
        assert!(tokens.iter().all(|token| token.is_cancelled()));
    }

    #[tokio::test]
    async fn async_cancellation_wakes_and_announces_already_cancelled() {
        let handle = Arc::new(AsyncCancellation::new());
        let reg: TaskRegistry<AsyncCancellation> = TaskRegistry::new("ONNX Runtime 下载");
        reg.register("dl", Arc::clone(&handle)).unwrap();

        let waiter = {
            let handle = Arc::clone(&handle);
            tokio::spawn(async move { handle.cancelled().await })
        };

        tokio::time::timeout(Duration::from_secs(1), async {
            // Give the waiter a chance to register before cancelling.
            tokio::task::yield_now().await;
            reg.cancel("dl").unwrap();
            waiter.await.unwrap();
        })
        .await
        .expect("cancelled() future did not resolve after cancel");
        assert!(handle.is_cancelled());
        assert_eq!(
            reg.cancel("dl").unwrap().status,
            CancellationStatus::AlreadyCompleted
        );

        // Cancelling an already-cancelled handle still returns a result (idempotent).
        let _: CancellationResult = reg.cancel("dl").unwrap();
    }
}