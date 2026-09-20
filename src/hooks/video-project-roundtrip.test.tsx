import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useProjectActions } from "./useProjectActions";
import { useAnnotationStore } from "../store/useAnnotationStore";
import type { ProjectConfig } from "../lib/importers";
import type { VideoProject } from "../types/video";
import type { ExportFormatId } from "../types/export";
import { loadImageSize } from "../lib/app-utils";
import { mergeProjectImages, projectVideos, projectFrameIndices } from "../lib/project-media";
const api = vi.hoisted(() => ({
  exportAnnotationsJson: vi.fn(),
  selectExportJsonPath: vi.fn(),
  listTextFiles: vi.fn(),
  readTextFile: vi.fn(),
  migratePluginConfigs: vi.fn(),
}));
vi.mock("../lib/tauri-api", async (original) => ({
  ...(await original<typeof import("../lib/tauri-api")>()),
  ...api,
}));
vi.mock("../lib/app-utils", async (original) => ({
  ...(await original<typeof import("../lib/app-utils")>()),
  loadImageSize: vi.fn((path: string) => {
    if (path.endsWith("photo.png")) return Promise.resolve({ width: 320, height: 240 });
    throw new Error("video save must not decode frames");
  }),
}));
it.each([false, true])(
  "saves and reopens video annotations without decoding frames (mixed: %s)",
  async (mixed) => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const files = new Map<string, string>();
    const normalize = (path: string) => path.replace(/\\/g, "/");
    api.exportAnnotationsJson.mockImplementation(async (path: string, data: unknown) =>
      files.set(normalize(path), JSON.stringify(data)),
    );
    api.selectExportJsonPath.mockResolvedValue("C:/frames/annotations.json");
    api.listTextFiles.mockImplementation(async () =>
      [...files.keys()].map((path) => ({ path, name: path.split("/").slice(-1)[0] })),
    );
    api.readTextFile.mockImplementation(async (path: string) => files.get(normalize(path)));
    api.migratePluginConfigs.mockResolvedValue({ configs: [], issues: [] });
    const video: VideoProject = {
      schemaVersion: 1,
      sourcePath: "C:/movie.mp4",
      width: 64,
      height: 48,
      frameInterval: 30,
      totalFrames: 31,
      frames: [
        { name: "frame-000000.png", frameIndex: 0, timestampSeconds: 0 },
        { name: "frame-000001.png", frameIndex: 30, timestampSeconds: 1.1 },
      ],
    };
    const videos = mixed
      ? projectVideos("C:/frames", [
          { sourcePath: video.sourcePath, folderPath: "C:/frames/one", video },
          {
            sourcePath: "C:/two.mp4",
            folderPath: "C:/frames/two",
            video: { ...video, sourcePath: "C:/two.mp4", width: 128 },
          },
        ])
      : [];
    const images = mixed
      ? mergeProjectImages([{ path: "C:/frames/photo.png", name: "photo.png" }], videos)
      : video.frames.map((frame) => ({
          name: frame.name,
          path: `C:/frames/${frame.name}`,
        }));
    const store = useAnnotationStore.getState();
    store.setFrameIndices(
      mixed ? projectFrameIndices(videos) : { [images[0].path]: 0, [images[1].path]: 30 },
    );
    store.replaceAnnotations({});
    const target = mixed ? videos[0].images[1] : images[1];
    store.addAnnotation(target.path, {
      id: "target",
      type: "rect",
      labelId: "car",
      points: [1, 2, 3, 4],
      attributes: { videoTrackId: "track", videoKeyframe: true },
    });
    let actions: ReturnType<typeof useProjectActions>;
    const error = vi.fn();
    function Harness() {
      const [config, setConfig] = useState<ProjectConfig | null>(null);
      const [configPath, setConfigPath] = useState("");
      const [format, setFormat] = useState<ExportFormatId>("json");
      const annotations = useAnnotationStore((state) => state.annotationsByImage);
      actions = useProjectActions({
        video: mixed ? null : video,
        videos,
        activeProjectConfig: config,
        activeProjectConfigPath: configPath,
        annotationsByImage: annotations,
        customMappingText: "{}",
        folderPath: "C:/frames",
        images,
        labels: [{ id: "car", name: "汽车", color: "#123456", shapeType: "rect" }],
        selectedExportFormatId: format,
        pluginExportFormats: [],
        refreshPluginExtensions: async () => {},
        applyProjectTemplate: () => {},
        clearProjectTemplate: () => {},
        replaceAnnotations: store.replaceAnnotations,
        setActiveProjectConfig: setConfig,
        setActiveProjectConfigPath: setConfigPath,
        setError: error,
        showMessage: vi.fn(),
        setProjectTemplateId: () => {},
        setSelectedExportFormatId: setFormat,
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness />));
    await act(async () => (mixed ? actions.saveProjectExport() : actions.exportSelectedFormat()));
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("must not decode"));
    expect(files.has("C:/frames/my-label-tool.project.json")).toBe(true);
    await act(async () => store.updateAnnotation(target.path, "target", { points: [2, 3, 4, 5] }));
    await act(async () => {
      expect(await actions.saveProjectExport()).toBe(true);
    });
    await act(async () => store.replaceAnnotations({}));
    await act(async () => actions.maybeLoadProjectConfig("C:/frames", images));
    expect(useAnnotationStore.getState().annotationsByImage[target.path][0]).toMatchObject({
      points: [2, 3, 4, 5],
      frameIndex: 30,
      attributes: { videoTrackId: "track", videoKeyframe: true },
    });
    if (mixed) {
      expect(
        vi.mocked(loadImageSize).mock.calls.every(([path]) => path.endsWith("photo.png")),
      ).toBe(true);
      const exported = JSON.parse(files.get("C:/frames/annotations.json")!);
      expect(exported.projectMedia.videos).toHaveLength(2);
      expect(
        exported.images.find((image: { name: string }) => image.name === "two/frame-000000.png")
          .width,
      ).toBe(128);
    } else expect(loadImageSize).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  },
);
