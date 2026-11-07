use super::*;
use serde_json::json;

fn update(revision: u64, reset: bool, changes: Value) -> Update {
    serde_json::from_value(json!({
        "expectedRevision": revision, "reset": reset,
        "metadata": { "labels": [{"id":"l", "name":"标签", "color":"#ffffff", "shapeType":"any"}],
            "projectConfig": null, "configPath":"", "selectedPath":"a.png", "savedAt":"2026-11-07T00:00:00Z" },
        "changes": changes,
    })).unwrap()
}
fn shape() -> Value {
    json!({"id":"s", "type":"polygon", "labelId":"l", "points":[1.0,2.0,3.0,4.0,5.0,6.0], "frameIndex":7, "attributes":{"track":"42"}})
}

#[test]
fn incremental_roundtrip_deletion_and_project_isolation() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    assert!(load(root.path(), project.path()).unwrap().is_none());
    assert!(last(root.path()).unwrap().is_none());
    save(
        root.path(),
        project.path(),
        update(
            0,
            true,
            json!({"frames/a.png":[shape()], "b.png":[shape()]}),
        ),
    )
    .unwrap();
    save(
        root.path(),
        project.path(),
        update(1, false, json!({"b.png":[]})),
    )
    .unwrap();
    let restored = load(root.path(), project.path()).unwrap().unwrap();
    assert_eq!(restored.revision, 2);
    assert_eq!(
        serde_json::to_value(&restored.annotations["frames/a.png"][0]).unwrap(),
        shape()
    );
    assert!(restored.annotations["b.png"].is_empty());
    assert!(load(root.path(), other.path()).unwrap().is_none());
    assert_eq!(last(root.path()).unwrap().unwrap(), project.path());
    save(
        root.path(),
        project.path(),
        update(2, false, json!({"frames/a.png":null})),
    )
    .unwrap();
    assert!(!load(root.path(), project.path())
        .unwrap()
        .unwrap()
        .annotations
        .contains_key("frames/a.png"));
}

#[test]
fn failed_or_uncommitted_segment_keeps_previous_copy_and_retry_works() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    save(
        root.path(),
        project.path(),
        update(0, true, json!({"a.png":[shape()]})),
    )
    .unwrap();
    let dir = directory(root.path(), project.path()).unwrap();
    fs::create_dir(segment(&dir, 2)).unwrap();
    assert!(save(
        root.path(),
        project.path(),
        update(1, false, json!({"a.png":[]}))
    )
    .is_err());
    assert_eq!(
        load(root.path(), project.path())
            .unwrap()
            .unwrap()
            .annotations["a.png"]
            .len(),
        1
    );
    fs::remove_dir(segment(&dir, 2)).unwrap();
    fs::write(segment(&dir, 2), b"interrupted").unwrap();
    assert_eq!(
        load(root.path(), project.path()).unwrap().unwrap().revision,
        1
    );
    save(
        root.path(),
        project.path(),
        update(1, false, json!({"a.png":[]})),
    )
    .unwrap();
    assert!(load(root.path(), project.path())
        .unwrap()
        .unwrap()
        .annotations["a.png"]
        .is_empty());
    assert_eq!(
        save(root.path(), project.path(), update(1, false, json!({}))).unwrap_err(),
        text::STALE
    );
}

#[test]
fn reset_compaction_and_corruption_are_explicit() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    for revision in 0..=COMPACT_AFTER {
        save(
            root.path(),
            project.path(),
            update(revision, revision == 0, json!({"a.png":[shape()]})),
        )
        .unwrap();
    }
    let dir = directory(root.path(), project.path()).unwrap();
    assert_eq!(head(&dir).unwrap().unwrap().base, COMPACT_AFTER + 1);
    assert!(!segment(&dir, 1).exists());
    assert_eq!(
        load(root.path(), project.path())
            .unwrap()
            .unwrap()
            .annotations["a.png"]
            .len(),
        1
    );
    save(
        root.path(),
        project.path(),
        update(COMPACT_AFTER + 1, true, json!({"new.png":[]})),
    )
    .unwrap();
    let restored = load(root.path(), project.path()).unwrap().unwrap();
    assert_eq!(restored.annotations.len(), 1);
    fs::write(segment(&dir, restored.revision), b"broken").unwrap();
    assert!(load(root.path(), project.path()).is_err());
}

#[test]
fn rejects_paths_outside_project_and_unknown_schema() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    for path in [
        "../outside.png",
        "/absolute.png",
        "C:/absolute.png",
        "a\\b",
        "a//b",
        ".",
    ] {
        assert!(save(
            root.path(),
            project.path(),
            update(0, true, json!({path:[]}))
        )
        .is_err());
    }
    assert!(load(root.path(), Path::new("relative")).is_err());
    let dir = directory(root.path(), project.path()).unwrap();
    atomic(
        &dir.join("head.json"),
        &json!({"schemaVersion":2, "folder":project.path(), "base":1,"revision":1}),
    )
    .unwrap();
    assert!(load(root.path(), project.path()).is_err());
}

