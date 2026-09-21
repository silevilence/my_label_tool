import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrelabelResourceSettings, PrelabelResourceSummary } from "./PrelabelResourceSettings";
import { usePrelabelResourceStore as store } from "../../store/usePrelabelResourceStore";
import { PRELABEL_RESOURCE_ZH_CN as text } from "../../i18n/prelabel-resource.zh-CN";

const prompts = vi.hoisted(() => ({ confirmAction: vi.fn() }));
vi.mock("../../lib/prompts", () => prompts);
const api = vi.hoisted(() => ({
  loadPrelabelResourceLimits: vi.fn(),
  savePrelabelResourceLimits: vi.fn(),
}));
vi.mock("../../lib/tauri-api", () => api);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const dirty = vi.fn();
const saving = vi.fn();

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  store.setState({ limits: null, loading: false, saving: false, error: "" });
  api.loadPrelabelResourceLimits.mockResolvedValue({ maxMemoryMiB: 80, maxCandidates: 100_000 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <PrelabelResourceSettings onDirtyChange={dirty} onSavingChange={saving} />
        <PrelabelResourceSummary />
      </>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function edit(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
}

it("persists both settings and refreshes the model management conversion", async () => {
  expect(host.textContent).toContain("10,485,760");
  edit(text.memory, "128");
  edit(text.candidates, "150000");
  expect(dirty).toHaveBeenLastCalledWith(true);
  await act(async () => button(text.save).click());
  expect(api.savePrelabelResourceLimits).toHaveBeenCalledWith({
    maxMemoryMiB: 128,
    maxCandidates: 150_000,
  });
  expect(host.textContent).toContain("16,777,216");
  expect(host.textContent).toContain("150,000");
  expect(host.textContent).toContain(text.saved);
  expect(dirty).toHaveBeenLastCalledWith(false);
  await act(async () => {
    root.unmount();
  });
  api.loadPrelabelResourceLimits.mockClear();
  api.loadPrelabelResourceLimits.mockResolvedValue({ maxMemoryMiB: 256, maxCandidates: 150_000 });
  root = createRoot(host);
  await act(async () =>
    root.render(<PrelabelResourceSettings onDirtyChange={dirty} onSavingChange={saving} />),
  );
  expect(host.querySelector<HTMLInputElement>(`input[aria-label="${text.memory}"]`)!.value).toBe(
    "256",
  );
  expect(api.loadPrelabelResourceLimits).toHaveBeenCalledOnce();
});

it("blocks invalid values and leaves the saved summary unchanged on write failure", async () => {
  edit(text.memory, "");
  expect(button(text.save).disabled).toBe(true);
  expect(host.textContent).toContain(text.invalidMemory);
  edit(text.memory, "128");
  edit(text.candidates, "0");
  expect(button(text.save).disabled).toBe(true);
  edit(text.candidates, "150000");
  api.savePrelabelResourceLimits.mockRejectedValueOnce("disk full");
  await act(async () => button(text.save).click());
  expect(host.textContent).toContain("disk full");
  expect(host.textContent).toContain("10,485,760");
  expect(dirty).toHaveBeenLastCalledWith(true);
  act(() => button(text.defaults).click());
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it("confirms before reload discards a failed-save draft", async () => {
  edit(text.memory, "128");
  api.savePrelabelResourceLimits.mockRejectedValueOnce("disk full");
  await act(async () => button(text.save).click());
  api.loadPrelabelResourceLimits.mockClear();
  prompts.confirmAction.mockResolvedValueOnce(false);
  await act(async () => button(text.retry).click());
  expect(prompts.confirmAction).toHaveBeenCalledWith(text.discardReload);
  expect(api.loadPrelabelResourceLimits).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>(`input[aria-label="${text.memory}"]`)!.value).toBe(
    "128",
  );
  prompts.confirmAction.mockResolvedValueOnce(true);
  await act(async () => button(text.retry).click());
  expect(api.loadPrelabelResourceLimits).toHaveBeenCalledOnce();
  expect(dirty).toHaveBeenLastCalledWith(false);
});
it("recovers an unreadable configuration by explicitly saving defaults", async () => {
  await act(async () => root.unmount());
  store.setState({ limits: null, error: "" });
  api.loadPrelabelResourceLimits.mockRejectedValue("invalid JSON");
  root = createRoot(host);
  await act(async () =>
    root.render(<PrelabelResourceSettings onDirtyChange={dirty} onSavingChange={saving} />),
  );
  expect(host.textContent).toContain("invalid JSON");
  expect(button(text.defaults).disabled).toBe(false);
  act(() => button(text.defaults).click());
  expect(button(text.save).disabled).toBe(false);
  await act(async () => button(text.save).click());
  expect(api.savePrelabelResourceLimits).toHaveBeenCalledWith({
    maxMemoryMiB: 80,
    maxCandidates: 100_000,
  });
  expect(store.getState().error).toBe("");
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it("allows default recovery after a reload invalidates previously loaded defaults", async () => {
  expect(store.getState().limits).toEqual({ maxMemoryMiB: 80, maxCandidates: 100_000 });
  expect(button(text.save).disabled).toBe(true);
  api.loadPrelabelResourceLimits.mockRejectedValueOnce("invalid JSON");
  await act(async () => store.getState().load());
  expect(store.getState().limits).toBeNull();
  expect(host.textContent).toContain("invalid JSON");
  act(() => button(text.defaults).click());
  expect(button(text.save).disabled).toBe(false);
  await act(async () => button(text.save).click());
  expect(api.savePrelabelResourceLimits).toHaveBeenCalledExactlyOnceWith({
    maxMemoryMiB: 80,
    maxCandidates: 100_000,
  });
  expect(store.getState().error).toBe("");
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it("explains invalid recovery inputs while disabling save", async () => {
  api.loadPrelabelResourceLimits.mockRejectedValueOnce("invalid JSON");
  await act(async () => store.getState().load());
  expect(store.getState().limits).toBeNull();
  edit(text.memory, "0");
  expect(button(text.save).disabled).toBe(true);
  expect(host.textContent).toContain(text.invalidMemory);
  edit(text.memory, "80");
  edit(text.candidates, "0");
  expect(button(text.save).disabled).toBe(true);
  expect(host.textContent).toContain(text.invalidCandidates);
});
