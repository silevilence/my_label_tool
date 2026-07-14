import type { KonvaEventObject } from "konva/lib/Node";
import type { DrawingRect, ImageLayout, InteractionMode } from "./types";

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getImagePoint(
  event: KonvaEventObject<MouseEvent>,
  layout: ImageLayout,
  image: HTMLImageElement,
): { x: number; y: number } | null {
  const pointer = event.target.getStage()?.getPointerPosition();
  if (!pointer) {
    return null;
  }

  const x = (pointer.x - layout.x) / layout.scale;
  const y = (pointer.y - layout.y) / layout.scale;
  if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) {
    return null;
  }

  return { x, y };
}

export function normalizeRectPoints(rect: DrawingRect): number[] {
  const x = Math.min(rect.startX, rect.currentX);
  const y = Math.min(rect.startY, rect.currentY);
  return [x, y, Math.abs(rect.currentX - rect.startX), Math.abs(rect.currentY - rect.startY)];
}

export function toCanvasRect(points: number[], layout: ImageLayout): CanvasRect {
  const [x, y, width, height] = points;
  return {
    x: layout.x + x * layout.scale,
    y: layout.y + y * layout.scale,
    width: width * layout.scale,
    height: height * layout.scale,
  };
}

export function isPointNearCanvasRect(
  point: { x: number; y: number },
  rect: CanvasRect,
  tolerance: number,
): boolean {
  return (
    point.x >= rect.x - tolerance &&
    point.y >= rect.y - tolerance &&
    point.x <= rect.x + rect.width + tolerance &&
    point.y <= rect.y + rect.height + tolerance
  );
}

export function clampRect(rect: CanvasRect, image: HTMLImageElement): CanvasRect {
  const width = Math.max(1, Math.min(rect.width, image.naturalWidth));
  const height = Math.max(1, Math.min(rect.height, image.naturalHeight));
  return {
    width,
    height,
    x: clamp(rect.x, 0, image.naturalWidth - width),
    y: clamp(rect.y, 0, image.naturalHeight - height),
  };
}

export function fitImageLayout(
  image: HTMLImageElement,
  canvasSize: { width: number; height: number },
): ImageLayout {
  const scale = getFitScale(image, canvasSize);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return {
    width,
    height,
    x: (canvasSize.width - width) / 2,
    y: (canvasSize.height - height) / 2,
    scale,
  };
}

export function getFitScale(
  image: HTMLImageElement,
  canvasSize: { width: number; height: number },
): number {
  return Math.min(canvasSize.width / image.naturalWidth, canvasSize.height / image.naturalHeight);
}

export function isLargeImage(image: HTMLImageElement): boolean {
  return image.naturalWidth * image.naturalHeight >= 3840 * 2160;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getInteractionMode(ctrlKey: boolean, shiftKey: boolean): InteractionMode {
  if (ctrlKey) {
    return "annotate";
  }
  if (shiftKey) {
    return "select";
  }
  return "default";
}

export function clampContextMenuPosition(
  position: { x: number; y: number },
  hasAnnotationActions: boolean,
): { x: number; y: number } {
  const estimatedWidth = 360;
  const estimatedHeight = hasAnnotationActions ? 340 : 250;
  const maxX = Math.max(8, window.innerWidth - estimatedWidth);
  const maxY = Math.max(8, window.innerHeight - estimatedHeight);
  return {
    x: clamp(position.x, 8, maxX),
    y: clamp(position.y, 8, maxY),
  };
}
