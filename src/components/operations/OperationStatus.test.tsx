import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OperationStatus } from "./OperationStatus";
import { useOperations } from "../../store/useOperations";

it("shows new results first, expires completed cards, and keeps failures and active cancellations", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  useOperations.setState({ operations: [] });
  const rootHost = document.createElement("div");
  const root = createRoot(rootHost);
  act(() => root.render(<OperationStatus />));
  const begin = (label: string) =>
    useOperations.getState().begin({ label, resource: "export-dir" });
  act(() => {
    begin("old").complete();
    begin("error").fail("disk");
    begin("new").complete();
  });
  expect([...rootHost.querySelectorAll("strong")].map((element) => element.textContent)).toEqual([
    "new",
    "error",
    "old",
  ]);
  let running!: ReturnType<typeof begin>;
  const cancel = vi.fn();
  act(() => {
    running = useOperations.getState().begin({ label: "running", resource: "export-dir", cancel });
  });
  expect(rootHost.querySelector("strong")?.textContent).toBe("running");
  act(() => vi.advanceTimersByTime(5000));
  expect([...rootHost.querySelectorAll("strong")].map((element) => element.textContent)).toEqual([
    "running",
    "error",
  ]);
  act(() => rootHost.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
  expect(useOperations.getState().operations.map((op) => op.label)).toEqual(["running"]);
  act(() => {
    running.complete();
    root.unmount();
  });
  vi.useRealTimers();
});
