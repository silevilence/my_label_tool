use std::process::{Command, Stdio};

use crate::i18n::zh_cn as text;

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
}

#[cfg(windows)]
impl SuspendedJobProcess {
    pub(crate) fn spawn(
        executable: &std::path::Path,
        arguments: &[String],
        working_directory: &std::path::Path,
        environment_overrides: &[(&str, &str)],
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

        let display = executable.to_string_lossy();
        let mut command_line = windows_command_line(executable.as_os_str(), arguments)?;
        let current_directory = wide_null(working_directory.as_os_str())?;
        let environment = windows_environment_block(environment_overrides)?;
        let security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            bInheritHandle: true.into(),
            ..Default::default()
        };

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
            let _ = InitializeProcThreadAttributeList(None, 1, None, &mut attribute_size);
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
                1,
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
fn create_kill_on_close_job() -> Result<windows::Win32::Foundation::HANDLE, String> {
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
unsafe fn close_handle(handle: windows::Win32::Foundation::HANDLE) {
    use windows::Win32::Foundation::CloseHandle;
    // SAFETY: the caller provides the validity and unique-ownership invariant.
    let _ = unsafe { CloseHandle(handle) };
}

#[cfg(windows)]
fn windows_command_line(
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
fn wide_null(value: &std::ffi::OsStr) -> Result<Vec<u16>, String> {
    use std::os::windows::ffi::OsStrExt;

    let mut encoded = value.encode_wide().collect::<Vec<_>>();
    if encoded.contains(&0) {
        return Err(text::process_argument_contains_nul());
    }
    encoded.push(0);
    Ok(encoded)
}

#[cfg(windows)]
fn windows_environment_block(overrides: &[(&str, &str)]) -> Result<Vec<u16>, String> {
    use std::{collections::HashSet, ffi::OsString, os::windows::ffi::OsStrExt};

    let overridden = overrides
        .iter()
        .map(|(key, _)| key.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut variables = std::env::vars_os()
        .filter(|(key, _)| !overridden.contains(&key.to_string_lossy().to_ascii_lowercase()))
        .collect::<Vec<_>>();
    variables.extend(
        overrides
            .iter()
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
