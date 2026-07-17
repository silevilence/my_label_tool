import type { AnnotationShape } from "../types/annotation";
import type { ImageFile } from "../lib/tauri-api";

export function useImageNavigation({
  annotationsByImage,
  images,
  selectedPath,
  setSelectedPath,
}: {
  annotationsByImage: Record<string, AnnotationShape[]>;
  images: ImageFile[];
  selectedPath: string;
  setSelectedPath: (path: string) => void;
}) {
  function selectAdjacentImage(delta: number) {
    if (images.length === 0) {
      return;
    }

    const index = Math.max(
      0,
      images.findIndex((image) => image.path === selectedPath),
    );
    const nextIndex = Math.min(images.length - 1, Math.max(0, index + delta));
    if (nextIndex !== index) {
      setSelectedPath(images[nextIndex].path);
    }
  }

  function selectAdjacentUnannotatedImage(delta: 1 | -1) {
    const index = images.findIndex((image) => image.path === selectedPath);
    if (index < 0) {
      return;
    }

    const nextIndex = findAdjacentUnannotatedIndex(index, delta);
    if (nextIndex >= 0) {
      setSelectedPath(images[nextIndex].path);
    }
  }

  function findAdjacentUnannotatedIndex(index: number, delta: 1 | -1) {
    for (
      let nextIndex = index + delta;
      nextIndex >= 0 && nextIndex < images.length;
      nextIndex += delta
    ) {
      if ((annotationsByImage[images[nextIndex].path] ?? []).length === 0) {
        return nextIndex;
      }
    }

    return -1;
  }

  return { selectAdjacentImage, selectAdjacentUnannotatedImage };
}
