use super::*;
use crate::plugins::manifest::parse_plugin_manifest;
use crate::plugins::runtime::{save_plugin_runtime_settings, PluginRuntimeSettings};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use zip::write::SimpleFileOptions;

#[test]
fn negotiates_supported_overall_and_exporter_versions() {
    assert_eq!(negotiate_manifest(&code_manifest("exporter", 1, 1)), Ok(()));
}

#[test]
fn rejects_an_unsupported_business_capability_version_with_actionable_context() {
    let error = negotiate_manifest(&code_manifest("prelabel", 1, 2)).unwrap_err();
    assert_eq!(error.code, "API_VERSION_UNSUPPORTED");
    assert!(error.message.contains("prelabel v2"));
    assert!(error.message.contains("宿主支持 v1"));
    assert!(error.message.contains("升级插件"));
}

#[test]
fn prepares_authorizes_and_persists_a_valid_archive() {
    let root = temp_dir("authorize");
    let archive = write_manifest_archive(&root, "example.bundle", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare install");
    assert_eq!(preview.manifest.id, "dev.acme.labels");
    assert!(preview.warning.contains("未验证作者"));

    let entry = authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
        .expect("authorize")
        .expect("registered entry");

    assert_eq!(entry.state, PluginState::Enabled);
    assert!(root.join("plugins/dev.acme.labels/manifest.json").is_file());
    assert!(!root
        .join("plugins/.pending")
        .join(preview.install_token)
        .exists());
    let loaded = load_plugin_registry(&root);
    assert_eq!(loaded.warning, None);
    assert_eq!(loaded.plugins, vec![entry]);
    cleanup(root);
}

#[test]
fn permission_preview_and_registry_store_resolved_absolute_targets() {
    let root = temp_dir("resolved-permission-preview");
    let project = root.join("current-project");
    fs::create_dir_all(&project).expect("create project");
    let archive = write_manifest_archive(&root, "plugin.zip", label_manifest(0));

    let preview = prepare_plugin_install_for_project(&root, &archive, Some(&project))
        .expect("prepare with project context");
    assert_eq!(
        preview.permissions,
        vec![PluginPermissionGrant {
            permission: "fs.read".to_string(),
            target: Some(
                fs::canonicalize(&project)
                    .expect("canonical project")
                    .join("images")
                    .to_string_lossy()
                    .into_owned(),
            ),
        }]
    );
    let entry = authorize_plugin_install_for_project(
        &root,
        &preview.install_token,
        Some(preview.permissions.clone()),
        Some(&project),
    )
    .expect("authorize resolved grant")
    .expect("registered plugin");
    assert_eq!(entry.grants, preview.permissions);

    let archive = write_manifest_archive(&root, "missing-project.zip", label_manifest(0));
    let error = prepare_plugin_install_for_project(&root, &archive, None)
        .expect_err("project placeholder must require an open project");
    assert_eq!(error.code, "PERMISSION_DENIED");
    cleanup(root);
}

#[test]
fn registry_entries_without_timeout_use_the_backward_compatible_default() {
    let root = temp_dir("registry-timeout-default");
    let archive = write_manifest_archive(&root, "labels.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare install");
    authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
        .expect("authorize")
        .expect("registered entry");
    let registry_path = root.join("plugin-registry.json");
    let mut registry: Value =
        serde_json::from_reader(fs::File::open(&registry_path).expect("open registry"))
            .expect("parse registry");
    registry[0]
        .as_object_mut()
        .expect("registry entry")
        .remove("timeoutMs");
    serde_json::to_writer_pretty(
        fs::File::create(&registry_path).expect("replace registry"),
        &registry,
    )
    .expect("write legacy registry");

    let loaded = load_plugin_registry(&root);
    assert_eq!(loaded.warning, None);
    assert_eq!(loaded.plugins[0].timeout_ms, DEFAULT_PLUGIN_TIMEOUT_MS);
    cleanup(root);
}

#[test]
fn legacy_placeholder_grants_load_disabled_and_require_reauthorization() {
    let root = installed_registry("legacy-placeholder-grant");
    let registry_path = root.join("plugin-registry.json");
    let mut registry: Value =
        serde_json::from_str(&fs::read_to_string(&registry_path).expect("registry fixture"))
            .expect("registry JSON");
    registry[0]["grants"] = json!([{
        "permission": "fs.read",
        "target": "%PROJECT%/images"
    }]);
    fs::write(
        &registry_path,
        serde_json::to_string_pretty(&registry).expect("legacy registry"),
    )
    .expect("write legacy registry");

    let snapshot = load_plugin_registry(&root);
    assert_eq!(snapshot.plugins.len(), 1);
    assert_eq!(snapshot.warning, None);
    assert_eq!(snapshot.plugins[0].state, PluginState::Disabled);
    assert_eq!(snapshot.plugins[0].failure_count, 0);
    assert_eq!(
        snapshot.plugins[0].last_error.as_deref(),
        Some(text::PLUGIN_PERMISSION_REAUTHORIZE_REQUIRED)
    );
    assert!(PermissionPolicy::from_grants(&snapshot.plugins[0].grants).is_err());
    let error = set_registered_plugin_enabled(&root, &snapshot.plugins[0].id, true)
        .expect_err("legacy grant cannot be enabled without reauthorization");
    assert_eq!(error.code, "PERMISSION_DENIED");

    let archive = write_manifest_archive(&root, "reauthorize.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare reauthorization");
    let updated =
        authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
            .expect("authorize replacement")
            .expect("updated plugin");
    assert_eq!(updated.state, PluginState::Enabled);
    assert_eq!(updated.failure_count, 0);
    assert_eq!(updated.last_error, None);
    assert!(PermissionPolicy::from_grants(&updated.grants).is_ok());
    cleanup(root);
}

#[test]
fn concurrent_runtime_failures_preserve_updates_for_every_plugin() {
    let root = temp_dir("registry-concurrent-failures");
    for (archive_name, plugin_id) in [
        ("first.zip", "dev.acme.first"),
        ("second.zip", "dev.acme.second"),
    ] {
        let mut manifest = label_manifest(0);
        manifest["id"] = json!(plugin_id);
        let archive = write_manifest_archive(&root, archive_name, manifest);
        let preview = prepare_plugin_install(&root, &archive).expect("prepare plugin");
        authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
            .expect("authorize plugin")
            .expect("registered plugin");
    }
    let root = Arc::new(root);
    let tasks = ["dev.acme.first", "dev.acme.second"]
        .into_iter()
        .map(|plugin_id| {
            let root = Arc::clone(&root);
            std::thread::spawn(move || {
                for failure in 0..3 {
                    record_plugin_runtime_failure(&root, plugin_id, &format!("failure-{failure}"))
                        .expect("record failure");
                }
            })
        })
        .collect::<Vec<_>>();
    for task in tasks {
        task.join().expect("join registry writer");
    }
    let snapshot = load_plugin_registry(&root);
    assert_eq!(snapshot.plugins.len(), 2);
    assert!(snapshot
        .plugins
        .iter()
        .all(|plugin| plugin.failure_count == 3 && plugin.state == PluginState::AutoDisabled));
    cleanup(Arc::into_inner(root).expect("release fixture root"));
}

#[test]
fn prepares_authorizes_and_enables_a_python_plugin() {
    let root = temp_dir("python-authorize");
    let manifest = serde_json::to_vec(&python_manifest()).expect("manifest JSON");
    let archive = write_entries(
        &root,
        "python.plugin",
        &[("manifest.json", &manifest), ("main.py", b"print('ok')")],
    );
    let preview = prepare_plugin_install_with_probe(&root, &archive, |_, _| Ok(()))
        .expect("prepare Python plugin");
    let entry = authorize_plugin_install_with_probe(
        &root,
        &preview.install_token,
        Some(preview.permissions),
        |_, _| Ok(()),
    )
    .expect("authorize Python plugin")
    .expect("registered Python plugin");

    assert_eq!(entry.state, PluginState::Enabled);
    assert_eq!(entry.id, "dev.acme.python");
    assert!(root.join("plugins/dev.acme.python/main.py").is_file());
    cleanup(root);
}

#[test]
fn safe_mode_rejects_code_plugins_but_keeps_label_presets_available() {
    let root = temp_dir("safe-mode-install");
    save_plugin_runtime_settings(&root, PluginRuntimeSettings { safe_mode: true })
        .expect("enable safe mode");
    let manifest = serde_json::to_vec(&python_manifest()).expect("manifest JSON");
    let code_archive = write_entries(
        &root,
        "python.plugin",
        &[("manifest.json", &manifest), ("main.py", b"print('ok')")],
    );
    let error = prepare_plugin_install_with_probe(&root, &code_archive, |_, _| Ok(()))
        .expect_err("safe mode must reject code plugin");
    assert_eq!(error.code, "SAFE_MODE");
    assert_pending_empty(&root);

    let label_archive = write_manifest_archive(&root, "labels.zip", label_manifest(0));
    prepare_plugin_install(&root, &label_archive).expect("label preset remains installable");
    cleanup(root);
}

#[test]
fn enabling_safe_mode_after_preview_blocks_authorization() {
    let root = temp_dir("safe-mode-authorize");
    let manifest = serde_json::to_vec(&python_manifest()).expect("manifest JSON");
    let archive = write_entries(
        &root,
        "python.plugin",
        &[("manifest.json", &manifest), ("main.py", b"print('ok')")],
    );
    let preview = prepare_plugin_install_with_probe(&root, &archive, |_, _| Ok(()))
        .expect("prepare code plugin");
    save_plugin_runtime_settings(&root, PluginRuntimeSettings { safe_mode: true })
        .expect("enable safe mode");
    let error = authorize_plugin_install_with_probe(
        &root,
        &preview.install_token,
        Some(preview.permissions),
        |_, _| panic!("safe mode must block before process probe"),
    )
    .expect_err("safe mode must block authorization");
    assert_eq!(error.code, "SAFE_MODE");
    assert_pending_empty(&root);
    cleanup(root);
}

#[test]
fn cancelling_authorization_removes_the_pending_package() {
    let root = temp_dir("cancel");
    let archive = write_manifest_archive(&root, "cancel.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare install");
    let pending = root.join("plugins/.pending").join(&preview.install_token);

    assert_eq!(
        authorize_plugin_install(&root, &preview.install_token, None).expect("cancel"),
        None
    );
    assert!(!pending.exists());
    assert!(load_plugin_registry(&root).plugins.is_empty());
    cleanup(root);
}

#[test]
fn mismatched_grants_fail_without_leaving_an_unregistered_package() {
    let root = temp_dir("grants");
    let archive = write_manifest_archive(&root, "grants.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare install");

    let error =
        authorize_plugin_install(&root, &preview.install_token, Some(Vec::new())).unwrap_err();

    assert_eq!(error.code, "PERMISSION_DENIED");
    assert!(!root
        .join("plugins/.pending")
        .join(preview.install_token)
        .exists());
    assert!(!root.join("plugins/dev.acme.labels").exists());
    cleanup(root);
}

#[test]
fn mismatched_code_plugin_grants_never_execute_the_runtime_probe() {
    let root = temp_dir("code-grants-before-probe");
    let manifest = serde_json::to_vec(&python_manifest()).expect("manifest JSON");
    let archive = write_entries(
        &root,
        "python.plugin",
        &[("manifest.json", &manifest), ("main.py", b"print('ok')")],
    );
    let preview = prepare_plugin_install_with_probe(&root, &archive, |_, _| {
        panic!("runtime probe must wait for authorization")
    })
    .expect("prepare Python plugin");
    let error = authorize_plugin_install_with_probe(
        &root,
        &preview.install_token,
        Some(vec![PluginPermissionGrant {
            permission: "network".to_string(),
            target: None,
        }]),
        |_, _| panic!("mismatched grants must be rejected before runtime probe"),
    )
    .unwrap_err();

    assert_eq!(error.code, "PERMISSION_DENIED");
    assert_pending_empty(&root);
    cleanup(root);
}

#[test]
fn authorization_rejects_a_changed_pending_package_and_cleans_it() {
    let root = temp_dir("authorize-revalidate");
    let archive = write_manifest_archive(&root, "plugin.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare install");
    let pending = root.join("plugins/.pending").join(&preview.install_token);
    let mut changed = label_manifest(0);
    changed["id"] = json!("dev.acme.replaced");
    fs::write(
        pending.join("manifest.json"),
        serde_json::to_vec(&changed).expect("changed manifest"),
    )
    .expect("replace pending manifest");

    let error = authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
        .unwrap_err();
    assert_eq!(error.code, "INVALID_ARGUMENT");
    assert!(error.message.contains("发生变化"));
    assert!(!pending.exists());
    assert!(load_plugin_registry(&root).plugins.is_empty());
    cleanup(root);
}

#[test]
fn update_preserves_install_time_and_marks_changed_config_for_migration() {
    let root = temp_dir("update");
    let first = write_manifest_archive(&root, "v1.zip", label_manifest(1));
    let preview = prepare_plugin_install(&root, &first).expect("prepare v1");
    let original =
        authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
            .expect("authorize v1")
            .expect("entry v1");
    let second = write_manifest_archive(&root, "v2.zip", {
        let mut value = label_manifest(2);
        value["version"] = json!("2.0.0");
        value
    });
    let preview = prepare_plugin_install(&root, &second).expect("prepare update");
    assert!(preview.is_update);
    let updated =
        authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
            .expect("authorize update")
            .expect("updated entry");

    assert_eq!(updated.version, "2.0.0");
    assert_eq!(updated.installed_at, original.installed_at);
    assert_eq!(updated.grants, original.grants);
    assert_eq!(updated.state, PluginState::PendingMigration);
    assert_eq!(
        set_registered_plugin_enabled(&root, "dev.acme.labels", true)
            .unwrap_err()
            .code,
        "CONFIG_MIGRATION_REQUIRED"
    );
    assert_eq!(
        clear_registered_plugin_failures(&root, "dev.acme.labels")
            .expect("clear failures without bypass")
            .state,
        PluginState::PendingMigration
    );
    let repeated = write_manifest_archive(&root, "v2-repeat.zip", {
        let mut value = label_manifest(2);
        value["version"] = json!("2.0.0");
        value
    });
    let preview = prepare_plugin_install(&root, &repeated).expect("prepare repeated update");
    let repeated_update =
        authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
            .expect("authorize repeated update")
            .expect("repeated updated entry");
    assert_eq!(repeated_update.state, PluginState::PendingMigration);
    assert_eq!(load_plugin_registry(&root).plugins.len(), 1);
    cleanup(root);
}

#[test]
fn unloadable_registry_does_not_block_startup() {
    let root = temp_dir("corrupt-registry");
    fs::write(root.join("plugin-registry.json"), "not-json").expect("registry fixture");
    let snapshot = load_plugin_registry(&root);
    assert!(snapshot.plugins.is_empty());
    assert!(snapshot.warning.expect("warning").contains("损坏"));
    let archive = write_manifest_archive(&root, "plugin.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare remains available");
    let error = authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
        .unwrap_err();
    assert_eq!(error.code, "INTERNAL_ERROR");
    assert_eq!(
        fs::read_to_string(root.join("plugin-registry.json")).expect("corrupt registry retained"),
        "not-json"
    );
    assert_pending_empty(&root);
    cleanup(root);
}

#[test]
fn semantically_invalid_registry_is_protected_from_path_and_grant_use() {
    let root = installed_registry("semantic-registry");
    let registry_path = root.join("plugin-registry.json");
    let mut registry: Value =
        serde_json::from_str(&fs::read_to_string(&registry_path).expect("registry fixture"))
            .expect("registry JSON");
    registry[0]["id"] = json!("../../outside");
    registry[0]["grants"] = json!([{
        "permission": "fs.read",
        "target": "../../outside"
    }]);
    let damaged = serde_json::to_string_pretty(&registry).expect("damaged registry");
    fs::write(&registry_path, &damaged).expect("write damaged registry");

    let snapshot = load_plugin_registry(&root);
    assert!(snapshot.plugins.is_empty());
    assert!(snapshot.warning.is_some());
    let error = uninstall_registered_plugin(&root, "../../outside").unwrap_err();
    assert_eq!(error.code, "INTERNAL_ERROR");
    assert_eq!(
        fs::read_to_string(registry_path).expect("registry retained"),
        damaged
    );
    cleanup(root);
}

#[test]
fn independent_executable_must_pass_the_shared_runtime_probe() {
    let root = temp_dir("executable-probe");
    let mut manifest =
        serde_json::to_value(code_manifest("exporter", 1, 1)).expect("manifest JSON value");
    manifest["entry"] = json!({ "command": "plugin.exe" });
    let manifest = serde_json::to_vec(&manifest).expect("manifest JSON");
    let archive = write_entries(
        &root,
        "broken-executable.zip",
        &[("manifest.json", &manifest), ("plugin.exe", b"broken")],
    );
    let preview = prepare_plugin_install_with_probe(&root, &archive, |_, _| {
        panic!("package entry must not execute before authorization")
    })
    .expect("static executable validation");
    let error = authorize_plugin_install_with_probe(
        &root,
        &preview.install_token,
        Some(preview.permissions),
        |_, _| Err("cannot execute".to_string()),
    )
    .unwrap_err();
    assert_eq!(error.code, "RUNTIME_UNAVAILABLE");
    assert!(error.message.contains("无法启动"));
    assert_pending_empty(&root);
    cleanup(root);
}

#[test]
fn packaged_executable_is_checked_without_running_an_undeclared_argument() {
    let root = temp_dir("executable-format");
    let executable = root.join(if cfg!(windows) {
        "plugin.exe"
    } else {
        "plugin"
    });
    fs::write(&executable, b"broken").expect("broken executable");
    assert!(validate_packaged_executable(&executable).is_err());

    fs::write(&executable, executable_fixture_bytes()).expect("valid executable header");
    assert_eq!(validate_packaged_executable(&executable), Ok(()));
    cleanup(root);
}

#[test]
fn executable_probe_cannot_modify_the_package_that_is_published() {
    let root = temp_dir("executable-mutates-package");
    let mut manifest =
        serde_json::to_value(code_manifest("exporter", 1, 1)).expect("manifest JSON value");
    manifest["entry"] = json!({ "command": "plugin.exe" });
    let manifest = serde_json::to_vec(&manifest).expect("manifest JSON");
    let archive = write_entries(
        &root,
        "mutating-executable.zip",
        &[("manifest.json", &manifest), ("plugin.exe", b"original")],
    );
    let preview = prepare_plugin_install_with_probe(&root, &archive, |_, _| Ok(()))
        .expect("prepare executable plugin");
    let error = authorize_plugin_install_with_probe(
        &root,
        &preview.install_token,
        Some(preview.permissions),
        |entry, package_root| {
            fs::write(package_root.join(&entry.command), "mutated")
                .expect("mutate package during probe");
            Ok(())
        },
    )
    .unwrap_err();

    assert_eq!(error.code, "INVALID_ARGUMENT");
    assert!(error.message.contains("发生变化"));
    assert_pending_empty(&root);
    assert!(!root.join("plugins/dev.acme.exporter").exists());
    cleanup(root);
}

#[test]
fn uninstall_removes_only_package_and_registry_entry() {
    let root = temp_dir("uninstall");
    fs::write(root.join("project.json"), "keep").expect("project fixture");
    let archive = write_manifest_archive(&root, "plugin.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare");
    authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
        .expect("authorize");

    uninstall_registered_plugin(&root, "dev.acme.labels").expect("uninstall");

    assert!(!root.join("plugins/dev.acme.labels").exists());
    assert!(root.join("project.json").is_file());
    assert!(load_plugin_registry(&root).plugins.is_empty());
    cleanup(root);
}

#[test]
fn uninstall_cleanup_failure_restores_package_and_registry() {
    let root = installed_registry("uninstall-rollback");
    let error = uninstall_registered_plugin_with_remove(&root, "dev.acme.labels", |_| {
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "locked fixture",
        ))
    })
    .unwrap_err();

    assert_eq!(error.code, "INTERNAL_ERROR");
    assert!(root.join("plugins/dev.acme.labels").is_dir());
    assert_eq!(load_plugin_registry(&root).plugins.len(), 1);
    cleanup(root);
}

