import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrelabelExecutionDialog } from "../components/settings/PrelabelExecutionDialog";
import { PRELABEL_ZH_CN as text } from "../i18n/prelabel.zh-CN";
import { createPrelabelModelConfig } from "../lib/prelabel-models";
import { useOperations } from "../store/useOperations";
import type { PrelabelInferenceOutcome } from "../types/prelabel";
import { usePrelabelExecution } from "./usePrelabelExecution";
import { usePrelabelModels } from "./usePrelabelModels";

const api = vi.hoisted(() => ({
  runPrelabelInference: vi.fn(),
  cancelPrelabelInference: vi.fn(),
  runPluginPrelabel: vi.fn(),
  cancelPluginPrelabel: vi.fn(),
  loadPrelabelModelLibrary: vi.fn(),
  savePrelabelModelLibrary: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);

type Options = Parameters<typeof usePrelabelExecution>[0];
let options: Options;
let controls: ReturnType<typeof usePrelabelExecution>;
let root: Root;
let host: HTMLDivElement;
const insert = vi.fn<Options["insertAnnotationsBatch"]>();
const models = ["a", "b", "c"].map((id, index) => ({
  ...createPrelabelModelConfig(
    `${id}.onnx`,
    {
      format: index === 0 ? "yolov5" : "yolov8",
      classCount: index + 1,
      classNames: Array.from({ length: index + 1 }, (_, i) => `${id}${i}`),
      inputWidth: 640,
      inputHeight: 640,
    },
    id,
  ),
  name: "same-name",
}));
function Harness() {
  controls = usePrelabelExecution(options);
  return <PrelabelExecutionDialog execution={controls} hasSelectedImage onClose={() => {}} />;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
function inferResult(paths: string[]): PrelabelInferenceOutcome {
  return {
    cancelled: false,
    results: paths.map((imagePath) => ({
      imagePath,
      detections: [{ classIndex: 0, confidence: 0.9, points: [10, 20, 30, 40] }],
    })),
  };
}
function select(index: number) {
  const select = document.body.querySelector("select")!;
  act(() => {
    select.value = controls.sources[index].selectionId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  useOperations.setState({ operations: [] });
  const labels = [
    { id: "target", name: "mapped-label", color: "#ffffff", shapeType: "rect" as const },
  ];
  options = {
    activeProjectConfig: {
      schemaVersion: 1,
      format: "json",
      annotationPath: "labels.json",
      exportedAt: "",
      imageFolder: "p",
      labels,
      template: { id: "project-config", name: "project" },
      exportOptions: { format: "json" },
      prelabelMappings: {
        b: [{ classIndex: 0, className: "b0", action: "bind", labelId: "target" }],
        c: [{ classIndex: 0, className: "c0", action: "bind", labelId: "target" }],
      },
    },
    annotationsByImage: {},
    images: Array.from({ length: 10 }, (_, i) => ({ path: `p/${i}.png`, name: `${i}.png` })),
    labels,
    library: { schemaVersion: 1, currentModelId: "b", models },
    pluginSources: [],
    projectFolder: "p",
    selectedPath: "p/0.png",
    refreshPluginSources: vi.fn().mockResolvedValue(undefined),
    insertAnnotationsBatch: insert,
    setError: vi.fn(),
  };
  api.runPrelabelInference.mockImplementation(
    async (_id: string, _model: unknown, paths: string[]) => inferResult(paths),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("shows distinct summaries, switches mappings and uses the selected model for single and multi-chunk batches", async () => {
  const choices = [...document.body.querySelectorAll("option")];
  expect(choices).toHaveLength(3);
  expect(new Set(choices.map((choice) => choice.textContent)).size).toBe(3);
  expect(controls.currentModel?.id).toBe("b");
  expect(controls.unmatchedClassCount).toBe(1);
  select(2);
  expect(controls.currentModel?.id).toBe("c");
  expect(controls.unmatchedClassCount).toBe(2);
  await act(async () => controls.runSingle());
  expect(insert).toHaveBeenLastCalledWith(
    [
      {
        imagePath: "p/0.png",
        annotations: [expect.objectContaining({ labelId: "target", points: [10, 20, 30, 40] })],
      },
    ],
    "append",
  );
  insert.mockClear();
  await act(async () => controls.runBatch(false));
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert.mock.calls.flatMap(([entries]) => entries)).toHaveLength(10);
  expect(insert.mock.calls[0][2]).toBe(insert.mock.calls[1][2]);
  for (const [, usedModel] of api.runPrelabelInference.mock.calls)
    expect(usedModel).toBe(models[2]);
  for (const [entries] of insert.mock.calls) {
    for (const entry of entries) expect(entry.annotations[0].labelId).toBe("target");
  }
  select(0);
  expect(controls.unmatchedClassCount).toBe(1);
});

it("does not persist the model library when switching and executing through the dialog", async () => {
  api.loadPrelabelModelLibrary.mockResolvedValue(options.library);
  const common = options;
  let currentLibraryId: string | null = null;
  function LibraryHarness() {
    const models = usePrelabelModels(common.setError);
    currentLibraryId = models.library.currentModelId;
    controls = usePrelabelExecution({ ...common, library: models.library });
    return <PrelabelExecutionDialog execution={controls} hasSelectedImage onClose={() => {}} />;
  }
  await act(async () => root.render(<LibraryHarness />));
  select(2);
  const run = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent === text.singleRun,
  )!;
  await act(async () => run.click());
  expect(api.runPrelabelInference.mock.calls[0][1]).toBe(models[2]);
  expect(api.savePrelabelModelLibrary).not.toHaveBeenCalled();
  expect(currentLibraryId).toBe("b");
});

function pluginSource() {
  return {
    selectionId: "plugin:dev.test.source" as const,
    pluginId: "dev.test.source",
    pluginName: "Plugin",
    classNames: ["mapped-label"],
    annotationTypes: ["rect" as const],
    enabled: true,
    disabledReason: null,
    supportsBatch: true,
    supportsProgress: true,
    supportsCancel: true,
  };
}

it("accepts the next plugin run when the previous refresh returns identical source contents", async () => {
  let finishRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  options = {
    ...options,
    pluginSources: [pluginSource()],
    refreshPluginSources: vi.fn().mockReturnValueOnce(refresh).mockResolvedValue(undefined),
  };
  await render();
  select(3);
  api.runPluginPrelabel.mockResolvedValueOnce({
    images: [{ imagePath: "0.png", shapes: [] }],
    cancelled: false,
  });
  await act(async () => controls.runSingle());
  let finishInference!: (value: {
    images: { imagePath: string; shapes: [] }[];
    cancelled: boolean;
  }) => void;
  api.runPluginPrelabel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishInference = resolve;
      }),
  );
  let run!: Promise<void>;
  await act(async () => {
    run = controls.runSingle();
  });
  options = { ...options, pluginSources: [pluginSource()] };
  await render();
  await act(async () => {
    finishRefresh();
    finishInference({ images: [{ imagePath: "0.png", shapes: [] }], cancelled: false });
    await run;
  });
  expect(insert).toHaveBeenCalledTimes(2);
  expect(useOperations.getState().operations.some((op) => op.status === "failed")).toBe(false);
});

it("falls back from an unsupported plugin batch to per-image calls", async () => {
  options = { ...options, pluginSources: [pluginSource()], images: options.images.slice(0, 3) };
  await render();
  select(3);
  api.runPluginPrelabel
    .mockRejectedValueOnce(new Error("[METHOD_NOT_FOUND] batch unavailable"))
    .mockImplementation(async (_id: string, _folder: string, paths: string[]) => ({
      images: paths.map((imagePath) => ({ imagePath, shapes: [] })),
      cancelled: false,
    }));
  await act(async () => controls.runBatch(false));
  expect(api.runPluginPrelabel.mock.calls.map((call) => call[2])).toEqual([
    ["0.png", "1.png", "2.png"],
    ["0.png"],
    ["1.png"],
    ["2.png"],
  ]);
  expect(insert.mock.calls.flatMap(([entries]) => entries.map((entry) => entry.imagePath))).toEqual(
    ["p/0.png", "p/1.png", "p/2.png"],
  );
});

it("keeps completed plugin images when cancellation interrupts single-image fallback", async () => {
  options = { ...options, pluginSources: [pluginSource()], images: options.images.slice(0, 3) };
  await render();
  select(3);
  let rejectSecond!: (error: Error) => void;
  api.runPluginPrelabel
    .mockRejectedValueOnce(new Error("[METHOD_NOT_FOUND]"))
    .mockResolvedValueOnce({ images: [{ imagePath: "0.png", shapes: [] }], cancelled: false })
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSecond = reject;
        }),
    );
  api.cancelPluginPrelabel.mockResolvedValue({ found: true });
  let run!: Promise<void>;
  await act(async () => {
    run = controls.runBatch(false);
  });
  const running = useOperations.getState().operations.find((op) => op.status === "running")!;
  await act(async () => useOperations.getState().cancel(running.id));
  await act(async () => {
    rejectSecond(new Error("[CANCELLED]"));
    await run;
  });
  expect(api.runPluginPrelabel).toHaveBeenCalledTimes(3);
  expect(insert.mock.calls.flatMap(([entries]) => entries.map((entry) => entry.imagePath))).toEqual(
    ["p/0.png"],
  );
  expect(controls.progress.message).toBe(text.batchCancelled(1, 3));
});

