use super::Config;
use crate::i18n::zh_cn as text;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    sync::mpsc::{self, Receiver, SyncSender},
    thread::JoinHandle,
    time::Duration,
};

pub const MAX_LINE: usize = 1024 * 1024;
#[cfg(windows)]
use crate::process_control::PipedJobProcess;
#[cfg(not(windows))]
use std::process::{Child, Command, Stdio};
pub struct Transport {
    #[cfg(not(windows))]
    child: Child,
    #[cfg(windows)]
    child: PipedJobProcess,
    input: Option<SyncSender<Value>>,
    output: Option<Receiver<Result<Value, String>>>,
    workers: Vec<JoinHandle<()>>,
}
impl Transport {
    pub fn spawn(config: &Config, cwd: &Path) -> Result<Self, String> {
        #[cfg(not(windows))]
        let child = {
            let mut command = Command::new(&config.executable);
            command
                .args(&config.args)
                .current_dir(cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            crate::process_control::configure_process_group(&mut command);
            command.spawn().map_err(text::acp_start_failed)?
        };
        #[cfg(windows)]
        let child = PipedJobProcess::spawn_acp(&config.executable, &config.args, cwd)?;
        let mut transport = Self {
            child,
            input: None,
            output: None,
            workers: vec![],
        };
        #[cfg(not(windows))]
        let (mut stdin, stdout) = (
            transport.child.stdin.take().ok_or(text::ACP_PROTOCOL)?,
            transport.child.stdout.take().ok_or(text::ACP_PROTOCOL)?,
        );
        #[cfg(windows)]
        let (mut stdin, stdout) = (
            transport.child.take_stdin().ok_or(text::ACP_PROTOCOL)?,
            transport.child.take_stdout().ok_or(text::ACP_PROTOCOL)?,
        );
        #[cfg(windows)]
        if let Some(mut stderr) = transport.child.take_stderr() {
            transport.workers.push(std::thread::spawn(move || {
                let _ = std::io::copy(&mut stderr, &mut std::io::sink());
            }));
        }
        let (input_tx, input_rx) = mpsc::sync_channel::<Value>(32);
        let (output_tx, output_rx) = mpsc::sync_channel(32);
        let writer_error = output_tx.clone();
        transport.workers.push(std::thread::spawn(move || {
            for value in input_rx {
                if writeln!(stdin, "{value}")
                    .and_then(|_| stdin.flush())
                    .is_err()
                {
                    let _ = writer_error.send(Err(text::ACP_DISCONNECTED.into()));
                    break;
                }
            }
        }));
        transport.workers.push(std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut bytes = vec![];
                let read = reader
                    .by_ref()
                    .take((MAX_LINE + 1) as u64)
                    .read_until(b'\n', &mut bytes);
                let result = match read {
                    Ok(0) => Err(text::ACP_DISCONNECTED.into()),
                    Ok(_) if bytes.len() > MAX_LINE => Err(text::ACP_LIMIT.into()),
                    Ok(_) => {
                        serde_json::from_slice(&bytes).map_err(|_| text::ACP_PROTOCOL.to_owned())
                    }
                    Err(_) => Err(text::ACP_DISCONNECTED.into()),
                };
                let failed = result.is_err();
                if output_tx.send(result).is_err() || failed {
                    break;
                }
            }
        }));
        transport.input = Some(input_tx);
        transport.output = Some(output_rx);
        Ok(transport)
    }
    pub fn send(&self, value: Value) -> Result<(), String> {
        if value.to_string().len() > MAX_LINE {
            return Err(text::ACP_LIMIT.into());
        }
        self.input
            .as_ref()
            .ok_or(text::ACP_DISCONNECTED)?
            .try_send(value)
            .map_err(|_| text::ACP_DISCONNECTED.into())
    }
    pub fn receive(&self) -> Result<Option<Value>, String> {
        match self
            .output
            .as_ref()
            .ok_or(text::ACP_DISCONNECTED)?
            .recv_timeout(Duration::from_millis(15))
        {
            Ok(result) => result.map(Some),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                #[cfg(windows)]
                if self.child.try_wait()?.is_some() {
                    return Err(text::ACP_DISCONNECTED.into());
                }
                Ok(None)
            }
            Err(_) => Err(text::ACP_DISCONNECTED.into()),
        }
    }
}
impl Drop for Transport {
    fn drop(&mut self) {
        // Close every inherited pipe by terminating descendants before joining workers.
        #[cfg(windows)]
        let _ = self.child.terminate_tree();
        #[cfg(not(windows))]
        {
            let _ = crate::process_control::terminate_process_tree(self.child.id());
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        self.input.take();
        self.output.take();
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
    }
}
