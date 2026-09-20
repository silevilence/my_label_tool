import { expect, it } from "vitest";
import { frameNavigation, frameSummaries } from "./video-frames";
import type { VideoProject } from "../types/video";
import type { AnnotationShape } from "../types/annotation";
const video: VideoProject = {
  schemaVersion: 1,
  sourcePath: "v",
  width: 100,
  height: 100,
  totalFrames: 40,
  frameInterval: 10,
  frames: [0, 10, 25, 39].map((frameIndex, i) => ({
    frameIndex,
    name: `${i}.png`,
    timestampSeconds: frameIndex / 30,
  })),
};
const images = video.frames.map((frame) => ({ name: frame.name, path: `dir/${frame.name}` }));
const shape: AnnotationShape = { id: "s", labelId: "l", type: "point", points: [1, 2] };
it("summarizes empty, single, partial annotations and sparse keyframes without positional joins", () => {
  expect(frameSummaries(null, {}, images)).toEqual([]);
  expect(frameSummaries({ ...video, frames: [] }, {}, [])).toEqual([]);
  const annotations = {
    [images[0].path]: [shape],
    [images[2].path]: [{ ...shape, attributes: { videoTrackId: "track", videoKeyframe: true } }],
    [images[3].path]: [{ ...shape, attributes: { videoKeyframe: true } }],
  };
  const frames = frameSummaries(video, annotations, images);
  expect(frameSummaries(video, annotations, images)).toBe(frames);
  expect(
    frames.map((frame) => [frame.index, frame.frameIndex, frame.annotated, frame.keyframe]),
  ).toEqual([
    [0, 0, true, false],
    [1, 10, false, false],
    [2, 25, true, true],
    [3, 39, true, false],
  ]);
  expect(frames[2].timestampSeconds).toBe(25 / 30);
  const partial = frameSummaries(video, annotations, [images[2], images[0]]);
  expect(partial.map((frame) => frame.path)).toEqual([images[0].path, images[2].path]);
  expect(partial[1].index).toBe(1);
  expect(partial[1].frameIndex).toBe(25);
  expect(
    frameSummaries(video, {}, images).every((frame) => !frame.annotated && !frame.keyframe),
  ).toBe(true);
  expect(frameSummaries({ ...video, frames: video.frames.slice(0, 1) }, {}, images)).toHaveLength(
    1,
  );
});
it("navigation stops at boundaries and rejects missing or fractional destinations", () => {
  const frames = frameSummaries(video, {}, images);
  let path = images[0].path;
  const nav = () =>
    frameNavigation(frames, path, (next) => {
      path = next;
    });
  expect(nav().canStep(-1)).toBe(false);
  expect(nav().step(-1)).toBe(false);
  expect(nav().step(1)).toBe(true);
  expect(path).toBe(images[1].path);
  expect(nav().select(3)).toBe(true);
  expect(nav().canStep(1)).toBe(false);
  expect(nav().select(images[0].path)).toBe(true);
  expect(nav().select("missing")).toBe(false);
  expect(nav().select(0.5)).toBe(false);
  expect(nav().step(0.5)).toBe(false);
  expect(nav().canStep(0)).toBe(false);
  expect(frameNavigation([], "missing", () => {}).step(1)).toBe(false);
  const missing = frameNavigation(frames, "missing", () => {});
  expect(missing.currentIndex).toBe(-1);
  expect(missing.canStep(1)).toBe(false);
});
