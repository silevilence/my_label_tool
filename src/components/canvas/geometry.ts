import type { KonvaEventObject } from "konva/lib/Node";
import type { DrawingRect, ImageLayout, InteractionMode } from "./types";
import type { AnnotationShape } from "../../types/annotation";

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

export function toCanvasPoints(points: number[], layout: ImageLayout): number[] {
  return points.map((value, index) => layout[index % 2 === 0 ? "x" : "y"] + value * layout.scale);
}

export function annotationBounds(annotation: AnnotationShape): CanvasRect {
  if (annotation.type === "rect") {
    return toRectBounds(annotation.points);
  }

  const xs = annotation.points.filter((_, index) => index % 2 === 0);
  const ys = annotation.points.filter((_, index) => index % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function annotationBbox(annotation: AnnotationShape): number[] {
  const bounds = annotationBounds(annotation);
  return [bounds.x, bounds.y, bounds.width, bounds.height];
}

export function isPointNearAnnotation(
  point: { x: number; y: number },
  annotation: AnnotationShape,
  layout: ImageLayout,
  tolerance: number,
): boolean {
  if (annotation.type === "rect") {
    return isPointNearCanvasRect(point, toCanvasRect(annotation.points, layout), tolerance);
  }

  const points = toCanvasPoints(annotation.points, layout);
  if (annotation.type === "point") {
    return distance(point, { x: points[0], y: points[1] }) <= tolerance + 5;
  }

  return isPointInPolygon(point, points) || isPointNearPolyline(point, points, tolerance, true);
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

export function clampPoint(
  point: { x: number; y: number },
  image: HTMLImageElement,
): { x: number; y: number } {
  return {
    x: clamp(point.x, 0, image.naturalWidth),
    y: clamp(point.y, 0, image.naturalHeight),
  };
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

function toRectBounds(points: number[]): CanvasRect {
  const [x, y, width, height] = points;
  return { x, y, width, height };
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isPointNearPolyline(
  point: { x: number; y: number },
  points: number[],
  tolerance: number,
  closed: boolean,
): boolean {
  for (let index = 0; index < points.length - 2; index += 2) {
    if (
      distanceToSegment(
        point,
        points[index],
        points[index + 1],
        points[index + 2],
        points[index + 3],
      ) <= tolerance
    ) {
      return true;
    }
  }

  return (
    closed &&
    points.length >= 6 &&
    distanceToSegment(
      point,
      points[points.length - 2],
      points[points.length - 1],
      points[0],
      points[1],
    ) <= tolerance
  );
}

function distanceToSegment(
  point: { x: number; y: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(point, { x: x1, y: y1 });
  }

  const t = clamp(((point.x - x1) * dx + (point.y - y1) * dy) / lengthSquared, 0, 1);
  return distance(point, { x: x1 + t * dx, y: y1 + t * dy });
}

function isPointInPolygon(point: { x: number; y: number }, points: number[]): boolean {
  let inside = false;
  for (
    let index = 0, previous = points.length - 2;
    index < points.length;
    previous = index, index += 2
  ) {
    const xi = points[index];
    const yi = points[index + 1];
    const xj = points[previous];
    const yj = points[previous + 1];
    const intersects =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}