#[test]
fn enable_disable_status_and_failure_clear_round_trip() {
    let root = installed_registry("states");
    let disabled = set_registered_plugin_enabled(&root, "dev.acme.labels", false).expect("disable");
    assert_eq!(disabled.state, PluginState::Disabled);
    let enabled = set_registered_plugin_enabled(&root, "dev.acme.labels", true).expect("enable");
    assert_eq!(enabled.state, PluginState::Enabled);
    let mut plugins = load_plugin_registry(&root).plugins;
    plugins[0].state = PluginState::AutoDisabled;
    plugins[0].failure_count = 3;
    plugins[0].last_error = Some("boom".to_string());
    save_plugin_registry(&root, &plugins).expect("save auto-disabled");
    assert!(set_registered_plugin_enabled(&root, "dev.acme.labels", true).is_err());
    let cleared = clear_registered_plugin_failures(&root, "dev.acme.labels").expect("clear");
    assert_eq!(cleared.failure_count, 0);
    assert_eq!(cleared.last_error, None);
    assert_eq!(cleared.state, PluginState::Enabled);
    assert_eq!(
        get_registered_plugin(&root, "dev.acme.labels").expect("status"),
        cleared
    );
    cleanup(root);
}

#[test]
fn pending_migration_state_can_be_persisted_and_completed() {
    let root = installed_registry("migration-state");

    let pending = mark_plugin_pending_migration(&root, "dev.acme.labels", "migration failed")
        .expect("mark pending");
    assert_eq!(pending.state, PluginState::PendingMigration);
    assert_eq!(pending.last_error.as_deref(), Some("migration failed"));
    assert!(set_registered_plugin_enabled(&root, "dev.acme.labels", true).is_err());

    let completed =
        complete_plugin_config_migration(&root, "dev.acme.labels").expect("complete migration");
    assert_eq!(completed.state, PluginState::Enabled);
    assert_eq!(completed.failure_count, 0);
    assert_eq!(completed.last_error, None);
    assert_eq!(load_plugin_registry(&root).plugins, vec![completed]);
    cleanup(root);
}

