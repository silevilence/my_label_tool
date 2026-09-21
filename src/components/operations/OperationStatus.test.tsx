import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OperationStatus } from "./OperationStatus";
import { useOperations } from "../../store/useOperations";
import { Overlay } from "../overlay/Overlay";

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

it("shares the status area with update content and keeps cancellation operational", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useOperations.setState({ operations: [] });
  const host = document.createElement("div"),
    root = createRoot(host);
  const cancel = vi.fn();
  const operation = useOperations
    .getState()
    .begin({ label: "update", resource: "app-update", cancel });
  await act(async () =>
    root.render(
      <OperationStatus>
        <article>Downloading update</article>
      </OperationStatus>,
    ),
  );
  expect(host.querySelector('[role="region"]')?.contains(host.querySelector("article"))).toBe(true);
  const region = host.querySelector('[role="region"]');
  expect(host.querySelector("article")?.parentElement).toBe(region);
  expect(host.querySelector('[role="status"]')?.parentElement).toBe(region);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(cancel).toHaveBeenCalledOnce();
  expect(operation.cancelRequested).toBe(true);
  await act(async () => {
    operation.complete();
    root.unmount();
  });
});

it("moves a single feedback region into the active work dialog and returns it when closed", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useOperations.setState({ operations: [] });
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  const render = (open: boolean) =>
    act(async () =>
      root.render(
        <>
          <OperationStatus />
          {open && (
            <Overlay operationFeedback label="work" onClose={vi.fn()}>
              <button>Work</button>
            </Overlay>
          )}
        </>,
      ),
    );
  await render(true);
  await act(async () =>
    useOperations
      .getState()
      .begin({ label: "model", resource: "model-download" })
      .fail("broken model"),
  );
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("broken model");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await render(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("broken model");
  await act(async () => root.unmount());
  host.remove();
});

it("routes matching failures into one inline slot while keeping aggregation and dismissal", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useOperations.setState({ operations: [] });
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  await act(async () =>
    root.render(
      <>
        <div data-operation-error-feedback='export["special"]' />
        <OperationStatus />
      </>,
    ),
  );
  await act(async () => {
    useOperations
      .getState()
      .begin({ label: 'export["special"]', resource: "export-dir" })
      .fail("first");
    useOperations
      .getState()
      .begin({ label: 'export["special"]', resource: "export-dir" })
      .fail("second");
  });
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  const slot = host.querySelector("[data-operation-error-feedback]")!;
  expect(slot.querySelector('[role="alert"]')?.textContent).toContain("second（共 2 次）");
  await act(async () => slot.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  await act(async () => root.unmount());
  host.remove();
});

it("replaces old failure cards on retry and does not label progress or success with a failure count", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useOperations.setState({ operations: [] });
  const host = document.createElement("div"),
    root = createRoot(host);
  act(() => root.render(<OperationStatus />));
  const registry = useOperations.getState();
  act(() => {
    registry.begin({ label: "retry", resource: "export-dir" }).fail("first");
    registry.begin({ label: "retry", resource: "export-dir" }).fail("second");
  });
  expect(host.textContent).toContain("共 2 次");
  let retry!: ReturnType<typeof registry.begin>;
  act(() => {
    retry = registry.begin({ label: "retry", resource: "export-dir" });
    retry.progress(50, "running");
  });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("running");
  expect(host.textContent).not.toContain("共 2 次");
  act(() => retry.complete("success"));
  expect(host.textContent).toContain("success");
  expect(host.textContent).not.toContain("共 2 次");
  act(() => root.unmount());
});
