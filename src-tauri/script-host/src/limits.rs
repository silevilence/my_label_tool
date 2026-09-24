use crate::protocol::{Failure, Limits, Result};

pub fn validate(limits: &Limits) -> Result<()> {
    let spec = specification();
    if !(spec.memory.min..=spec.memory.max).contains(&limits.max_memory_mi_b)
        || !(spec.timeout.min..=spec.timeout.max).contains(&limits.timeout_seconds)
    {
        return Err(Failure::new("INVALID_ARGUMENT", "limits"));
    }
    Ok(())
}

#[derive(serde::Deserialize)]
struct Range {
    min: u64,
    max: u64,
}
#[derive(serde::Deserialize)]
struct Specification {
    defaults: Limits,
    memory: Range,
    timeout: Range,
}
fn specification() -> &'static Specification {
    static SPEC: std::sync::OnceLock<Specification> = std::sync::OnceLock::new();
    SPEC.get_or_init(|| {
        serde_json::from_str(include_str!("../../../src/lib/defaults/script-limits.json"))
            .expect("checked-in script limit specification")
    })
}
pub fn defaults() -> Limits {
    specification().defaults.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_ranges_share_one_specification() {
        assert!(validate(&defaults()).is_ok());
        for (memory, seconds) in [(0, 30), (4097, 30), (256, 0), (256, 3601)] {
            assert!(validate(&Limits {
                max_memory_mi_b: memory,
                timeout_seconds: seconds
            })
            .is_err());
        }
    }
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