#[test]
fn five_install_failures_are_actionable_repeatable_and_clean() {
    let root = temp_dir("failures");
    let corrupt = root.join("corrupt.zip");
    fs::write(&corrupt, "broken").expect("corrupt fixture");
    assert_install_failure_cleans(&root, &corrupt, "INVALID_ARGUMENT");

    let missing = write_entries(&root, "missing.zip", &[("readme.txt", b"x")]);
    assert_install_failure_cleans(&root, &missing, "INVALID_ARGUMENT");

    let invalid = write_manifest_archive(&root, "invalid.zip", json!({ "schemaVersion": 1 }));
    assert_install_failure_cleans(&root, &invalid, "INVALID_ARGUMENT");

    let incompatible = write_manifest_archive(&root, "incompatible.zip", {
        let mut value = label_manifest(0);
        value["apiVersion"] = json!({ "min": 2 });
        value
    });
    assert_install_failure_cleans(&root, &incompatible, "API_VERSION_UNSUPPORTED");

    let python = write_manifest_archive(&root, "python.zip", python_manifest());
    for _ in 0..2 {
        let preview = prepare_plugin_install_with_probe(&root, &python, |_, _| {
            panic!("runtime probe must wait for authorization")
        })
        .expect("static Python package validation");
        let error = authorize_plugin_install_with_probe(
            &root,
            &preview.install_token,
            Some(preview.permissions),
            |_, _| Err("missing".to_string()),
        )
        .unwrap_err();
        assert_eq!(error.code, "RUNTIME_UNAVAILABLE");
        assert!(error.message.contains("Python 3"));
        assert_pending_empty(&root);
    }
    cleanup(root);
}

