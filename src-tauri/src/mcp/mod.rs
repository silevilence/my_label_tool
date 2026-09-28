//! Desktop-only MCP gateway. No plugin capabilities or arbitrary command dispatch.
mod config;
mod http;
#[cfg(test)]
mod tests;
use crate::i18n::mcp_zh_cn as text;
pub use config::Config;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::oneshot;

pub const VERSIONS: &[&str] = &["2025-03-26", "2025-06-18", "2025-11-25"];
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn catalog() -> Value {
    // Only completed capabilities are advertised. Expanded as domain handlers are installed.
    let all: Vec<Value> =
        serde_json::from_str(include_str!("../../../docs/mcp-tools.json")).unwrap_or_default();
    Value::Array(
        all.into_iter()
            .filter(|v| {
                matches!(
                    v["name"].as_str(),
                    Some("app_state" | "project_read" | "annotations_read" | "annotations_apply")
                ) || v["name"]
                    .as_str()
                    .is_some_and(|n| n.starts_with("control_"))
            })
            .collect(),
    )
}
pub fn failure(code: &str, message: &str) -> Value {
    let body = json!({"code":code,"message":message});
    json!({"isError":true,"content":[{"type":"text","text":body.to_string()}],"structuredContent":body})
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub client: String,
    pub version: String,
    pub last_seen: u64,
    #[serde(skip)]
    pub initialized: bool,
    #[serde(skip)]
    pub window: u64,
    #[serde(skip)]
    pub count: u32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub arguments: Value,
    pub deadline: u64,
}
struct Pending {
    call: Call,
    sender: oneshot::Sender<Value>,
    delivered: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Audit {
    pub time: u64,
    pub session: String,
    pub tool: String,
    pub result: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub enabled: bool,
    pub address: String,
    pub port: u16,
    pub generation: u64,
    pub error: Option<String>,
    pub sessions: Vec<Session>,
    pub audit: Vec<Audit>,
}
#[derive(Serialize)]
pub struct Poll {
    pub status: Status,
    pub calls: Vec<Call>,
}
pub(super) struct Inner {
    config: Option<Config>,
    path: Option<PathBuf>,
    running: bool,
    generation: u64,
    error: Option<String>,
    sessions: HashMap<String, Session>,
    pending: HashMap<String, Pending>,
    audit: VecDeque<Audit>,
    last_poll: u64,
    stop: Option<oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}
impl Inner {
    fn sweep(&mut self) {
        let time = now();
        self.sessions
            .retain(|_, s| time.saturating_sub(s.last_seen) < 60_000);
        self.pending.retain(|_, p| {
            p.call.deadline > time
                && !p.sender.is_closed()
                && self.sessions.contains_key(&p.call.session_id)
        });
    }
    fn status(&self) -> Status {
        Status {
            running: self.running,
            enabled: self.config.as_ref().is_some_and(|c| c.enabled),
            address: self
                .config
                .as_ref()
                .map_or("127.0.0.1".into(), |c| c.address.clone()),
            port: self.config.as_ref().map_or(1421, |c| c.port),
            generation: self.generation,
            error: self.error.clone(),
            sessions: self.sessions.values().cloned().collect(),
            audit: self.audit.iter().cloned().collect(),
        }
    }
    fn record(&mut self, session: &str, tool: &str, result: &str) {
        self.audit.push_back(Audit {
            time: now(),
            session: session.chars().take(8).collect(),
            tool: tool.into(),
            result: result.into(),
        });
        while self.audit.len() > 200 {
            self.audit.pop_front();
        }
    }
    fn invalidate(&mut self) {
        self.running = false;
        self.generation += 1;
        self.sessions.clear();
        self.pending.clear();
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}
pub struct Host {
    inner: Mutex<Inner>,
    lifecycle: tokio::sync::Mutex<()>,
}
impl Default for Host {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                config: None,
                path: None,
                running: false,
                generation: 0,
                error: None,
                sessions: HashMap::new(),
                pending: HashMap::new(),
                audit: VecDeque::new(),
                last_poll: 0,
                stop: None,
                task: None,
            }),
            lifecycle: tokio::sync::Mutex::new(()),
        }
    }
}
impl Host {
    pub async fn initialize_owned(self: Arc<Self>, path: PathBuf) {
        self.initialize(path).await;
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.inner.lock().map_err(|_| text::INTERNAL.into())
    }
    pub async fn initialize(self: &Arc<Self>, path: PathBuf) {
        let read_path = path.clone();
        let result = tokio::task::spawn_blocking(move || config::load(&read_path))
            .await
            .map_err(text::failed)
            .and_then(|v| v);
        match result {
            Ok(value) => {
                if let Ok(mut inner) = self.lock() {
                    inner.config = Some(value.clone());
                    inner.path = Some(path);
                }
                if value.enabled {
                    if let Err(e) = self.restart().await {
                        if let Ok(mut inner) = self.lock() {
                            inner.error = Some(e);
                        }
                    }
                }
            }
            Err(e) => {
                if let Ok(mut inner) = self.lock() {
                    inner.error = Some(e);
                }
            }
        }
    }
    pub async fn configure(
        self: &Arc<Self>,
        enabled: bool,
        address: String,
        port: u16,
        rotate: bool,
    ) -> Result<Status, String> {
        config::validate(&address, port)?;
        let _gate = self.lifecycle.lock().await;
        let (mut config, path) = {
            let inner = self.lock()?;
            (
                inner.config.clone().ok_or(text::READY)?,
                inner.path.clone().ok_or(text::READY)?,
            )
        };
        config.enabled = enabled;
        config.address = address;
        config.port = port;
        if rotate {
            config.token = config::secret()?;
        }
        config::save(&path, &config)?;
        self.lock()?.config = Some(config);
        self.restart_inner().await?;
        Ok(self.lock()?.status())
    }
    async fn restart(self: &Arc<Self>) -> Result<(), String> {
        let _gate = self.lifecycle.lock().await;
        self.restart_inner().await
    }
    async fn restart_inner(self: &Arc<Self>) -> Result<(), String> {
        let (config, task) = {
            let mut inner = self.lock()?;
            inner.invalidate();
            inner.error = None;
            (inner.config.clone().ok_or(text::READY)?, inner.task.take())
        };
        if let Some(mut task) = task {
            if tokio::time::timeout(std::time::Duration::from_secs(2), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
        if !config.enabled {
            return Ok(());
        }
        let ip = config::validate(&config.address, config.port)?;
        let listener = match tokio::net::TcpListener::bind((ip, config.port)).await {
            Ok(value) => value,
            Err(error) => {
                let error = text::failed(error);
                self.lock()?.error = Some(error.clone());
                return Err(error);
            }
        };
        let (tx, rx) = oneshot::channel();
        let router = http::router(self.clone());
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        });
        let mut inner = self.lock()?;
        inner.stop = Some(tx);
        inner.task = Some(task);
        inner.running = true;
        Ok(())
    }
    pub fn shutdown(&self) {
        if let Ok(mut inner) = self.lock() {
            inner.invalidate();
        }
    }
    pub fn poll(&self) -> Result<Poll, String> {
        let mut inner = self.lock()?;
        inner.sweep();
        inner.last_poll = now();
        let calls = inner
            .pending
            .values_mut()
            .filter(|p| !p.delivered)
            .map(|p| {
                p.delivered = true;
                p.call.clone()
            })
            .collect();
        Ok(Poll {
            status: inner.status(),
            calls,
        })
    }
    pub fn token(&self) -> Result<String, String> {
        Ok(self
            .lock()?
            .config
            .as_ref()
            .ok_or(text::READY)?
            .token
            .clone())
    }
    pub fn resolve(&self, id: &str, result: Value) -> Result<(), String> {
        let mut inner = self.lock()?;
        if let Some(p) = inner.pending.remove(id) {
            let code = result["structuredContent"]["code"].as_str().unwrap_or("OK");
            inner.record(&p.call.session_id, &p.call.name, code);
            let _ = p.sender.send(result);
        }
        Ok(())
    }
    async fn call(&self, session: &str, name: &str, arguments: Value) -> Value {
        let Ok(id) = config::secret() else {
            return failure("INTERNAL_ERROR", text::INTERNAL);
        };
        let (tx, rx) = oneshot::channel();
        {
            let Ok(mut inner) = self.lock() else {
                return failure("INTERNAL_ERROR", text::INTERNAL);
            };
            if now().saturating_sub(inner.last_poll) > 3000 {
                return failure("NOT_READY", text::READY);
            }
            if inner.pending.len() >= 32 {
                return failure("BUSY", text::LIMIT);
            }
            inner.pending.insert(
                id.clone(),
                Pending {
                    call: Call {
                        id: id.clone(),
                        session_id: session.into(),
                        name: name.into(),
                        arguments,
                        deadline: now() + 10_000,
                    },
                    sender: tx,
                    delivered: false,
                },
            );
        }
        let result = match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => failure("CONTROL_REVOKED", text::SESSION),
            Err(_) => failure("TIMEOUT", text::TIMEOUT),
        };
        if let Ok(mut inner) = self.lock() {
            if inner.pending.remove(&id).is_some() {
                inner.record(session, name, "TIMEOUT");
            }
        }
        result
    }
}
pub fn host() -> &'static Arc<Host> {
    static HOST: OnceLock<Arc<Host>> = OnceLock::new();
    HOST.get_or_init(|| Arc::new(Host::default()))
}
