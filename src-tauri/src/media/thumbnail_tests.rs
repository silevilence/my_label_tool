use super::{cache_path_for, generate};
use image::{ImageBuffer, RgbaImage};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU32, Ordering},
    time::{Duration, SystemTime},
};

static NEXT: AtomicU32 = AtomicU32::new(0);

fn temp_root(label: &str) -> PathBuf {
    let nonce = NEXT.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "my-label-tool-thumbnail-{label}-{}-{nonce}",
        std::process::id()
    ))
}

fn write_png(path: &Path, width: u32, height: u32) {
    let image: RgbaImage = ImageBuffer::from_fn(width, height, |x, y| {
        image::Rgba([(x % 256) as u8, (y % 256) as u8, 128, 255])
    });
    image
        .save_with_format(path, image::ImageFormat::Png)
        .unwrap();
}

fn dimensions(path: &Path) -> (u32, u32) {
    image::image_dimensions(path).unwrap()
}

#[test]
fn creates_a_missing_cache_directory_on_first_use() {
    let root = temp_root("cold");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("source.png");
    write_png(&source, 400, 200);
    let cache = root.join("new-app-cache").join("thumbnails");
    let thumbnail = generate(&source, &cache).unwrap();
    assert_eq!(dimensions(&thumbnail), (256, 128));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn simultaneous_requests_leave_one_complete_cache_file() {
    let root = temp_root("concurrent");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("source.png");
    write_png(&source, 640, 400);
    let cache = root.join("cache");
    let barrier = std::sync::Barrier::new(8);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..8)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    generate(&source, &cache)
                })
            })
            .collect();
        for handle in handles {
            assert_eq!(dimensions(&handle.join().unwrap().unwrap()), (256, 160));
        }
    });
    assert_eq!(fs::read_dir(&cache).unwrap().count(), 1);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn scales_long_edge_to_the_cap_preserving_aspect() {
    let root = temp_root("scale");
    fs::create_dir_all(root.join("cache")).unwrap();
    let source = root.join("wide.png");
    write_png(&source, 640, 400);

    let thumbnail = generate(&source, &root.join("cache")).unwrap();

    assert_eq!(dimensions(&thumbnail), (256, 160));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn keeps_images_at_or_below_the_cap_unscaled() {
    let root = temp_root("small");
    fs::create_dir_all(root.join("cache")).unwrap();
    let source = root.join("tiny.png");
    write_png(&source, 100, 50);

    let thumbnail = generate(&source, &root.join("cache")).unwrap();

    assert_eq!(dimensions(&thumbnail), (100, 50));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn cache_hit_returns_without_decoding_the_source() {
    let root = temp_root("hit");
    fs::create_dir_all(root.join("cache")).unwrap();
    let source = root.join("corrupt.png");
    fs::write(&source, b"not-an-image").unwrap();
    let cache_path = cache_path_for(&source, &root.join("cache")).unwrap();
    const MARKER: &[u8] = b"cached-marker";
    fs::write(&cache_path, MARKER).unwrap();

    let returned = generate(&source, &root.join("cache")).unwrap();

    // 损坏源未被解码：直接命中缓存并原样返回
    assert_eq!(returned, cache_path);
    assert_eq!(fs::read(&returned).unwrap(), MARKER);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn cache_key_tracks_mtime_changes() {
    let root = temp_root("mtime");
    fs::create_dir_all(root.join("cache")).unwrap();
    let source = root.join("changing.png");
    write_png(&source, 300, 300);
    let first = generate(&source, &root.join("cache")).unwrap();
    assert!(first.is_file());

    let later = SystemTime::now() + Duration::from_secs(2);
    fs::OpenOptions::new()
        .write(true)
        .open(&source)
        .unwrap()
        .set_modified(later)
        .unwrap();
    let second = generate(&source, &root.join("cache")).unwrap();

    assert_ne!(first, second, "mtime 变化必须换缓存键并重新生成");
    assert!(second.is_file());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn cache_path_is_deterministic_for_unchanged_files() {
    let root = temp_root("stable");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("same.png");
    write_png(&source, 32, 32);

    let first = cache_path_for(&source, &root).unwrap();
    let second = cache_path_for(&source, &root).unwrap();

    assert_eq!(first, second);
    assert_eq!(
        first.extension().and_then(|value| value.to_str()),
        Some("png")
    );
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn missing_or_unreadable_sources_fail_without_panicking() {
    let root = temp_root("missing");
    fs::create_dir_all(root.join("cache")).unwrap();

    let missing = generate(&root.join("nope.png"), &root.join("cache"));
    assert!(missing.is_err());

    let corrupt = root.join("corrupt.png");
    fs::write(&corrupt, b"not-an-image").unwrap();
    let decode_failed = generate(&corrupt, &root.join("cache"));
    assert!(decode_failed.is_err());
    fs::remove_dir_all(&root).unwrap();
}