#[test]
fn chunked_compaction_roundtrips_unicode_and_keeps_following_writes_readable() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    for revision in 0..=COMPACT_AFTER {
        save_with_limit(
            root.path(),
            project.path(),
            update(
                revision,
                revision == 0,
                json!({format!("图片{revision}.png"): [shape()]}),
            ),
            false,
            256,
        )
        .unwrap();
    }
    let dir = directory(root.path(), project.path()).unwrap();
    let current = head(&dir).unwrap().unwrap();
    assert_eq!(current.base, COMPACT_AFTER + 1);
    let manifest: Value = read(&segment(&dir, current.base)).unwrap();
    assert!(manifest["parts"].as_u64().unwrap() > 1);
    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|ext| ext == "txt") {
            assert!(fs::metadata(&path).unwrap().len() <= 256);
            crate::text_read::read(&path).unwrap();
        }
    }
    let restored = load(root.path(), project.path()).unwrap().unwrap();
    assert_eq!(restored.annotations.len(), COMPACT_AFTER as usize + 1);
    save(
        root.path(),
        project.path(),
        update(restored.revision, false, json!({"after.png": [shape()]})),
    )
    .unwrap();
    assert_eq!(
        load(root.path(), project.path())
            .unwrap()
            .unwrap()
            .annotations
            .len(),
        COMPACT_AFTER as usize + 2
    );
    assert!(!segment(&dir, 1).exists());
    assert!(!dir.join("00000000000000000001.part-00000000.txt").exists());
}

#[test]
fn explicit_reset_and_conflict_preserve_the_other_copy() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    save(
        root.path(),
        project.path(),
        update(0, true, json!({"original.png": [shape()]})),
    )
    .unwrap();
    save(
        root.path(),
        project.path(),
        update(1, true, json!({"disk.png": []})),
    )
    .unwrap();
    let revision = fork(
        root.path(),
        project.path(),
        update(1, false, json!({"memory.png": [shape()]})),
    )
    .unwrap();
    assert!(revision > 2);
    assert_eq!(
        save(root.path(), project.path(), update(2, false, json!({}))).unwrap_err(),
        text::STALE
    );
    let mut retained = Vec::new();
    for entry in fs::read_dir(storage::archives(root.path(), project.path()).unwrap()).unwrap() {
        let path = entry.unwrap().path();
        retained.extend(
            replay(&path, &head(&path).unwrap().unwrap())
                .unwrap()
                .annotations
                .into_keys(),
        );
    }
    retained.sort();
    assert_eq!(retained, ["disk.png", "original.png"]);
    assert!(load(root.path(), project.path())
        .unwrap()
        .unwrap()
        .annotations
        .contains_key("memory.png"));
}

#[test]
fn corrupt_copy_is_preserved_byte_for_byte_before_starting_a_new_lineage() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    save(
        root.path(),
        project.path(),
        update(0, true, json!({"a.png": [shape()]})),
    )
    .unwrap();
    let dir = directory(root.path(), project.path()).unwrap();
    fs::write(dir.join("head.json"), b"corrupt head").unwrap();
    let revision = fork(
        root.path(),
        project.path(),
        update(0, true, json!({"new.png": []})),
    )
    .unwrap();
    let archive = fs::read_dir(storage::archives(root.path(), project.path()).unwrap())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        fs::read(archive.join("head.json")).unwrap(),
        b"corrupt head"
    );
    assert_eq!(
        fs::read(segment(&archive, 1)).unwrap(),
        fs::read(segment(&dir, 1)).unwrap()
    );
    assert_eq!(
        load(root.path(), project.path()).unwrap().unwrap().revision,
        revision
    );
}

// Run through the test executable so the contenders cannot share the in-process mutex.
#[test]
fn cross_process_worker() {
    let Ok(root) = std::env::var("RECOVERY_RACE_ROOT") else {
        return;
    };
    let project = std::env::var("RECOVERY_RACE_PROJECT").unwrap();
    let id = std::env::var("RECOVERY_RACE_ID").unwrap();
    let root = Path::new(&root);
    fs::write(root.join(format!("ready-{id}")), b"ready").unwrap();
    let start = std::time::Instant::now();
    while !root.join("start").exists() {
        assert!(start.elapsed().as_secs() < 30);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let result = save(
        root,
        Path::new(&project),
        update(1, false, json!({format!("{id}.png"): [shape()]})),
    );
    fs::write(
        root.join(format!("result-{id}")),
        match result {
            Ok(_) => "ok".into(),
            Err(e) => e,
        },
    )
    .unwrap();
}

#[test]
fn two_processes_cannot_commit_the_same_revision() {
    let root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    save(root.path(), project.path(), update(0, true, json!({}))).unwrap();
    let lock = storage::lock(root.path()).unwrap();
    let mut children = Vec::new();
    for id in ["one", "two"] {
        children.push(
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "recovery::tests::cross_process_worker",
                    "--nocapture",
                ])
                .env("RECOVERY_RACE_ROOT", root.path())
                .env("RECOVERY_RACE_PROJECT", project.path())
                .env("RECOVERY_RACE_ID", id)
                .spawn()
                .unwrap(),
        );
    }
    let start = std::time::Instant::now();
    while !root.path().join("ready-one").exists() || !root.path().join("ready-two").exists() {
        assert!(start.elapsed().as_secs() < 30);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    fs::write(root.path().join("start"), b"go").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert!(!root.path().join("result-one").exists());
    assert!(!root.path().join("result-two").exists());
    drop(lock);
    for mut child in children {
        assert!(child.wait().unwrap().success());
    }
    let results: Vec<_> = ["one", "two"]
        .iter()
        .map(|id| crate::text_read::read(&root.path().join(format!("result-{id}"))).unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| *result == "ok").count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| *result == text::STALE)
            .count(),
        1
    );
    assert_eq!(
        load(root.path(), project.path()).unwrap().unwrap().revision,
        2
    );
}
