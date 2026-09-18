import { expect, it } from "vitest";
import { videoImages } from "./video-images";
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
