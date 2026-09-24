import { expect, it } from "vitest";
import { labelSampleCandidates, sampleCropBounds } from "./label-sample-crops";
import type { AnnotationShape } from "../types/annotation";

const shape = (
  type: AnnotationShape["type"],
  points: number[],
  labelId = "a",
): AnnotationShape => ({ id: "s", type, points, labelId });
it("uses original pixel bounds for rectangles, polygon extents and point neighborhoods", () => {
  expect(sampleCropBounds(shape("rect", [1.5, 2.5, 30, 40]))).toEqual({
    x: 1.5,
    y: 2.5,
    width: 30,
    height: 40,
  });
  expect(sampleCropBounds(shape("polygon", [5, 10, 20, 30, 2, 14]))).toEqual({
    x: 2,
    y: 10,
    width: 18,
    height: 20,
  });
  expect(sampleCropBounds(shape("point", [10, 20]))).toEqual({
    x: -22,
    y: -12,
    width: 64,
    height: 64,
  });
});
it("omits invalid and empty-area annotations", () => {
  for (const invalid of [
    shape("rect", [0, 0, 0, 10]),
    shape("rect", [0, 0, -10, 10]),
    shape("rect", [1]),
    shape("point", [1]),
    shape("point", [NaN, 0]),
    shape("polygon", [1, 2, 3, 4]),
    shape("polygon", [1, 2, 3, 4, 5, 6, 7]),
    shape("polygon", [1, 1, 1, 2, 1, 3]),
  ])
    expect(sampleCropBounds(invalid)).toBeNull();
});
it("lists matching annotations across the full project, prioritizes current image, excludes stale paths", () => {
  const result = labelSampleCandidates(
    [
      { path: "a.png", name: "a.png" },
      { path: "b.png", name: "b.png" },
    ],
    {
      "a.png": [shape("rect", [1, 2, 3, 4]), shape("point", [2, 3], "other")],
      "b.png": [shape("point", [10, 20])],
      "removed.png": [shape("rect", [1, 2, 3, 4])],
    },
    "a",
    "b.png",
  );
  expect(result.map((item) => item.imagePath)).toEqual(["b.png", "a.png"]);
  expect(result[0].annotationId).toBe("s");
  expect(labelSampleCandidates([{ path: "none.png", name: "none.png" }], {}, "a", "")).toEqual([]);
});
