import { describe, expect, it } from "vitest";
import {
  annotationSnapshotsEqual,
  annotationShapesSnapshot,
  annotationValuesEqual,
} from "./annotation-utils";
import type { AnnotationShape } from "../types/annotation";

const annotation: AnnotationShape = {
  id: "shape-1",
  type: "rect",
  labelId: "person",
  points: [1, 2, 3, 4],
  frameIndex: 0,
};

describe("annotation snapshots", () => {
  it("distinguishes exact snapshot changes from equivalent script values", () => {
    const before = { ...annotation, attributes: { z: 1, a: 2 }, frameIndex: undefined };
    const after = { ...annotation, attributes: { a: 2, z: 1 }, frameIndex: 0 };
    expect(annotationSnapshotsEqual([before], [after])).toBe(false);
    expect(annotationValuesEqual([before], [after])).toBe(true);
    expect(annotationValuesEqual([before], [])).toBe(false);
    expect(annotationValuesEqual([before], [{ ...after, points: [9, 2, 3, 4] }])).toBe(false);
  });
  it("uses one stable equality rule for store history and async conflict checks", () => {
    expect(annotationShapesSnapshot([annotation])).toBe(JSON.stringify([annotation]));
    expect(annotationSnapshotsEqual([annotation], [{ ...annotation }])).toBe(true);
    expect(annotationSnapshotsEqual([annotation], [{ ...annotation, points: [2, 2, 3, 4] }])).toBe(
      false,
    );
  });
});
