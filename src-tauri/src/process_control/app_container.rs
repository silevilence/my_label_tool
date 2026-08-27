use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use sha2::{Digest, Sha256};
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{LocalFree, ERROR_ALREADY_EXISTS, HLOCAL},
        Security::{
            Authorization::{
                GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
                GRANT_ACCESS, REVOKE_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER,
                TRUSTEE_W,
            },
            CreateWellKnownSid, FreeSid,
            Isolation::DeleteAppContainerProfile,
            Isolation::{CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName},
            WinCapabilityInternetClientSid, WinCapabilityPrivateNetworkClientServerSid,
            DACL_SECURITY_INFORMATION, PSID, SECURITY_CAPABILITIES, SECURITY_MAX_SID_SIZE,
            SID_AND_ATTRIBUTES, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        },
        Storage::FileSystem::{FILE_GENERIC_EXECUTE, FILE_GENERIC_READ},
    },
};

use crate::i18n::zh_cn as text;

pub(crate) struct AppContainerLaunch {
    sid: PSID,
    profile_name: String,
    granted_paths: Vec<PathBuf>,
    capability_storage: Vec<Vec<u8>>,
    capabilities: Vec<SID_AND_ATTRIBUTES>,
}

static LAUNCH_SEQUENCE: AtomicU64 = AtomicU64::new(1);