#[test]
fn path_traversal_and_symlink_entries_are_rejected() {
    let root = temp_dir("unsafe");
    let traversal = write_entries(&root, "traversal.zip", &[("../evil.txt", b"bad")]);
    assert_install_failure_cleans(&root, &traversal, "INVALID_ARGUMENT");

    let archive = root.join("symlink.zip");
    let mut writer = zip::ZipWriter::new(fs::File::create(&archive).expect("archive"));
    writer
        .add_symlink("link", "../outside", SimpleFileOptions::default())
        .expect("symlink entry");
    writer.finish().expect("finish symlink archive");
    assert_install_failure_cleans(&root, &archive, "INVALID_ARGUMENT");
    cleanup(root);
}

#[test]
fn archive_size_and_compression_guards_enforce_exact_limits() {
    assert_eq!(
        validate_archive_entry_size(MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_FILE_BYTES, 0)
            .expect("single-file boundary"),
        MAX_ARCHIVE_FILE_BYTES
    );
    assert!(validate_archive_entry_size(MAX_ARCHIVE_FILE_BYTES + 1, 1, 0).is_err());
    assert!(validate_archive_entry_size(1, 1, MAX_ARCHIVE_TOTAL_BYTES).is_err());
    let ratio_error = validate_archive_entry_size(1_001, 1, 0).unwrap_err();
    assert!(ratio_error.message.contains("压缩比"));
    assert!(validate_archive_entry_size(1, 0, 0).is_err());
    assert_eq!(
        validate_extracted_bytes(MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_FILE_BYTES, 0)
            .expect("actual file boundary"),
        MAX_ARCHIVE_FILE_BYTES
    );
    assert!(validate_extracted_bytes(MAX_ARCHIVE_FILE_BYTES + 1, 1, 0).is_err());
    assert!(validate_extracted_bytes(1, 1, MAX_ARCHIVE_TOTAL_BYTES).is_err());
    assert!(validate_extracted_bytes(1_001, 1, 0).is_err());
    assert_eq!(
        validate_extracted_bytes(1_000, 1, 0).expect("actual ratio boundary"),
        1_000
    );
}

