import { useEffect, useMemo, useRef, useState } from "react";
import { imageFileSrc, type ImageFile } from "../lib/tauri-api";
import { cacheDecodedImage, getCachedImage } from "../lib/image-cache";

export function useImageLoader(images: ImageFile[], selectedPath: string) {
  const cacheRef = useRef(new Map<string, HTMLImageElement>());
  const [loaded, setLoaded] = useState<{ path: string; image: HTMLImageElement } | null>(null);
  const loadedImage = loaded?.path === selectedPath ? loaded.image : null;
  const [imageLoadError, setImageLoadError] = useState("");
  const selectedImage = useMemo(
    () => images.find((image) => image.path === selectedPath) ?? null,
    [images, selectedPath],
  );

  useEffect(() => {
    const paths = new Set(images.map((image) => image.path));
    for (const path of cacheRef.current.keys()) {
      if (!paths.has(path)) cacheRef.current.delete(path);
    }
  }, [images]);

  useEffect(() => {
    if (!selectedImage) {
      setLoaded(null);
      setImageLoadError("");
      return;
    }

    const cachedImage = getCachedImage(cacheRef.current, selectedImage.path);
    if (cachedImage) {
      setLoaded({ path: selectedImage.path, image: cachedImage });
      setImageLoadError("");
      return;
    }

    let cancelled = false;
    const image = new Image();
    setLoaded(null);
    setImageLoadError("");

    image.onload = () => {
      if (!cancelled) {
        cacheDecodedImage(cacheRef.current, selectedImage.path, image);
        setLoaded({ path: selectedImage.path, image });
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setImageLoadError(`图片加载失败：${selectedImage.name}`);
      }
    };
    image.src = imageFileSrc(selectedImage.path);

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [selectedImage]);

  useEffect(() => {
    const selectedIndex = images.findIndex((image) => image.path === selectedPath);
    const nextImage = selectedIndex >= 0 ? images[selectedIndex + 1] : null;
    if (!nextImage || cacheRef.current.has(nextImage.path)) {
      return;
    }

    const image = new Image();
    image.onload = () => cacheDecodedImage(cacheRef.current, nextImage.path, image);
    image.onerror = null;
    image.src = imageFileSrc(nextImage.path);

    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [images, selectedPath]);

  return {
    imageLoadError,
    isImageLoading: Boolean(selectedImage && !loadedImage && !imageLoadError),
    loadedImage,
    selectedImage,
  };
}