impl AppContainerLaunch {
    pub(crate) fn prepare(
        identity: &str,
        package_root: &Path,
        runtime_root: Option<&Path>,
        allow_network: bool,
    ) -> Result<Self, String> {
        let launch_identity = format!(
            "{identity}:{}:{}",
            std::process::id(),
            LAUNCH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let profile_name = profile_name(&launch_identity);
        let sid = create_or_open_profile(&profile_name)?;
        let mut launch = Self {
            sid,
            profile_name,
            granted_paths: Vec::new(),
            capability_storage: Vec::new(),
            capabilities: Vec::new(),
        };
        let result: Result<(), String> = (|| {
            launch.grant_tree_access(package_root)?;
            if let Some(runtime_root) = runtime_root {
                launch.grant_tree_access(runtime_root)?;
            }
            let mut capability_storage = Vec::new();
            if allow_network {
                capability_storage.push(well_known_sid(WinCapabilityInternetClientSid)?);
                capability_storage
                    .push(well_known_sid(WinCapabilityPrivateNetworkClientServerSid)?);
            }
            let capabilities = capability_storage
                .iter_mut()
                .map(|bytes| SID_AND_ATTRIBUTES {
                    Sid: PSID(bytes.as_mut_ptr().cast()),
                    Attributes: 4,
                })
                .collect();
            launch.capability_storage = capability_storage;
            launch.capabilities = capabilities;
            Ok(())
        })();
        result?;
        Ok(launch)
    }

    pub(crate) fn security_capabilities(&mut self) -> SECURITY_CAPABILITIES {
        let _keep_storage_alive = &self.capability_storage;
        SECURITY_CAPABILITIES {
            AppContainerSid: self.sid,
            Capabilities: self.capabilities.as_mut_ptr(),
            CapabilityCount: self.capabilities.len() as u32,
            Reserved: 0,
        }
    }

    fn grant_tree_access(&mut self, root: &Path) -> Result<(), String> {
        if !root.is_dir() {
            return Err(text::PLUGIN_SANDBOX_PACKAGE_MISSING.to_string());
        }
        self.grant_access(root, true)?;
        let mut pending = vec![root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            for entry in fs::read_dir(&directory).map_err(text::plugin_sandbox_acl_failed)? {
                let entry = entry.map_err(text::plugin_sandbox_acl_failed)?;
                let file_type = entry.file_type().map_err(text::plugin_sandbox_acl_failed)?;
                if file_type.is_symlink() {
                    return Err(text::PLUGIN_SANDBOX_SYMLINK_REJECTED.to_string());
                }
                let path = entry.path();
                self.grant_access(&path, file_type.is_dir())?;
                if file_type.is_dir() {
                    pending.push(path);
                }
            }
        }
        Ok(())
    }

    fn grant_access(&mut self, path: &Path, inherit: bool) -> Result<(), String> {
        update_path_access(
            path,
            self.sid,
            GRANT_ACCESS,
            FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0,
            inherit,
        )?;
        self.granted_paths.push(path.to_path_buf());
        Ok(())
    }
}

impl Drop for AppContainerLaunch {
    fn drop(&mut self) {
        for path in self.granted_paths.iter().rev() {
            let _ = update_path_access(path, self.sid, REVOKE_ACCESS, 0, false);
        }
        let _ = delete_profile_by_name(&self.profile_name);
        // SAFETY: this guard uniquely owns the SID returned by the profile API.
        unsafe { FreeSid(self.sid) };
    }
}

fn profile_name(identity: &str) -> String {
    let digest = Sha256::digest(identity.as_bytes());
    format!("my-label-tool.{:x}", digest)[..46].to_string()
}

fn delete_profile_by_name(profile_name: &str) -> Result<(), String> {
    let name = super::wide_null(profile_name.as_ref())?;
    // SAFETY: the profile name is a live, NUL-terminated UTF-16 string.
    match unsafe { DeleteAppContainerProfile(windows::core::PCWSTR(name.as_ptr())) } {
        Ok(()) => Ok(()),
        Err(error)
            if windows::Win32::Foundation::WIN32_ERROR::from_error(&error)
                == Some(windows::Win32::Foundation::ERROR_FILE_NOT_FOUND) =>
        {
            Ok(())
        }
        Err(error) => Err(text::plugin_sandbox_profile_delete_failed(error)),
    }
}

fn create_or_open_profile(profile_name: &str) -> Result<PSID, String> {
    let name = super::wide_null(profile_name.as_ref())?;
    let display = super::wide_null("My Label Tool plugin sandbox".as_ref())?;
    let description = super::wide_null("Isolated external plugin process".as_ref())?;
    // SAFETY: all UTF-16 strings are NUL-terminated and remain live for the call.
    unsafe {
        match CreateAppContainerProfile(
            windows::core::PCWSTR(name.as_ptr()),
            windows::core::PCWSTR(display.as_ptr()),
            windows::core::PCWSTR(description.as_ptr()),
            None,
        ) {
            Ok(sid) => Ok(sid),
            Err(error)
                if error.code() == windows::core::HRESULT::from_win32(ERROR_ALREADY_EXISTS.0) =>
            {
                DeriveAppContainerSidFromAppContainerName(windows::core::PCWSTR(name.as_ptr()))
                    .map_err(text::plugin_sandbox_profile_failed)
            }
            Err(error) => Err(text::plugin_sandbox_profile_failed(error)),
        }
    }
}

fn well_known_sid(kind: windows::Win32::Security::WELL_KNOWN_SID_TYPE) -> Result<Vec<u8>, String> {
    let mut storage = vec![0_u8; SECURITY_MAX_SID_SIZE as usize];
    let mut size = storage.len() as u32;
    // SAFETY: storage is writable for `size` bytes and the API updates `size`.
    unsafe {
        CreateWellKnownSid(
            kind,
            None,
            Some(PSID(storage.as_mut_ptr().cast())),
            &mut size,
        )
        .map_err(text::plugin_sandbox_capability_failed)?;
    }
    storage.truncate(size as usize);
    Ok(storage)
}

fn update_path_access(
    path: &Path,
    sid: PSID,
    mode: windows::Win32::Security::Authorization::ACCESS_MODE,
    permissions: u32,
    inherit: bool,
) -> Result<(), String> {
    let path_wide = super::wide_null(path.as_os_str())?;
    let mut old_acl = std::ptr::null_mut();
    let mut descriptor = windows::Win32::Security::PSECURITY_DESCRIPTOR::default();
    // SAFETY: all output pointers are valid and every returned allocation is
    // released below with LocalFree.
    unsafe {
        GetNamedSecurityInfoW(
            windows::core::PCWSTR(path_wide.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(&mut old_acl),
            None,
            &mut descriptor,
        )
        .ok()
        .map_err(text::plugin_sandbox_acl_failed)?;
        let access = EXPLICIT_ACCESS_W {
            grfAccessPermissions: permissions,
            grfAccessMode: mode,
            grfInheritance: if inherit {
                SUB_CONTAINERS_AND_OBJECTS_INHERIT
            } else {
                Default::default()
            },
            Trustee: TRUSTEE_W {
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_USER,
                ptstrName: PWSTR(sid.0.cast()),
                ..Default::default()
            },
        };
        let mut new_acl = std::ptr::null_mut();
        let acl_result = SetEntriesInAclW(Some(&[access]), Some(old_acl), &mut new_acl)
            .ok()
            .and_then(|_| {
                SetNamedSecurityInfoW(
                    windows::core::PCWSTR(path_wide.as_ptr()),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    None,
                    None,
                    Some(new_acl),
                    None,
                )
                .ok()
            });
        if !new_acl.is_null() {
            LocalFree(Some(HLOCAL(new_acl.cast())));
        }
        if !descriptor.0.is_null() {
            LocalFree(Some(HLOCAL(descriptor.0)));
        }
        acl_result.map_err(text::plugin_sandbox_acl_failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_name_is_stable_valid_and_bounded() {
        let first = profile_name("dev.example.plugin:C:\\plugins\\example");
        assert_eq!(
            first,
            profile_name("dev.example.plugin:C:\\plugins\\example")
        );
        assert_ne!(first, profile_name("dev.example.other"));
        assert!(first.len() <= 64);
        assert!(first
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_. ".contains(character)));
    }
}
