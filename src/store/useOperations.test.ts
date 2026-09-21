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
  expect(useOperations.getState().operations.find((op) => op.id === handle.id)?.message).toBe(
    "retry",
  );
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
  handle.setCancel(cancel);
  await useOperations.getState().cancel(handle.id);
  expect(cancel).not.toHaveBeenCalled();
  useOperations.getState().dismiss(handle.id);
  expect(handle.cancelRequested).toBe(false);
  expect(useOperations.getState().operations.some((op) => op.id === handle.id)).toBe(false);
});

it("aggregates repeated push errors under one label and ignores empty messages", () => {
  const registry = useOperations.getState();
  registry.pushError("导出", "disk full");
  registry.pushError("导出", "disk full again");
  registry.pushError("导出", "");
  const card = useOperations
    .getState()
    .operations.find((op) => op.label === "导出" && op.status === "failed")!;
  expect(card.message).toBe("disk full again");
  expect(card.failCount).toBe(2);
  expect(card.resources).toEqual([]);
  expect(registry.canStart("project-annotations")).toBe(true);
  registry.dismiss(card.id);
  registry.pushError("导出", "third");
  expect(useOperations.getState().operations.filter((op) => op.label === "导出")).toHaveLength(1);
});

it("aggregates failed retries without double-counting late terminal calls or losing resources", () => {
  const registry = useOperations.getState();
  const first = registry.begin({ label: "export", resource: "export-dir" });
  first.fail("first");
  first.fail("late duplicate");
  const retry = registry.begin({ label: "export", resource: "export-dir" });
  expect(registry.canStart("export-dir")).toBe(false);
  retry.fail("second");
  retry.complete("late success");
  expect(useOperations.getState().operations).toHaveLength(1);
  expect(useOperations.getState().operations[0]).toMatchObject({
    id: retry.id,
    status: "failed",
    message: "second",
    failCount: 2,
  });
  expect(registry.canStart("export-dir")).toBe(true);
  registry.pushError("unrelated", "separate");
  registry.dismiss(retry.id);
  const fresh = registry.begin({ label: "export", resource: "export-dir" });
  fresh.fail("fresh");
  expect(useOperations.getState().operations.find((op) => op.id === fresh.id)?.failCount).toBe(1);
  expect(useOperations.getState().operations.find((op) => op.label === "unrelated")).toBeDefined();
});

it("merges standalone failures with the next failed operation of the same name", () => {
  const registry = useOperations.getState();
  registry.pushError("download", "first");
  registry.pushError("download", "second");
  registry.begin({ label: "download", resource: "model-download" }).fail("third");
  expect(useOperations.getState().operations).toHaveLength(1);
  expect(useOperations.getState().operations[0]).toMatchObject({ message: "third", failCount: 3 });
});
