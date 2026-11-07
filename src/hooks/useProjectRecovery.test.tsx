import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectRecovery } from "./useProjectRecovery";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useRecoveryStore } from "../store/useRecoveryStore";
import { useOperations } from "../store/useOperations";
import { usePromptStore } from "../lib/prompts";
import type { RecoveryMetadata, RecoveryWrite } from "../types/recovery";

const api = vi.hoisted(() => ({
  loadRecovery: vi.fn(),
  forkRecovery: vi.fn(),
  openRecoveryDirectory: vi.fn(),
  saveRecovery: vi.fn(),
  lastRecoveryProject: vi.fn(),
  destroy: vi.fn(),
  onCloseRequested: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => api }));
const label = { id: "l", name: "标签", color: "#ffffff", shapeType: "any" as const };
const shape = { id: "s", type: "rect" as const, labelId: "l", points: [1, 2, 3, 4] };
let root: Root;
let model: ReturnType<typeof useProjectRecovery>;
let metadata: Omit<RecoveryMetadata, "savedAt" | "selectedPath">;
const report = vi.fn(),
  notify = vi.fn(),
  apply = vi.fn();
const images = ["a", "b", "c"].map((n) => ({ name: `${n}.png`, path: `C:/project/${n}.png` }));
function Harness() {
  model = useProjectRecovery({ folder: "C:/project", metadata, apply, report, notify });
  return null;
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function open() {
  await act(async () => {
    expect(await model.beforeOpen("C:/project")).toBe(true);
    useAnnotationStore.getState().setImages(images);
    const loaded = model.load("C:/project", images, async () => {});
    await vi.advanceTimersByTimeAsync(0);
    await loaded;
    model.openFinished();
  });
  await tick();
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  metadata = { labels: [label], projectConfig: null, configPath: "" };
  api.loadRecovery.mockResolvedValue(null);
  api.lastRecoveryProject.mockResolvedValue(null);
  api.saveRecovery.mockImplementation(
    async (_folder: string, update: RecoveryWrite) => update.expectedRevision + 1,
  );
  api.onCloseRequested.mockResolvedValue(vi.fn());
  api.destroy.mockResolvedValue(undefined);
  useOperations.setState({ operations: [], mcpControlled: false });
  useAnnotationStore.setState(useAnnotationStore.getInitialState());
  usePromptStore.setState({ confirmQueue: [], promptQueue: [], choiceQueue: [] });
  useRecoveryStore.setState({
    settings: { mode: "off", intervalSeconds: 10 },
    status: { dirty: false, saving: false, savedAt: "", error: "" },
    retry: null,
    manualPending: 0,
    resolveConflict: null,
    openArchives: null,
  });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it("blocks reload keys in focused inputs without changing annotations", async () => {
  await open();
  act(() => useAnnotationStore.getState().addAnnotation(images[0].path, shape));
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  for (const key of [
    { key: "F5" },
    { key: "F5", ctrlKey: true },
    { key: "r", ctrlKey: true, shiftKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(useAnnotationStore.getState().annotationsByImage[images[0].path]).toHaveLength(1);
  expect(api.saveRecovery).not.toHaveBeenCalled();
  input.remove();
});
it("off mode does not write, and cancelling project replacement preserves all changes", async () => {
  await open();
  act(() => {
    useAnnotationStore.getState().addAnnotation(images[0].path, shape);
    useAnnotationStore.getState().select(images[1].path);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  let leaving!: Promise<boolean>;
  await act(async () => {
    leaving = model.beforeOpen("C:/other");
  });
  expect(usePromptStore.getState().confirmQueue).toHaveLength(1);
  await act(async () => usePromptStore.getState().settleConfirm(false));
  expect(await leaving).toBe(false);
  expect(useAnnotationStore.getState().selectedPath).toBe(images[1].path);
  expect(useAnnotationStore.getState().annotationsByImage[images[0].path]).toHaveLength(1);
  expect(api.saveRecovery).not.toHaveBeenCalled();
});
it("interval mode includes the current image and retains editing during the write", async () => {
  await open();
  act(() => useRecoveryStore.getState().setSettings({ mode: "interval", intervalSeconds: 10 }));
  await tick();
  api.saveRecovery.mockClear();
  act(() => useAnnotationStore.getState().addAnnotation(images[0].path, shape));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9_999);
  });
  expect(api.saveRecovery).not.toHaveBeenCalled();
  let finish!: (revision: number) => void;
  api.saveRecovery.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(api.saveRecovery.mock.calls[0][1].changes["a.png"]).toHaveLength(1);
  expect(useOperations.getState().canEditAnnotations()).toBe(true);
  act(() => useAnnotationStore.getState().clearImageAnnotations(images[0].path));
  await act(async () => finish(2));
  expect(useRecoveryStore.getState().status.dirty).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(api.saveRecovery.mock.calls[1][1].changes).toEqual({ "a.png": [] });
});
it("rapid switch saves every departed dirty image and handles undo and batch writes", async () => {
  await open();
  act(() => useRecoveryStore.getState().setSettings({ mode: "switch", intervalSeconds: 10 }));
  await tick();
  api.saveRecovery.mockClear();
  act(() => {
    const store = useAnnotationStore.getState();
    store.addAnnotation(images[0].path, shape);
    store.select(images[1].path);
    store.addAnnotation(images[1].path, shape);
    store.select(images[2].path);
  });
  await tick();
  expect(Object.keys(api.saveRecovery.mock.calls[0][1].changes)).toEqual(["a.png", "b.png"]);
  act(() => useAnnotationStore.getState().undo());
  await tick();
  expect(api.saveRecovery.mock.calls[1][1].changes).toEqual({ "b.png": [] });
  act(() =>
    useAnnotationStore.getState().insertAnnotationsBatch(
      images.map((image) => ({ imagePath: image.path, annotations: [shape] })),
      "replace",
    ),
  );
  await tick();
  expect(useRecoveryStore.getState().status.dirty).toBe(false);
});
it("closing flushes the final current image and failure keeps the window open for retry", async () => {
  await open();
  act(() => useRecoveryStore.getState().setSettings({ mode: "switch", intervalSeconds: 10 }));
  await tick();
  act(() => useAnnotationStore.getState().addAnnotation(images[0].path, shape));
  api.saveRecovery.mockRejectedValueOnce(new Error("disk full"));
  const close = api.onCloseRequested.mock.calls[0][0] as (event: {
    preventDefault: () => void;
  }) => void;
  const event = { preventDefault: vi.fn() };
  await act(async () => close(event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(api.destroy).not.toHaveBeenCalled();
  expect(useRecoveryStore.getState().status.error).toContain("disk full");
  await act(async () => close(event));
  expect(api.destroy).toHaveBeenCalledOnce();
  expect(
    api.saveRecovery.mock.calls[api.saveRecovery.mock.calls.length - 1][1].changes["a.png"],
  ).toHaveLength(1);
});
it("restores a never-exported project with labels, attributes, frames and empty images", async () => {
  const recovered = {
    revision: 9,
    metadata: { ...metadata, selectedPath: images[1].path, savedAt: "2026-11-07T00:00:00Z" },
    annotations: {
      "a.png": [{ ...shape, frameIndex: 7, attributes: { track: "42" } }],
      "b.png": [],
      "missing.png": [shape],
    },
  };
  api.loadRecovery.mockResolvedValue(recovered);
  let opening!: Promise<boolean>;
  await act(async () => {
    opening = model.beforeOpen("C:/project");
  });
  expect(usePromptStore.getState().choiceQueue).toHaveLength(1);
  await act(async () => {
    usePromptStore.getState().settleChoice("restore");
    expect(await opening).toBe(true);
    useAnnotationStore.getState().setImages(images);
    await model.load("C:/project", images, async () => {
      throw new Error("must not import export");
    });
    model.openFinished();
  });
  expect(useAnnotationStore.getState().annotationsByImage[images[0].path][0].attributes).toEqual({
    track: "42",
  });
  expect(useAnnotationStore.getState().selectedPath).toBe(images[1].path);
  expect(apply).toHaveBeenCalledWith(recovered.metadata);
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("1 张图片"));
});
it("validates corrupted copies before replacing the old workspace", async () => {
  await open();
  const state = useAnnotationStore.getState();
  api.loadRecovery.mockResolvedValue({ revision: 1, metadata: null });
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = model.beforeOpen("C:/other");
  });
  expect(usePromptStore.getState().choiceQueue[0].title).toContain("无法读取");
  await act(async () => {
    usePromptStore.getState().settleChoice(null);
  });
  expect(await pending).toBe(false);
  expect(useAnnotationStore.getState()).toBe(state);
});
it("serializes and coalesces manual saves with recovery and does not leave obsolete work pending", async () => {
  await open();
  act(() => useAnnotationStore.getState().addAnnotation(images[0].path, shape));
  const action = vi.fn(async () => true);
  await act(async () => {
    await Promise.all([model.manual(action), model.manual(action)]);
  });
  expect(action).toHaveBeenCalledOnce();
  expect(api.saveRecovery).toHaveBeenCalledOnce();
  expect(useRecoveryStore.getState().status.dirty).toBe(false);
});

it("keeps the edit gate until asynchronous native destruction completes", async () => {
  await open();
  act(() => useRecoveryStore.getState().setSettings({ mode: "switch", intervalSeconds: 10 }));
  await tick();
  act(() => useAnnotationStore.getState().addAnnotation(images[0].path, shape));
  let destroyed!: () => void;
  api.destroy.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        destroyed = resolve;
      }),
  );
  await act(async () => api.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }));
  expect(api.destroy).toHaveBeenCalledOnce();
  expect(useOperations.getState().canEditAnnotations()).toBe(false);
  expect(await model.manual(async () => true)).toBe(false);
  await act(async () => destroyed());
  expect(useOperations.getState().canEditAnnotations()).toBe(true);
});

