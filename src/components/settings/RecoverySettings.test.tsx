import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RecoverySettings } from "./RecoverySettings";
import { useRecoveryStore } from "../../store/useRecoveryStore";
import { OperationStatus } from "../operations/OperationStatus";
import { useOperations, type OperationHandle } from "../../store/useOperations";

it("offers three modes, validates intervals, persists preferences and exposes retry", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const retry = vi.fn();
  useRecoveryStore.setState({
    settings: { mode: "off", intervalSeconds: 60 },
    status: { saving: false, dirty: false, savedAt: "", error: "" },
    retry,
    manualPending: 0,
    resolveConflict: null,
    openArchives: null,
  });
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  await act(async () => root.render(<RecoverySettings />));
  expect(host.textContent).toContain("自动保存：未开启");
  await act(async () => host.querySelector("button")!.click());
  expect(document.querySelectorAll("option")).toHaveLength(3);
  await act(async () => {
    const select = document.querySelector("select")!;
    select.value = "interval";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const input = document.querySelector("input")!;
  async function submit(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  }
  await submit("0");
  expect(document.body.textContent).toContain("10 至 3600");
  await submit("30");
  expect(useRecoveryStore.getState().settings.intervalSeconds).toBe(30);
  expect(
    JSON.parse(localStorage.getItem("my-label-tool-autosave")!).state.settings.intervalSeconds,
  ).toBe(30);
  await act(async () =>
    useRecoveryStore.setState({
      status: { saving: false, dirty: true, savedAt: "", error: "disk full" },
    }),
  );
  expect(host.textContent).toContain("disk full");
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "重试保存")!
      .click(),
  );
  expect(retry).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  host.remove();
});
it("background save operations do not shift the canvas but failures remain visible", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useOperations.setState({ operations: [], mcpControlled: false });
  const host = document.createElement("div"),
    root = createRoot(host);
  await act(async () => root.render(<OperationStatus />));
  let operation!: OperationHandle;
  await act(async () => {
    operation = useOperations
      .getState()
      .begin({ label: "background", resource: "recovery-copy", quiet: true });
  });
  expect(host.textContent).toBe("");
  await act(async () => operation.fail("disk full"));
  expect(host.textContent).toContain("disk full");
  await act(async () => root.unmount());
  host.remove();
});

it("shows manual-only state, keeps draft settings on cancel, and offers conflict recovery", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const resolveConflict = vi.fn(),
    openArchives = vi.fn();
  useRecoveryStore.setState({
    settings: { mode: "off", intervalSeconds: 60 },
    manualPending: 0,
    status: { saving: false, dirty: true, savedAt: "", error: "" },
    resolveConflict,
    openArchives,
  });
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  await act(async () => root.render(<RecoverySettings />));
  expect(host.textContent).toContain("自动保存：未开启");
  expect(host.textContent).toContain("请手动保存");
  await act(async () => host.querySelector("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  await act(async () => {
    const select = dialog.querySelector("select")!;
    select.value = "interval";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(useRecoveryStore.getState().settings.mode).toBe("off");
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "打开保留副本目录")!
      .click(),
  );
  expect(openArchives).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useRecoveryStore.getState().settings).toEqual({ mode: "off", intervalSeconds: 60 });
  await act(async () => useRecoveryStore.setState({ manualPending: 1 }));
  expect(host.textContent).toContain("手动保存已排队");
  await act(async () =>
    useRecoveryStore.setState({
      manualPending: 0,
      status: {
        saving: false,
        dirty: true,
        savedAt: "",
        error: "[RECOVERY_CONFLICT] another window",
      },
    }),
  );
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "保留双方副本并继续保存")!
      .click(),
  );
  expect(resolveConflict).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  host.remove();
});