it("shows dynamic dimensions without inventing a fixed input size", async () => {
  options = {
    ...options,
    library: {
      ...options.library,
      models: [{ ...models[0], inputWidth: 0, inputHeight: 0, inputSizeOverride: null }],
    },
  };
  await render();
  expect(document.body.querySelector("option")?.textContent).toContain(text.modelSummary(1, 0, 0));
});

it("retains the first committed chunk when the library changes during the second chunk", async () => {
  select(2);
  let finish!: (value: PrelabelInferenceOutcome) => void;
  api.runPrelabelInference
    .mockResolvedValueOnce(inferResult(options.images.slice(0, 8).map((entry) => entry.path)))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  let run!: Promise<void>;
  await act(async () => {
    run = controls.runBatch(false);
  });
  expect(insert).toHaveBeenCalledTimes(1);
  options = { ...options, library: { ...options.library, currentModelId: "a" } };
  await render();
  await act(async () => {
    finish(inferResult(["p/8.png", "p/9.png"]));
    await run;
  });
  expect(insert).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls[0][0]).toHaveLength(8);
  expect(controls.progress.message).toBe(text.batchFailed(8, 10));
});

it("uses the current library model after asynchronous loading and keeps an explicit selection for the app session", async () => {
  options = { ...options, library: { schemaVersion: 1, currentModelId: null, models: [] } };
  await render();
  expect(controls.currentSource).toBeNull();
  expect(document.body.textContent).toContain(text.executionNoModel);
  options = { ...options, library: { schemaVersion: 1, currentModelId: "b", models } };
  await render();
  expect(controls.currentModel?.id).toBe("b");
  select(2);
  options = { ...options, library: { ...options.library, currentModelId: "a" } };
  await render();
  expect(controls.currentModel?.id).toBe("c");
});

