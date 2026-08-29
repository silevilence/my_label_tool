use std::{fs::File, mem::size_of, os::windows::io::FromRawHandle, path::Path};

use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT},
        Security::SECURITY_ATTRIBUTES,
        System::{
            JobObjects::{AssignProcessToJobObject, TerminateJobObject},
            Pipes::CreatePipe,
            Threading::{
                CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
                ResumeThread, TerminateProcess, UpdateProcThreadAttribute, CREATE_SUSPENDED,
                CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT,
                LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
            },
        },
    },
};

use super::{
    app_container::AppContainerLaunch, close_handle, create_kill_on_close_job,
    resolve_windows_executable, wide_null, windows_command_line,
    windows_environment_block_filtered, PluginSandbox,
};
use crate::i18n::zh_cn as text;

pub(crate) struct PipedJobProcess {
    job: HANDLE,
    process: HANDLE,
    stdin: Option<File>,
    stdout: Option<File>,
    stderr: Option<File>,
    terminated: bool,
    _sandbox: AppContainerLaunch,
}

// SAFETY: every HANDLE is uniquely owned by this guard. Moving the guard to
// another thread transfers ownership; no thread-affine Win32 API is used.
unsafe impl Send for PipedJobProcess {}

impl PipedJobProcess {
    pub(crate) fn spawn(
        executable: &Path,
        arguments: &[String],
        working_directory: &Path,
        sandbox: PluginSandbox<'_>,
        environment_overrides: &[(&str, &str)],
        environment_removals: &[&str],
    ) -> Result<Self, String> {
        let executable = resolve_windows_executable(executable)?;
        let display = executable.path.to_string_lossy();
        let mut command_line = windows_command_line(executable.path.as_os_str(), arguments)?;
        let current_directory = wide_null(working_directory.as_os_str())?;
        let environment =
            windows_environment_block_filtered(environment_overrides, environment_removals)?;
        let security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            bInheritHandle: true.into(),
            ..Default::default()
        };
        let mut app_container = AppContainerLaunch::prepare(
            sandbox.identity,
            sandbox.package_root,
            executable.runtime_root.as_deref(),
            sandbox.allow_network,
        )?;
        let mut security_capabilities = app_container.security_capabilities();

