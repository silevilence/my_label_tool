import { expect, it, vi, beforeEach } from "vitest";
import { importVideo } from "./tauri-api";
import { runVideoImportQueue } from "./video-import-queue";
import type { VideoImportResult } from "../types/video";
vi.mock("./tauri-api", () => ({ importVideo: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const result = { folderPath: "frames" } as VideoImportResult;
it("runs sequentially, applies every result, and records failures without skipping later videos", async () => {
  vi.mocked(importVideo)
    .mockResolvedValueOnce(result)
    .mockRejectedValueOnce(new Error("broken"))
    .mockResolvedValueOnce(result);
  const applied = vi.fn().mockResolvedValue(undefined);
  const progress = await runVideoImportQueue(
    ["a", "b", "c"],
    "project",
    7,
    applied,
    () => false,
    vi.fn(),
  );
  expect(importVideo).toHaveBeenNthCalledWith(1, "a", "project", 7);
  expect(importVideo).toHaveBeenNthCalledWith(3, "c", "project", 7);
  expect(applied).toHaveBeenCalledTimes(2);
  expect(progress).toMatchObject({
    completed: 2,
    total: 3,
    finished: true,
    failures: [{ source: "b", message: "broken" }],
  });
});
it("stops before the next video on cancellation and retains committed results", async () => {
  vi.mocked(importVideo).mockResolvedValue(result);
  let cancelled = false;
  const progress = await runVideoImportQueue(
    ["a", "b"],
    "project",
    30,
    async () => {
      cancelled = true;
    },
    () => cancelled,
    vi.fn(),
  );
  expect(importVideo).toHaveBeenCalledTimes(1);
  expect(progress).toMatchObject({ completed: 1, cancelled: true, failures: [] });
});
it("does not report cancelled extraction as a failed video", async () => {
  let cancelled = false;
  vi.mocked(importVideo).mockImplementation(async () => {
    cancelled = true;
    throw "cancelled";
  });
  const applied = vi.fn();
  const progress = await runVideoImportQueue(
    ["a", "b"],
    "project",
    30,
    applied,
    () => cancelled,
    vi.fn(),
  );
  expect(applied).not.toHaveBeenCalled();
  expect(progress).toMatchObject({ completed: 0, cancelled: true, failures: [] });
});
it("handles a string failure and cancellation before any extraction", async () => {
  vi.mocked(importVideo).mockRejectedValue("failed");
  const failed = await runVideoImportQueue(["a"], "p", 1, vi.fn(), () => false, vi.fn());
  expect(failed.failures[0].message).toBe("failed");
  vi.mocked(importVideo).mockClear();
  await runVideoImportQueue(["a"], "p", 1, vi.fn(), () => true, vi.fn());
  expect(importVideo).not.toHaveBeenCalled();
});
