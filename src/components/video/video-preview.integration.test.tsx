import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../../App";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import { DEFAULT_LABELS } from "../../lib/defaults/labels";
import type { ImageFile } from "../../lib/tauri-api";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

vi.mock("react-konva", () =>
  Object.fromEntries(
    [
      "Circle",
      "Image",
      "Layer",
      "Label",
      "Line",
      "Rect",
      "Stage",
      "Tag",
      "Text",
      "Transformer",
    ].map((name) => [name, () => null]),
  ),
);
vi.mock("../../lib/updater", () => ({ checkAppUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock("../../hooks/useImageLoader", () => {
  const bitmap = { width: 100, height: 100, naturalWidth: 100, naturalHeight: 100 };
  return {
    useImageLoader: (images: ImageFile[], path: string) => ({
      selectedImage: images.find((image) => image.path === path) ?? null,
      loadedImage: images.some((image) => image.path === path) ? bitmap : null,
      isImageLoading: false,
      imageLoadError: "",
    }),
  };
});
vi.mock("../../lib/tauri-api", async (original) => ({
  ...(await original<typeof import("../../lib/tauri-api")>()),
  loadLabelConfigs: vi.fn().mockResolvedValue([]),
  loadLabelTemplates: vi.fn().mockResolvedValue([]),
  loadShortcuts: vi.fn().mockResolvedValue({}),
  loadPluginLabelPresets: vi.fn().mockResolvedValue({ presets: [] }),
  loadPluginExportFormats: vi.fn().mockResolvedValue({ formats: [] }),
  loadPluginPrelabelSources: vi.fn().mockResolvedValue({ sources: [] }),
  loadPrelabelModelLibrary: vi
    .fn()
    .mockResolvedValue((await import("../../types/prelabel")).EMPTY_PRELABEL_MODEL_LIBRARY),
  listImageFiles: vi.fn().mockResolvedValue([{ name: "photo.png", path: "C:/project/photo.png" }]),
  listTextFiles: vi.fn().mockResolvedValue([]),
  selectImageFolder: vi.fn().mockResolvedValue("C:/project"),
  listProjectVideos: vi.fn().mockResolvedValue([
    {
      sourcePath: "C:/movie.mp4",
      folderPath: "C:/project/video",
      video: {
        schemaVersion: 1,
        sourcePath: "C:/movie.mp4",
        width: 100,
        height: 100,
        frameInterval: 1,
        totalFrames: 3,
        frames: [0, 1, 2].map((frameIndex) => ({
          name: `${frameIndex}.png`,
          frameIndex,
          timestampSeconds: frameIndex,
        })),
      },
    },
  ]),
}));

let root: Root;
let container: HTMLDivElement;
const path = (frame: number) => `C:/project/video/${frame}.png`;
const shape = (frame: number) => ({
  id: `shape-${frame}`,
  type: "rect" as const,
  labelId: DEFAULT_LABELS[0].id,
  points: [frame * 10, 10, 20, 30],
  attributes: { videoTrackId: "track", videoKeyframe: true },
});
async function click(label: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
async function openVideo() {
  await act(async () => root.render(<App />));
  await act(async () => document.body.querySelector<HTMLButtonElement>('button[aria-label="打开菜单"]')!.click());
  await click("打开项目文件夹");
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('button[title="C:/movie.mp4"]')!.click(),
  );
  await act(async () => {
    useAnnotationStore.getState().replaceAnnotations({ [path(0)]: [shape(0)] });
    useAnnotationStore.getState().selectShape("shape-0");
  });
}
async function preparePreview() {
  await openVideo();
  await act(async () =>
    useAnnotationStore
      .getState()
      .insertAnnotationsBatch([{ imagePath: path(2), annotations: [shape(2)] }], "replace"),
  );
  await click(text.preview);
}
function overlay() {
  return document.body.querySelector(`svg[aria-label="${text.previewOverlay}"]`);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useAnnotationStore.getState().replaceAnnotations({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("automatically dismisses the real interpolation error instead of leaving it on the canvas", async () => {
  await openVideo();
  await click(text.preview);
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(text.needKeyframes);
  await act(async () => vi.advanceTimersByTime(6000));
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
});

it("shows an unapplied interpolation directly on its frame and clears the preceding error", async () => {
  await openVideo();
  await click(text.preview);
  await act(async () =>
    useAnnotationStore
      .getState()
      .insertAnnotationsBatch([{ imagePath: path(2), annotations: [shape(2)] }], "replace"),
  );
  await click(text.preview);
  expect.soft(document.body.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.querySelector('svg[aria-label="插值预览（尚未应用）"] rect')).not.toBeNull();
  expect(useAnnotationStore.getState().annotationsByImage[path(1)]).toBeUndefined();
});

it("allows closing an error and gives a repeated error its own full display duration", async () => {
  await openVideo();
  await click(text.preview);
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭错误提示"]')!.click(),
  );
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  await click(text.preview);
  await act(async () => vi.advanceTimersByTime(4000));
  await click(text.preview);
  await act(async () => vi.advanceTimersByTime(1500));
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(text.needKeyframes);
  await act(async () => vi.advanceTimersByTime(3500));
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
});

it("cancels without changing annotations or history, and applies only on confirmation", async () => {
  await preparePreview();
  const state = useAnnotationStore.getState();
  const rect = overlay()!.querySelector("rect")!;
  expect(["x", "y", "width", "height"].map((name) => rect.getAttribute(name))).toEqual([
    "10",
    "10",
    "20",
    "30",
  ]);
  expect(
    [...document.body.querySelectorAll('button[aria-current="true"]')].map(
      (button) => button.textContent,
    ),
  ).toContain(text.viewFrame(2));
  await click(text.cancelPreview);
  expect(overlay()).toBeNull();
  expect(useAnnotationStore.getState().annotationsByImage).toBe(state.annotationsByImage);
  expect(useAnnotationStore.getState().undoStack).toBe(state.undoStack);
  await click(text.preview);
  expect(overlay()).not.toBeNull();
  await click(text.apply);
  expect(overlay()).toBeNull();
  expect(useAnnotationStore.getState().annotationsByImage[path(1)][0]).toMatchObject({
    points: [10, 10, 20, 30],
    frameIndex: 1,
  });
  await act(async () => useAnnotationStore.getState().undo());
  expect(useAnnotationStore.getState().annotationsByImage[path(1)] ?? []).toEqual([]);
});

it("removes stale ghosts after editing a keyframe and recomputes before applying", async () => {
  await preparePreview();
  await act(async () =>
    useAnnotationStore.getState().updateAnnotation(path(0), "shape-0", { points: [4, 10, 20, 30] }),
  );
  expect(overlay()).toBeNull();
  expect(
    [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === text.apply,
    )?.disabled,
  ).toBe(true);
  await click(text.preview);
  expect(overlay()!.querySelector("rect")?.getAttribute("x")).toBe("12");
});

it("shows the ghost only on generated frames and clears it when switching to a photo", async () => {
  await preparePreview();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })),
  );
  expect(overlay()).toBeNull();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })),
  );
  expect(overlay()).not.toBeNull();
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('button[title="C:/project/photo.png"]')!.click(),
  );
  expect(overlay()).toBeNull();
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('button[title="C:/movie.mp4"]')!.click(),
  );
  expect(overlay()).toBeNull();
});
