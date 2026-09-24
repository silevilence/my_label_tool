use crate::protocol::{Failure, Limits, Result};

pub fn validate(limits: &Limits) -> Result<()> {
    if !(64..=4096).contains(&limits.max_memory_mi_b)
        || !(1..=3600).contains(&limits.timeout_seconds)
    {
        return Err(Failure::new("INVALID_ARGUMENT", "limits"));
    }
    Ok(())
}

#[cfg(windows)]
pub struct ProcessLimit(windows::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Drop for ProcessLimit {
    fn drop(&mut self) {
        // SAFETY: the guard uniquely owns the Job handle. It has no kill-on-close flag.
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(windows)]
pub fn install(limits: &Limits) -> Result<ProcessLimit> {
    use windows::Win32::System::{JobObjects::*, Threading::GetCurrentProcess};
    validate(limits)?;
    // SAFETY: create an unnamed job owned by the guard, configure before assignment.
    unsafe {
        let job = ProcessLimit(
            CreateJobObjectW(None, None).map_err(|e| Failure::new("HOST_UNAVAILABLE", e))?,
        );
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        info.ProcessMemoryLimit = limits.max_memory_mi_b as usize * 1024 * 1024;
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            std::mem::size_of_val(&info) as u32,
        )
        .map_err(|e| Failure::new("HOST_UNAVAILABLE", e))?;
        AssignProcessToJobObject(job.0, GetCurrentProcess())
            .map_err(|e| Failure::new("HOST_UNAVAILABLE", e))?;
        Ok(job)
    }
}
#[cfg(unix)]
pub fn install(limits: &Limits) -> Result<()> {
    validate(limits)?;
    let bytes = limits.max_memory_mi_b * 1024 * 1024;
    let rlimit = libc::rlimit {
        rlim_cur: bytes as libc::rlim_t,
        rlim_max: bytes as libc::rlim_t,
    };
    // SAFETY: points to a valid rlimit; limits apply only to this dedicated host.
    if unsafe { libc::setrlimit(libc::RLIMIT_AS, &rlimit) } != 0 {
        return Err(Failure::new(
            "HOST_UNAVAILABLE",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(())
}
