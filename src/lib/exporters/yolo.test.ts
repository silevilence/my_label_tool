import { expect, it } from "vitest";
import { exportYolo } from "./yolo";
import type { ExportData } from "../../types/export";
const fixture = (): ExportData => ({
  labels: [{ id: "car", name: "车", color: "#ffffff", shapeType: "rect" }],
  images: [
    {
      path: "one.png",
      name: "one.png",
      width: 100,
      height: 100,
      annotations: [{ id: "r", labelId: "car", type: "rect", points: [10, 20, 30, 40] }],
    },
  ],
});
it.each([
  [0, 0, 0, 2],
  [0, 0, -1, 2],
  [90, 0, 20, 20],
  [-1, 0, 2, 2],
  [0, 0, NaN, 2],
  [1, 2],
])("rejects invalid frame rectangles %s before serialization", (...points) => {
  const data = fixture();
  data.images[0].annotations[0].points = points;
  expect(() => exportYolo(data)).toThrow("YOLO 矩形");
});
it("rejects unknown labels and invalid frame dimensions", () => {
  const data = fixture();
  data.images[0].annotations[0].labelId = "missing";
  expect(() => exportYolo(data)).toThrow("已知标签");
  data.images[0].width = 0;
  expect(() => exportYolo(data)).toThrow("图片尺寸无效");
});
it("rejects duplicate output stems and reserved classes.txt instead of overwriting files", () => {
  const data = fixture();
  data.images.push({ ...data.images[0], name: "ONE.jpg" });
  expect(() => exportYolo(data)).toThrow("文件名冲突");
  data.images = [{ ...data.images[0], name: "classes.png" }];
  expect(() => exportYolo(data)).toThrow("文件名冲突");
});
it("uses label order as class ids and preserves frame paths without collisions", () => {
  const data = fixture();
  data.labels.unshift({ id: "person", name: "人", shapeType: "rect", color: "#ffffff" });
  data.images[0].name = "video-one/frame-000003.png";
  expect(exportYolo(data)).toEqual([
    { path: "classes.txt", content: "人\n车\n" },
    { path: "video-one/frame-000003.txt", content: "1 0.25 0.4 0.3 0.4\n" },
  ]);
});
