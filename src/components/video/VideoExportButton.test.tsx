import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VideoExportButton } from "./VideoExportButton";
import type { VideoProject } from "../../types/video";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
const api = vi.hoisted(() => ({ exportAnnotationsJson: vi.fn(), selectExportPath: vi.fn() }));
vi.mock("../../lib/tauri-api", () => api);
const video: VideoProject = {
  schemaVersion: 1,
  sourcePath: "v.mp4",
  width: 64,
  height: 48,
  frameInterval: 1,
  totalFrames: 1,
  frames: [{ name: "frame-000000.png", frameIndex: 0, timestampSeconds: 0 }],
};
let root: Root;
let container: HTMLDivElement;
const message = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  api.selectExportPath.mockResolvedValue("out.json");
  api.exportAnnotationsJson.mockResolvedValue(undefined);
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () =>
    root.render(
      <VideoExportButton
        video={video}
        images={[{ name: "frame-000000.png", path: "frames/frame-000000.png" }]}
        labels={[]}
        annotations={{}}
        disabled={false}
        onMessage={message}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("exports the versioned video payload through the existing host writer", async () => {
  await act(async () => container.querySelector("button")!.click());
  expect(api.selectExportPath).toHaveBeenCalledWith("annotations.video.json");
  expect(api.exportAnnotationsJson).toHaveBeenCalledWith(
    "out.json",
    expect.objectContaining({ kind: "my-label-tool.video", schemaVersion: 1, video }),
  );
  expect(message).toHaveBeenCalledWith(text.exported);
});
it("cancelling the chooser writes nothing, and write errors reenable retry", async () => {
  api.selectExportPath.mockResolvedValueOnce(null);
  await act(async () => container.querySelector("button")!.click());
  expect(api.exportAnnotationsJson).not.toHaveBeenCalled();
  api.exportAnnotationsJson.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => container.querySelector("button")!.click());
  expect(message).toHaveBeenCalledWith("Error: disk full");
  expect(container.querySelector("button")!.disabled).toBe(false);
});
