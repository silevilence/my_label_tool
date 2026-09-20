import { beforeEach, expect, it, vi } from "vitest";
import { tryBeginOperation, useOperations } from "./useOperations";
beforeEach(() => {
  for (const op of useOperations.getState().operations) useOperations.getState().dismiss(op.id);
});
it("atomically excludes overlapping resources while allowing independent operations", () => {
  const registry = useOperations.getState();
  const prelabel = registry.begin({ label: "prelabel", resource: "project-annotations" });
  const exporting = registry.begin({ label: "export", resource: "export-dir" });
  expect(registry.canStart("onnx-runtime")).toBe(true);
  expect(registry.canStart(["video-frames", "project-annotations"])).toBe(false);
  expect(() =>
    registry.begin({ label: "delete", resource: ["export-dir", "project-annotations"] }),
  ).toThrow();
  expect(tryBeginOperation({ label: "save", resource: "export-dir" })).toBeNull();
  prelabel.progress(130, "prelabel progress");
  exporting.progress(NaN, "export progress");
  expect(useOperations.getState().operations.find((op) => op.id === prelabel.id)?.percent).toBe(
    100,
  );
  expect(
    useOperations.getState().operations.find((op) => op.id === exporting.id)?.percent,
  ).toBeNull();
  registry.dismiss(prelabel.id);
  expect(registry.canStart("project-annotations")).toBe(false);
  prelabel.complete("done");
  prelabel.fail("late error");
  prelabel.progress(0, "late progress");
  exporting.fail(new Error("disk full"));
  expect(useOperations.getState().operations.map((op) => [op.message, op.kind])).toEqual([
    ["done", "success"],
    ["disk full", "error"],
  ]);
  expect(registry.canStart(["project-annotations", "export-dir"])).toBe(true);
});
it("requests cancellation once, retains resources until terminal acknowledgement and permits cancellation retry", async () => {
  const cancel = vi.fn().mockRejectedValueOnce(new Error("retry")).mockResolvedValue(undefined);
  const handle = tryBeginOperation({ label: "download", resource: "model-download", cancel })!;
  await useOperations.getState().cancel(handle.id);
  expect(handle.cancelRequested).toBe(false);
  await useOperations.getState().cancel(handle.id);
  await useOperations.getState().cancel(handle.id);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(handle.cancelRequested).toBe(true);
  expect(useOperations.getState().canStart("model-download")).toBe(false);
  handle.complete("cancelled", "warning");
  expect(useOperations.getState().canStart("model-download")).toBe(true);
  await useOperations.getState().cancel(handle.id);
  expect(cancel).toHaveBeenCalledTimes(2);
});
it("allows changing cancellation support and ignores unknown ids", async () => {
  const handle = useOperations.getState().begin({ label: "update", resource: "app-update" });
  const cancel = vi.fn();
  await useOperations.getState().cancel("missing");
  await useOperations.getState().cancel(handle.id);
  handle.setCancel(cancel);
  handle.progress(-5);
  handle.progress(null);
  handle.setCancel();
  await useOperations.getState().cancel(handle.id);
  expect(cancel).not.toHaveBeenCalled();
  handle.fail("failed");
  useOperations.getState().dismiss(handle.id);
  expect(handle.cancelRequested).toBe(false);
});
