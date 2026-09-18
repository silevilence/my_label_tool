import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectVideoActions } from "./useProjectVideoActions";
import { importVideo, type ImageFile } from "../lib/tauri-api";
import type { ProjectVideo } from "../types/video";
import { useAnnotationStore } from "../store/useAnnotationStore";
vi.mock("../lib/tauri-api", () => ({
  importVideo: vi.fn(),
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
  root = createRoot(document.createElement("div"));
  useAnnotationStore
    .getState()
    .replaceAnnotations({
      "C:/project/photo.png": [{ id: "photo", type: "point", labelId: "label", points: [1, 2] }],
    });
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("merges all batch results without losing earlier frames, photos or annotations", async () => {
  vi.mocked(importVideo).mockImplementation(async (sourcePath, _folder, frameInterval) => ({
    folderPath: `C:/project/${sourcePath}`,
    video: {
      schemaVersion: 1,
      sourcePath,
      frameInterval,
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