        // SAFETY: only the three child pipe endpoints are inherited. The child
        // stays suspended until it belongs to the kill-on-close Job Object.
        unsafe {
            let job = create_kill_on_close_job()?;
            let (stdin_read, stdin_write) = match create_pipe(&security) {
                Ok(handles) => handles,
                Err(error) => {
                    close_handle(job);
                    return Err(error);
                }
            };
            let (stdout_read, stdout_write) = match create_pipe(&security) {
                Ok(handles) => handles,
                Err(error) => {
                    close_many(&[stdin_read, stdin_write, job]);
                    return Err(error);
                }
            };
            let (stderr_read, stderr_write) = match create_pipe(&security) {
                Ok(handles) => handles,
                Err(error) => {
                    close_many(&[stdin_read, stdin_write, stdout_read, stdout_write, job]);
                    return Err(error);
                }
            };
            for parent in [stdin_write, stdout_read, stderr_read] {
                if let Err(error) =
                    SetHandleInformation(parent, HANDLE_FLAG_INHERIT.0, Default::default())
                {
                    close_many(&[
                        stdin_read,
                        stdin_write,
                        stdout_read,
                        stdout_write,
                        stderr_read,
                        stderr_write,
                        job,
                    ]);
                    return Err(text::process_stdio_setup_failed(error));
                }
            }

            let mut attribute_size = 0;
            let _ = InitializeProcThreadAttributeList(None, 2, None, &mut attribute_size);
            if attribute_size == 0 {
                let error = windows::core::Error::from_win32();
                close_many(&[
                    stdin_read,
                    stdin_write,
                    stdout_read,
                    stdout_write,
                    stderr_read,
                    stderr_write,
                    job,
                ]);
                return Err(text::process_stdio_setup_failed(error));
            }
            let mut attribute_storage = vec![0_usize; attribute_size.div_ceil(size_of::<usize>())];
            let attribute_list =
                LPPROC_THREAD_ATTRIBUTE_LIST(attribute_storage.as_mut_ptr().cast());
            if let Err(error) = InitializeProcThreadAttributeList(
                Some(attribute_list),
                2,
                None,
                &mut attribute_size,
            ) {
                close_many(&[
                    stdin_read,
                    stdin_write,
                    stdout_read,
                    stdout_write,
                    stderr_read,
                    stderr_write,
                    job,
                ]);
                return Err(text::process_stdio_setup_failed(error));
            }
            let inherited = [stdin_read, stdout_write, stderr_write];
            if let Err(error) = UpdateProcThreadAttribute(
                attribute_list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                Some(inherited.as_ptr().cast()),
                size_of::<HANDLE>() * inherited.len(),
                None,
                None,
            ) {
                DeleteProcThreadAttributeList(attribute_list);
                close_many(&[
                    stdin_read,
                    stdin_write,
                    stdout_read,
                    stdout_write,
                    stderr_read,
                    stderr_write,
                    job,
                ]);
                return Err(text::process_stdio_setup_failed(error));
            }
            if let Err(error) = UpdateProcThreadAttribute(
                attribute_list,
                0,
                windows::Win32::System::Threading::PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES
                    as usize,
                Some(
                    (&mut security_capabilities
                        as *mut windows::Win32::Security::SECURITY_CAPABILITIES)
                        .cast(),
                ),
                size_of::<windows::Win32::Security::SECURITY_CAPABILITIES>(),
                None,
                None,
            ) {
                DeleteProcThreadAttributeList(attribute_list);
                close_many(&[
                    stdin_read,
                    stdin_write,
                    stdout_read,
                    stdout_write,
                    stderr_read,
                    stderr_write,
                    job,
                ]);
                return Err(text::plugin_sandbox_launch_failed(error));
            }
            let startup = STARTUPINFOEXW {
                StartupInfo: windows::Win32::System::Threading::STARTUPINFOW {
                    cb: size_of::<STARTUPINFOEXW>() as u32,
                    dwFlags: STARTF_USESTDHANDLES,
                    hStdInput: stdin_read,
                    hStdOutput: stdout_write,
                    hStdError: stderr_write,
                    ..Default::default()
                },
                lpAttributeList: attribute_list,
            };
            let mut info = PROCESS_INFORMATION::default();
            let created = CreateProcessW(
                PCWSTR::null(),
                Some(PWSTR(command_line.as_mut_ptr())),
                None,
                None,
                true,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
                Some(environment.as_ptr().cast()),
                PCWSTR(current_directory.as_ptr()),
                &raw const startup.StartupInfo,
                &mut info,
            );
            DeleteProcThreadAttributeList(attribute_list);
            close_many(&[stdin_read, stdout_write, stderr_write]);
            if let Err(error) = created {
                close_many(&[stdin_write, stdout_read, stderr_read, job]);
                return Err(text::plugin_runtime_start_failed(&display, error));
            }
            if let Err(error) = AssignProcessToJobObject(job, info.hProcess) {
                let _ = TerminateProcess(info.hProcess, 1);
                close_many(&[
                    info.hThread,
                    info.hProcess,
                    stdin_write,
                    stdout_read,
                    stderr_read,
                    job,
                ]);
                return Err(text::process_job_assignment_failed(error));
            }
            if ResumeThread(info.hThread) == u32::MAX {
                let error = windows::core::Error::from_win32();
                let _ = TerminateJobObject(job, 1);
                close_many(&[
                    info.hThread,
                    info.hProcess,
                    stdin_write,
                    stdout_read,
                    stderr_read,
                    job,
                ]);
                return Err(text::process_resume_failed(error));
            }
            close_handle(info.hThread);
            Ok(Self {
                job,
                process: info.hProcess,
                stdin: Some(File::from_raw_handle(stdin_write.0)),
                stdout: Some(File::from_raw_handle(stdout_read.0)),
                stderr: Some(File::from_raw_handle(stderr_read.0)),
                terminated: false,
                _sandbox: app_container,
            })
        }
    }

    pub(crate) fn take_stdin(&mut self) -> Option<File> {
        self.stdin.take()
    }

    pub(crate) fn take_stdout(&mut self) -> Option<File> {
        self.stdout.take()
    }

    pub(crate) fn take_stderr(&mut self) -> Option<File> {
        self.stderr.take()
    }

    pub(crate) fn try_wait(&self) -> Result<Option<i32>, String> {
        use windows::Win32::{
            Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
            System::Threading::{GetExitCodeProcess, WaitForSingleObject},
        };
        // SAFETY: `self.process` remains valid and uniquely owned for this
        // non-blocking status query.
        unsafe {
            match WaitForSingleObject(self.process, 0) {
                WAIT_TIMEOUT => Ok(None),
                WAIT_OBJECT_0 => {
                    let mut code = 0;
                    GetExitCodeProcess(self.process, &mut code)
                        .map_err(text::plugin_runtime_wait_failed)?;
                    Ok(Some(code as i32))
                }
                _ => Err(text::plugin_runtime_wait_failed(
                    windows::core::Error::from_win32(),
                )),
            }
        }
    }

    pub(crate) fn terminate_tree(&mut self) -> Result<(), String> {
        use windows::Win32::System::Threading::WaitForSingleObject;
        if self.terminated {
            return Ok(());
        }
        // SAFETY: the uniquely owned Job contains the process before resume;
        // waiting uses the still-valid process handle.
        unsafe {
            TerminateJobObject(self.job, 1).map_err(text::process_job_termination_failed)?;
            let _ = WaitForSingleObject(self.process, 5_000);
        }
        self.terminated = true;
        Ok(())
    }
}