it("keeps Save and Save As distinct while coalescing duplicate intent and exposing the queue", async () => {
  await open();
  let finish!: (revision: number) => void;
  api.saveRecovery.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => useRecoveryStore.getState().setSettings({ mode: "switch", intervalSeconds: 10 }));
  await tick();
  const saveAction = vi.fn(async () => true),
    saveAsAction = vi.fn(async () => true);
  let pending!: Promise<boolean[]>;
  await act(async () => {
    pending = Promise.all([
      model.manual(saveAction, "save:json"),
      model.manual(saveAsAction, "export:coco"),
      model.manual(saveAction, "save:json"),
    ]);
  });
  expect(useRecoveryStore.getState().manualPending).toBe(2);
  expect(model.manualBusy).toBe(true);
  expect(saveAction).not.toHaveBeenCalled();
  expect(saveAsAction).not.toHaveBeenCalled();
  await act(async () => {
    finish(1);
    await pending;
  });
  expect(saveAction).toHaveBeenCalledOnce();
  expect(saveAsAction).toHaveBeenCalledOnce();
  expect(saveAction.mock.invocationCallOrder[0]).toBeLessThan(
    saveAsAction.mock.invocationCallOrder[0],
  );
  expect(useRecoveryStore.getState().manualPending).toBe(0);
});

