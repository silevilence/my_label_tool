import { afterEach, expect, it, vi } from "vitest";
import { useOperations } from "../store/useOperations";
import { beginScriptOperation } from "./script-operation";
afterEach(() => useOperations.setState({ operations: [] }));
it("reserves project annotations against export and prelabel and exposes cancellation", async () => {
  const cancel = vi.fn(async () => {});
  const operation = beginScriptOperation(cancel);
  expect(useOperations.getState().canStart("project-annotations")).toBe(false);
  expect(() => beginScriptOperation(cancel)).toThrow();
  await useOperations.getState().cancel(operation.id);
  expect(cancel).toHaveBeenCalledWith(operation.id);
  expect(operation.cancelRequested).toBe(true);
  operation.complete();
  expect(useOperations.getState().canStart("project-annotations")).toBe(true);
});
