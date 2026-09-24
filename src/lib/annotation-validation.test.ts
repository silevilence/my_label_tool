import { describe, expect, it } from "vitest";
import { resolveLabel, validateAnnotationCore } from "./annotation-validation";
import type { LabelConfig } from "../types/annotation";
const labels: LabelConfig[] = [{ id: "a", name: "车辆", color: "#fff", shapeType: "any" }];
describe("shared annotation constraints", () => {
  it("resolves unique names and ids without silently choosing duplicates", () => {
    expect(resolveLabel(labels, { name: "车辆" }).id).toBe("a");
    expect(resolveLabel(labels, { id: "a" }).name).toBe("车辆");
    expect(() => resolveLabel(labels, { name: "missing" })).toThrow("LABEL_NOT_FOUND");
    expect(() => resolveLabel([...labels, { ...labels[0], id: "b" }], { name: "车辆" })).toThrow(
      "LABEL_AMBIGUOUS",
    );
  });
  it("validates types, membership, point counts and finite coordinates", () => {
    const shape = { labelId: "a", type: "rect", points: [0, 0, 10, 20] };
    expect(() => validateAnnotationCore(shape, labels)).not.toThrow();
    for (const bad of [
      null,
      {},
      { ...shape, labelId: "" },
      { ...shape, labelId: "missing" },
      { ...shape, type: "other" },
      { ...shape, points: [0] },
      { ...shape, points: [0, 0, Infinity, 1] },
    ])
      expect(() => validateAnnotationCore(bad, labels)).toThrow();
    expect(() => validateAnnotationCore(shape, [{ ...labels[0], shapeType: "point" }])).toThrow();
    expect(() => validateAnnotationCore({ ...shape, type: "point", points: [0, 0] })).not.toThrow();
    expect(() =>
      validateAnnotationCore({ ...shape, type: "polygon", points: [0, 0, 1, 1, 2, 2] }),
    ).not.toThrow();
  });
});