#[test]
fn package_digest_has_unambiguous_file_and_content_boundaries() {
    let two_files = temp_dir("digest-two-files");
    fs::write(two_files.join("z1"), b"X").expect("first file");
    fs::write(two_files.join("z2"), b"Y").expect("second file");
    let one_file = temp_dir("digest-one-file");
    fs::write(one_file.join("z1"), [b'X', u8::MAX, b'z', b'2', 0, b'Y'])
        .expect("ambiguous legacy payload");

    assert_ne!(
        package_digest(&two_files).expect("two-file digest"),
        package_digest(&one_file).expect("one-file digest")
    );
    cleanup(two_files);
    cleanup(one_file);
}

fn code_manifest(extension_kind: &str, overall: u32, capability: u32) -> PluginManifest {
    let capability_name = if extension_kind == "exporter" {
        "exporter"
    } else {
        "prelabel"
    };
    let annotation_types = if extension_kind == "prelabel" {
        json!(["rect"])
    } else {
        json!([])
    };
    parse_plugin_manifest(&json!({
        "schemaVersion": 1,
        "id": format!("dev.acme.{extension_kind}"),
        "name": "插件",
        "version": "1.0.0",
        "apiVersion": { "min": overall },
        "extensionKind": extension_kind,
        "runtime": "process",
        "entry": { "command": "plugin/main.exe" },
        "capabilities": {
            "annotationTypes": annotation_types,
            capability_name: { "apiVersion": { "min": capability } }
        }
    }))
    .value
    .expect("valid manifest fixture")
}

