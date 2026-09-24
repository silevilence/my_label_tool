use super::*;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "sample-crop-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        image::RgbImage::from_fn(20, 15, |x, y| image::Rgb([x as u8, y as u8, 0]))
            .save(path.join("source.png"))
            .unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn bounds() -> CropBounds {
    CropBounds {
        x: 3.2,
        y: 4.8,
        width: 5.0,
        height: 6.0,
    }
}

#[test]
fn selection_writes_actual_crop_and_discard_only_removes_owned_files() {
    let f = Fixture::new();
    let source = f.0.join("source.png");
    let cache = f.0.join("cache");
    let preview = preview(&f.0, &source, bounds()).unwrap();
    assert!(preview.starts_with("data:image/png;base64,"));
    assert!(!cache.exists());
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
    let result = create(&f.0, &source, bounds(), &cache).unwrap();
    let decoded = image::open(&result.path).unwrap().to_rgb8();
    assert_eq!(decoded.dimensions(), (6, 7));
    assert_eq!(decoded.get_pixel(0, 0).0, [3, 4, 0]);
    assert_eq!(decoded.get_pixel(5, 6).0, [8, 10, 0]);
    discard(&source).unwrap();
    assert!(source.exists());
    discard(&result.path).unwrap();
    discard(&result.path).unwrap();
    assert!(!result.path.exists());
}

#[test]
fn clipping_invalid_geometry_and_project_boundary() {
    let f = Fixture::new();
    let source = f.0.join("source.png");
    let cropped = crop(
        &f.0,
        &source,
        CropBounds {
            x: -10.0,
            y: -5.0,
            width: 15.0,
            height: 10.0,
        },
    )
    .unwrap();
    assert_eq!((cropped.width(), cropped.height()), (5, 5));
    for b in [
        CropBounds {
            x: 21.0,
            ..bounds()
        },
        CropBounds {
            width: 0.0,
            ..bounds()
        },
        CropBounds {
            x: f64::NAN,
            ..bounds()
        },
        CropBounds {
            height: f64::INFINITY,
            ..bounds()
        },
    ] {
        assert!(crop(&f.0, &source, b).is_err());
    }
    let other = Fixture::new();
    assert!(crop(&f.0, &other.0.join("source.png"), bounds()).is_err());
    assert!(crop(&f.0, &f.0.join("missing.png"), bounds()).is_err());
}
