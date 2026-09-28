import { beforeEach, expect, it } from "vitest";
import { McpController } from "./mcp-controller";
import { useOperations } from "../store/useOperations";
import { useOverlayStore } from "../store/useOverlayStore";
import { useAnnotationStore } from "../store/useAnnotationStore";
import type { McpStatus } from "../types/mcp";
import type { AnnotationShape } from "../types/annotation";
import { exportCoco } from "./exporters/coco";
import { validateAnnotationCore } from "./annotation-validation";

const labels = [{ id: "person", name: "人", color: "#ff0000", shapeType: "rect" as const }];
const shape: AnnotationShape = {
  id: "box",
  type: "rect",
  labelId: "person",
  points: [10, 20, 30, 40],
  attributes: { score: 0.9 },
  frameIndex: 999,
};
let controller: McpController;
let status: McpStatus;
let imageId: string;
let secondId: string;
let leaseId: unknown;
beforeEach(() => {
  useOperations.setState({ operations: [], mcpControlled: false });
  useOverlayStore.setState({ stack: [] });
  useAnnotationStore.setState({
    images: [
      { path: "C:/project/a.png", name: "a.png" },
      { path: "C:/project/b.png", name: "b.png" },
    ],
    annotationsByImage: {},
    frameIndices: { "C:/project/b.png": 12 },
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
  });
  controller = new McpController(() => ({
    folderPath: "C:/project",
    labels,
    canGrant: () => true,
  }));
  status = {
    running: true,
    enabled: true,
    address: "127.0.0.1",
    port: 1421,
    generation: 1,
    error: null,
    sessions: [{ id: "s", client: "sdk", version: "2025-11-25", lastSeen: Date.now() }],
    audit: [],
  };
  controller.observe(status);
  [imageId, secondId] = controller.annotations.images().map((image) => image.id);
  call("control_request", { projectId: controller.projectId, permissions: ["annotations"] });
  controller.approve(["annotations"]);
  leaseId = controller.control.state.leaseId;
});
function call(name: string, args: Record<string, unknown>) {
  return controller.handle(
    { id: "call", sessionId: "s", name, arguments: args, deadline: Date.now() + 10000 },
    status,
  );
}
function apply(changes: unknown[], revision = controller.revision) {
  return call("annotations_apply", {
    projectId: controller.projectId,
    expectedRevision: revision,
    leaseId,
    changes,
  });
}
it("uses stable opaque IDs and returns no filesystem paths or mutable store references", () => {
  const project = call("project_read", {}).structuredContent;
  expect(JSON.stringify(project)).not.toContain("C:/");
  expect(controller.annotations.images()[0].id).toBe(imageId);
  expect(controller.annotations.path(imageId)).toBe("C:/project/a.png");
  expect(() => controller.annotations.path("C:/project/a.png")).toThrow();
  expect(
    call("annotations_read", { projectId: controller.projectId, imageId }).structuredContent
      .annotations,
  ).toEqual([]);
  controller.control.revoke();
  useAnnotationStore.getState().setImages([{ path: "C:/project/b.png", name: "b.png" }]);
  expect(() => controller.annotations.path(imageId)).toThrow();
  expect(controller.annotations.images()[0].id).toBe(secondId);
});
it("commits a batch atomically with one undo entry and binds source frame numbers", () => {
  const before = controller.revision;
  const result = apply([
    { imageId, operation: "add", annotation: shape },
    { imageId: secondId, operation: "add", annotation: shape },
  ]);
  expect(result.isError).toBe(false);
  expect(result.structuredContent.revision).toBeGreaterThan(before);
  const state = useAnnotationStore.getState();
  expect(state.undoStack).toHaveLength(1);
  expect(state.annotationsByImage["C:/project/a.png"][0].frameIndex).toBe(0);
  expect(state.annotationsByImage["C:/project/b.png"][0].frameIndex).toBe(12);
  const queried = controller.annotations.read(imageId);
  queried[0].points[0] = 999;
  expect(state.annotationsByImage["C:/project/a.png"][0].points[0]).toBe(10);
  controller.control.revoke();
  state.undo();
  expect(useAnnotationStore.getState().annotationsByImage["C:/project/a.png"]).toEqual([]);
  useAnnotationStore.getState().redo();
  expect(useAnnotationStore.getState().annotationsByImage["C:/project/b.png"][0].frameIndex).toBe(
    12,
  );
  const coco = exportCoco({
    labels,
    images: useAnnotationStore
      .getState()
      .images.map((image) => ({
        ...image,
        width: 100,
        height: 100,
        annotations: useAnnotationStore.getState().annotationsByImage[image.path],
      })),
  });
  expect(coco.annotations).toHaveLength(2);
  expect(coco.annotations[0].bbox).toEqual(shape.points);
});
it("updates and deletes existing annotations and detects stale revisions", () => {
  expect(apply([{ imageId, operation: "add", annotation: shape }]).isError).toBe(false);
  const revision = controller.revision;
  expect(
    apply([
      {
        imageId,
        operation: "update",
        annotationId: "box",
        annotation: { ...shape, points: [1, 2, 3, 4] },
      },
    ]).isError,
  ).toBe(false);
  expect(controller.annotations.read(imageId)[0].points).toEqual([1, 2, 3, 4]);
  expect(
    apply([{ imageId, operation: "delete", annotationId: "box" }], revision).structuredContent.code,
  ).toBe("CONFLICT");
  expect(apply([{ imageId, operation: "delete", annotationId: "box" }]).isError).toBe(false);
  expect(controller.annotations.read(imageId)).toEqual([]);
  expect(
    apply([{ imageId, operation: "delete", annotationId: "box" }]).structuredContent.code,
  ).toBe("NOT_FOUND");
});
it("rejects the entire batch if its last change is invalid, conflicting or unauthorized", () => {
  const before = useAnnotationStore.getState();
  const bad = [
    { imageId: "../escape", operation: "add", annotation: shape },
    { imageId, operation: "add", annotation: { ...shape, labelId: "missing" } },
    { imageId, operation: "add", annotation: { ...shape, type: "point", points: [1, 2] } },
    { imageId, operation: "add", annotation: { ...shape, points: [1, 2, -3, 4] } },
    { imageId, operation: "add", annotation: { ...shape, points: [1, 2, NaN, 4] } },
    { imageId, operation: "add", annotation: { ...shape, id: " " } },
    { imageId, operation: "add", annotation: shape },
    { imageId, operation: "delete", annotationId: "box", annotation: shape },
    { imageId, operation: "delete" },
    { imageId, operation: "update", annotation: { ...shape, id: "missing" } },
    { imageId, operation: "update", annotationId: "other", annotation: shape },
    { imageId, operation: "update" },
  ];
  for (const change of bad) {
    expect(apply([{ imageId, operation: "add", annotation: shape }, change]).isError).toBe(true);
    expect(useAnnotationStore.getState().annotationsByImage).toBe(before.annotationsByImage);
    expect(useAnnotationStore.getState().undoStack).toHaveLength(0);
  }
  const busy = useOperations
    .getState()
    .begin({ label: "task", resource: "project-annotations", owner: "mcp" });
  expect(apply([{ imageId, operation: "add", annotation: shape }]).structuredContent.code).toBe(
    "BUSY",
  );
  busy.complete();
  controller.control.revoke();
  expect(apply([{ imageId, operation: "add", annotation: shape }]).structuredContent.code).toBe(
    "CONTROL_REVOKED",
  );
});
it("keeps legacy normalization compatible and validates exact MCP coordinate layouts centrally", () => {
  for (const value of [
    { labelId: "a", type: "rect", points: [0, 0, 1, 1, 5] },
    { labelId: "a", type: "point", points: [0, 0, 1] },
    { labelId: "a", type: "polygon", points: [0, 0, 1, 1, 2, 2, 3] },
  ]) {
    expect(() => validateAnnotationCore(value)).not.toThrow();
    expect(() => validateAnnotationCore(value, undefined, true)).toThrow();
  }
  controller.dispose();
});
