import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrelabelResourceSettings, PrelabelResourceSummary } from "./PrelabelResourceSettings";
import { usePrelabelResourceStore as store } from "../../store/usePrelabelResourceStore";
import { PRELABEL_RESOURCE_ZH_CN as text } from "../../i18n/prelabel-resource.zh-CN";

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
  api.loadPrelabelResourceLimits.mockResolvedValue({ maxMemoryMiB: 128, maxCandidates: 150_000 });
  root = createRoot(host);
  await act(async () =>
    root.render(<PrelabelResourceSettings onDirtyChange={dirty} onSavingChange={saving} />),
  );
  expect(host.querySelector<HTMLInputElement>(`input[aria-label="${text.memory}"]`)!.value).toBe(
    "128",
  );
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
