import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrelabelSettings } from "./PrelabelSettings";
import { usePrelabelModels } from "../../hooks/usePrelabelModels";
import { createPrelabelModelConfig } from "../../lib/prelabel-models";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import type { ModelDownloadResult, PrelabelModelLibrary } from "../../types/prelabel";

const api = vi.hoisted(() => ({
  getOnnxRuntimeStatus: vi.fn(),
  confirmAction: vi.fn(),
  downloadPrelabelModel: vi.fn(),
  cancelPrelabelModelDownload: vi.fn(),
  loadPrelabelModelLibrary: vi.fn(),
  savePrelabelModelLibrary: vi.fn(),
}));
vi.mock("../../lib/tauri-api", () => api);
const onError = vi.fn();
const onClose = vi.fn();

function Harness() {
  const models = usePrelabelModels(onError);
  return (
    <PrelabelSettings
      activeProjectConfig={null}
      isLabelDirty={false}
      isLoaded={models.isLoaded}
      labels={[]}
      library={models.library}
      pluginSources={[]}
      onAddModel={models.addModel}
      onDeleteModel={models.deleteModel}
      onSelectModel={models.selectModel}
      onUpdateModel={models.updateModel}
      onClose={onClose}
      onSaveMappings={async () => {}}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const summary = {
  format: "yolo11" as const,
  classCount: 1,
  inputWidth: 640,
  inputHeight: 640,
  classNames: ["person"],
};
const model = {
  ...createPrelabelModelConfig("C:/app/models/a.onnx", summary, "a"),
  sourceUrl: "https://example.com/a.onnx",
};
const result: ModelDownloadResult = { ...summary, path: "C:/app/models/a-new.onnx" };
let saved: PrelabelModelLibrary;
let download: ReturnType<typeof deferred<ModelDownloadResult | null>>;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  saved = { schemaVersion: 1, currentModelId: "a", models: [model] };
  api.loadPrelabelModelLibrary.mockResolvedValue(saved);
  api.savePrelabelModelLibrary.mockImplementation(async (next: PrelabelModelLibrary) => {
    saved = next;
  });
  api.getOnnxRuntimeStatus.mockResolvedValue({
    state: "available",
    message: "available",
    runtimeDirectory: "C:/app/runtime",
  });
  api.confirmAction.mockResolvedValue(true);
  api.cancelPrelabelModelDownload.mockResolvedValue({ status: "already-completed" });
  download = deferred<ModelDownloadResult | null>();
  api.downloadPrelabelModel.mockReturnValue(download.promise);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

it("locks library edits and closing from confirmation through persistence", async () => {
  const confirmation = deferred<boolean>();
  const persistence = deferred<void>();
  api.confirmAction.mockReturnValue(confirmation.promise);
  api.savePrelabelModelLibrary.mockImplementation(async (next: PrelabelModelLibrary) => {
    await persistence.promise;
    saved = next;
  });
  await click(text.updateModel);
  expect(button(text.removeModel).disabled).toBe(true);
  expect(button(text.saveModel).disabled).toBe(true);
  expect(button(text.close).disabled).toBe(true);
  expect(button(text.updateModel).disabled).toBe(true);
  await click(text.removeModel);
  await click(text.close);
  expect(onClose).not.toHaveBeenCalled();
  expect(api.savePrelabelModelLibrary).not.toHaveBeenCalled();

  await act(async () => confirmation.resolve(true));
  expect(button(text.runtimeCancelDownload).disabled).toBe(false);
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>(`input[placeholder="${text.sourceUrlPlaceholder}"]`)
      ?.disabled,
  ).toBe(true);
  await act(async () => download.resolve(result));
  expect(button(text.removeModel).disabled).toBe(true);
  await act(async () => persistence.resolve());
  expect(saved.models[0].path).toBe(result.path);
  expect(button(text.removeModel).disabled).toBe(false);
  await click(text.removeModel);
  expect(saved.models).toHaveLength(0);
});

it.each(["accepted", "already-completed", "failed"])(
  "persists a completed download even when cancellation is %s",
  async (status) => {
    if (status === "failed")
      api.cancelPrelabelModelDownload.mockRejectedValue(new Error("cancel failed"));
    else api.cancelPrelabelModelDownload.mockResolvedValue({ status });
    await click(text.updateModel);
    await click(text.runtimeCancelDownload);
    expect(api.cancelPrelabelModelDownload).toHaveBeenCalledOnce();
    await act(async () => download.resolve(result));
    expect(saved.models[0].path).toBe(result.path);
    expect(container.textContent).toContain(text.modelUpdateCompleted(model.name));
    expect(container.textContent).not.toContain(text.modelUpdateCancelled);
  },
);

it("keeps the current model and unlocks the form when the backend cancels", async () => {
  await click(text.updateModel);
  await click(text.runtimeCancelDownload);
  await act(async () => download.resolve(null));
  expect(api.savePrelabelModelLibrary).not.toHaveBeenCalled();
  expect(saved.models[0].path).toBe(model.path);
  expect(container.textContent).toContain(text.modelUpdateCancelled);
  expect(button(text.updateModel).disabled).toBe(false);
});

it("keeps the current config and allows retry after a save failure", async () => {
  api.savePrelabelModelLibrary.mockRejectedValueOnce(new Error("disk full"));
  await click(text.updateModel);
  await act(async () => download.resolve(result));
  expect(saved.models[0].path).toBe(model.path);
  expect(container.textContent).toContain("disk full");
  expect(container.textContent).not.toContain(text.modelUpdateCompleted(model.name));
  expect(button(text.updateModel).disabled).toBe(false);
});

it("releases the lock without downloading when confirmation is declined", async () => {
  api.confirmAction.mockResolvedValue(false);
  await click(text.updateModel);
  expect(api.downloadPrelabelModel).not.toHaveBeenCalled();
  expect(button(text.removeModel).disabled).toBe(false);
});
