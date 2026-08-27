// The registry keeps archive publication and durable state transitions in one
// transactional module; it exceeds 1000 lines so rollback invariants and their
// private test seams are not split across partially authoritative modules.
use super::manifest::{
    is_safe_relative_path, is_valid_permission_target, is_valid_plugin_id, is_valid_semver,
    parse_plugin_manifest, PluginCapabilities, PluginEntry, PluginExtensionKind, PluginManifest,
    DEFAULT_PLUGIN_TIMEOUT_MS, MAX_PLUGIN_TIMEOUT_MS,
};
use super::permissions::{
    resolve_permission_grants_for_install, PermissionPolicy, PermissionRoots,
};
use super::runtime::load_plugin_runtime_settings;
use super::runtime_probe::probe_plugin_process_available;
pub use super::versioning::{
    SUPPORTED_EXPORTER_API_VERSIONS, SUPPORTED_HOST_API_VERSIONS, SUPPORTED_PRELABEL_API_VERSIONS,
};
use crate::i18n::zh_cn as text;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};

const MAX_ARCHIVE_TOTAL_BYTES: u64 = 200 * 1024 * 1024;
const MAX_ARCHIVE_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 1_000;
static INSTALL_TOKEN_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static REGISTRY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistryError {
    pub code: String,
    pub message: String,
}

pub use super::permissions::PluginPermissionGrant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallPreview {
    pub install_token: String,
    pub manifest: PluginManifest,
    pub permissions: Vec<PluginPermissionGrant>,
    pub warning: String,
    pub is_update: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginState {
    Enabled,
    Disabled,
    AutoDisabled,
    PendingMigration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub extension_kind: PluginExtensionKind,
    pub entry: Option<PluginEntry>,
    pub capabilities: PluginCapabilities,
    pub grants: Vec<PluginPermissionGrant>,
    pub state: PluginState,
    pub failure_count: u32,
    pub last_error: Option<String>,
    pub config_version: u32,
    #[serde(default = "default_plugin_timeout_ms")]
    pub timeout_ms: u32,
    pub installed_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistrySnapshot {
    pub plugins: Vec<PluginRegistryEntry>,
    pub warning: Option<String>,
}

pub fn prepare_plugin_install(
    app_data_dir: &Path,
    archive_path: &Path,
) -> Result<PluginInstallPreview, PluginRegistryError> {
    prepare_plugin_install_for_project(app_data_dir, archive_path, Some(app_data_dir))
}

pub fn prepare_plugin_install_for_project(
    app_data_dir: &Path,
    archive_path: &Path,
    project_dir: Option<&Path>,
) -> Result<PluginInstallPreview, PluginRegistryError> {
    prepare_plugin_install_with_probe_for_project(
        app_data_dir,
        archive_path,
        project_dir,
        probe_plugin_entry,
    )
}

#[cfg(test)]
fn prepare_plugin_install_with_probe(
    app_data_dir: &Path,
    archive_path: &Path,
    probe: impl Fn(&PluginEntry, &Path) -> Result<(), String>,
) -> Result<PluginInstallPreview, PluginRegistryError> {
    prepare_plugin_install_with_probe_for_project(
        app_data_dir,
        archive_path,
        Some(app_data_dir),
        probe,
    )
}

fn prepare_plugin_install_with_probe_for_project(
    app_data_dir: &Path,
    archive_path: &Path,
    project_dir: Option<&Path>,
    probe: impl Fn(&PluginEntry, &Path) -> Result<(), String>,
) -> Result<PluginInstallPreview, PluginRegistryError> {
    let token = next_install_token();
    let pending_root = app_data_dir.join("plugins").join(".pending").join(&token);
    fs::create_dir_all(&pending_root)
        .map_err(|error| internal_error(text::plugin_archive_extract_failed(error)))?;
    match prepare_plugin_install_inner(
        app_data_dir,
        archive_path,
        &pending_root,
        token.clone(),
        project_dir,
        &probe,
    ) {
        Ok(mut preview) => match bind_install_token(app_data_dir, &pending_root, &token) {
            Ok(bound_token) => {
                preview.install_token = bound_token;
                Ok(preview)
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&pending_root);
                Err(error)
            }
        },
        Err(error) => {
            let _ = fs::remove_dir_all(&pending_root);
            Err(error)
        }
    }
}

fn prepare_plugin_install_inner(
    app_data_dir: &Path,
    archive_path: &Path,
    pending_root: &Path,
    token: String,
    project_dir: Option<&Path>,
    probe: &impl Fn(&PluginEntry, &Path) -> Result<(), String>,
) -> Result<PluginInstallPreview, PluginRegistryError> {
    let file = fs::File::open(archive_path)
        .map_err(|error| invalid_package(text::plugin_archive_open_failed(error)))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
    let mut total = 0_u64;
    let mut extracted_total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
        let size = entry.size();
        total = validate_archive_entry_size(size, entry.compressed_size(), total)?;
        if entry.is_symlink() {
            return Err(invalid_package(
                text::PLUGIN_ARCHIVE_UNSAFE_ENTRY.to_string(),
            ));
        }
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| invalid_package(text::PLUGIN_ARCHIVE_UNSAFE_ENTRY.to_string()))?;
        let output = pending_root.join(relative);
        if !output.starts_with(pending_root) {
            return Err(invalid_package(
                text::PLUGIN_ARCHIVE_UNSAFE_ENTRY.to_string(),
            ));
        }
        if entry.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|error| invalid_package(text::plugin_archive_extract_failed(error)))?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| invalid_package(text::plugin_archive_extract_failed(error)))?;
        }
        let mut output_file = fs::File::create(&output)
            .map_err(|error| invalid_package(text::plugin_archive_extract_failed(error)))?;
        let copied = std::io::copy(
            &mut entry.by_ref().take(MAX_ARCHIVE_FILE_BYTES + 1),
            &mut output_file,
        )
        .map_err(|error| invalid_package(text::plugin_archive_extract_failed(error)))?;
        extracted_total =
            validate_extracted_bytes(copied, entry.compressed_size(), extracted_total)?;
        output_file
            .flush()
            .map_err(|error| invalid_package(text::plugin_archive_extract_failed(error)))?;
    }

    let manifest_path = pending_root.join("manifest.json");
    if !manifest_path.is_file() {
        return Err(invalid_package(
            text::PLUGIN_ARCHIVE_MISSING_MANIFEST.to_string(),
        ));
    }
    let manifest_json: serde_json::Value = serde_json::from_reader(
        fs::File::open(&manifest_path)
            .map_err(|error| invalid_package(text::plugin_archive_open_failed(error)))?,
    )
    .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
    let parsed = parse_plugin_manifest(&manifest_json);
    let manifest = parsed.value.ok_or_else(|| {
        let reasons = parsed
            .errors
            .iter()
            .map(|error| format!("{}: {}", error.field, error.reason))
            .collect::<Vec<_>>()
            .join("；");
        invalid_package(text::plugin_manifest_invalid(&reasons))
    })?;
    reject_code_plugin_in_safe_mode(app_data_dir, &manifest)?;
    negotiate_manifest(&manifest)?;
    validate_runtime(&manifest, pending_root, probe, false)?;
    let permissions = resolve_permission_grants_for_install(
        &manifest.permissions,
        &permission_roots(app_data_dir, project_dir),
    )
    .map_err(permission_registry_error)?;
    let is_update = app_data_dir.join("plugins").join(&manifest.id).is_dir();
    Ok(PluginInstallPreview {
        install_token: token,
        manifest,
        permissions,
        warning: text::PLUGIN_UNVERIFIED_AUTHOR_WARNING.to_string(),
        is_update,
    })
}

