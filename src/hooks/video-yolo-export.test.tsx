import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectActions } from "./useProjectActions";
import { projectVideos, mergeProjectImages } from "../lib/project-media";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { exportTextFiles, exportAnnotationsJson, selectExportFolder } from "../lib/tauri-api";
import type { AnnotationShape } from "../types/annotation";
import { ExportPanel } from "../components/settings/ExportPanel";
import { loadImageSize } from "../lib/app-utils";
import { DEFAULT_PROJECT_SETTINGS } from "../lib/defaults/video";
import { projectConfigTemplate, type ProjectConfig } from "../lib/importers";
vi.mock("../lib/tauri-api", async (original) => ({
  ...(await original<typeof import("../lib/tauri-api")>()),
  exportTextFiles: vi.fn(),
  exportAnnotationsJson: vi.fn(),
  selectExportFolder: vi.fn(),
}));
vi.mock("../lib/app-utils", async (original) => ({
  ...(await original<typeof import("../lib/app-utils")>()),
  loadImageSize: vi.fn().mockResolvedValue({ width: 200, height: 100 }),
}));
let root: Root;
let container: HTMLDivElement;
const error = vi.fn();
const config = vi.fn();
const videos = projectVideos(
  "C:/project",
  ["one", "two"].map((id, index) => ({
    sourcePath: `C:/${id}.mp4`,
    folderPath: `C:/project/${id}`,
    video: {
      schemaVersion: 1,
      sourcePath: `C:/${id}.mp4`,
      width: 100 * (index + 1),
      height: 100,
      frameInterval: 30,
      totalFrames: 31,
      frames: [0, 30].map((frameIndex, frame) => ({
        name: `frame-00000${frame}.png`,
        frameIndex,
        timestampSeconds: frameIndex / 24,
      })),
    },
  })),
);
const images = mergeProjectImages([{ path: "C:/project/photo.png", name: "photo.png" }], videos);
let actions: ReturnType<typeof useProjectActions>;
const existingConfig: ProjectConfig = {
  schemaVersion: 1,
  format: "json",
  annotationPath: "C:/project/annotations.json",
  imageFolder: "C:/project",
  exportedAt: "",
  labels: [],
  template: projectConfigTemplate(),
  exportOptions: { format: "json" },
  settings: DEFAULT_PROJECT_SETTINGS,
};
function Harness({ existing = false }: { existing?: boolean }) {
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  actions = useProjectActions({
    videos,
    images,
    folderPath: "C:/project",
    labels: [{ id: "person", name: "人", color: "#ffffff", shapeType: "rect" }],
    annotationsByImage: annotations,
    activeProjectConfig: existing ? existingConfig : null,
    activeProjectConfigPath: existing ? "C:/project/my-label-tool.project.json" : "",
    selectedExportFormatId: "json",
    customMappingText: "{}",
    pluginExportFormats: [],
    refreshPluginExtensions: async () => {},
    applyProjectTemplate: vi.fn(),
    clearProjectTemplate: vi.fn(),
    replaceAnnotations: vi.fn(),
    setActiveProjectConfig: config,
    setActiveProjectConfigPath: vi.fn(),
    setError: error,
    setProjectTemplateId: vi.fn(),
    setSelectedExportFormatId: vi.fn(),
  });
  return (
    <ExportPanel
      hasVideos
      videoFrameCount={4}
      pendingVideoCount={1}
      onExportYolo={() => void actions.exportYoloAnnotations()}
      customMappingText="{}"
      disabled={false}
      isSaving={false}
      selectedFormatId="json"
      pluginFormats={[]}
      pluginExportProgress={null}
      canSaveProject
      onChangeCustomMappingText={vi.fn()}
      onCancelPluginExport={vi.fn()}
      onChangeFormat={vi.fn()}
      onExport={vi.fn()}
      onSaveProject={vi.fn()}
    />
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.mocked(selectExportFolder).mockResolvedValue("C:/output");
  vi.mocked(exportTextFiles).mockResolvedValue(undefined);
  const shape: AnnotationShape = {
    id: "target",
    type: "rect",
    labelId: "person",
    points: [10, 20, 20, 40],
  };
  useAnnotationStore
    .getState()
    .replaceAnnotations(
      Object.fromEntries(
        ["C:/project/photo.png", videos[0].images[1].path, videos[1].images[0].path].map((path) => [
          path,
          [shape],
        ]),
      ),
    );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("exports separate per-video frame txt files and empty frames from the explicit UI entry", async () => {
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toContain("1 个未抽帧视频不导出");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "导出 YOLO txt")!
      .click(),
  );
  expect(exportTextFiles).toHaveBeenCalledExactlyOnceWith("C:/output", [
    { path: "classes.txt", content: "人\n" },
    { path: "photo.txt", content: "0 0.1 0.4 0.1 0.4\n" },
    { path: "one/frame-000000.txt", content: "" },
    { path: "one/frame-000001.txt", content: "0 0.2 0.4 0.2 0.4\n" },
    { path: "two/frame-000000.txt", content: "0 0.1 0.4 0.1 0.4\n" },
    { path: "two/frame-000001.txt", content: "" },
  ]);
  expect(loadImageSize).toHaveBeenCalledExactlyOnceWith("C:/project/photo.png");
  expect(config).not.toHaveBeenCalled();
  expect(exportAnnotationsJson).not.toHaveBeenCalled();
});
it("writes nothing when the directory chooser is cancelled", async () => {
  vi.mocked(selectExportFolder).mockResolvedValue(null);
  await act(async () => root.render(<Harness />));
  await act(async () => actions.exportYoloAnnotations());
  expect(exportTextFiles).not.toHaveBeenCalled();
});
it("rejects unsupported shapes before choosing a directory or dropping annotations", async () => {
  useAnnotationStore.getState().replaceAnnotations({
    [videos[0].images[0].path]: [
      { id: "point", type: "point", labelId: "person", points: [10, 10] },
    ],
  });
  await act(async () => root.render(<Harness />));
  await act(async () => actions.exportYoloAnnotations());
  expect(error).toHaveBeenCalledWith(expect.stringContaining("YOLO 只支持矩形"));
  expect(selectExportFolder).not.toHaveBeenCalled();
  expect(exportTextFiles).not.toHaveBeenCalled();
});

it("preserves project sampling settings during subsequent annotation saves", async () => {
  vi.mocked(exportAnnotationsJson).mockResolvedValue(undefined);
  await act(async () => root.render(<Harness existing />));
  await act(async () => {
    expect(await actions.saveProjectExport()).toBe(true);
  });
  expect(exportAnnotationsJson).toHaveBeenLastCalledWith(
    "C:/project/my-label-tool.project.json",
    expect.objectContaining({ settings: DEFAULT_PROJECT_SETTINGS }),
  );
});
it("does not activate an updated project configuration if writing its file fails", async () => {
  vi.mocked(exportAnnotationsJson)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk full"));
  await act(async () => root.render(<Harness existing />));
  await act(async () => {
    expect(await actions.saveProjectExport()).toBe(false);
  });
  expect(config).not.toHaveBeenCalled();
  expect(error).toHaveBeenLastCalledWith("disk full");
});
