import { useOperations } from "../../store/useOperations";
import { OPERATION_ZH_CN as operationText } from "../../i18n/operations.zh-CN";
import { OperationStatus } from "../../components/operations/OperationStatus";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrelabelSettings } from "./PrelabelSettings";
import { usePrelabelModels } from "../../hooks/usePrelabelModels";
import { createPrelabelModelConfig } from "../../lib/prelabel-models";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import { ONNX_GRAPH_ZH_CN as graphText } from "../../i18n/onnx-graph.zh-CN";
import type { ModelDownloadResult, PrelabelModelLibrary } from "../../types/prelabel";

const api = vi.hoisted(() => ({
  loadPrelabelResourceLimits: vi
    .fn()
    .mockResolvedValue({ maxMemoryMiB: 80, maxCandidates: 100_000 }),
  getOnnxRuntimeStatus: vi.fn(),
  selectPrelabelModelFile: vi.fn(),
  selectOnnxGraphFile: vi.fn(),
  inspectOnnxGraph: vi.fn(),
  findConvertedOnnx: vi.fn(),
  detectPtConversionEnvironment: vi.fn(),
  previewPtConversionCommand: vi.fn(),
  convertPtToOnnx: vi.fn(),
  downloadPrelabelModel: vi.fn(),
  cancelPrelabelModelDownload: vi.fn(),
  loadPrelabelModelLibrary: vi.fn(),
  savePrelabelModelLibrary: vi.fn(),
}));
const promptsApi = vi.hoisted(() => ({ confirmAction: vi.fn() }));
vi.mock("../../lib/prompts", () => promptsApi);
vi.mock("../../lib/tauri-api", () => api);
const onError = vi.fn();
const onClose = vi.fn();