it("cancelling a valid recovery choice leaves the old project and disk copy untouched", async () => {
  await open();
  const old = useAnnotationStore.getState();
  api.loadRecovery.mockResolvedValue({
    revision: 9,
    metadata: { ...metadata, selectedPath: "", savedAt: "2026-11-07T00:00:00Z" },
    annotations: { "a.png": [shape] },
  });
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = model.beforeOpen("C:/other");
  });
  await act(async () => usePromptStore.getState().settleChoice(null));
  expect(await pending).toBe(false);
  expect(useAnnotationStore.getState()).toBe(old);
  expect(api.saveRecovery).not.toHaveBeenCalled();
  expect(api.forkRecovery).not.toHaveBeenCalled();
});

it("explicitly opening original data after a corrupt copy forks instead of overwriting it", async () => {
  api.loadRecovery.mockRejectedValueOnce(new Error("corrupt"));
  api.forkRecovery.mockResolvedValue(100);
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = model.beforeOpen("C:/project");
  });
  await act(async () => {
    usePromptStore.getState().settleChoice("original");
    expect(await pending).toBe(true);
    useAnnotationStore.getState().setImages(images);
    await model.load("C:/project", images, async () => {});
    model.openFinished();
  });
  act(() => useRecoveryStore.getState().setSettings({ mode: "switch", intervalSeconds: 10 }));
  await tick();
  expect(api.forkRecovery).toHaveBeenCalledOnce();
  expect(api.saveRecovery).not.toHaveBeenCalled();
  act(() => {
    useAnnotationStore.getState().addAnnotation(images[0].path, shape);
    useAnnotationStore.getState().select(images[1].path);
  });
  await tick();
  expect(api.saveRecovery.mock.calls[0][1].expectedRevision).toBe(100);
});

it("resolves stale-revision conflicts by preserving both copies and writing a complete current snapshot", async () => {
  await open();
  act(() => useRecoveryStore.getState().setSettings({ mode: "switch", intervalSeconds: 10 }));
  await tick();
  act(() => useAnnotationStore.getState().addAnnotation(images[0].path, shape));
  api.saveRecovery.mockRejectedValueOnce(new Error("[RECOVERY_CONFLICT] newer window"));
  act(() => useAnnotationStore.getState().select(images[1].path));
  await tick();
  api.forkRecovery.mockResolvedValue(100);
  await act(async () => useRecoveryStore.getState().resolveConflict?.());
  await act(async () => usePromptStore.getState().settleConfirm(true));
  expect(api.forkRecovery.mock.calls[0][1]).toMatchObject({
    reset: true,
    changes: { "a.png": [expect.objectContaining({ id: "s" })] },
  });
  expect(useRecoveryStore.getState().status.dirty).toBe(false);
  expect(useRecoveryStore.getState().status.error).toBe("");
});
