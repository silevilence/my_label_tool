import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useShortcutsConfig } from "./useShortcutsConfig";
import { useTextReadStore } from "../store/useTextReadStore";
import { DEFAULT_SHORTCUTS } from "../lib/defaults/shortcuts";
const api = vi.hoisted(() => ({ loadShortcuts: vi.fn(), saveShortcuts: vi.fn() }));
vi.mock("../lib/tauri-api", () => api);
let root: Root;
let host: HTMLDivElement;
let model: ReturnType<typeof useShortcutsConfig>;
const onError = vi.fn();
function Harness() {
  model = useShortcutsConfig(onError);
  return null;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  useTextReadStore.setState({ revision: 0 });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
});
it("retries failed startup reads after configuration repair without remounting", async () => {
  api.loadShortcuts
    .mockRejectedValueOnce("reader missing")
    .mockResolvedValue({ ...DEFAULT_SHORTCUTS, nextImage: "n" });
  await act(async () => root.render(<Harness />));
  expect(onError).toHaveBeenCalledWith("reader missing");
  expect(api.saveShortcuts).not.toHaveBeenCalled();
  await act(async () => useTextReadStore.getState().changed());
  expect(api.loadShortcuts).toHaveBeenCalledTimes(2);
  expect(model.shortcuts.nextImage).toBe("n");
});
it("does not replace loaded state on subsequent mode changes", async () => {
  api.loadShortcuts.mockResolvedValue(DEFAULT_SHORTCUTS);
  await act(async () => root.render(<Harness />));
  await act(async () => useTextReadStore.getState().changed());
  expect(api.loadShortcuts).toHaveBeenCalledOnce();
});