it("distinguishes otherwise identical model summaries by effective input dimensions", async () => {
  options = {
    ...options,
    library: {
      schemaVersion: 1,
      currentModelId: "b",
      models: [models[1], { ...models[1], id: "large", inputSizeOverride: [1280, 1280] }],
    },
  };
  await render();
  const names = [...document.body.querySelectorAll("option")].map((option) => option.textContent);
  expect(names[0]).toContain("640×640");
  expect(names[1]).toContain("1280×1280");
});

it.each(["single", "batch"] as const)(
  "rejects stale %s results on any library change",
  async (mode) => {
    select(2);
    let resolve!: (value: PrelabelInferenceOutcome) => void;
    api.runPrelabelInference.mockImplementationOnce(
      () =>
        new Promise<PrelabelInferenceOutcome>((done) => {
          resolve = done;
        }),
    );
    let run!: Promise<void>;
    await act(async () => {
      run = mode === "single" ? controls.runSingle() : controls.runBatch(false);
    });
    expect(document.body.querySelector("select")?.disabled).toBe(true);
    act(() => controls.selectSource(controls.sources[0].selectionId));
    expect(controls.currentModel?.id).toBe("c");
    expect(useOperations.getState().canStart("project-annotations")).toBe(false);
    options = { ...options, library: { ...options.library, currentModelId: "a" } };
    await render();
    await act(async () => {
      resolve(inferResult(["p/0.png"]));
      await run;
    });
    expect(insert).not.toHaveBeenCalled();
    expect(api.runPrelabelInference).toHaveBeenCalledTimes(1);
    expect(
      useOperations.getState().operations.find((op) => op.status === "failed")?.message,
    ).toContain(text.executionContextChanged);
    expect(useOperations.getState().canStart("project-annotations")).toBe(true);
  },
);

