import { describe, expect, it } from "vitest";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  annotationBbox,
  annotationBounds,
  clamp,
  clampContextMenuPosition,
  clampPoint,
  clampRect,
  fitImageLayout,
  getFitScale,
  getImagePoint,
  getInteractionMode,
  isLargeImage,
  isPointNearAnnotation,
  normalizeRectPoints,
  toCanvasPoints,
  toCanvasRect,
} from "./geometry";
import type { ImageLayout } from "./types";

const layout: ImageLayout = { x: 10, y: 20, width: 200, height: 100, scale: 2 };
const image = { naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement;

function eventAt(x: number, y: number): KonvaEventObject<MouseEvent> {
  return {
    target: {
      getStage: () => ({
        getPointerPosition: () => ({ x, y }),
      }),
    },
  } as unknown as KonvaEventObject<MouseEvent>;
}

function eventWithoutPointer(): KonvaEventObject<MouseEvent> {
  return {
    target: {
      getStage: () => ({
        getPointerPosition: () => null,
      }),
    },
  } as unknown as KonvaEventObject<MouseEvent>;
}

describe("canvas geometry", () => {
  it("normalizes and projects rectangle points", () => {
    expect(normalizeRectPoints({ startX: 10, startY: 8, currentX: 2, currentY: 20 })).toEqual([2, 8, 8, 12]);
    expect(toCanvasRect([1, 2, 3, 4], layout)).toEqual({ x: 12, y: 24, width: 6, height: 8 });
    expect(toCanvasPoints([1, 2, 3, 4], layout)).toEqual([12, 24, 16, 28]);
  });

  it("computes bounds for rect, polygon and point annotations", () => {
    expect(annotationBounds({ id: "r", type: "rect", labelId: "x", points: [1, 2, 3, 4] })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(annotationBbox({ id: "p", type: "polygon", labelId: "x", points: [4, 5, 10, 2, 8, 9] })).toEqual([4, 2, 6, 7]);
    expect(annotationBbox({ id: "k", type: "point", labelId: "x", points: [4, 5] })).toEqual([4, 5, 0, 0]);
  });

  it("maps pointer positions into image coordinates and rejects outside points", () => {
    expect(getImagePoint(eventAt(30, 40), layout, image)).toEqual({ x: 10, y: 10 });
    expect(getImagePoint(eventAt(500, 40), layout, image)).toBeNull();
    expect(getImagePoint(eventWithoutPointer(), layout, image)).toBeNull();
  });

  it("checks hit targets for rects, polygons and points", () => {
    expect(isPointNearAnnotation({ x: 15, y: 25 }, { id: "r", type: "rect", labelId: "x", points: [0, 0, 10, 10] }, layout, 0)).toBe(true);
    expect(isPointNearAnnotation({ x: 20, y: 30 }, { id: "p", type: "polygon", labelId: "x", points: [0, 0, 10, 0, 10, 10, 0, 10] }, layout, 0)).toBe(true);
    expect(isPointNearAnnotation({ x: 30, y: 20 }, { id: "edge", type: "polygon", labelId: "x", points: [0, 0, 10, 0, 10, 10] }, layout, 1)).toBe(true);
    expect(isPointNearAnnotation({ x: 100, y: 100 }, { id: "far", type: "polygon", labelId: "x", points: [0, 0, 10, 0, 10, 10] }, layout, 1)).toBe(false);
    expect(isPointNearAnnotation({ x: 15, y: 25 }, { id: "k", type: "point", labelId: "x", points: [2, 2] }, layout, 1)).toBe(true);
  });

  it("clamps values, points, rectangles and context menus", () => {
    expect(clamp(5, 1, 4)).toBe(4);
    expect(clampPoint({ x: -1, y: 99 }, image)).toEqual({ x: 0, y: 50 });
    expect(clampRect({ x: -5, y: 99, width: 200, height: 0 }, image)).toEqual({
      x: 0,
      y: 49,
      width: 100,
      height: 1,
    });

    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 300, configurable: true });
    expect(clampContextMenuPosition({ x: 390, y: 290 }, true)).toEqual({ x: 40, y: 8 });
  });

  it("fits images and resolves interaction modes", () => {
    expect(getFitScale(image, { width: 50, height: 50 })).toBe(0.5);
    expect(fitImageLayout(image, { width: 300, height: 300 })).toEqual({
      width: 300,
      height: 150,
      x: 0,
      y: 75,
      scale: 3,
    });
    expect(isLargeImage({ naturalWidth: 3840, naturalHeight: 2160 } as HTMLImageElement)).toBe(true);
    expect(getInteractionMode(false, false)).toBe("default");
    expect(getInteractionMode(false, true)).toBe("select");
    expect(getInteractionMode(true, true)).toBe("annotate");
  });
});