fn reject_code_plugin_in_safe_mode(
    app_data_dir: &Path,
    manifest: &PluginManifest,
) -> Result<(), PluginRegistryError> {
    if manifest.extension_kind != PluginExtensionKind::LabelPreset
        && load_plugin_runtime_settings(app_data_dir)?.safe_mode
    {
        return Err(PluginRegistryError {
            code: "SAFE_MODE".to_string(),
            message: text::PLUGIN_SAFE_MODE_CODE_INSTALL_BLOCKED.to_string(),
        });
    }
    Ok(())
}

fn validate_extracted_bytes(
    copied: u64,
    compressed_size: u64,
    current_total: u64,
) -> Result<u64, PluginRegistryError> {
    let next_total = current_total.saturating_add(copied);
    if copied > MAX_ARCHIVE_FILE_BYTES || next_total > MAX_ARCHIVE_TOTAL_BYTES {
        return Err(invalid_package(text::PLUGIN_ARCHIVE_TOO_LARGE.to_string()));
    }
    validate_compression_ratio(copied, compressed_size)?;
    Ok(next_total)
}

fn validate_compression_ratio(
    expanded_size: u64,
    compressed_size: u64,
) -> Result<(), PluginRegistryError> {
    if expanded_size > 0
        && (compressed_size == 0
            || expanded_size > compressed_size.saturating_mul(MAX_COMPRESSION_RATIO))
    {
        Err(invalid_package(
            text::PLUGIN_ARCHIVE_RATIO_TOO_HIGH.to_string(),
        ))
    } else {
        Ok(())
    }
}

fn bind_install_token(
    app_data_dir: &Path,
    pending_root: &Path,
    token: &str,
) -> Result<String, PluginRegistryError> {
    let digest = package_digest(pending_root)?;
    let bound_token = format!("{token}-{digest}");
    let bound_root = app_data_dir
        .join("plugins")
        .join(".pending")
        .join(&bound_token);
    fs::rename(pending_root, bound_root)
        .map_err(|error| internal_error(text::plugin_package_replace_failed(error)))?;
    Ok(bound_token)
}

