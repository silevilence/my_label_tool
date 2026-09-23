import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePrelabelLibraryMutation } from "./usePrelabelLibraryMutation";
import { useOperations, type OperationHandle } from "../store/useOperations";
import { OPERATION_ZH_CN as text } from "../i18n/operations.zh-CN";

let root: Root;
let controls: ReturnType<typeof usePrelabelLibraryMutation<{ value: number }>>;
function Harness() {
  controls = usePrelabelLibraryMutation({ value: 1 });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useOperations.setState({ operations: [] });
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
});
afterEach(() => act(() => root.unmount()));

it("guards a captured retry callback against resource contention and stale failures", async () => {
  const action = vi
    .fn()
    .mockRejectedValueOnce(new Error("save failed"))
    .mockResolvedValue(undefined);
  await act(async () => controls.runLibraryMutation(action));
  const retry = controls.retryLibraryAction!;
  expect(retry).not.toBeNull();
  const failure = useOperations.getState().operations[0];
  let owner!: OperationHandle;
  act(() => {
    owner = useOperations.getState().begin({ label: "graph", resource: "model-download" });
  });
  await act(async () => retry());
  expect(action).toHaveBeenCalledTimes(1);
  expect(controls.busyNotice).toBe("");
  expect(useOperations.getState().operations).toContain(failure);
  act(() => {
    owner.complete();
    useOperations.getState().dismiss(failure.id);
  });
  await act(async () => retry());
  expect(action).toHaveBeenCalledTimes(1);
});

it("rejects reentrant writes while retaining the first pending mutation", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const competing = vi.fn();
  let first!: Promise<void>;
  await act(async () => {
    first = controls.runLibraryMutation(() => pending);
  });
  await act(async () => controls.runLibraryMutation(competing));
  expect(competing).not.toHaveBeenCalled();
  expect(controls.isLibraryBusy).toBe(true);
  await act(async () => {
    finish();
    await first;
  });
  expect(controls.isLibraryBusy).toBe(false);
});

it.each([false, true])(
  "reports busy without creating failures for local/download mutations (%s)",
  async (download) => {
    let owner!: OperationHandle;
    act(() => {
      owner = useOperations.getState().begin({ label: "graph", resource: "model-download" });
    });
    const action = vi.fn();
    await act(async () => controls.runLibraryMutation(action, { download }));
    expect(action).not.toHaveBeenCalled();
    expect(controls.busyNotice).toBe(text.busy);
    expect(useOperations.getState().operations).toHaveLength(1);
    act(() => owner.complete());
    expect(controls.busyNotice).toBe("");
  },
);

it("records download failures under the download operation", async () => {
  await act(async () =>
    controls.runLibraryMutation(
      async () => {
        throw new Error("download failed");
      },
      { download: true },
    ),
  );
  expect(useOperations.getState().operations[0]).toMatchObject({
    label: text.model,
    status: "failed",
    message: "download failed",
  });
  expect(controls.retryLibraryAction).toBeNull();
});