fn label_manifest(config_version: u32) -> Value {
    json!({
        "schemaVersion": 1,
        "id": "dev.acme.labels",
        "name": "标签插件",
        "version": "1.0.0",
        "apiVersion": { "min": 1 },
        "extensionKind": "label-preset",
        "permissions": ["fs.read:%PROJECT%/images"],
        "configVersion": config_version
    })
}

fn python_manifest() -> Value {
    json!({
        "schemaVersion": 1,
        "id": "dev.acme.python",
        "name": "Python 插件",
        "version": "1.0.0",
        "apiVersion": { "min": 1 },
        "extensionKind": "exporter",
        "runtime": "process",
        "entry": { "command": "python", "args": ["main.py"] }
    })
}

#[cfg(windows)]
fn executable_fixture_bytes() -> Vec<u8> {
    let mut bytes = vec![0_u8; 68];
    bytes[..2].copy_from_slice(b"MZ");
    bytes[60..64].copy_from_slice(&64_u32.to_le_bytes());
    bytes[64..68].copy_from_slice(b"PE\0\0");
    bytes
}

#[cfg(not(windows))]
fn executable_fixture_bytes() -> Vec<u8> {
    b"\x7fELF".to_vec()
}

fn installed_registry(suffix: &str) -> PathBuf {
    let root = temp_dir(suffix);
    let archive = write_manifest_archive(&root, "plugin.zip", label_manifest(0));
    let preview = prepare_plugin_install(&root, &archive).expect("prepare");
    authorize_plugin_install(&root, &preview.install_token, Some(preview.permissions))
        .expect("authorize");
    root
}

