import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextReadSettings } from "./TextReadSettings";
import { TEXT_READ_ZH_CN as text } from "../../i18n/text-read.zh-CN";
import { useOperations } from "../../store/useOperations";
import { useTextReadStore } from "../../store/useTextReadStore";
const api = vi.hoisted(() => ({
  getTextReadSettings: vi.fn(),
  previewTextRead: vi.fn(),
  configureTextRead: vi.fn(),
  cancelTextRead: vi.fn(),
}));
vi.mock("../../lib/tauri-api", () => api);
let host: HTMLDivElement;
let root: Root;
const native = { mode: "native", values: {}, timeoutMs: 30000 };
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  useOperations.setState({ operations: [] });
  useTextReadStore.setState({ revision: 0 });
  api.getTextReadSettings.mockResolvedValue({
    config: native,
    modes: [
      { id: "native", name: "原生", fields: [], selfCheck: "unicode check" },
      {
        id: "demo",
        name: "注册表新增模式",
        fields: [{ key: "program", label: "演示路径", kind: "string", required: true }],
        selfCheck: "demo check",
      },
    ],
    lastCheck: null,
    startupError: null,
  });
  api.previewTextRead.mockResolvedValue({ executable: null, arguments: [] });
  api.configureTextRead.mockResolvedValue({ config: native, ok: true, message: "check passed" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<TextReadSettings />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function button(label: string) {
  return [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
}
it("requires preview, saves only after self-check and notifies failed startup readers", async () => {
  expect(button(text.save).disabled).toBe(true);
  await act(async () => button(text.preview).click());
  expect(api.configureTextRead).not.toHaveBeenCalled();
  await act(async () => button(text.save).click());
  expect(api.configureTextRead).toHaveBeenCalledWith(native, expect.any(String), true);
  expect(useTextReadStore.getState().revision).toBe(1);
  expect(host.textContent).toContain(text.saved);
});
it("renders new mode metadata without mode-specific UI and invalidates old preview", async () => {
  await act(async () => button(text.preview).click());
  act(() => {
    const select = host.querySelector("select")!;
    select.value = "demo";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("演示路径");
  expect(host.textContent).toContain("demo check");
  expect(button(text.check).disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>("input")!.required).toBe(true);
});
it("shows self-check failures, preserves active settings and allows a retry", async () => {
  api.configureTextRead.mockRejectedValueOnce("读取程序超时：检查 DLP 策略");
  await act(async () => button(text.preview).click());
  await act(async () => button(text.save).click());
  expect(host.textContent).toContain("检查 DLP 策略");
  expect(useTextReadStore.getState().revision).toBe(0);
  expect(useOperations.getState().operations[0].status).toBe("failed");
  await act(async () => button(text.check).click());
  expect(api.configureTextRead).toHaveBeenLastCalledWith(native, expect.any(String), false);
  expect(host.textContent).toContain("check passed");
  expect(useTextReadStore.getState().revision).toBe(1);
});
it("does not retry readers when only an unapplied draft passes self-check", async () => {
  act(() => {
    const select = host.querySelector("select")!;
    select.value = "demo";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  api.configureTextRead.mockResolvedValue({
    config: { ...native, mode: "demo" },
    ok: true,
    message: "check passed",
  });
  await act(async () => button(text.preview).click());
  await act(async () => button(text.check).click());
  expect(useTextReadStore.getState().revision).toBe(0);
});
it.each([
  { ...native, timeoutMs: 1000 },
  { ...native, values: { executable: "different.exe" } },
])(
  "does not retry readers when checked parameters differ from active settings: %j",
  async (config) => {
    api.configureTextRead.mockResolvedValue({ config, ok: true, message: "check passed" });
    await act(async () => button(text.preview).click());
    await act(async () => button(text.check).click());
    expect(useTextReadStore.getState().revision).toBe(0);
  },
);
it("cancels the specific pending check", async () => {
  let reject!: (error: unknown) => void;
  api.configureTextRead.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => button(text.preview).click());
  await act(async () => button(text.check).click());
  await act(async () => button(text.cancel).click());
  expect(api.cancelTextRead).toHaveBeenCalledWith(api.configureTextRead.mock.calls[0][1]);
  await act(async () => reject("cancelled"));
  expect(host.textContent).toContain("cancelled");
});
