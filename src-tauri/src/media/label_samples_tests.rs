use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "label-samples-test-{}-{}",
            std::process::id(),
            NEXT_TOKEN.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn png(&self, name: &str, color: u8) -> PathBuf {
        let path = self.0.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        image::RgbImage::from_pixel(2, 2, image::Rgb([color, 0, 0]))
            .save(&path)
            .unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn change(old: &str, name: &str) -> Change {
    Change {
        name: name.into(),
        original_name: Some(old.into()),
        source_path: None,
        clear: false,
    }
}

#[test]
fn windows_names_and_collisions() {
    for (name, expected) in [
        (" 行人. ", "行人"),
        ("a/b:c?d", "a_b_c_d"),
        ("CON", "_CON"),
        ("com1.png", "_com1.png"),
        ("LPT²", "_LPT²"),
        ("com10", "com10"),
    ] {
        assert_eq!(file_stem(name).unwrap(), expected);
    }
    assert!(file_stem("...").is_err());
    assert!(file_stem(&"a".repeat(201)).is_err());
    let fixture = Fixture::new();
    for (a, b) in [("a/b", "a:b"), ("Cat", "cat"), ("CON", "_CON")] {
        assert!(plan(&fixture.0, &[change("a", a), change("b", b)]).is_err());
    }
    assert!(!fixture.0.join("icon").exists());
    assert!(plan(
        &fixture.0,
        &[
            change("...", "fixed"),
            change("a/b", "one"),
            change("a:b", "two")
        ]
    )
    .is_ok());
}

#[test]
fn preview_refreshes_from_bytes_and_duplicate_extensions_are_rejected() {
    let f = Fixture::new();
    assert!(list(&f.0).unwrap().is_empty());
    let path = f.png("icon/行人.png", 10);
    let first = list(&f.0).unwrap();
    assert_eq!(first[0].name, "行人");
    assert!(first[0].preview.starts_with("data:image/png;base64,"));
    f.png("icon/行人.png", 20);
    assert_ne!(first[0].preview, list(&f.0).unwrap()[0].preview);
    fs::copy(&path, f.0.join("icon/行人.jpg")).unwrap();
    assert!(list(&f.0).unwrap_err().contains("冲突"));
}

#[test]
fn plans_swaps_case_renames_and_protects_unrelated_files() {
    let f = Fixture::new();
    let a = f.png("icon/A.png", 1);
    let b = f.png("icon/B.png", 2);
    let dir = directory(&f.0, false).unwrap();
    let swap = plan(&f.0, &[change("A", "B"), change("B", "A")]).unwrap();
    assert_eq!(swap.after[&dir.join("A.png")], fs::read(&b).unwrap());
    assert_eq!(swap.after[&dir.join("B.png")], fs::read(&a).unwrap());
    assert!(plan(&f.0, &[change("A", "B")]).is_err());
    let same = plan(&f.0, &[change("A", "a")]).unwrap();
    assert_eq!(same.before.len(), 1);
    assert!(same.after.contains_key(&dir.join("a.png")));
    let no_source = plan(&f.0, &[change("missing", "B")]).unwrap();
    assert!(no_source.before.is_empty());
    assert!(no_source.after.is_empty());
}

#[test]
fn transaction_replace_rollback_rename_commit_and_clear() {
    let f = Fixture::new();
    let a = f.png("icon/A.png", 1);
    let original = fs::read(&a).unwrap();
    let source = f.png("source.png", 2);
    let mut replacement = change("A", "B");
    replacement.source_path = Some(source.clone());
    let token = prepare(&f.0, &[replacement]).unwrap();
    assert!(!a.exists());
    assert_eq!(
        fs::read(f.0.join("icon/B.png")).unwrap(),
        fs::read(source).unwrap()
    );
    assert!(prepare(&f.0, &[]).is_err());
    assert!(finish(token + 1, true).is_err());
    finish(token, false).unwrap();
    assert_eq!(fs::read(&a).unwrap(), original);
    assert!(!f.0.join("icon/B.png").exists());
    let token = prepare(&f.0, &[change("A", "B")]).unwrap();
    finish(token, true).unwrap();
    assert_eq!(list(&f.0).unwrap()[0].name, "b");
    let token = prepare(&f.0, &[change("B", "b")]).unwrap();
    finish(token, true).unwrap();
    assert_eq!(list(&f.0).unwrap()[0].file_name, "b.png");
    let mut clear = change("B", "B");
    clear.clear = true;
    let token = prepare(&f.0, &[clear]).unwrap();
    finish(token, true).unwrap();
    assert!(list(&f.0).unwrap().is_empty());
    assert_eq!(fs::read_dir(f.0.join("icon")).unwrap().count(), 0);
}

#[cfg(windows)]
#[test]
fn partial_move_failure_restores_originals_without_rewriting_bytes() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let a = f.png("icon/A.png", 1);
    let b = f.png("icon/B.png", 2);
    let original_a = fs::read(&a).unwrap();
    let original_b = fs::read(&b).unwrap();
    let mut transaction = plan(&f.0, &[change("A", "C"), change("B", "D")]).unwrap();
    // Allow reading B but deny deletion/renaming, so failure occurs after A was backed up.
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&b)
        .unwrap();
    assert!(transaction.apply(&f.0).is_err());
    assert!(!a.exists());
    transaction.rollback().unwrap();
    transaction.cleanup();
    drop(locked);
    assert_eq!(fs::read(&a).unwrap(), original_a);
    assert_eq!(fs::read(&b).unwrap(), original_b);
    assert_eq!(fs::read_dir(f.0.join("icon")).unwrap().count(), 2);
}

#[test]
fn rejects_bad_images_and_non_directory_icon_before_writing() {
    let f = Fixture::new();
    fs::write(f.0.join("bad.png"), b"not an image").unwrap();
    let mut invalid = change("A", "B");
    invalid.source_path = Some(f.0.join("bad.png"));
    assert!(plan(&f.0, &[invalid]).is_err());
    assert!(!f.0.join("icon").exists());
    fs::write(f.0.join("icon"), b"occupied").unwrap();
    assert!(directory(&f.0, true).is_err());
    assert_eq!(fs::read(f.0.join("icon")).unwrap(), b"occupied");
}

#[cfg(unix)]
#[test]
fn rejects_linked_icon_directory() {
    let f = Fixture::new();
    let other = Fixture::new();
    std::os::unix::fs::symlink(&other.0, f.0.join("icon")).unwrap();
    assert!(directory(&f.0, true).is_err());
}