it("does not merge results after the selected model is removed", async () => {
  select(2);
  let resolve!: (value: PrelabelInferenceOutcome) => void;
  api.runPrelabelInference.mockImplementationOnce(
    () =>
      new Promise<PrelabelInferenceOutcome>((done) => {
        resolve = done;
      }),
  );
  let run!: Promise<void>;
  await act(async () => {
    run = controls.runSingle();
  });
  options = { ...options, library: { ...options.library, models: models.slice(0, 2) } };
  await render();
  await act(async () => {
    resolve(inferResult(["p/0.png"]));
    await run;
  });
  expect(insert).not.toHaveBeenCalled();
  expect(api.runPrelabelInference.mock.calls[0][1]).toBe(models[2]);
});

it.each([false, true])(
  "preserves plugin source execution and cancellation capability (%s)",
  async (supportsCancel) => {
    options = {
      ...options,
      pluginSources: [
        {
          selectionId: "plugin:dev.test.source",
          pluginId: "dev.test.source",
          pluginName: "Plugin",
          classNames: ["mapped-label"],
          annotationTypes: ["rect"],
          enabled: true,
          disabledReason: null,
          supportsBatch: false,
          supportsProgress: true,
          supportsCancel,
        },
      ],
    };
    await render();
    select(3);
    expect(controls.currentModel).toBeNull();
    expect(controls.unmatchedClassCount).toBe(0);
    let resolve!: (value: { images: []; cancelled: boolean }) => void;
    api.runPluginPrelabel.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    api.cancelPluginPrelabel.mockResolvedValue({ found: true });
    let run!: Promise<void>;
    await act(async () => {
      run = controls.runSingle();
    });
    const operation = useOperations.getState().operations.find((op) => op.status === "running")!;
    expect(operation.canCancel).toBe(supportsCancel);
    expect(operation.resources).toEqual(["project-annotations"]);
    await act(async () => useOperations.getState().cancel(operation.id));
    expect(api.cancelPluginPrelabel).toHaveBeenCalledTimes(supportsCancel ? 1 : 0);
    await act(async () => {
      resolve({ images: [], cancelled: supportsCancel });
      await run;
    });
    expect(api.runPrelabelInference).not.toHaveBeenCalled();
    expect(api.runPluginPrelabel.mock.calls[0].slice(0, 3)).toEqual([
      "dev.test.source",
      "p",
      ["0.png"],
    ]);
    expect(options.refreshPluginSources).toHaveBeenCalledOnce();
  },
);
