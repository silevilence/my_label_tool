import { describe, expect, it } from "vitest";
import type { ExportData } from "../../types/export";
import { exportCoco } from "./coco";
import { exportCustom } from "./custom";
import { exportVoc } from "./voc";
import { exportYolo } from "./yolo";

const data: ExportData = {
  labels: [
    { id: "person", name: "人&车", color: "#38bdf8", shapeType: "any" },
    { id: "lane", name: "车道", color: "#f97316", shapeType: "polygon" },
    { id: "nose", name: "鼻尖", color: "#a78bfa", shapeType: "point" },
  ],
  images: [
    {
      path: "C:/images/a.jpg",
      name: "a.jpg",
      width: 100,
      height: 50,
      annotations: [
        { id: "r1", type: "rect", labelId: "person", points: [10, 5, 20, 10] },
        { id: "p1", type: "polygon", labelId: "lane", points: [0, 0, 10, 0, 10, 10, 0, 10] },
        { id: "k1", type: "point", labelId: "nose", points: [3, 4] },
      ],
    },
  ],
};

describe("exporters", () => {
  it("exports COCO for rect, polygon and point annotations", () => {
    const exported = exportCoco(data);

    expect(exported.images).toEqual([{ id: 1, file_name: "a.jpg", width: 100, height: 50 }]);
    expect(exported.categories.map((category) => category.name)).toEqual(["人&车", "车道", "鼻尖"]);
    expect(exported.annotations[0]).toMatchObject({
      image_id: 1,
      category_id: 1,
      bbox: [10, 5, 20, 10],
      area: 200,
    });
    expect(exported.annotations[1]).toMatchObject({
      category_id: 2,
      bbox: [0, 0, 10, 10],
      area: 100,
      segmentation: [[0, 0, 10, 0, 10, 10, 0, 10]],
    });
    expect(exported.annotations[2]).toMatchObject({
      category_id: 3,
      bbox: [3, 4, 0, 0],
      keypoints: [3, 4, 2],
      num_keypoints: 1,
    });
  });

  it("exports YOLO txt only for rectangles and keeps empty image files", () => {
    const exported = exportYolo({
      ...data,
      images: [
        ...data.images,
        { path: "b.png", name: "b.png", width: 100, height: 100, annotations: [] },
      ],
    });

    expect(exported).toEqual([
      { path: "classes.txt", content: "人&车\n车道\n鼻尖\n" },
      { path: "a.txt", content: "0 0.2 0.2 0.2 0.2\n" },
      { path: "b.txt", content: "" },
    ]);
  });

  it("exports VOC XML with escaped label names and rounded boxes", () => {
    const exported = exportVoc({
      labels: [{ id: "person", name: "<person&car>", color: "#38bdf8", shapeType: "rect" }],
      images: [
        {
          path: "a.jpg",
          name: "a.jpg",
          width: 100,
          height: 50,
          annotations: [{ id: "r1", type: "rect", labelId: "person", points: [1.2, 2.7, 3.4, 4.1] }],
        },
      ],
    });

    expect(exported[0].path).toBe("a.xml");
    expect(exported[0].content).toContain("<name>&lt;person&amp;car&gt;</name>");
    expect(exported[0].content).toContain("<xmin>1</xmin>");
    expect(exported[0].content).toContain("<xmax>5</xmax>");
  });

  it("exports custom mapped records with fallback label names", () => {
    const exported = exportCustom(
      {
        labels: [],
        images: [
          {
            path: "a.jpg",
            name: "a.jpg",
            width: 10,
            height: 10,
            annotations: [
              {
                id: "missing-label",
                type: "point",
                labelId: "unknown",
                points: [2, 3],
                attributes: { occluded: true },
              },
            ],
          },
        ],
      },
      {
        imagePath: "path",
        imageName: "name",
        labelId: "label",
        labelName: "labelText",
        bbox: "box",
        attributes: "attrs",
      },
    );

    expect(exported).toEqual([
      {
        path: "a.jpg",
        name: "a.jpg",
        label: "unknown",
        labelText: "unknown",
        box: [2, 3, 0, 0],
        type: "point",
        points: [2, 3],
        attrs: { occluded: true },
      },
    ]);
  });
});