fn verify_bound_install_token(
    pending_root: &Path,
    install_token: &str,
) -> Result<(), PluginRegistryError> {
    let expected = install_token
        .rsplit_once('-')
        .map(|(_, digest)| digest)
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(invalid_token)?;
    if package_digest(pending_root)? == expected {
        Ok(())
    } else {
        Err(invalid_package(
            text::PLUGIN_PENDING_PACKAGE_CHANGED.to_string(),
        ))
    }
}

fn package_digest(root: &Path) -> Result<String, PluginRegistryError> {
    let mut files = Vec::new();
    collect_package_files(root, root, &mut files)?;
    files.sort();
    let mut hasher = Sha256::new();
    hasher.update(b"my-label-tool-plugin-package-v1");
    hasher.update((files.len() as u64).to_le_bytes());
    let mut buffer = [0_u8; 64 * 1024];
    for relative in files {
        let normalized = relative.to_string_lossy().replace('\\', "/");
        let path_bytes = normalized.as_bytes();
        hasher.update((path_bytes.len() as u64).to_le_bytes());
        hasher.update(path_bytes);
        let mut file = fs::File::open(root.join(&relative))
            .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
        let content_length = file
            .metadata()
            .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?
            .len();
        hasher.update(content_length.to_le_bytes());
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_package_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), PluginRegistryError> {
    let entries = fs::read_dir(directory)
        .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
        if metadata.file_type().is_symlink() {
            return Err(invalid_package(
                text::PLUGIN_PENDING_PACKAGE_CHANGED.to_string(),
            ));
        }
        if metadata.is_dir() {
            collect_package_files(root, &path, files)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| invalid_package(text::PLUGIN_PENDING_PACKAGE_CHANGED.to_string()))?;
            files.push(relative.to_path_buf());
        } else {
            return Err(invalid_package(
                text::PLUGIN_PENDING_PACKAGE_CHANGED.to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_archive_entry_size(
    size: u64,
    compressed_size: u64,
    current_total: u64,
) -> Result<u64, PluginRegistryError> {
    let next_total = current_total.saturating_add(size);
    if size > MAX_ARCHIVE_FILE_BYTES || next_total > MAX_ARCHIVE_TOTAL_BYTES {
        return Err(invalid_package(text::PLUGIN_ARCHIVE_TOO_LARGE.to_string()));
    }
    validate_compression_ratio(size, compressed_size)?;
    Ok(next_total)
}

fn validate_runtime(
    manifest: &PluginManifest,
    package_root: &Path,
    probe: &impl Fn(&PluginEntry, &Path) -> Result<(), String>,
    execute_package_entry: bool,
) -> Result<(), PluginRegistryError> {
    let Some(entry) = manifest.entry.as_ref() else {
        return Ok(());
    };
    let uses_system_python = matches!(entry.command.as_str(), "python" | "python3" | "py");
    if !uses_system_python && !package_root.join(&entry.command).is_file() {
        return Err(PluginRegistryError {
            code: "RUNTIME_UNAVAILABLE".to_string(),
            message: text::PLUGIN_ENTRY_MISSING.to_string(),
        });
    }
    if !execute_package_entry {
        return Ok(());
    }
    probe(entry, package_root).map_err(|_| PluginRegistryError {
        code: "RUNTIME_UNAVAILABLE".to_string(),
        message: if uses_system_python {
            text::PLUGIN_PYTHON_RUNTIME_MISSING.to_string()
        } else {
            text::PLUGIN_EXECUTABLE_RUNTIME_UNAVAILABLE.to_string()
        },
    })
}

fn probe_plugin_entry(entry: &PluginEntry, package_root: &Path) -> Result<(), String> {
    let executable = if matches!(entry.command.as_str(), "python" | "python3" | "py") {
        PathBuf::from(&entry.command)
    } else {
        let executable = package_root.join(&entry.command);
        validate_packaged_executable(&executable)?;
        executable
    };
    probe_plugin_process_available(&executable, &entry.args, package_root)
}

#[cfg(windows)]
fn validate_packaged_executable(path: &Path) -> Result<(), String> {
    use std::io::{Seek, SeekFrom};

    let mut file = fs::File::open(path).map_err(text::plugin_executable_inspection_failed)?;
    let mut dos_header = [0_u8; 64];
    file.read_exact(&mut dos_header)
        .map_err(text::plugin_executable_inspection_failed)?;
    if &dos_header[..2] != b"MZ" {
        return Err(text::PLUGIN_EXECUTABLE_FORMAT_INVALID.to_string());
    }
    let pe_offset = u32::from_le_bytes(
        dos_header[60..64]
            .try_into()
            .map_err(|_| text::PLUGIN_EXECUTABLE_FORMAT_INVALID.to_string())?,
    );
    file.seek(SeekFrom::Start(u64::from(pe_offset)))
        .map_err(text::plugin_executable_inspection_failed)?;
    let mut signature = [0_u8; 4];
    file.read_exact(&mut signature)
        .map_err(text::plugin_executable_inspection_failed)?;
    if signature == *b"PE\0\0" {
        Ok(())
    } else {
        Err(text::PLUGIN_EXECUTABLE_FORMAT_INVALID.to_string())
    }
}

#[cfg(not(windows))]
fn validate_packaged_executable(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(text::plugin_executable_inspection_failed)?;
    let mut signature = [0_u8; 4];
    let read = file
        .read(&mut signature)
        .map_err(text::plugin_executable_inspection_failed)?;
    if (read >= 4 && signature == *b"\x7fELF") || (read >= 2 && &signature[..2] == b"#!") {
        Ok(())
    } else {
        Err(text::PLUGIN_EXECUTABLE_FORMAT_INVALID.to_string())
    }
}

pub fn authorize_plugin_install(
    app_data_dir: &Path,
    install_token: &str,
    grants: Option<Vec<PluginPermissionGrant>>,
) -> Result<Option<PluginRegistryEntry>, PluginRegistryError> {
    authorize_plugin_install_for_project(app_data_dir, install_token, grants, Some(app_data_dir))
}

pub fn authorize_plugin_install_for_project(
    app_data_dir: &Path,
    install_token: &str,
    grants: Option<Vec<PluginPermissionGrant>>,
    project_dir: Option<&Path>,
) -> Result<Option<PluginRegistryEntry>, PluginRegistryError> {
    authorize_plugin_install_with_probe_for_project(
        app_data_dir,
        install_token,
        grants,
        project_dir,
        probe_plugin_entry,
    )
}

pub fn pending_plugin_install_id(
    app_data_dir: &Path,
    install_token: &str,
) -> Result<String, PluginRegistryError> {
    let pending_root = pending_install_root(app_data_dir, install_token)?;
    verify_bound_install_token(&pending_root, install_token)?;
    read_manifest(&pending_root.join("manifest.json")).map(|manifest| manifest.id)
}

#[cfg(test)]
fn authorize_plugin_install_with_probe(
    app_data_dir: &Path,
    install_token: &str,
    grants: Option<Vec<PluginPermissionGrant>>,
    probe: impl Fn(&PluginEntry, &Path) -> Result<(), String>,
) -> Result<Option<PluginRegistryEntry>, PluginRegistryError> {
    authorize_plugin_install_with_probe_for_project(
        app_data_dir,
        install_token,
        grants,
        Some(app_data_dir),
        probe,
    )
}

fn authorize_plugin_install_with_probe_for_project(
    app_data_dir: &Path,
    install_token: &str,
    grants: Option<Vec<PluginPermissionGrant>>,
    project_dir: Option<&Path>,
    probe: impl Fn(&PluginEntry, &Path) -> Result<(), String>,
) -> Result<Option<PluginRegistryEntry>, PluginRegistryError> {
    let pending_root = pending_install_root(app_data_dir, install_token)?;
    if !pending_root.is_dir() {
        return Err(invalid_token());
    }
    let Some(grants) = grants else {
        fs::remove_dir_all(&pending_root)
            .map_err(|error| internal_error(text::plugin_archive_extract_failed(error)))?;
        return Ok(None);
    };
    if let Err(error) = verify_bound_install_token(&pending_root, install_token) {
        let _ = fs::remove_dir_all(&pending_root);
        return Err(error);
    }
    match authorize_plugin_install_inner(
        app_data_dir,
        install_token,
        &pending_root,
        grants,
        project_dir,
        &probe,
    ) {
        Ok(entry) => Ok(Some(entry)),
        Err(error) => {
            let _ = fs::remove_dir_all(&pending_root);
            Err(error)
        }
    }
}

fn authorize_plugin_install_inner(
    app_data_dir: &Path,
    install_token: &str,
    pending_root: &Path,
    grants: Vec<PluginPermissionGrant>,
    project_dir: Option<&Path>,
    probe: &impl Fn(&PluginEntry, &Path) -> Result<(), String>,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    let manifest = read_manifest(&pending_root.join("manifest.json"))?;
    reject_code_plugin_in_safe_mode(app_data_dir, &manifest)?;
    negotiate_manifest(&manifest)?;
    let expected_grants = resolve_permission_grants_for_install(
        &manifest.permissions,
        &permission_roots(app_data_dir, project_dir),
    )
    .map_err(permission_registry_error)?;
    let expected = grants_to_set(&expected_grants)?;
    let actual = grants_to_set(&grants)?;
    if expected != actual {
        return Err(PluginRegistryError {
            code: "PERMISSION_DENIED".to_string(),
            message: text::PLUGIN_GRANTS_MISMATCH.to_string(),
        });
    }
    validate_runtime(&manifest, pending_root, probe, true)?;
    verify_bound_install_token(pending_root, install_token)?;

    let _registry_guard = registry_lock().lock().map_err(|_| registry_lock_error())?;
    let mut snapshot = load_plugin_registry_for_update(app_data_dir)?;
    let existing_index = snapshot
        .plugins
        .iter()
        .position(|plugin| plugin.id == manifest.id);
    let existing = existing_index.map(|index| snapshot.plugins[index].clone());
    let existing_requires_reauthorization = existing
        .as_ref()
        .is_some_and(|entry| PermissionPolicy::from_grants(&entry.grants).is_err());
    let persisted_grants = existing
        .as_ref()
        .filter(|entry| grants_to_set(&entry.grants).is_ok_and(|values| values == expected))
        .map_or(grants, |entry| entry.grants.clone());
    let now = timestamp();
    let state = existing.as_ref().map_or(PluginState::Enabled, |entry| {
        if entry.config_version != manifest.config_version
            || entry.state == PluginState::PendingMigration
        {
            PluginState::PendingMigration
        } else if existing_requires_reauthorization {
            PluginState::Enabled
        } else {
            entry.state
        }
    });
    let entry = PluginRegistryEntry {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        extension_kind: manifest.extension_kind.clone(),
        entry: manifest.entry.clone(),
        capabilities: manifest.capabilities.clone(),
        grants: persisted_grants,
        state,
        failure_count: if existing_requires_reauthorization {
            0
        } else {
            existing.as_ref().map_or(0, |entry| entry.failure_count)
        },
        last_error: if existing_requires_reauthorization {
            None
        } else {
            existing.as_ref().and_then(|entry| entry.last_error.clone())
        },
        config_version: manifest.config_version,
        timeout_ms: manifest.timeout_ms,
        installed_at: existing
            .as_ref()
            .map_or_else(|| now.clone(), |entry| entry.installed_at.clone()),
        updated_at: now,
    };
    if let Some(index) = existing_index {
        snapshot.plugins[index] = entry.clone();
    } else {
        snapshot.plugins.push(entry.clone());
    }
    snapshot
        .plugins
        .sort_by(|left, right| left.id.cmp(&right.id));

    let plugins_root = app_data_dir.join("plugins");
    let final_root = plugins_root.join(&manifest.id);
    let backup_root = plugins_root.join(format!(".backup-{install_token}"));
    let had_existing_package = final_root.is_dir();
    if had_existing_package {
        fs::rename(&final_root, &backup_root)
            .map_err(|error| internal_error(text::plugin_package_replace_failed(error)))?;
    }
    if let Err(error) = fs::rename(pending_root, &final_root) {
        if had_existing_package {
            let _ = fs::rename(&backup_root, &final_root);
        }
        let _ = fs::remove_dir_all(pending_root);
        return Err(internal_error(text::plugin_package_replace_failed(error)));
    }
    if let Err(error) = save_plugin_registry(app_data_dir, &snapshot.plugins) {
        let _ = fs::remove_dir_all(&final_root);
        if had_existing_package {
            let _ = fs::rename(&backup_root, &final_root);
        }
        return Err(error);
    }
    if had_existing_package {
        let _ = fs::remove_dir_all(backup_root);
    }
    Ok(entry)
}

pub fn load_plugin_registry(app_data_dir: &Path) -> PluginRegistrySnapshot {
    let Ok(_guard) = registry_lock().lock() else {
        return PluginRegistrySnapshot {
            plugins: Vec::new(),
            warning: Some(text::PLUGIN_REGISTRY_LOAD_WARNING.to_string()),
        };
    };
    load_plugin_registry_unlocked(app_data_dir)
}

fn load_plugin_registry_unlocked(app_data_dir: &Path) -> PluginRegistrySnapshot {
    let path = app_data_dir.join("plugin-registry.json");
    if !path.is_file() {
        return PluginRegistrySnapshot {
            plugins: Vec::new(),
            warning: None,
        };
    }
    match fs::File::open(path)
        .map_err(serde_json::Error::io)
        .and_then(serde_json::from_reader::<_, Vec<PluginRegistryEntry>>)
    {
        Ok(mut plugins) if registry_entries_are_valid(&plugins) => {
            for plugin in &mut plugins {
                if PermissionPolicy::from_grants(&plugin.grants).is_err() {
                    plugin.state = PluginState::Disabled;
                    plugin.failure_count = 0;
                    plugin.last_error =
                        Some(text::PLUGIN_PERMISSION_REAUTHORIZE_REQUIRED.to_string());
                }
            }
            plugins.sort_by(|left, right| left.id.cmp(&right.id));
            PluginRegistrySnapshot {
                plugins,
                warning: None,
            }
        }
        Ok(_) => {
            eprintln!("{}", text::PLUGIN_REGISTRY_SEMANTIC_INVALID);
            PluginRegistrySnapshot {
                plugins: Vec::new(),
                warning: Some(text::PLUGIN_REGISTRY_LOAD_WARNING.to_string()),
            }
        }
        Err(error) => {
            eprintln!("{}", text::plugin_registry_load_failed(error));
            PluginRegistrySnapshot {
                plugins: Vec::new(),
                warning: Some(text::PLUGIN_REGISTRY_LOAD_WARNING.to_string()),
            }
        }
    }
}

fn registry_entries_are_valid(plugins: &[PluginRegistryEntry]) -> bool {
    let mut ids = HashSet::new();
    plugins.iter().all(|plugin| {
        ids.insert(&plugin.id)
            && is_valid_plugin_id(&plugin.id)
            && !plugin.name.trim().is_empty()
            && is_valid_semver(&plugin.version)
            && plugin
                .entry
                .as_ref()
                .is_none_or(|entry| is_safe_relative_path(&entry.command))
            && matches!(
                (&plugin.extension_kind, &plugin.entry),
                (PluginExtensionKind::LabelPreset, None)
                    | (
                        PluginExtensionKind::Exporter | PluginExtensionKind::Prelabel,
                        Some(_)
                    )
            )
            && plugin.capabilities.exporter.api_version.min >= 1
            && plugin.capabilities.prelabel.api_version.min >= 1
            && (1..=MAX_PLUGIN_TIMEOUT_MS).contains(&plugin.timeout_ms)
            && registry_grants_are_valid(&plugin.grants)
    })
}

fn load_plugin_registry_for_update(
    app_data_dir: &Path,
) -> Result<PluginRegistrySnapshot, PluginRegistryError> {
    let snapshot = load_plugin_registry_unlocked(app_data_dir);
    if snapshot.warning.is_some() {
        Err(PluginRegistryError {
            code: "INTERNAL_ERROR".to_string(),
            message: text::PLUGIN_REGISTRY_CORRUPT_WRITE_BLOCKED.to_string(),
        })
    } else {
        Ok(snapshot)
    }
}

pub fn uninstall_registered_plugin(
    app_data_dir: &Path,
    plugin_id: &str,
) -> Result<(), PluginRegistryError> {
    uninstall_registered_plugin_with_remove(app_data_dir, plugin_id, |path| {
        fs::remove_dir_all(path)
    })
}

fn uninstall_registered_plugin_with_remove(
    app_data_dir: &Path,
    plugin_id: &str,
    remove: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<(), PluginRegistryError> {
    let _registry_guard = registry_lock().lock().map_err(|_| registry_lock_error())?;
    let mut snapshot = load_plugin_registry_for_update(app_data_dir)?;
    let original_plugins = snapshot.plugins.clone();
    let original_len = snapshot.plugins.len();
    snapshot.plugins.retain(|plugin| plugin.id != plugin_id);
    if snapshot.plugins.len() == original_len {
        return Err(not_found());
    }
    let package_root = app_data_dir.join("plugins").join(plugin_id);
    let staged_removal = app_data_dir
        .join("plugins")
        .join(format!(".uninstalling-{plugin_id}"));
    let had_package = package_root.is_dir();
    if had_package {
        if staged_removal.exists() {
            fs::remove_dir_all(&staged_removal)
                .map_err(|error| internal_error(text::plugin_package_replace_failed(error)))?;
        }
        fs::rename(&package_root, &staged_removal)
            .map_err(|error| internal_error(text::plugin_package_replace_failed(error)))?;
    }
    if let Err(error) = save_plugin_registry(app_data_dir, &snapshot.plugins) {
        if had_package {
            let _ = fs::rename(&staged_removal, &package_root);
        }
        return Err(error);
    }
    if had_package {
        if let Err(error) = remove(&staged_removal) {
            let registry_restored = save_plugin_registry(app_data_dir, &original_plugins).is_ok();
            let package_restored = fs::rename(&staged_removal, &package_root).is_ok();
            if !registry_restored || !package_restored {
                return Err(internal_error(text::plugin_uninstall_rollback_failed(
                    error,
                )));
            }
            return Err(internal_error(text::plugin_package_replace_failed(error)));
        }
    }
    Ok(())
}

pub fn set_registered_plugin_enabled(
    app_data_dir: &Path,
    plugin_id: &str,
    enabled: bool,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    update_registry_entry(app_data_dir, plugin_id, |entry| {
        if enabled && PermissionPolicy::from_grants(&entry.grants).is_err() {
            return Err(PluginRegistryError {
                code: "PERMISSION_DENIED".to_string(),
                message: text::PLUGIN_PERMISSION_REAUTHORIZE_REQUIRED.to_string(),
            });
        }
        if entry.state == PluginState::PendingMigration {
            return Err(PluginRegistryError {
                code: "CONFIG_MIGRATION_REQUIRED".to_string(),
                message: text::PLUGIN_CONFIG_MIGRATION_REQUIRED.to_string(),
            });
        }
        if enabled && entry.state == PluginState::AutoDisabled {
            return Err(PluginRegistryError {
                code: "INVALID_ARGUMENT".to_string(),
                message: text::PLUGIN_AUTO_DISABLED_REQUIRES_CLEAR.to_string(),
            });
        }
        entry.state = if enabled {
            PluginState::Enabled
        } else {
            PluginState::Disabled
        };
        entry.updated_at = timestamp();
        Ok(())
    })
}

pub fn clear_registered_plugin_failures(
    app_data_dir: &Path,
    plugin_id: &str,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    update_registry_entry(app_data_dir, plugin_id, |entry| {
        entry.failure_count = 0;
        entry.last_error = None;
        if entry.state == PluginState::AutoDisabled {
            entry.state = PluginState::Enabled;
        }
        entry.updated_at = timestamp();
        Ok(())
    })
}

pub fn record_plugin_runtime_success(
    app_data_dir: &Path,
    plugin_id: &str,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    update_registry_entry(app_data_dir, plugin_id, |entry| {
        entry.failure_count = 0;
        entry.last_error = None;
        entry.updated_at = timestamp();
        Ok(())
    })
}

pub fn record_plugin_runtime_failure(
    app_data_dir: &Path,
    plugin_id: &str,
    message: &str,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    update_registry_entry(app_data_dir, plugin_id, |entry| {
        entry.failure_count = entry.failure_count.saturating_add(1);
        entry.last_error = Some(message.to_string());
        if entry.failure_count >= 3 {
            entry.state = PluginState::AutoDisabled;
        }
        entry.updated_at = timestamp();
        Ok(())
    })
}

pub fn mark_plugin_pending_migration(
    app_data_dir: &Path,
    plugin_id: &str,
    message: &str,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    update_registry_entry(app_data_dir, plugin_id, |entry| {
        entry.state = PluginState::PendingMigration;
        entry.last_error = Some(message.to_string());
        entry.updated_at = timestamp();
        Ok(())
    })
}

pub fn complete_plugin_config_migration(
    app_data_dir: &Path,
    plugin_id: &str,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    update_registry_entry(app_data_dir, plugin_id, |entry| {
        if entry.state == PluginState::PendingMigration {
            entry.state = PluginState::Enabled;
        }
        entry.failure_count = 0;
        entry.last_error = None;
        entry.updated_at = timestamp();
        Ok(())
    })
}

pub fn get_registered_plugin(
    app_data_dir: &Path,
    plugin_id: &str,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    let _registry_guard = registry_lock().lock().map_err(|_| registry_lock_error())?;
    load_plugin_registry_for_update(app_data_dir)?
        .plugins
        .into_iter()
        .find(|plugin| plugin.id == plugin_id)
        .ok_or_else(not_found)
}

fn update_registry_entry(
    app_data_dir: &Path,
    plugin_id: &str,
    update: impl FnOnce(&mut PluginRegistryEntry) -> Result<(), PluginRegistryError>,
) -> Result<PluginRegistryEntry, PluginRegistryError> {
    let _registry_guard = registry_lock().lock().map_err(|_| registry_lock_error())?;
    let mut snapshot = load_plugin_registry_for_update(app_data_dir)?;
    let entry = snapshot
        .plugins
        .iter_mut()
        .find(|plugin| plugin.id == plugin_id)
        .ok_or_else(not_found)?;
    update(entry)?;
    let updated = entry.clone();
    save_plugin_registry(app_data_dir, &snapshot.plugins)?;
    Ok(updated)
}

const fn default_plugin_timeout_ms() -> u32 {
    DEFAULT_PLUGIN_TIMEOUT_MS
}

fn registry_lock() -> &'static Mutex<()> {
    REGISTRY_LOCK.get_or_init(|| Mutex::new(()))
}

fn registry_lock_error() -> PluginRegistryError {
    internal_error(text::PLUGIN_REGISTRY_LOCK_POISONED.to_string())
}

fn save_plugin_registry(
    app_data_dir: &Path,
    plugins: &[PluginRegistryEntry],
) -> Result<(), PluginRegistryError> {
    fs::create_dir_all(app_data_dir)
        .map_err(|error| internal_error(text::plugin_registry_write_failed(error)))?;
    let path = app_data_dir.join("plugin-registry.json");
    let temporary = app_data_dir.join("plugin-registry.json.tmp");
    let mut file = fs::File::create(&temporary)
        .map_err(|error| internal_error(text::plugin_registry_write_failed(error)))?;
    serde_json::to_writer_pretty(&mut file, plugins)
        .map_err(|error| internal_error(text::plugin_registry_write_failed(error)))?;
    file.flush()
        .map_err(|error| internal_error(text::plugin_registry_write_failed(error)))?;
    let backup = app_data_dir.join("plugin-registry.json.bak");
    let had_existing = path.is_file();
    if had_existing {
        if backup.exists() {
            fs::remove_file(&backup)
                .map_err(|error| internal_error(text::plugin_registry_write_failed(error)))?;
        }
        fs::rename(&path, &backup)
            .map_err(|error| internal_error(text::plugin_registry_write_failed(error)))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if had_existing {
            let _ = fs::rename(&backup, &path);
        }
        return Err(internal_error(text::plugin_registry_write_failed(error)));
    }
    if had_existing {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn read_manifest(path: &Path) -> Result<PluginManifest, PluginRegistryError> {
    let value: serde_json::Value = serde_json::from_reader(
        fs::File::open(path)
            .map_err(|error| invalid_package(text::plugin_archive_open_failed(error)))?,
    )
    .map_err(|error| invalid_package(text::plugin_archive_read_failed(error)))?;
    let parsed = parse_plugin_manifest(&value);
    parsed.value.ok_or_else(|| {
        let reasons = parsed
            .errors
            .iter()
            .map(|error| format!("{}: {}", error.field, error.reason))
            .collect::<Vec<_>>()
            .join("；");
        invalid_package(text::plugin_manifest_invalid(&reasons))
    })
}

fn grants_to_set(grants: &[PluginPermissionGrant]) -> Result<HashSet<String>, PluginRegistryError> {
    PermissionPolicy::from_grants(grants).map_err(permission_registry_error)?;
    let mut result = HashSet::new();
    for grant in grants {
        let value = match (&grant.permission[..], grant.target.as_deref()) {
            ("network", None) => "network".to_string(),
            ("fs.read" | "fs.write", Some(target)) => {
                format!("{}:{target}", grant.permission)
            }
            _ => {
                return Err(PluginRegistryError {
                    code: "PERMISSION_DENIED".to_string(),
                    message: text::PLUGIN_GRANTS_MISMATCH.to_string(),
                })
            }
        };
        if !result.insert(value) {
            return Err(PluginRegistryError {
                code: "PERMISSION_DENIED".to_string(),
                message: text::PLUGIN_GRANTS_MISMATCH.to_string(),
            });
        }
    }
    Ok(result)
}

fn registry_grants_are_valid(grants: &[PluginPermissionGrant]) -> bool {
    if PermissionPolicy::from_grants(grants).is_ok() {
        return true;
    }
    let mut seen = HashSet::new();
    grants.iter().all(|grant| {
        let value = match (grant.permission.as_str(), grant.target.as_deref()) {
            ("network", None) => "network".to_string(),
            ("fs.read" | "fs.write", Some(target)) if is_valid_permission_target(target) => {
                format!("{}:{}", grant.permission, target.replace('\\', "/"))
            }
            _ => return false,
        };
        seen.insert(value)
    })
}

fn permission_roots(app_data_dir: &Path, project_dir: Option<&Path>) -> PermissionRoots {
    PermissionRoots {
        project: project_dir.map(Path::to_path_buf),
        models: app_data_dir.join("models"),
        app_data: app_data_dir.to_path_buf(),
    }
}

fn permission_registry_error(error: super::permissions::PermissionError) -> PluginRegistryError {
    PluginRegistryError {
        code: "PERMISSION_DENIED".to_string(),
        message: error.message,
    }
}

fn pending_install_root(
    app_data_dir: &Path,
    install_token: &str,
) -> Result<PathBuf, PluginRegistryError> {
    if install_token.is_empty()
        || !install_token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(invalid_token());
    }
    Ok(app_data_dir
        .join("plugins")
        .join(".pending")
        .join(install_token))
}

fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
        .to_string()
}

fn invalid_token() -> PluginRegistryError {
    PluginRegistryError {
        code: "INVALID_ARGUMENT".to_string(),
        message: text::PLUGIN_INSTALL_TOKEN_INVALID.to_string(),
    }
}

fn not_found() -> PluginRegistryError {
    PluginRegistryError {
        code: "METHOD_NOT_FOUND".to_string(),
        message: text::PLUGIN_NOT_FOUND.to_string(),
    }
}

fn next_install_token() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        INSTALL_TOKEN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn internal_error(message: String) -> PluginRegistryError {
    PluginRegistryError {
        code: "INTERNAL_ERROR".to_string(),
        message,
    }
}

fn invalid_package(message: String) -> PluginRegistryError {
    PluginRegistryError {
        code: "INVALID_ARGUMENT".to_string(),
        message,
    }
}

pub fn negotiate_manifest(manifest: &PluginManifest) -> Result<(), PluginRegistryError> {
    require_supported_version(
        "host API",
        manifest.api_version.min,
        SUPPORTED_HOST_API_VERSIONS,
    )?;
    match manifest.extension_kind {
        PluginExtensionKind::LabelPreset => Ok(()),
        PluginExtensionKind::Exporter => require_supported_version(
            "exporter",
            manifest.capabilities.exporter.api_version.min,
            SUPPORTED_EXPORTER_API_VERSIONS,
        ),
        PluginExtensionKind::Prelabel => require_supported_version(
            "prelabel",
            manifest.capabilities.prelabel.api_version.min,
            SUPPORTED_PRELABEL_API_VERSIONS,
        ),
    }
}

fn require_supported_version(
    scope: &str,
    required: u32,
    supported: &[u32],
) -> Result<(), PluginRegistryError> {
    if supported.contains(&required) {
        return Ok(());
    }
    Err(PluginRegistryError {
        code: "API_VERSION_UNSUPPORTED".to_string(),
        message: text::plugin_api_version_unsupported(scope, required, supported),
    })
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
