use std::process::{Command, Stdio};

use crate::i18n::zh_cn as text;

#[cfg(all(windows, test))]
pub(crate) fn windows_isolation_test_guard() -> std::sync::MutexGuard<'static, ()> {
    static TEST_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    TEST_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(all(windows, test))]
pub(crate) const PLUGIN_TEST_STUB_FILENAME: &str = "plugin-runtime-test-stub.exe";

#[cfg(all(windows, test))]
pub(crate) fn install_plugin_test_stub(package_root: &std::path::Path) -> std::path::PathBuf {
    let current = std::env::current_exe().expect("current Rust test executable");
    let debug_directory = current
        .parent()
        .and_then(std::path::Path::parent)
        .expect("Cargo debug directory");
    let source = debug_directory.join("plugin-conformance-stub.exe");
    assert!(
        source.is_file(),
        "missing native plugin test stub: {source:?}"
    );
    let destination = package_root.join(PLUGIN_TEST_STUB_FILENAME);
    std::fs::copy(&source, &destination).expect("copy native plugin test stub into package");
    destination
}

#[cfg(windows)]
mod app_container;
#[cfg(windows)]
mod piped;
#[cfg(windows)]
pub(crate) use piped::PipedJobProcess;

#[cfg(windows)]
pub(crate) struct PluginSandbox<'a> {
    pub identity: &'a str,
    pub package_root: &'a std::path::Path,
    pub allow_network: bool,
}

#[cfg(unix)]
pub(crate) fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
pub(crate) fn configure_process_group(_: &mut Command) {}

#[cfg(windows)]
pub(crate) fn terminate_process_tree(process_id: u32) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(text::process_tree_termination_failed)?;
    if status.success() {
        Ok(())
    } else {
        Err(text::process_tree_termination_exit_failed(status.code()))
    }
}