impl Drop for PipedJobProcess {
    fn drop(&mut self) {
        let _ = self.terminate_tree();
        // SAFETY: Drop uniquely owns both handles and closes each exactly once.
        unsafe { close_many(&[self.process, self.job]) };
    }
}

unsafe fn create_pipe(security: &SECURITY_ATTRIBUTES) -> Result<(HANDLE, HANDLE), String> {
    let mut read = HANDLE::default();
    let mut write = HANDLE::default();
    // SAFETY: output pointers reference live HANDLE slots and `security`
    // remains valid for the duration of CreatePipe.
    unsafe { CreatePipe(&mut read, &mut write, Some(security), 0) }
        .map_err(text::process_stdio_setup_failed)?;
    Ok((read, write))
}

unsafe fn close_many(handles: &[HANDLE]) {
    for handle in handles {
        // SAFETY: callers pass only uniquely owned handles and never use them
        // after this cleanup helper returns.
        unsafe { close_handle(*handle) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{BufRead, BufReader},
        net::TcpListener,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn appcontainer_denies_direct_file_escape_and_unauthorized_network() {
        let _isolation = super::super::windows_isolation_test_guard();
        let root = std::env::temp_dir().join(format!(
            "my-label-tool-appcontainer-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let package = root.join("plugin");
        fs::create_dir_all(&package).expect("create package");
        let packaged_executable = package.join("plugin-probe.exe");
        let system_powershell = resolve_windows_executable(Path::new("powershell.exe"))
            .expect("resolve PowerShell")
            .path;
        fs::copy(system_powershell, &packaged_executable).expect("copy packaged executable");
        let inside = package.join("inside.txt");
        let outside = root.join("outside.txt");
        fs::write(&inside, "package-visible").expect("write package file");
        fs::write(&outside, "host-secret").expect("write outside file");
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind host listener");
        let port = listener
            .local_addr()
            .expect("listener address")
            .port()
            .to_string();
        let inside_value = inside.to_string_lossy().into_owned();
        let outside_value = outside.to_string_lossy().into_owned();
        let script = concat!(
            "$inside = try { [IO.File]::ReadAllText($env:SANDBOX_INSIDE).Trim() } ",
            "catch { 'INSIDE_DENIED' }; ",
            "$outside = try { [IO.File]::ReadAllText($env:SANDBOX_OUTSIDE).Trim() } ",
            "catch { 'OUTSIDE_DENIED' }; ",
            "$client = [Net.Sockets.TcpClient]::new(); ",
            "$network = try { $client.Connect('127.0.0.1', [int]$env:SANDBOX_PORT); ",
            "'NETWORK_ALLOWED' } catch { 'NETWORK_DENIED' }; ",
            "$client.Dispose(); ",
            "[Console]::Out.WriteLine(\"$inside|$outside|$network\")"
        );
        let arguments = vec![
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-Command".to_string(),
            script.to_string(),
        ];
        let mut process = PipedJobProcess::spawn(
            &packaged_executable,
            &arguments,
            &package,
            PluginSandbox {
                identity: &root.to_string_lossy(),
                package_root: &package,
                allow_network: false,
            },
            &[
                ("SANDBOX_INSIDE", &inside_value),
                ("SANDBOX_OUTSIDE", &outside_value),
                ("SANDBOX_PORT", &port),
            ],
            &[],
        )
        .expect("spawn isolated probe");
        drop(process.take_stdin());
        let mut output = String::new();
        BufReader::new(process.take_stdout().expect("stdout"))
            .read_line(&mut output)
            .expect("read probe output");
        assert_eq!(
            output.trim(),
            "package-visible|OUTSIDE_DENIED|NETWORK_DENIED"
        );
        drop(listener);
        drop(process);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn appcontainer_runs_system_python_without_host_secrets() {
        let _isolation = super::super::windows_isolation_test_guard();
        static ENVIRONMENT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _environment = ENVIRONMENT_LOCK.lock().expect("lock environment");
        let root = std::env::temp_dir().join(format!(
            "my-label-tool-python-appcontainer-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let package = root.join("plugin");
        fs::create_dir_all(&package).expect("create package");
        let script = package.join("main.py");
        fs::write(
            &script,
            concat!(
                "import os\n",
                "secret = os.environ.get('MY_LABEL_TOOL_TEST_SECRET')\n",
                "print('PYTHON_OK|' + ('SECRET_HIDDEN' if secret is None else secret))\n",
            ),
        )
        .expect("write Python plugin");
        // SAFETY: the process-wide mutation is serialized by ENVIRONMENT_LOCK
        // and restored before releasing that lock.
        unsafe { std::env::set_var("MY_LABEL_TOOL_TEST_SECRET", "SECRET_LEAKED") };
        let result = (|| {
            let arguments = vec![script.to_string_lossy().into_owned()];
            let mut process = PipedJobProcess::spawn(
                Path::new("python"),
                &arguments,
                &package,
                PluginSandbox {
                    identity: &root.to_string_lossy(),
                    package_root: &package,
                    allow_network: false,
                },
                &[],
                &[],
            )?;
            drop(process.take_stdin());
            let mut output = String::new();
            BufReader::new(
                process
                    .take_stdout()
                    .ok_or_else(|| "missing stdout".to_string())?,
            )
            .read_line(&mut output)
            .map_err(|error| error.to_string())?;
            drop(process);
            Ok::<String, String>(output)
        })();
        // SAFETY: restore the variable while still holding ENVIRONMENT_LOCK.
        unsafe { std::env::remove_var("MY_LABEL_TOOL_TEST_SECRET") };
        let output = result.expect("run isolated Python plugin");
        assert_eq!(output.trim(), "PYTHON_OK|SECRET_HIDDEN");
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
