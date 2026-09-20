import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePrelabelExecution } from "./usePrelabelExecution";
import { useOperations } from "../store/useOperations";
import { createPrelabelModelConfig } from "../lib/prelabel-models";
const api = vi.hoisted(() => ({
  runPrelabelInference: vi.fn(),
  cancelPrelabelInference: vi.fn(),
  cancelPluginPrelabel: vi.fn(),
  runPluginPrelabel: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);
it("cancels a running inference through the originally registered callback and supports retry", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let resolve!: (result: { cancelled: boolean; results: [] }) => void;
  api.runPrelabelInference.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  api.cancelPrelabelInference
    .mockRejectedValueOnce(new Error("temporary IPC failure"))
    .mockResolvedValue({ status: "accepted" });
  const model = createPrelabelModelConfig(
    "model.onnx",
    { format: "yolov8", classCount: 1, classNames: ["person"], inputWidth: 640, inputHeight: 640 },
    "model",
  );
  const options = {
    activeProjectConfig: null,
    annotationsByImage: {},
    images: [{ name: "a.png", path: "p/a.png" }],
    labels: [{ id: "person", name: "person", color: "#ffffff", shapeType: "rect" as const }],
    library: { schemaVersion: 1 as const, currentModelId: model.id, models: [model] },
    pluginSources: [],
    projectFolder: "p",
    refreshPluginSources: async () => {},
    selectedPath: "p/a.png",
    insertAnnotationsBatch: vi.fn(),
    setError: vi.fn(),
  };
  let controls!: ReturnType<typeof usePrelabelExecution>;
  function Harness() {
    controls = usePrelabelExecution(options);
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Harness />));
  let run!: Promise<void>;
  await act(async () => {
    run = controls.runSingle();
  });
  const operation = useOperations.getState().operations.find((op) => op.status === "running")!;
  expect(controls.progress.isRunning).toBe(true);
  await act(async () => useOperations.getState().cancel(operation.id));
  expect(api.cancelPrelabelInference).toHaveBeenCalledOnce();
  expect(controls.progress.cancelRequested).toBe(false);
  await act(async () => useOperations.getState().cancel(operation.id));
  expect(api.cancelPrelabelInference).toHaveBeenCalledTimes(2);
  expect(controls.progress.cancelRequested).toBe(true);
  expect(useOperations.getState().canStart("project-annotations")).toBe(false);
  await act(async () => {
    resolve({ cancelled: true, results: [] });
    await run;
  });
  expect(useOperations.getState().canStart("project-annotations")).toBe(true);
  expect(useOperations.getState().operations.find((op) => op.id === operation.id)?.kind).toBe(
    "warning",
  );
  expect(options.insertAnnotationsBatch).not.toHaveBeenCalled();
  act(() => root.unmount());
  useOperations.getState().dismiss(operation.id);
});
