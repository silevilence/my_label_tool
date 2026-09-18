import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVideoImport } from "./useVideoImport";

const api = vi.hoisted(() => ({
  confirmAction: vi.fn(),
  importVideo: vi.fn(),
  selectVideoFile: vi.fn(),
  selectExportFolder: vi.fn(),
  cancelVideoImport: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);
let root: Root;
let controls: ReturnType<typeof useVideoImport>;
const imported = vi.fn();
const error = vi.fn();
function Harness() {
  controls = useVideoImport(imported, error);
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  api.confirmAction.mockResolvedValue(true);
  api.selectVideoFile.mockResolvedValue("movie.mp4");
  api.selectExportFolder.mockResolvedValue("output");
  api.cancelVideoImport.mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("commits the imported project only after extraction succeeds", async () => {
  const result = { folderPath: "output/new", video: { frames: [] } };
  api.importVideo.mockResolvedValue(result);
  await act(async () => controls.start(5));
  expect(api.importVideo).toHaveBeenCalledWith("movie.mp4", "output", 5);
  expect(imported).toHaveBeenCalledWith(result);
  expect(controls.busy).toBe(false);
});
it("preserves the active project after failure and permits retry", async () => {
  api.importVideo.mockRejectedValue(new Error("broken"));
  await act(async () => controls.start(5));
  expect(imported).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith("Error: broken");
  expect(controls.busy).toBe(false);
  await act(async () => controls.start(5));
  expect(api.importVideo).toHaveBeenCalledTimes(2);
});
it("does not import after cancelling either chooser or confirmation", async () => {
  api.confirmAction.mockResolvedValueOnce(false);
  await act(async () => controls.start(1));
  api.selectVideoFile.mockResolvedValueOnce(null);
  await act(async () => controls.start(1));
  api.selectExportFolder.mockResolvedValueOnce(null);
  await act(async () => controls.start(1));
  expect(api.importVideo).not.toHaveBeenCalled();
});
it("rejects invalid intervals and prevents overlapping imports", async () => {
  for (const interval of [0, -1, 1.5, NaN, Infinity, 1_000_001]) await controls.start(interval);
  expect(api.confirmAction).not.toHaveBeenCalled();
  let resolve: (value: boolean) => void = () => {};
  api.confirmAction.mockImplementationOnce(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const pending = controls.start(1);
  await controls.start(1);
  expect(api.confirmAction).toHaveBeenCalledTimes(1);
  resolve(false);
  await pending;
  await controls.cancel();
  expect(api.cancelVideoImport).toHaveBeenCalledOnce();
});