#[cfg(unix)]
pub(crate) fn terminate_process_tree(process_id: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .args(["-KILL", &format!("-{process_id}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(text::process_tree_termination_failed)?;
    if status.success() {
        Ok(())
    } else {
        Err(text::process_tree_termination_exit_failed(status.code()))
    }
}

#[cfg(windows)]
pub(crate) struct SuspendedJobProcess {
    job: windows::Win32::Foundation::HANDLE,
    process: windows::Win32::Foundation::HANDLE,
    stdin_write: windows::Win32::Foundation::HANDLE,
    terminated: bool,
    _sandbox: app_container::AppContainerLaunch,
}

#[cfg(windows)]
impl SuspendedJobProcess {
    pub(crate) fn spawn(
        executable: &std::path::Path,
        arguments: &[String],
        working_directory: &std::path::Path,
        sandbox: PluginSandbox<'_>,
        environment_overrides: &[(&str, &str)],
        environment_removals: &[&str],
    ) -> Result<Self, String> {
        use std::mem::size_of;
        use windows::{
            core::{PCWSTR, PWSTR},
            Win32::{
                Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT},
                Security::SECURITY_ATTRIBUTES,
                Storage::FileSystem::{
                    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE,
                    OPEN_EXISTING,
                },
                System::{
                    JobObjects::{AssignProcessToJobObject, TerminateJobObject},
                    Pipes::CreatePipe,
                    Threading::{
                        CreateProcessW, DeleteProcThreadAttributeList,
                        InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
                        UpdateProcThreadAttribute, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
                        EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
                        PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                        STARTF_USESTDHANDLES, STARTUPINFOEXW,
                    },
                },
            },
        };

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
        let mut app_container = app_container::AppContainerLaunch::prepare(
            sandbox.identity,
            sandbox.package_root,
            executable.runtime_root.as_deref(),
            sandbox.allow_network,
        )?;
        let mut security_capabilities = app_container.security_capabilities();

        // SAFETY: all inherited handles are created explicitly, the child is
        // suspended until it is assigned to the kill-on-close Job Object, and
        // every owned handle is closed on every error path.
        unsafe {
            let job = create_kill_on_close_job()?;
            let mut stdin_read = Default::default();
            let mut stdin_write = Default::default();
            if let Err(error) = CreatePipe(
                &mut stdin_read,
                &mut stdin_write,
                Some(&raw const security),
                0,
            ) {
                close_handle(job);
                return Err(text::process_stdio_setup_failed(error));
            }
            if let Err(error) =
                SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT.0, Default::default())
            {
                close_handle(stdin_read);
                close_handle(stdin_write);
                close_handle(job);
                return Err(text::process_stdio_setup_failed(error));
            }
            let null_output = match CreateFileW(
                windows::core::w!("NUL"),
                windows::Win32::Foundation::GENERIC_WRITE.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                Some(&raw const security),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            ) {
                Ok(handle) => handle,
                Err(error) => {
                    close_handle(stdin_read);
                    close_handle(stdin_write);
                    close_handle(job);
                    return Err(text::process_stdio_setup_failed(error));
                }
            };
            let mut attribute_size = 0;
            let _ = InitializeProcThreadAttributeList(None, 2, None, &mut attribute_size);
            if attribute_size == 0 {
                let error = windows::core::Error::from_win32();
                close_handle(stdin_read);
                close_handle(stdin_write);
                close_handle(null_output);
                close_handle(job);
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
                close_handle(stdin_read);
                close_handle(stdin_write);
                close_handle(null_output);
                close_handle(job);
                return Err(text::process_stdio_setup_failed(error));
            }
            let inherited_handles = [stdin_read, null_output];
            if let Err(error) = UpdateProcThreadAttribute(
                attribute_list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                Some(inherited_handles.as_ptr().cast()),
                size_of::<windows::Win32::Foundation::HANDLE>() * inherited_handles.len(),
                None,
                None,
            ) {
                DeleteProcThreadAttributeList(attribute_list);
                close_handle(stdin_read);
                close_handle(stdin_write);
                close_handle(null_output);
                close_handle(job);
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
                close_handle(stdin_read);
                close_handle(stdin_write);
                close_handle(null_output);
                close_handle(job);
                return Err(text::plugin_sandbox_launch_failed(error));
            }
            let startup = STARTUPINFOEXW {
                StartupInfo: windows::Win32::System::Threading::STARTUPINFOW {
                    cb: size_of::<STARTUPINFOEXW>() as u32,
                    dwFlags: STARTF_USESTDHANDLES,
                    hStdInput: stdin_read,
                    hStdOutput: null_output,
                    hStdError: null_output,
                    ..Default::default()
                },
                lpAttributeList: attribute_list,
            };
            let mut process_information = PROCESS_INFORMATION::default();
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
                &mut process_information,
            );
            DeleteProcThreadAttributeList(attribute_list);
            close_handle(stdin_read);
            close_handle(null_output);
            if let Err(error) = created {
                close_handle(stdin_write);
                close_handle(job);
                return Err(text::plugin_runtime_start_failed(&display, error));
            }
            if let Err(error) = AssignProcessToJobObject(job, process_information.hProcess) {
                let _ = TerminateProcess(process_information.hProcess, 1);
                close_handle(process_information.hThread);
                close_handle(process_information.hProcess);
                close_handle(stdin_write);
                close_handle(job);
                return Err(text::process_job_assignment_failed(error));
            }
            if ResumeThread(process_information.hThread) == u32::MAX {
                let error = windows::core::Error::from_win32();
                let _ = TerminateJobObject(job, 1);
                close_handle(process_information.hThread);
                close_handle(process_information.hProcess);
                close_handle(stdin_write);
                close_handle(job);
                return Err(text::process_resume_failed(error));
            }
            close_handle(process_information.hThread);
            Ok(Self {
                job,
                process: process_information.hProcess,
                stdin_write,
                terminated: false,
                _sandbox: app_container,
            })
        }
    }

    pub(crate) fn try_wait(&self) -> Result<Option<i32>, String> {
        use windows::Win32::{
            Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
            System::Threading::{GetExitCodeProcess, WaitForSingleObject},
        };

        // SAFETY: the process handle remains owned by `self` for this call.
        unsafe {
            match WaitForSingleObject(self.process, 0) {
                WAIT_TIMEOUT => Ok(None),
                WAIT_OBJECT_0 => {
                    let mut exit_code = 0;
                    GetExitCodeProcess(self.process, &mut exit_code)
                        .map_err(text::plugin_runtime_wait_failed)?;
                    Ok(Some(exit_code as i32))
                }
                _ => Err(text::plugin_runtime_wait_failed(
                    windows::core::Error::from_win32(),
                )),
            }
        }
    }

    pub(crate) fn terminate_tree(&mut self) -> Result<(), String> {
        use windows::Win32::System::{
            JobObjects::TerminateJobObject, Threading::WaitForSingleObject,
        };

        if self.terminated {
            return Ok(());
        }
        // SAFETY: the Job Object is uniquely owned and contains the process
        // before its primary thread was ever resumed.
        unsafe {
            TerminateJobObject(self.job, 1).map_err(text::process_job_termination_failed)?;
            let _ = WaitForSingleObject(self.process, 5_000);
        }
        self.terminated = true;
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for SuspendedJobProcess {
    fn drop(&mut self) {
        let _ = self.terminate_tree();
        // SAFETY: these three fields are valid, uniquely owned handles and are
        // closed exactly once when the guard is dropped.
        unsafe {
            close_handle(self.stdin_write);
            close_handle(self.process);
            close_handle(self.job);
        }
    }
}

#[cfg(windows)]
pub(super) fn create_kill_on_close_job() -> Result<windows::Win32::Foundation::HANDLE, String> {
    use std::mem::size_of;
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // SAFETY: null attributes and name request an unnamed Job Object and do
    // not borrow any caller-owned memory.
    let job = unsafe { CreateJobObjectW(None, None) }.map_err(text::process_job_creation_failed)?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: `job` is valid and uniquely owned; `limits` has the exact Win32
    // structure and byte size and remains alive for the whole call.
    if let Err(error) = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } {
        // SAFETY: configuration failed before ownership was returned, so this
        // path uniquely owns and must close `job`.
        unsafe { close_handle(job) };
        return Err(text::process_job_configuration_failed(error));
    }
    Ok(job)
}

#[cfg(windows)]
/// # Safety
/// `handle` must be a valid, uniquely owned Win32 handle that has not already
/// been closed and will not be used after this call.
pub(super) unsafe fn close_handle(handle: windows::Win32::Foundation::HANDLE) {
    use windows::Win32::Foundation::CloseHandle;
    // SAFETY: the caller provides the validity and unique-ownership invariant.
    let _ = unsafe { CloseHandle(handle) };
}

#[cfg(windows)]
pub(super) fn windows_command_line(
    executable: &std::ffi::OsStr,
    arguments: &[String],
) -> Result<Vec<u16>, String> {
    let mut command_line = Vec::new();
    push_windows_argument(&mut command_line, executable)?;
    for argument in arguments {
        command_line.push(b' ' as u16);
        push_windows_argument(&mut command_line, std::ffi::OsStr::new(argument))?;
    }
    command_line.push(0);
    Ok(command_line)
}

#[cfg(windows)]
fn push_windows_argument(target: &mut Vec<u16>, argument: &std::ffi::OsStr) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    let units = argument.encode_wide().collect::<Vec<_>>();
    if units.contains(&0) {
        return Err(text::process_argument_contains_nul());
    }
    let quoted = units.is_empty()
        || units
            .iter()
            .any(|unit| *unit == b' ' as u16 || *unit == b'\t' as u16 || *unit == b'"' as u16);
    if !quoted {
        target.extend(units);
        return Ok(());
    }
    target.push(b'"' as u16);
    let mut backslashes = 0;
    for unit in units {
        if unit == b'\\' as u16 {
            backslashes += 1;
        } else if unit == b'"' as u16 {
            target.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2 + 1));
            target.push(unit);
            backslashes = 0;
        } else {
            target.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
            target.push(unit);
            backslashes = 0;
        }
    }
    target.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2));
    target.push(b'"' as u16);
    Ok(())
}