fn write_manifest_archive(root: &Path, name: &str, manifest: Value) -> PathBuf {
    let content = serde_json::to_vec(&manifest).expect("manifest JSON");
    write_entries(root, name, &[("manifest.json", &content)])
}

fn write_entries(root: &Path, name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
    let archive = root.join(name);
    let mut writer = zip::ZipWriter::new(fs::File::create(&archive).expect("create archive"));
    for (path, content) in entries {
        writer
            .start_file(*path, SimpleFileOptions::default())
            .expect("archive entry");
        writer.write_all(content).expect("entry content");
    }
    writer.finish().expect("finish archive");
    archive
}

fn assert_install_failure_cleans(root: &Path, archive: &Path, code: &str) {
    let first = prepare_plugin_install(root, archive).unwrap_err();
    assert_eq!(first.code, code);
    assert!(!first.message.is_empty());
    assert_pending_empty(root);
    let second = prepare_plugin_install(root, archive).unwrap_err();
    assert_eq!(second.code, code);
    assert_pending_empty(root);
}

fn assert_pending_empty(root: &Path) {
    let pending = root.join("plugins/.pending");
    if pending.is_dir() {
        assert_eq!(fs::read_dir(pending).expect("pending entries").count(), 0);
    }
}

fn temp_dir(suffix: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "my_label_tool_plugin_registry_{}_{}_{}",
        suffix,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&path).expect("temp directory");
    path
}

fn cleanup(path: PathBuf) {
    let _ = fs::remove_dir_all(path);
}
