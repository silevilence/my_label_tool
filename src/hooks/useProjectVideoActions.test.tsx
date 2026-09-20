import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectVideoActions } from "./useProjectVideoActions";
import { importVideo, reextractVideo, cancelVideoImport, type ImageFile } from "../lib/tauri-api";
import { useOperations } from "../store/useOperations";
import type { ProjectVideo } from "../types/video";
import { useAnnotationStore } from "../store/useAnnotationStore";
vi.mock("../lib/tauri-api", () => ({
  importVideo: vi.fn(),
  reextractVideo: vi.fn(),
  cancelVideoImport: vi.fn().mockResolvedValue(undefined),
  selectVideoFile: vi.fn(),
  selectExportFolder: vi.fn(),
}));
let root: Root;
let actions: ReturnType<typeof useProjectVideoActions>;
let actualImages: ImageFile[];
let actualEntries: ProjectVideo[];
const error = vi.fn();
const selected = vi.fn();
function Harness() {
  const [entries, setEntries] = useState<ProjectVideo[]>([]);
  const [images, setImages] = useState([{ name: "photo.png", path: "C:/project/photo.png" }]);
  actualImages = images;
  actualEntries = entries;
  actions = useProjectVideoActions({
    folderPath: "C:/project",
    entries,
    images,
    setEntries,
    setImages,
    setSelectedPath: selected,
    setError: error,
    openFolder: vi.fn(),
  });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  useOperations.setState({ operations: [] });
  root = createRoot(document.createElement("div"));
  useAnnotationStore.getState().replaceAnnotations({
    "C:/project/photo.png": [{ id: "photo", type: "point", labelId: "label", points: [1, 2] }],
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});
it("merges all batch results without losing earlier frames, photos or annotations", async () => {
  vi.mocked(importVideo).mockImplementation(async (sourcePath, _folder, frameInterval) => ({
    folderPath: `C:/project/${sourcePath}`,
    video: {
      schemaVersion: 1,
      sourcePath,
      frameInterval:
        typeof frameInterval === "number" ? frameInterval : frameInterval.frameInterval,
      width: 100,
      height: 100,
      totalFrames: 1,
      frames: [{ name: "frame-000000.png", frameIndex: 0, timestampSeconds: 0 }],
    },
  }));
  await act(async () => root.render(<Harness />));
  const original = useAnnotationStore.getState().annotationsByImage;
  await act(async () => actions.startBatch(12, "C:/project", ["a.mp4", "b.mp4"]));
  expect(actualEntries).toHaveLength(2);
  expect(actualImages.map((image) => image.name)).toEqual([
    "photo.png",
    "a.mp4/frame-000000.png",
    "b.mp4/frame-000000.png",
  ]);
  expect(useAnnotationStore.getState().annotationsByImage).toEqual(original);
  expect(actions.batch).toMatchObject({ total: 2, completed: 2, finished: true });
  expect(actions.busy).toBe(false);
  await act(async () => actions.closeBatch());
  expect(actions.batch).toBeNull();
});
it("keeps the old frames and annotations after replacement failure or cancellation", async () => {
  const video = {
    schemaVersion: 1 as const,
    sourcePath: "C:/movie.mp4",
    frameInterval: 30,
    width: 100,
    height: 100,
    totalFrames: 1,
    frames: [{ name: "frame-000000.png", frameIndex: 0, timestampSeconds: 0 }],
  };
  vi.mocked(importVideo).mockResolvedValue({ folderPath: "C:/project/old", video });
  vi.mocked(reextractVideo).mockRejectedValue(new Error("recycle failed"));
  await act(async () => root.render(<Harness />));
  await act(async () => actions.start(30, "C:/project", video.sourcePath));
  await act(async () =>
    useAnnotationStore.getState().addAnnotation("C:/project/old/frame-000000.png", {
      id: "old",
      type: "point",
      labelId: "label",
      points: [1, 2],
    }),
  );
  const oldImages = actualImages;
  const annotations = useAnnotationStore.getState().annotationsByImage;
  await act(async () => actions.requestReextract(video.sourcePath, 10));
  await act(async () => actions.confirmReextract());
  expect(reextractVideo).not.toHaveBeenCalled();
  vi.spyOn(Date, "now").mockReturnValue(actions.replacement!.readyAt);
  await act(async () => actions.confirmReextract());
  expect(actions.replacementError).toBe("recycle failed");
  expect(actualImages).toBe(oldImages);
  expect(useAnnotationStore.getState().annotationsByImage).toBe(annotations);
  await act(async () => actions.cancelReextract());
  expect(actions.replacement).toBeNull();
});

it("reports interrupted re-extraction as cancellation and keeps the original frames", async () => {
  const video = {
    schemaVersion: 1 as const,
    sourcePath: "C:/movie.mp4",
    frameInterval: 30,
    width: 100,
    height: 100,
    totalFrames: 1,
    frames: [{ name: "frame-000000.png", frameIndex: 0, timestampSeconds: 0 }],
  };
  vi.mocked(importVideo).mockResolvedValue({ folderPath: "C:/project/old", video });
  await act(async () => root.render(<Harness />));
  await act(async () => actions.start(30, "C:/project", video.sourcePath));
  const originalImages = actualImages;
  const originalAnnotations = useAnnotationStore.getState().annotationsByImage;
  await act(async () => actions.requestReextract(video.sourcePath, 10));
  vi.spyOn(Date, "now").mockReturnValue(actions.replacement!.readyAt);
  let reject!: (error: Error) => void;
  vi.mocked(reextractVideo).mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.confirmReextract();
  });
  await act(async () => actions.cancelReextract());
  expect(cancelVideoImport).toHaveBeenCalledOnce();
  expect(useOperations.getState().canStart("video-frames")).toBe(false);
  await act(async () => {
    reject(new Error("VIDEO_INTERRUPTED"));
    await pending;
  });
  expect(actualImages).toBe(originalImages);
  expect(useAnnotationStore.getState().annotationsByImage).toBe(originalAnnotations);
  expect(actions.replacementError).toBe("");
  expect(actions.replacement).toBeNull();
  expect(useOperations.getState().operations.slice(-1)[0]).toMatchObject({
    status: "completed",
    kind: "warning",
  });
  expect(useOperations.getState().canStart("video-frames")).toBe(true);
});