#[cfg(windows)]
pub(super) fn wide_null(value: &std::ffi::OsStr) -> Result<Vec<u16>, String> {
    use std::os::windows::ffi::OsStrExt;

    let mut encoded = value.encode_wide().collect::<Vec<_>>();
    if encoded.contains(&0) {
        return Err(text::process_argument_contains_nul());
    }
    encoded.push(0);
    Ok(encoded)
}

#[cfg(windows)]
pub(super) struct ResolvedWindowsExecutable {
    pub path: std::path::PathBuf,
    pub runtime_root: Option<std::path::PathBuf>,
}

#[cfg(windows)]
static LAUNCH_DISCOVERY_SEQUENCE: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1);

#[cfg(windows)]
pub(super) fn resolve_windows_executable(
    executable: &std::path::Path,
) -> Result<ResolvedWindowsExecutable, String> {
    if executable.components().count() == 1
        && matches!(
            executable.to_string_lossy().to_ascii_lowercase().as_str(),
            "python" | "python3" | "py"
        )
    {
        return resolve_windows_python(executable);
    }
    if executable.is_absolute() || executable.components().count() > 1 {
        return Ok(ResolvedWindowsExecutable {
            path: executable.to_path_buf(),
            runtime_root: None,
        });
    }
    let has_extension = executable.extension().is_some();
    let path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .flat_map(|directory| {
            let direct = directory.join(executable);
            if has_extension {
                vec![direct]
            } else {
                vec![direct.with_extension("exe"), direct]
            }
        })
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| executable.to_path_buf());
    Ok(ResolvedWindowsExecutable {
        path,
        runtime_root: None,
    })
}

