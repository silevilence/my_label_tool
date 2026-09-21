import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { OperationStatus } from "../components/operations/OperationStatus";
import { OPERATION_ZH_CN as text } from "../i18n/operations.zh-CN";
import { useOperations } from "../store/useOperations";
import { useAppUpdate } from "./useAppUpdate";

const api = vi.hoisted(() => ({ checkAppUpdate: vi.fn(), installAppUpdate: vi.fn() }));
vi.mock("../lib/updater", () => api);

afterEach(() => {
  vi.useRealTimers();
  useOperations.setState({ operations: [] });
});

it("reports an installation failure in exactly one operation card", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  useOperations.setState({ operations: [] });
  api.checkAppUpdate.mockResolvedValue({ version: "2.0.0", currentVersion: "1.0.0" });
  api.installAppUpdate.mockRejectedValue(new Error("disk full"));
  let update!: ReturnType<typeof useAppUpdate>;
  function Harness() {
    update = useAppUpdate();
    return <OperationStatus />;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<Harness />));
    await act(async () => update.checkForUpdates());
    await act(async () => update.installUpdate());
    expect(api.installAppUpdate).toHaveBeenCalledOnce();
    expect(update.updateStatus).toBe("error");
    const failures = useOperations.getState().operations.filter((op) => op.status === "failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].label).toBe(text.update);
    expect(failures[0].message).toContain("disk full");
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(host.textContent).toContain("disk full");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
