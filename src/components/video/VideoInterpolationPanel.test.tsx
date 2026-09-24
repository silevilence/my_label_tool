import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VideoInterpolationPanel } from "./VideoInterpolationPanel";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import type { VideoProject } from "../../types/video";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
const video: VideoProject = {
  schemaVersion: 1,
  sourcePath: "v.mp4",
  width: 100,
  height: 100,
  frameInterval: 1,
  totalFrames: 3,
  frames: [0, 1, 2].map((frameIndex) => ({
    name: `${frameIndex}.png`,
    frameIndex,
    timestampSeconds: frameIndex,
  })),
};
const images = video.frames.map((frame) => ({ name: frame.name, path: frame.name }));
let container: HTMLDivElement;
let root: Root;
const error = vi.fn();
const select = vi.fn();
async function render(path: string, disabled = false) {
  await act(async () =>
    root.render(
      <VideoInterpolationPanel
        video={video}
        images={images}
        selectedPath={path}
        selectedShape={useAnnotationStore.getState().annotationsByImage[path]?.[0] ?? null}
        disabled={disabled}
        onSelect={select}
        onError={error}
      />,
    ),
  );
}
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  )!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  error.mockClear();
  select.mockClear();
  useAnnotationStore.getState().setFrameIndices({ "0.png": 0, "1.png": 1, "2.png": 2 });
  useAnnotationStore.getState().replaceAnnotations(
    Object.fromEntries(
      [0, 2].map((frame) => [
        `${frame}.png`,
        [
          {
            id: String(frame),
            type: "rect" as const,
            labelId: "label",
            points: [frame * 10, 0, 10, 10],
          },
        ],
      ]),
    ),
    [{ id: "label", name: "label", color: "#fff", shapeType: "any" }],
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("marks two selected shapes, previews without writing, and applies the intermediate frame", async () => {
  await render("0.png");
  await click(text.markKeyframe);
  const track =
    useAnnotationStore.getState().annotationsByImage["0.png"][0].attributes?.videoTrackId;
  await render("2.png");
  await click(text.markKeyframe);
  expect(
    useAnnotationStore.getState().annotationsByImage["2.png"][0].attributes?.videoTrackId,
  ).toBe(track);
  await click(text.preview);
  expect(container.textContent).toContain(text.previewCount(1));
  expect(useAnnotationStore.getState().annotationsByImage["1.png"]).toBeUndefined();
  await click(text.viewFrame(2));
  expect(select).toHaveBeenCalledWith("1.png");
  await click(text.apply);
  expect(useAnnotationStore.getState().annotationsByImage["1.png"][0]).toMatchObject({
    points: [10, 0, 10, 10],
    frameIndex: 1,
  });
  expect(error.mock.calls.every(([message]) => message === "")).toBe(true);
});
it("rejects incomplete tracks and invalidates a preview when annotations change", async () => {
  await render("0.png");
  await click(text.markKeyframe);
  await click(text.preview);
  expect(error).toHaveBeenCalledWith(expect.stringContaining(text.needKeyframes));
  await render("2.png");
  await click(text.markKeyframe);
  await click(text.preview);
  await act(async () =>
    useAnnotationStore.getState().updateAnnotation("0.png", "0", { points: [5, 0, 10, 10] }),
  );
  expect(button(text.apply).disabled).toBe(true);
  await render("1.png", true);
  expect(button(text.markKeyframe).disabled).toBe(true);
  expect(button(text.preview).disabled).toBe(true);
});