#[cfg(windows)]
fn resolve_windows_python(command: &std::path::Path) -> Result<ResolvedWindowsExecutable, String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    let command_name = command.to_string_lossy().to_ascii_lowercase();
    let discovery_script = std::env::temp_dir().join(format!(
        "my-label-tool-python-discovery-{}-{}.py",
        std::process::id(),
        LAUNCH_DISCOVERY_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::write(&discovery_script, "import sys\nprint(sys.executable)\n")
        .map_err(text::plugin_python_resolution_failed)?;
    let launcher_arguments = if command_name == "py" { " -3" } else { "" };
    let discovery = format!(
        "\"\"{command_name}\"{launcher_arguments} -I \"{}\"\"",
        discovery_script.to_string_lossy().replace('"', "\"\"")
    );
    let output = Command::new("cmd.exe")
        .args(["/d", "/s", "/c"])
        .raw_arg(&discovery)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(text::plugin_python_resolution_failed);
    let _ = std::fs::remove_file(&discovery_script);
    let output = output?;
    if !output.status.success() {
        return Err(text::plugin_python_resolution_failed(
            String::from_utf8_lossy(&output.stderr).trim(),
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .ok_or_else(|| text::plugin_python_resolution_failed("empty interpreter path"))?;
    let path = std::fs::canonicalize(first_line).map_err(text::plugin_python_resolution_failed)?;
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err(text::plugin_python_resolution_failed(first_line));
    }
    let runtime_root = path
        .parent()
        .ok_or_else(|| text::plugin_python_resolution_failed(first_line))?
        .to_path_buf();
    Ok(ResolvedWindowsExecutable {
        path,
        runtime_root: Some(runtime_root),
    })
}

#[cfg(windows)]
pub(super) fn windows_environment_block_filtered(
    overrides: &[(&str, &str)],
    removals: &[&str],
) -> Result<Vec<u16>, String> {
    windows_environment_block_from(std::env::vars_os(), overrides, removals)
}

#[cfg(windows)]
fn windows_environment_block_from(
    current: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
    overrides: &[(&str, &str)],
    removals: &[&str],
) -> Result<Vec<u16>, String> {
    use std::{collections::HashSet, ffi::OsString, os::windows::ffi::OsStrExt};

    let overridden = overrides
        .iter()
        .map(|(key, _)| key.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let removed = removals
        .iter()
        .map(|key| key.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    const SAFE_KEYS: [&str; 18] = [
        "path",
        "systemroot",
        "systemdrive",
        "windir",
        "comspec",
        "pathext",
        "userprofile",
        "localappdata",
        "appdata",
        "temp",
        "tmp",
        "homedrive",
        "homepath",
        "username",
        "lang",
        "lc_all",
        "tz",
        "number_of_processors",
    ];
    let mut variables = current
        .into_iter()
        .filter(|(key, _)| {
            let key = key.to_string_lossy().to_ascii_lowercase();
            (SAFE_KEYS.contains(&key.as_str()) || key.starts_with('='))
                && !overridden.contains(&key)
                && !removed.contains(&key)
        })
        .collect::<Vec<_>>();
    variables.extend(
        overrides
            .iter()
            .filter(|(key, _)| !removed.contains(&key.to_ascii_lowercase()))
            .map(|(key, value)| (OsString::from(key), OsString::from(value))),
    );
    variables.sort_by_key(|(key, _)| key.to_string_lossy().to_ascii_lowercase());

    let mut block = Vec::new();
    for (key, value) in variables {
        let mut variable = key;
        variable.push("=");
        variable.push(value);
        let encoded = variable.encode_wide().collect::<Vec<_>>();
        if encoded.contains(&0) {
            return Err(text::process_argument_contains_nul());
        }
        block.extend(encoded);
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

#[cfg(all(test, windows))]
mod environment_tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn filtered_environment_removes_proxy_variables_case_insensitively() {
        let block = windows_environment_block_from(
            [
                (OsString::from("Path"), OsString::from("C:\\bin")),
                (OsString::from("HTTP_PROXY"), OsString::from("http://proxy")),
                (
                    OsString::from("https_proxy"),
                    OsString::from("http://proxy"),
                ),
                (OsString::from("GITHUB_TOKEN"), OsString::from("secret")),
            ],
            &[("MY_LABEL_TOOL_PLUGIN_DIR", "C:\\plugin")],
            &["http_proxy", "HTTPS_PROXY"],
        )
        .expect("environment block");
        let decoded = String::from_utf16_lossy(&block).replace('\0', "|");
        assert!(decoded.contains("Path=C:\\bin"));
        assert!(decoded.contains("MY_LABEL_TOOL_PLUGIN_DIR=C:\\plugin"));
        assert!(!decoded.to_ascii_lowercase().contains("http_proxy="));
        assert!(!decoded.to_ascii_lowercase().contains("https_proxy="));
        assert!(!decoded.contains("GITHUB_TOKEN="));
        assert!(!decoded.contains("secret"));
    }
}
