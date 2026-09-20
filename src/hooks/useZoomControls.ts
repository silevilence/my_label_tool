import { createTransform } from "../components/canvas/transform";
import { clamp, fitImageLayout, getFitScale } from "../components/canvas/geometry";
import type { ImageLayout } from "../components/canvas/types";

export function useZoomControls({
  canvasSize,
  loadedImage,
  setImageView,
}: {
  canvasSize: { width: number; height: number };
  loadedImage: HTMLImageElement | null;
  setImageView: (
    layout: ImageLayout | null | ((layout: ImageLayout | null) => ImageLayout | null),
  ) => void;
}) {
  function zoomFromKeyboard(delta: 1 | -1) {
    zoomAt({ x: canvasSize.width / 2, y: canvasSize.height / 2 }, delta > 0 ? 1.12 : 1 / 1.12);
  }

  function setImageScale(scale: number) {
    if (!loadedImage) {
      return;
    }

    const width = loadedImage.naturalWidth * scale;
    const height = loadedImage.naturalHeight * scale;
    setImageView({
      scale,
      width,
      height,
      x: (canvasSize.width - width) / 2,
      y: (canvasSize.height - height) / 2,
    });
  }

  function fitImageWidth() {
    if (loadedImage) {
      setImageScale(canvasSize.width / loadedImage.naturalWidth);
    }
  }

  function fitImageHeight() {
    if (loadedImage) {
      setImageScale(canvasSize.height / loadedImage.naturalHeight);
    }
  }

  function resetZoom() {
    if (loadedImage) {
      setImageView(fitImageLayout(loadedImage, canvasSize));
    }
  }

  function zoomAt(point: { x: number; y: number }, factor: number) {
    if (!loadedImage) {
      return;
    }

    setImageView((layout) => {
      if (!layout) {
        return layout;
      }

      const fitScale = getFitScale(loadedImage, canvasSize);
      const nextScale = clamp(layout.scale * factor, fitScale * 0.25, fitScale * 8);
      if (nextScale === layout.scale) {
        return layout;
      }

      return createTransform(layout).zoomAt(point, nextScale);
    });
  }

  return { fitImageHeight, fitImageWidth, resetZoom, setImageScale, zoomAt, zoomFromKeyboard };
}
