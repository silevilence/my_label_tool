import { beforeEach, expect, it } from "vitest";
import { interpolateVideoTrack, markVideoKeyframe, videoTrackId } from "./video-interpolation";
import type { VideoProject } from "../types/video";
import type { AnnotationShape } from "../types/annotation";
import { useAnnotationStore } from "../store/useAnnotationStore";
const video: VideoProject = {
  schemaVersion: 1,
  sourcePath: "v.mp4",
  width: 100,
  height: 100,
  frameInterval: 2,
  totalFrames: 9,
  frames: [0, 2, 4, 6, 8].map((frameIndex) => ({
    name: `${frameIndex}.png`,
    frameIndex,
    timestampSeconds: frameIndex / 10,
  })),
};
const images = video.frames.map((frame) => ({ name: frame.name, path: frame.name }));
function shape(id: string, x: number, type: AnnotationShape["type"] = "rect"): AnnotationShape {
  return {
    id,
    type,
    labelId: "label",
    points:
      type === "rect" ? [x, x, 10, 20] : type === "point" ? [x, x] : [x, x, x + 5, x, x, x + 5],
    attributes: { videoTrackId: "track", videoKeyframe: true, confidence: 0.8 },
  };
}
beforeEach(() => {
  useAnnotationStore.getState().setFrameIndices({});
  useAnnotationStore.getState().replaceAnnotations({});
});
it("interpolates original pixel coordinates for rect, point and matching polygon vertices", () => {
  for (const type of ["rect", "point", "polygon"] as const) {
    const annotations = { "0.png": [shape("start", 0, type)], "8.png": [shape("end", 80, type)] };
    const plan = interpolateVideoTrack(video, images, annotations, "track");
    expect(plan.entries.map((entry) => entry.frameIndex)).toEqual([2, 4, 6]);
    expect(plan.entries[1].generated.points[0]).toBe(40);
    expect(plan.entries[1].generated.attributes).toMatchObject({
      videoInterpolated: true,
      videoKeyframe: false,
      videoTrackId: "track",
    });
    expect(new Set(plan.entries.map((entry) => entry.generated.id)).size).toBe(3);
    expect(annotations["0.png"][0].points[0]).toBe(0);
  }
});
it("uses piecewise segments and preserves unrelated targets", () => {
  const other = { ...shape("other", 99), attributes: undefined };
  const plan = interpolateVideoTrack(
    video,
    images,
    {
      "0.png": [shape("a", 0)],
      "4.png": [shape("b", 20)],
      "8.png": [shape("c", 80)],
      "2.png": [other],
    },
    "track",
  );
  expect(plan.entries.map((entry) => entry.generated.points[0])).toEqual([10, 50]);
  expect(plan.entries[0].annotations[0]).toBe(other);
});
it("rejects missing, duplicate, incompatible and nonfinite keyframes before any write", () => {
  const base = { "0.png": [shape("a", 0)], "8.png": [shape("b", 80)] };
  expect(() => interpolateVideoTrack(video, images, base, "")).toThrow();
  expect(() => interpolateVideoTrack(video, images, {}, "track")).toThrow();
  expect(() =>
    interpolateVideoTrack(
      video,
      images,
      { ...base, "0.png": [shape("a", 0), shape("b", 1)] },
      "track",
    ),
  ).toThrow();
  for (const end of [
    shape("b", 80, "point"),
    { ...shape("b", 80), labelId: "other" },
    { ...shape("b", 80), points: [1] },
    shape("b", NaN),
    { ...shape("b", 80), points: [0, 0, -1, 1] },
  ]) {
    expect(() =>
      interpolateVideoTrack(video, images, { ...base, "8.png": [end] }, "track"),
    ).toThrow();
  }
});
it("refreshes generated frames but refuses to replace a manual intermediate annotation", () => {
  const base = { "0.png": [shape("a", 0)], "8.png": [shape("b", 80)] };
  const manual = {
    ...shape("manual", 10),
    attributes: { videoTrackId: "track", videoKeyframe: false },
  };
  expect(() =>
    interpolateVideoTrack(video, images, { ...base, "2.png": [manual] }, "track"),
  ).toThrow();
  const generated = { ...manual, attributes: { ...manual.attributes, videoInterpolated: true } };
  const plan = interpolateVideoTrack(video, images, { ...base, "2.png": [generated] }, "track");
  expect(plan.entries[0].annotations).toHaveLength(1);
  expect(plan.entries[0].generated.points[0]).toBe(20);
});
it("marks a keyframe preserving attributes and promotes edited interpolation to a protected keyframe", () => {
  expect(videoTrackId(null)).toBe("");
  expect(() => markVideoKeyframe(shape("a", 0), " ")).toThrow();
  expect(markVideoKeyframe(shape("a", 0), "next").attributes).toMatchObject({
    videoTrackId: "next",
    confidence: 0.8,
    videoInterpolated: false,
  });
  const store = useAnnotationStore.getState();
  store.addAnnotation("2.png", {
    ...shape("generated", 20),
    attributes: { videoTrackId: "track", videoInterpolated: true },
  });
  store.updateAnnotation("2.png", "generated", { points: [10, 10, 10, 10] });
  expect(useAnnotationStore.getState().annotationsByImage["2.png"][0].attributes).toMatchObject({
    videoKeyframe: true,
    videoInterpolated: false,
  });
  store.undo();
  expect(
    useAnnotationStore.getState().annotationsByImage["2.png"][0].attributes?.videoInterpolated,
  ).toBe(true);
});
it("applies as ordinary frame history and supports undo/redo without mutating keyframes", () => {
  const original = { "0.png": [shape("a", 0)], "8.png": [shape("b", 80)] };
  const store = useAnnotationStore.getState();
  store.replaceAnnotations(original);
  store.insertAnnotationsBatch(
    interpolateVideoTrack(video, images, original, "track").entries,
    "replace",
  );
  for (let index = 0; index < 3; index++) store.undo();
  expect(useAnnotationStore.getState().annotationsByImage["0.png"]).toEqual(original["0.png"]);
  expect(useAnnotationStore.getState().annotationsByImage["4.png"]).toEqual([]);
  for (let index = 0; index < 3; index++) store.redo();
  expect(useAnnotationStore.getState().annotationsByImage["4.png"][0].points[0]).toBe(40);
});
