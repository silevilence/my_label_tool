import { useEffect, useMemo, useRef, useState } from "react";
import { imageFileSrc, type ImageFile } from "../lib/tauri-api";

export function useImageLoader(images: ImageFile[], selectedPath: string) {
  const cacheRef = useRef(new Map<string, HTMLImageElement>());
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [imageLoadError, setImageLoadError] = useState("");
  const selectedImage = useMemo(
    () => images.find((image) => image.path === selectedPath) ?? null,
    [images, selectedPath],
  );

  useEffect(() => {
    if (!selectedImage) {
      setLoadedImage(null);
      setImageLoadError("");
      return;
    }

    const cachedImage = cacheRef.current.get(selectedImage.path);
    if (cachedImage) {
      setLoadedImage(cachedImage);
      setImageLoadError("");
      return;
    }

    let cancelled = false;
    const image = new Image();
    setLoadedImage(null);
    setImageLoadError("");

    image.onload = () => {
      if (!cancelled) {
        cacheRef.current.set(selectedImage.path, image);
        setLoadedImage(image);
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
    image.onload = () => cacheRef.current.set(nextImage.path, image);
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
