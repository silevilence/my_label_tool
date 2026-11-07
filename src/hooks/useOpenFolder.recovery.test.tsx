import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useOpenFolder } from "./useOpenFolder";
import { useProjectRecovery } from "./useProjectRecovery";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOperations } from "../store/useOperations";
import { useRecoveryStore } from "../store/useRecoveryStore";
import { usePromptStore } from "../lib/prompts";
import type { ImageFile } from "../lib/tauri-api";
import type { RecoveryMetadata, RecoveryWrite } from "../types/recovery";
import type { ProjectVideo } from "../types/video";
const api = vi.hoisted(() => ({
  listImageFiles: vi.fn(),
  listProjectVideos: vi.fn(),
  loadVideoProject: vi.fn(),
  selectImageFolder: vi.fn(),
  loadRecovery: vi.fn(),
  saveRecovery: vi.fn(),
  forkRecovery: vi.fn(),
  openRecoveryDirectory: vi.fn(),
  lastRecoveryProject: vi.fn(),
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => api }));
const label = { id: "l", name: "original", color: "#ffffff", shapeType: "any" as const };
const shape = { id: "s", type: "rect" as const, labelId: "l", points: [1, 2, 3, 4] };
const initialMetadata = { labels: [label], projectConfig: null, configPath: "" };
let root: Root;
let open: (path?: string) => Promise<boolean>;
let fallback: (path: string, images: ImageFile[]) => Promise<void>;
let changeMetadata: (value: Omit<RecoveryMetadata, "savedAt" | "selectedPath">) => void;
let visibleFolder: string, visibleMetadata: Omit<RecoveryMetadata, "savedAt" | "selectedPath">;
const report = vi.fn();
function Harness() {
  const [folder, setFolder] = useState("");
  const [videos, setVideos] = useState<ProjectVideo[]>([]);
  const [metadata, setMetadata] =
    useState<Omit<RecoveryMetadata, "savedAt" | "selectedPath">>(initialMetadata);
  changeMetadata = setMetadata;
  visibleFolder = folder;
  visibleMetadata = metadata;
  const recovery = useProjectRecovery({
    folder,
    metadata,
    apply: setMetadata,
    report,
    notify: vi.fn(),
  });
  open = useOpenFolder({
    folderPath: folder,
    projectVideos: videos,
    setProjectVideos: setVideos,
    beforeOpen: recovery.beforeOpen,
    onOpenFinished: recovery.openFinished,
    maybeLoadProjectConfig: (path, images) =>
      recovery.load(path, images, () => fallback(path, images)),
    setFolderPath: setFolder,
    setImages: useAnnotationStore.getState().setImages,
    setSelectedPath: useAnnotationStore.getState().select,
    setError: report,
  });
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  useOperations.setState({ operations: [], mcpControlled: false });
  useAnnotationStore.setState(useAnnotationStore.getInitialState());
  usePromptStore.setState({ confirmQueue: [], promptQueue: [], choiceQueue: [] });
  useRecoveryStore.setState({
    settings: { mode: "switch", intervalSeconds: 10 },
    manualPending: 0,
  });
  api.loadRecovery.mockResolvedValue(null);
  api.listProjectVideos.mockResolvedValue([]);
  api.listImageFiles.mockImplementation(async (path: string) => [
    { path: `${path}/a.png`, name: "a.png" },
  ]);
  api.saveRecovery.mockImplementation(
    async (_folder: string, update: RecoveryWrite) => update.expectedRevision + 1,
  );
  api.onCloseRequested.mockResolvedValue(vi.fn());
  api.destroy.mockResolvedValue(undefined);
  fallback = async () => {};
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
it("rolls back images, history, folder and metadata on import failure and continues protecting the old session", async () => {
  await act(async () => {
    expect(await open("C:/old")).toBe(true);
  });
  await settle();
  act(() => useAnnotationStore.getState().addAnnotation("C:/old/a.png", shape));
  const original = useAnnotationStore.getState();
  fallback = async () => {
    changeMetadata({ ...initialMetadata, labels: [{ ...label, name: "failed project" }] });
    throw new Error("text adapter unavailable");
  };
  await act(async () => {
    expect(await open("C:/failed")).toBe(false);
  });
  expect(visibleFolder).toBe("C:/old");
  expect(visibleMetadata.labels).toEqual([label]);
  expect(useAnnotationStore.getState().annotationsByImage).toBe(original.annotationsByImage);
  expect(useAnnotationStore.getState().undoStack).toBe(original.undoStack);
  expect(useAnnotationStore.getState().selectedPath).toBe("C:/old/a.png");
  expect(api.saveRecovery.mock.calls.every(([folder]) => folder === "C:/old")).toBe(true);
  act(() =>
    useAnnotationStore.getState().addAnnotation("C:/old/a.png", { ...shape, id: "second" }),
  );
  await act(async () => {
    api.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() });
  });
  expect(api.destroy).toHaveBeenCalledOnce();
  expect(api.saveRecovery.mock.lastCall![1].changes["a.png"]).toHaveLength(2);
});
it("failed first open leaves no unprotected editable project", async () => {
  fallback = async () => {
    throw new Error("read failed");
  };
  await act(async () => {
    expect(await open("C:/failed")).toBe(false);
  });
  expect(visibleFolder).toBe("");
  expect(useAnnotationStore.getState().images).toEqual([]);
  expect(api.saveRecovery).not.toHaveBeenCalled();
  fallback = async () => {};
  await act(async () => {
    expect(await open("C:/working")).toBe(true);
  });
  await settle();
  expect(visibleFolder).toBe("C:/working");
  expect(api.saveRecovery).toHaveBeenCalled();
});
