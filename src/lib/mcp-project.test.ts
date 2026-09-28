import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { McpController, type McpContext } from "./mcp-controller";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOperations } from "../store/useOperations";
import { useOverlayStore } from "../store/useOverlayStore";
import { usePromptStore } from "./prompts";
import type { McpStatus } from "../types/mcp";
import type { PrelabelInferenceOutcome } from "../types/prelabel";
import * as api from "./tauri-api";
import { serializeMcpExport } from "./mcp-project";
import { MCP_LIMITS } from "./defaults/mcp";
import { loadImageSize } from "./app-utils";
import { DEFAULT_CUSTOM_EXPORT_MAPPING } from "./defaults/exports";
vi.mock("./tauri-api", () => ({
  mcpPrepareOutput: vi.fn(),
  mcpCommitOutput: vi.fn(),
  mcpDiscardOutput: vi.fn(),
  runPrelabelInference: vi.fn(),
  cancelPrelabelInference: vi.fn(),
}));
vi.mock("./app-utils", async () => ({
  ...(await vi.importActual<typeof import("./app-utils")>("./app-utils")),
  loadImageSize: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
}));
let c: McpController, context: McpContext, status: McpStatus;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadImageSize).mockResolvedValue({ width: 100, height: 100 });
  useOperations.setState({ operations: [], mcpControlled: false });
  useOverlayStore.setState({ stack: [] });
  usePromptStore.setState({ confirmQueue: [] });
  useAnnotationStore.setState({
    images: [{ name: "frame.png", path: "C:/project/frame.png" }],
    annotationsByImage: {},
    frameIndices: { "C:/project/frame.png": 42 },
    undoStack: [],
    redoStack: [],
  });
  const labels = [{ id: "person", name: "person", shapeType: "rect" as const, color: "#ff0000" }];
  context = {
    folderPath: "C:/project",
    labels,
    canGrant: () => true,
    customMappingText: JSON.stringify(DEFAULT_CUSTOM_EXPORT_MAPPING),
    activeProjectConfigPath: "C:/project/my-label-tool.project.json",
    activeProjectConfig: {
      schemaVersion: 1,
      format: "json",
      annotationPath: "C:/saved/annotations.json",
      imageFolder: "C:/project",
      exportedAt: "old",
      labels,
      template: { id: "project-config", name: "项目临时配置" },
      exportOptions: { format: "json" },
    },
    library: {
      schemaVersion: 1,
      currentModelId: "model",
      models: [
        {
          id: "model",
          name: "model",
          path: "C:/model.onnx",
          format: "yolov8",
          classCount: 1,
          classNames: ["person"],
          inputWidth: 640,
          inputHeight: 640,
          inputSizeOverride: null,
          confidenceThreshold: 0.5,
          iouThreshold: 0.5,
          addedAt: "",
          device: "cpu",
        },
      ],
    },
  };
  status = {
    running: true,
    enabled: true,
    address: "127.0.0.1",
    port: 1421,
    generation: 1,
    error: null,
    audit: [],
    sessions: ["s", "other"].map((id) => ({
      id,
      client: id,
      version: "2025-11-25",
      lastSeen: Date.now(),
    })),
  };
  c = new McpController(() => context);
  c.observe(status);
  c.exportDirectory = "C:/export";
  call("control_request", {
    projectId: c.projectId,
    permissions: ["save", "export", "prelabel", "annotations"],
  });
  c.approve(["save", "export", "prelabel", "annotations"]);
  vi.mocked(api.mcpPrepareOutput).mockResolvedValue({ files: 1, overwrites: 0 });
  vi.mocked(api.mcpCommitOutput).mockResolvedValue(1);
  vi.mocked(api.mcpDiscardOutput).mockResolvedValue();
  vi.mocked(api.cancelPrelabelInference).mockResolvedValue({ status: "accepted" });
});
afterEach(() => {
  c.dispose();
  vi.useRealTimers();
});
function call(name: string, args: Record<string, unknown>, sessionId = "s") {
  return c.handle(
    { id: crypto.randomUUID(), sessionId, name, arguments: args, deadline: Date.now() + 10000 },
    status,
  ).structuredContent;
}
function start(name: string, args = {}) {
  return call(name, {
    projectId: c.projectId,
    expectedRevision: c.revision,
    leaseId: c.control.state.leaseId,
    ...args,
  }).taskId as string;
}
async function done(taskId: string, expected = "completed") {
  await vi.waitFor(() => expect(call("task_status", { taskId }).status).toBe(expected));
  return call("task_status", { taskId });
}
it("exports through approved destinations and saves project plus native annotations without leaking paths", async () => {
  const task = start("project_export", { format: "json" });
  expect(call("task_status", { taskId: task }, "other").code).toBe("NOT_FOUND");
  expect(call("task_cancel", { taskId: task }, "other").code).toBe("NOT_FOUND");
  expect(start("project_save")).toBeUndefined();
  const result = await done(task);
  expect(JSON.stringify(result)).not.toMatch(/C:/);
  expect(api.mcpPrepareOutput).toHaveBeenCalledWith(task, "s", expect.any(String), [
    { root: "C:/export", files: [expect.objectContaining({ path: "annotations.json" })] },
  ]);
  const save = start("project_save");
  await done(save);
  const groups = vi.mocked(api.mcpPrepareOutput).mock.calls[1][3];
  expect(groups.map((g) => g.root)).toEqual(["C:/saved/", "C:/project/"]);
  expect(JSON.parse(groups[1].files[0].content).labels).toEqual(context.labels);
  expect(api.mcpCommitOutput).toHaveBeenLastCalledWith(save, true);
});
it("requires overwrite confirmation and cancellation removes only its own pending prompt", async () => {
  vi.mocked(api.mcpPrepareOutput).mockResolvedValue({ files: 1, overwrites: 1 });
  const task = start("project_export", { format: "coco" });
  await vi.waitFor(() => expect(usePromptStore.getState().confirmQueue.length).toBe(1));
  expect(api.mcpCommitOutput).not.toHaveBeenCalled();
  call("task_cancel", { taskId: task });
  await done(task, "cancelled");
  expect(usePromptStore.getState().confirmQueue).toHaveLength(0);
  expect(api.mcpCommitOutput).not.toHaveBeenCalled();
  const second = start("project_export", { format: "coco" });
  await vi.waitFor(() => expect(usePromptStore.getState().confirmQueue.length).toBe(1));
  usePromptStore.getState().settleConfirm(true);
  await done(second);
  expect(api.mcpCommitOutput).toHaveBeenCalledWith(second, true);
});
it("rejects late staging on revocation, changed revision or disconnect", async () => {
  for (const reason of ["revoke", "revision", "disconnect"] as const) {
    let resolve!: (value: { files: number; overwrites: number }) => void;
    vi.mocked(api.mcpPrepareOutput).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const task = start("project_save");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    if (reason === "revoke") c.control.revoke();
    else if (reason === "revision") c.changed();
    else {
      status.sessions = [];
      c.observe(status);
    }
    resolve({ files: 1, overwrites: 0 });
    await doneAfterDisconnect(task, reason === "revision" ? "failed" : "cancelled");
    expect(api.mcpCommitOutput).not.toHaveBeenCalled();
    status.sessions = [{ id: "s", client: "s", version: "2025-11-25", lastSeen: Date.now() }];
    c.observe(status);
    c.control.revoke();
    call("control_request", { projectId: c.projectId, permissions: ["save"] });
    c.approve(["save"]);
  }
});
async function doneAfterDisconnect(task: string, expected: string) {
  await vi.waitFor(() => expect(c.jobs.status("s", task).status).toBe(expected));
}
it("buffers prelabel results into one transaction and discards cancelled inference", async () => {
  const output: PrelabelInferenceOutcome = {
    cancelled: false,
    results: [
      {
        imagePath: "C:/project/frame.png",
        detections: [{ classIndex: 0, confidence: 0.9, points: [1, 2, 3, 4] }],
      },
    ],
  };
  vi.mocked(api.runPrelabelInference).mockResolvedValue(output);
  const imageIds = c.annotations.images().map((i) => i.id);
  await done(start("prelabel_start", { modelId: "model", imageIds }));
  expect(useAnnotationStore.getState().undoStack).toHaveLength(1);
  expect(
    useAnnotationStore.getState().annotationsByImage["C:/project/frame.png"][0].frameIndex,
  ).toBe(42);
  let resolve!: (outcome: PrelabelInferenceOutcome) => void;
  vi.mocked(api.runPrelabelInference).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const task = start("prelabel_start", { modelId: "model", imageIds });
  await vi.waitFor(() => expect(resolve).toBeDefined());
  call("task_cancel", { taskId: task });
  resolve(output);
  await done(task, "cancelled");
  expect(api.cancelPrelabelInference).toHaveBeenCalledWith(task);
  expect(useAnnotationStore.getState().undoStack).toHaveLength(1);
});
it("validates configured models, rejects arbitrary paths and sanitizes native failures", async () => {
  expect(start("project_export", { format: "json", path: "C:/escape" })).toBeUndefined();
  const task = start("prelabel_start", {
    modelId: "missing",
    imageIds: c.annotations.images().map((i) => i.id),
  });
  expect((await done(task, "failed")).code).toBe("NOT_FOUND");
  vi.mocked(api.mcpPrepareOutput).mockRejectedValue(new Error("C:/secret/file: access denied"));
  const failed = await done(start("project_save"), "failed");
  expect(JSON.stringify(failed)).not.toContain("secret");
  expect(useOperations.getState().operations.some((op) => op.message.includes("secret"))).toBe(
    true,
  );
});
it("times out a pending overwrite without writing", async () => {
  vi.useFakeTimers();
  vi.mocked(api.mcpPrepareOutput).mockResolvedValue({ files: 1, overwrites: 1 });
  const task = start("project_export", { format: "json" });
  await vi.advanceTimersByTimeAsync(10);
  await vi.advanceTimersByTimeAsync(MCP_LIMITS.taskMs);
  expect(c.jobs.status("s", task)).toMatchObject({ status: "cancelled", code: "TIMEOUT" });
  expect(api.mcpCommitOutput).not.toHaveBeenCalled();
});
it("retries cancellation after native registration and reports revocation independently of native errors", async () => {
  let reject!: (error: Error) => void;
  let progress!: Parameters<typeof api.runPrelabelInference>[3];
  vi.mocked(api.runPrelabelInference).mockImplementationOnce((_id, _model, _paths, onProgress) => {
    progress = onProgress;
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  const task = start("prelabel_start", {
    modelId: "model",
    imageIds: c.annotations.images().map((i) => i.id),
  });
  await vi.waitFor(() => expect(progress).toBeDefined());
  c.control.revoke();
  expect(api.cancelPrelabelInference).toHaveBeenCalledTimes(1);
  progress({ event: "modelLoading" });
  expect(api.cancelPrelabelInference).toHaveBeenCalledTimes(2);
  reject(new Error("native abort at C:/secret"));
  expect(await done(task, "cancelled")).toMatchObject({ code: "CONTROL_REVOKED" });
  expect(useAnnotationStore.getState().undoStack).toHaveLength(0);
});
it("serializes all built-in formats using existing exporters and protects YOLO shape constraints", () => {
  const data = {
    labels: context.labels,
    images: [
      {
        path: "C:/project/a.png",
        name: "a.png",
        width: 100,
        height: 100,
        annotations: [
          { id: "box", type: "rect" as const, labelId: "person", points: [1, 2, 3, 4] },
        ],
      },
    ],
  };
  for (const format of ["json", "coco", "voc", "yolo", "custom"] as const)
    expect(serializeMcpExport(format, data, context).length).toBeGreaterThan(0);
  expect(() =>
    serializeMcpExport(
      "yolo",
      {
        ...data,
        images: [
          {
            ...data.images[0],
            annotations: [{ id: "p", type: "point", labelId: "person", points: [1, 2] }],
          },
        ],
      },
      context,
    ),
  ).toThrow();
});
