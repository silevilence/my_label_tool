import { describe, expect, it } from "vitest";
import {
  mapPluginPrelabelResults,
  toPluginPrelabelClassMappings,
  toProjectRelativeImagePath,
} from "./prelabel-sources";

describe("plugin prelabel source adapters", () => {
  it("converts only images inside the project to safe relative paths", () => {
    expect(toProjectRelativeImagePath("C:\\project\\images\\a.jpg", "C:\\project")).toBe(
      "images/a.jpg",
    );
    expect(() => toProjectRelativeImagePath("C:\\other\\a.jpg", "C:\\project")).toThrow();
    expect(() =>
      toProjectRelativeImagePath("C:\\project\\images\\..\\a.jpg", "C:\\project"),
    ).toThrow();
  });

  it("sends only resolved mappings with host label names", () => {
    expect(
      toPluginPrelabelClassMappings(
        [
          { classIndex: 0, className: "car", labelId: "vehicle", excluded: false, source: "explicit" },
          { classIndex: 1, className: "person", excluded: true, source: "explicit-exclude" },
        ],
        [{ id: "vehicle", name: "车辆", color: "#38bdf8", shapeType: "rect" }],
      ),
    ).toEqual([{ modelClass: "car", labelId: "vehicle", labelName: "车辆" }]);
  });

  it("routes plugin shapes back to absolute images and replaces untrusted ids", () => {
    const results = mapPluginPrelabelResults(
      [
        {
          imagePath: "images/a.jpg",
          shapes: [
            { id: "plugin-id", type: "rect", labelId: "vehicle", points: [1, 2, 3, 4] },
          ],
        },
      ],
      new Map([["images/a.jpg", "C:/project/images/a.jpg"]]),
      () => "host-id",
    );
    expect(results).toEqual([
      {
        imagePath: "C:/project/images/a.jpg",
        annotations: [
          {
            id: "host-id",
            type: "rect",
            labelId: "vehicle",
            points: [1, 2, 3, 4],
            attributes: undefined,
            frameIndex: 0,
          },
        ],
      },
    ]);
  });
});
