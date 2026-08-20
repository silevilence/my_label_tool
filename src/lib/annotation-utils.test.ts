import { describe, expect, it } from "vitest";
import { annotationShapesEqual, annotationShapesSnapshot } from "./annotation-utils";
import type { AnnotationShape } from "../types/annotation";

const annotation: AnnotationShape = {
  id: "shape-1",
  type: "rect",
  labelId: "person",
  points: [1, 2, 3, 4],
  frameIndex: 0,
};

describe("annotation snapshots", () => {
  it("uses one stable equality rule for store history and async conflict checks", () => {
    expect(annotationShapesSnapshot([annotation])).toBe(JSON.stringify([annotation]));
    expect(annotationShapesEqual([annotation], [{ ...annotation }])).toBe(true);
    expect(annotationShapesEqual([annotation], [{ ...annotation, points: [2, 2, 3, 4] }])).toBe(
      false,
    );
  });
});