function Harness() {
  const models = usePrelabelModels(onError);
  return (
    <>
      <OperationStatus />
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
    </>
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
  useOperations.setState({ operations: [] });
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
  promptsApi.confirmAction.mockResolvedValue(true);
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
  const match = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

it("clears only settings failures when starting another settings action", async () => {
  act(() => {
    const registry = useOperations.getState();
    registry.pushError(operationText.prelabel, "inference failed");
    registry.pushError(operationText.prelabel, "inference failed again");
    registry.pushError(operationText.prelabelSettings, "settings failed");
  });
  const inferenceFailure = useOperations
    .getState()
    .operations.find((op) => op.label === operationText.prelabel);
  expect(inferenceFailure?.failCount).toBe(2);
  api.selectPrelabelModelFile.mockResolvedValueOnce(null);
  await click(text.addModel);
  expect(useOperations.getState().operations).toContainEqual(inferenceFailure);
  expect(
    useOperations
      .getState()
      .operations.some(
        (op) => op.label === operationText.prelabelSettings && op.status === "failed",
      ),
  ).toBe(false);
  expect(document.body.textContent).toContain("inference failed again");
  expect(document.body.textContent).not.toContain("settings failed");
});

it("locks library edits and closing from confirmation through persistence", async () => {
  const confirmation = deferred<boolean>();
  const persistence = deferred<void>();
  promptsApi.confirmAction.mockReturnValue(confirmation.promise);
  api.savePrelabelModelLibrary.mockImplementation(async (next: PrelabelModelLibrary) => {
    await persistence.promise;
    saved = next;
  });
  await click(text.updateModel);
  expect(button(text.removeModel).disabled).toBe(true);
  expect(button(text.saveModel).disabled).toBe(true);
  expect(button(text.close).disabled).toBe(true);
  expect(button(text.updateModel).disabled).toBe(true);
  expect(button(graphText.open).disabled).toBe(true);
  expect(button(graphText.view).disabled).toBe(true);
  await click(graphText.open);
  await click(graphText.view);
  expect(api.selectOnnxGraphFile).not.toHaveBeenCalled();
  expect(api.inspectOnnxGraph).not.toHaveBeenCalled();
  await click(text.removeModel);
  await click(text.close);
  expect(onClose).not.toHaveBeenCalled();
  expect(api.savePrelabelModelLibrary).not.toHaveBeenCalled();

  await act(async () => confirmation.resolve(true));
  expect(button(text.runtimeCancelDownload).disabled).toBe(false);
  expect(document.body.querySelector("fieldset")?.disabled).toBe(true);
  expect(
    document.body.querySelector<HTMLInputElement>(
      `input[placeholder="${text.sourceUrlPlaceholder}"]`,
    )?.disabled,
  ).toBe(true);
  await act(async () => download.resolve(result));
  expect(button(text.removeModel).disabled).toBe(true);
  expect(button(graphText.view).disabled).toBe(true);
  await act(async () => persistence.resolve());
  expect(saved.models[0].path).toBe(result.path);
  expect(button(text.removeModel).disabled).toBe(false);
  expect(button(graphText.view).disabled).toBe(false);
  expect(button(graphText.open).disabled).toBe(false);
  await click(text.removeModel);
  expect(saved.models).toHaveLength(0);
});

it("does not read a file if a model update starts while the native selector is open", async () => {
  const selection = deferred<string | null>();
  api.selectOnnxGraphFile.mockReturnValueOnce(selection.promise);
  await click(graphText.open);
  await click(text.updateModel);
  await act(async () => selection.resolve(model.path));
  expect(api.inspectOnnxGraph).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(operationText.busy);
  await act(async () => download.resolve(null));
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
    expect(document.body.textContent).toContain(text.modelUpdateCompleted(model.name));
    expect(document.body.textContent).not.toContain(text.modelUpdateCancelled);
  },
);

it("keeps the current model and unlocks the form when the backend cancels", async () => {
  await click(text.updateModel);
  await click(text.runtimeCancelDownload);
  await act(async () => download.resolve(null));
  expect(api.savePrelabelModelLibrary).not.toHaveBeenCalled();
  expect(saved.models[0].path).toBe(model.path);
  expect(document.body.textContent).toContain(text.modelUpdateCancelled);
  expect(button(text.updateModel).disabled).toBe(false);
});

it("keeps the current config and allows retry after a save failure", async () => {
  api.savePrelabelModelLibrary.mockRejectedValueOnce(new Error("disk full"));
  await click(text.updateModel);
  await act(async () => download.resolve(result));
  expect(saved.models[0].path).toBe(model.path);
  expect(document.body.textContent).toContain("disk full");
  expect(useOperations.getState().operations.filter((op) => op.status === "failed")).toHaveLength(
    1,
  );
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
    "disk full",
  );
  expect(document.body.textContent).not.toContain(text.modelUpdateCompleted(model.name));
  expect(button(text.updateModel).disabled).toBe(false);
});

it("releases the lock without downloading when confirmation is declined", async () => {
  promptsApi.confirmAction.mockResolvedValue(false);
  await click(text.updateModel);
  expect(api.downloadPrelabelModel).not.toHaveBeenCalled();
  expect(button(text.removeModel).disabled).toBe(false);
});

it("keeps cancellation retryable after a host error", async () => {
  api.cancelPrelabelModelDownload.mockRejectedValueOnce(new Error("IPC failed"));
  await click(text.updateModel);
  const operation = useOperations.getState().operations.find((op) => op.status === "running")!;
  await act(async () => useOperations.getState().cancel(operation.id));
  expect(
    useOperations.getState().operations.find((op) => op.id === operation.id)?.cancelRequested,
  ).toBe(false);
  await act(async () => useOperations.getState().cancel(operation.id));
  expect(api.cancelPrelabelModelDownload).toHaveBeenCalledTimes(2);
  await act(async () => download.resolve(null));
  expect(useOperations.getState().canStart("model-download")).toBe(true);
});

it("retries a failed PT conversion with its saved plan and clears the old failure", async () => {
  const plan = {
    method: "yolo-cli",
    executable: "yolo",
    command: "yolo export",
    timeoutSeconds: 300,
    parameters: { imgsz: 640, simplify: false },
  };
  api.selectPrelabelModelFile.mockResolvedValue("C:/models/a.pt");
  api.findConvertedOnnx.mockResolvedValue(null);
  api.detectPtConversionEnvironment.mockResolvedValue({
    available: true,
    method: "yolo-cli",
    executable: "yolo",
    message: "",
  });
  api.previewPtConversionCommand.mockResolvedValue(plan);
  api.convertPtToOnnx.mockRejectedValueOnce(new Error("conversion failed"));
  await click(text.addModel);
  await click(text.ptConvertNow);
  await click(text.ptStartConversion);
  expect(api.convertPtToOnnx).toHaveBeenCalledOnce();
  expect(button(text.ptRetryConversion).disabled).toBe(false);
  const retry = deferred<ModelDownloadResult>();
  api.convertPtToOnnx.mockReturnValueOnce(retry.promise);
  await click(text.ptRetryConversion);
  expect(api.convertPtToOnnx).toHaveBeenCalledTimes(2);
  expect(api.convertPtToOnnx.mock.calls[1].slice(0, 3)).toEqual(
    api.convertPtToOnnx.mock.calls[0].slice(0, 3),
  );
  expect(useOperations.getState().operations.filter((op) => op.status === "failed")).toHaveLength(
    0,
  );
  expect(useOperations.getState().operations.filter((op) => op.status === "running")).toHaveLength(
    1,
  );
  await act(async () => retry.resolve(result));
  expect(document.body.textContent).not.toContain(text.ptRetryConversion);
  expect(button(text.addToLibrary).disabled).toBe(false);
});
