import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSaveFeedback } from "./useSaveFeedback";
import { useOperations, type OperationHandle } from "../store/useOperations";
import { OPERATION_ZH_CN as text } from "../i18n/operations.zh-CN";
let root: Root;
let feedback!: ReturnType<typeof useSaveFeedback>;
function Harness() {
  feedback = useSaveFeedback(async () => true);
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  useOperations.setState({ operations: [] });
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("shows fast saves for 500ms then success for 2200ms without retaining the resource lock", () => {
  act(() =>
    useOperations
      .getState()
      .begin({ label: text.save, resource: "project-annotations" })
      .complete(),
  );
  expect(feedback.isSaving).toBe(true);
  expect(useOperations.getState().canStart("project-annotations")).toBe(true);
  act(() => vi.advanceTimersByTime(499));
  expect(feedback.showSaveSuccess).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(feedback.isSaving).toBe(false);
  expect(feedback.showSaveSuccess).toBe(true);
  act(() => vi.advanceTimersByTime(2200));
  expect(feedback.showSaveSuccess).toBe(false);
});
it("keeps slow saves visible until completion and never shows success on failure", () => {
  let handle!: OperationHandle;
  act(() => {
    handle = useOperations.getState().begin({ label: text.save, resource: "project-annotations" });
  });
  act(() => vi.advanceTimersByTime(900));
  expect(feedback.isSaving).toBe(true);
  act(() => handle.fail("disk full"));
  expect(feedback.isSaving).toBe(false);
  expect(feedback.showSaveSuccess).toBe(false);
});
