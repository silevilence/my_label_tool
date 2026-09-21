import { beforeEach, expect, it, vi } from "vitest";
import { usePrelabelResourceStore as store } from "./usePrelabelResourceStore";
import { DEFAULT_PRELABEL_RESOURCE_LIMITS as defaults } from "../lib/defaults/prelabel";
import { PRELABEL_RESOURCE_ZH_CN as text } from "../i18n/prelabel-resource.zh-CN";

const api = vi.hoisted(() => ({
  loadPrelabelResourceLimits: vi.fn(),
  savePrelabelResourceLimits: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);
beforeEach(() => {
  vi.resetAllMocks();
  store.setState({ limits: null, loading: false, saving: false, error: "" });
  api.loadPrelabelResourceLimits.mockResolvedValue(defaults);
});

it("loads saved limits and publishes changes only after persistence succeeds", async () => {
  await store.getState().load();
  expect(store.getState().limits).toEqual(defaults);
  const updated = { maxMemoryMiB: 128, maxCandidates: 150_000 };
  api.savePrelabelResourceLimits.mockRejectedValueOnce("disk full");
  await expect(store.getState().save(updated)).rejects.toBe("disk full");
  expect(store.getState().limits).toEqual(defaults);
  expect(store.getState().error).toContain("disk full");
  await store.getState().save(updated);
  expect(store.getState().limits).toEqual(updated);
  expect(store.getState().error).toBe("");
  expect(store.getState().saving).toBe(false);
});

it("reports read errors, supports retry and validates data from disk", async () => {
  api.loadPrelabelResourceLimits.mockRejectedValueOnce("denied");
  await store.getState().load();
  expect(store.getState().error).toContain("denied");
  api.loadPrelabelResourceLimits.mockResolvedValueOnce({ ...defaults, maxCandidates: 0 });
  await store.getState().load();
  expect(store.getState().limits).toBeNull();
  expect(store.getState().error).not.toBe("");
  await store.getState().load();
  expect(store.getState().limits).toEqual(defaults);
});

it("blocks overlapping reads/writes and refuses invalid saves", async () => {
  let finish!: (value: typeof defaults) => void;
  api.loadPrelabelResourceLimits.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = store.getState().load();
  await store.getState().load();
  await expect(store.getState().save(defaults)).rejects.toThrow();
  expect(store.getState().error).toBe(text.busy);
  expect(api.loadPrelabelResourceLimits).toHaveBeenCalledTimes(1);
  finish(defaults);
  await loading;
  await expect(store.getState().save({ ...defaults, maxMemoryMiB: 0 })).rejects.toThrow();
  expect(api.savePrelabelResourceLimits).not.toHaveBeenCalled();
  let finishSave!: () => void;
  api.savePrelabelResourceLimits.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
  );
  const saving = store.getState().save(defaults);
  await store.getState().load();
  await expect(store.getState().save(defaults)).rejects.toThrow();
  expect(store.getState().error).toBe(text.busy);
  expect(api.loadPrelabelResourceLimits).toHaveBeenCalledTimes(1);
  finishSave();
  await saving;
});
