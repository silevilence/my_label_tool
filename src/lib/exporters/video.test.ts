import Ajv2020 from "ajv/dist/2020";
import { expect, it } from "vitest";
import { exportVideo } from "./video";
import { exportCoco } from "./coco";
import { exportVoc } from "./voc";
import { exportYolo } from "./yolo";
import { parseNativeJsonImport } from "../importers";
import type { VideoProject } from "../../types/video";
import type { AnnotationShape, LabelConfig } from "../../types/annotation";
import schema from "../../../docs/video-annotation.schema.json";
import exporterSchema from "../../../docs/plugin-exporter.schema.json";
const validate = new Ajv2020({ strict: true, allErrors: true })
  .addSchema(exporterSchema)
  .compile(schema);
const video: VideoProject = {
  schemaVersion: 1,
  sourcePath: "C:/source/视频.mp4",
  width: 64,
  height: 48,
  frameInterval: 30,
  totalFrames: 31,
  frames: [
    { name: "frame-000000.png", frameIndex: 0, timestampSeconds: 0 },
    { name: "frame-000001.png", frameIndex: 30, timestampSeconds: 1.1 },
  ],
};
const images = video.frames.map((frame) => ({ name: frame.name, path: `C:/frames/${frame.name}` }));
const labels: LabelConfig[] = [{ id: "car", name: "汽车", color: "#123456", shapeType: "any" }];
const rect: AnnotationShape = {
  id: "one",
  labelId: "car",
  type: "rect",
  points: [8, 6, 16, 12],
  frameIndex: 0,
  attributes: { videoTrackId: "car-1", videoKeyframe: true, videoInterpolated: false },
};
it("exports FPS sampling metadata without changing source frame numbers", () => {
  const result = exportVideo({ ...video, frameInterval: 1, targetFps: 5 }, images, labels, {
    [images[1].path]: [rect],
  });
  expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
  expect(result.video.targetFps).toBe(5);
  expect(result.images[1].annotations[0].frameIndex).toBe(30);
  expect(validate({ ...result, video: { ...result.video, targetFps: 0 } })).toBe(false);
});
it("exports complete metadata, empty frames, original pixel coordinates and track attributes", () => {
  const result = exportVideo(video, images, labels, { [images[1].path]: [rect] });
  expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
  expect(result.images[0].annotations).toEqual([]);
  expect(result.images[1]).toMatchObject({
    path: "frame-000001.png",
    width: 64,
    height: 48,
    annotations: [{ frameIndex: 30, points: [8, 6, 16, 12], attributes: rect.attributes }],
  });
  expect(result.video.frames[1].timestampSeconds).toBe(1.1);
  expect(rect.frameIndex).toBe(0);
  result.images[1].annotations[0].points[0] = 100;
  expect(rect.points[0]).toBe(8);
});
it("remains readable by the native annotation parser and supports all shape types", () => {
  const shapes: AnnotationShape[] = [
    rect,
    { ...rect, id: "point", type: "point", points: [4, 5] },
    { ...rect, id: "poly", type: "polygon", points: [0, 0, 4, 0, 0, 5] },
  ];
  const result = exportVideo(video, images, labels, { [images[1].path]: shapes });
  const parsed = parseNativeJsonImport(JSON.stringify(result));
  expect(parsed.images[1].annotations.map((shape) => shape.type)).toEqual([
    "rect",
    "point",
    "polygon",
  ]);
  expect(parsed.images[1].annotations.every((shape) => shape.frameIndex === 30)).toBe(true);
  expect(validate(result)).toBe(true);
});
it("rejects missing images, dangling label references and nonfinite coordinates", () => {
  expect(() => exportVideo(video, [], labels, {})).toThrow();
  expect(() => exportVideo(video, images, [], { [images[0].path]: [rect] })).toThrow();
  expect(() =>
    exportVideo(video, images, labels, { [images[0].path]: [{ ...rect, points: [NaN, 0, 1, 1] }] }),
  ).toThrow();
});

it("rejects malformed geometry instead of exporting invalid video shapes", () => {
  const invalid: AnnotationShape[] = [
    { ...rect, points: [0, 0, -1, 2] },
    { ...rect, points: [0, 0] },
    { ...rect, type: "point", points: [0, 0, 1] },
    { ...rect, type: "polygon", points: [0, 0, 1, 1, 2, 2, 3] },
  ];
  for (const shape of invalid)
    expect(() => exportVideo(video, images, labels, { [images[0].path]: [shape] })).toThrow();
});
it("schema rejects incompatible versions and malformed metadata", () => {
  const result = exportVideo(video, images, labels, {});
  expect(validate({ ...result, schemaVersion: 2 })).toBe(false);
  expect(validate({ ...result, video: { ...video, frameInterval: 0 } })).toBe(false);
  expect(
    validate({
      ...result,
      video: { ...video, frames: [{ ...video.frames[0], name: "../escape.png" }] },
    }),
  ).toBe(false);
  expect(
    validate({
      ...result,
      video: { ...video, frames: [{ ...video.frames[0], timestampSeconds: -1 }] },
    }),
  ).toBe(false);
});
it("keeps standard exporters useful for frame datasets with correct standard coordinates", () => {
  const result = exportVideo(video, images, labels, { [images[1].path]: [rect] });
  const coco = exportCoco(result);
  expect(coco.images[1].file_name).toBe("frame-000001.png");
  expect(coco.annotations[0].bbox).toEqual([8, 6, 16, 12]);
  const voc = exportVoc(result).find((file) => file.path === "frame-000001.xml")!;
  const xml = new DOMParser().parseFromString(voc.content, "application/xml");
  expect(xml.querySelector("parsererror")).toBeNull();
  expect(xml.querySelector("xmin")?.textContent).toBe("8");
  expect(xml.querySelector("xmax")?.textContent).toBe("24");
  const yolo = exportYolo(result).find((file) => file.path === "frame-000001.txt")!;
  expect(yolo.content.trim().split(/\s+/).map(Number)).toEqual([0, 0.25, 0.25, 0.25, 0.25]);
});
