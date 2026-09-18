import { expect, it } from "vitest";
import { videoFrameIndices, videoImages } from "./video-images";
import type { VideoProject } from "../types/video";
const video: VideoProject = {
  schemaVersion: 1,
  sourcePath: "x.mp4",
  width: 10,
  height: 10,
  frameInterval: 2,
  totalFrames: 4,
  frames: [
    { name: "a.png", frameIndex: 0, timestampSeconds: 0 },
    { name: "b.png", frameIndex: 2, timestampSeconds: 0.2 },
  ],
};
it("keeps decoded order and excludes unrelated images", () => {
  expect(
    videoImages(video, [
      { name: "b.png", path: "b" },
      { name: "other.png", path: "other" },
      { name: "a.png", path: "a" },
    ]).map((image) => image.path),
  ).toEqual(["a", "b"]);
});
it("preserves image projects and rejects missing video frames", () => {
  const images = [{ name: "a.png", path: "a" }];
  expect(videoImages(null, images)).toBe(images);
  expect(() => videoImages(video, images)).toThrow();
});

it("binds full image paths to source frame indices without using sample ordinals", () => {
  expect(
    videoFrameIndices(video, [
      { name: "a.png", path: "folder/a.png" },
      { name: "b.png", path: "folder/b.png" },
    ]),
  ).toEqual({ "folder/a.png": 0, "folder/b.png": 2 });
  expect(videoFrameIndices(null, [])).toEqual({});
});
