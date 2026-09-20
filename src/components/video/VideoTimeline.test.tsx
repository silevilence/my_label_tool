import { frameSummaries } from "../../lib/video-frames";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VideoTimeline } from "./VideoTimeline";
import type { VideoProject } from "../../types/video";
const video: VideoProject = {
  schemaVersion: 1,
  sourcePath: "video.mp4",
  width: 64,
  height: 48,
  frameInterval: 3,
  totalFrames: 10,
  frames: [0, 3, 6, 9].map((frameIndex, index) => ({
    name: `${index}.png`,
    frameIndex,
    timestampSeconds: frameIndex / 10,
  })),
};
const frames = frameSummaries(
  video,
  {},
  video.frames.map((frame) => ({ name: frame.name, path: `dir/${frame.name}` })),
);
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("shows source positions, actual timestamps and sample count", async () => {
  await act(async () =>
    root.render(
      <VideoTimeline
        frames={frames}
        totalFrames={video.totalFrames}
        currentIndex={2}
        onSelectFrame={vi.fn()}
      />,
    ),
  );
  expect(container.textContent).toContain("源帧 7 / 10");
  expect(container.textContent).toContain("0.600 秒");
  expect(container.textContent).toContain("已抽取 4 帧");
  expect(container.querySelector("input")?.value).toBe("2");
});
it("scrubs to the first and last extracted frame without inventing missing frames", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(
      <VideoTimeline
        frames={frames}
        totalFrames={video.totalFrames}
        currentIndex={1}
        onSelectFrame={select}
      />,
    ),
  );
  const slider = container.querySelector("input")!;
  for (const value of ["3", "0"]) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        slider,
        value,
      );
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  expect(select.mock.calls).toEqual([[3], [0]]);
});
it("handles missing selection, one frame, and disabled extraction state", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(
      <VideoTimeline
        frames={frames}
        totalFrames={video.totalFrames}
        currentIndex={-1}
        onSelectFrame={select}
      />,
    ),
  );
  expect(container.querySelector("input")).toBeNull();
  await act(async () =>
    root.render(
      <VideoTimeline
        frames={frames.slice(0, 1)}
        totalFrames={1}
        currentIndex={0}
        onSelectFrame={select}
      />,
    ),
  );
  expect(container.querySelector("input")?.disabled).toBe(true);
  await act(async () =>
    root.render(
      <VideoTimeline
        frames={frames}
        totalFrames={video.totalFrames}
        currentIndex={0}
        disabled
        onSelectFrame={select}
      />,
    ),
  );
  expect(container.querySelector("input")?.disabled).toBe(true);
});
