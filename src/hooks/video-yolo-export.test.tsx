import type { PluginExportFormatDescriptor } from "../types/plugin";
import { OPERATION_ZH_CN as operationText } from "../i18n/operations.zh-CN";
import { PROJECT_ZH_CN as projectText } from "../i18n/project.zh-CN";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectActions } from "./useProjectActions";
import { projectVideos, mergeProjectImages, projectFrameIndices } from "../lib/project-media";
import { useAnnotationStore } from "../store/useAnnotationStore";
import {
  runPluginExport,
  cancelPluginExport,
  exportTextFiles,
  exportAnnotationsJson,
  selectExportFolder,
  listTextFiles,
  readTextFile,
} from "../lib/tauri-api";
import type { AnnotationShape } from "../types/annotation";
import type { ExportFormatId } from "../types/export";
import { ExportPanel } from "../components/settings/ExportPanel";
import { OperationStatus } from "../components/operations/OperationStatus";
import { useOperations } from "../store/useOperations";
import { loadImageSize } from "../lib/app-utils";
import { DEFAULT_PROJECT_SETTINGS } from "../lib/defaults/video";
import { projectConfigTemplate, type ProjectConfig } from "../lib/importers";
vi.mock("../lib/tauri-api", async (original) => ({
  ...(await original<typeof import("../lib/tauri-api")>()),
  runPluginExport: vi.fn(),
  cancelPluginExport: vi.fn(),
  exportTextFiles: vi.fn(),
  exportAnnotationsJson: vi.fn(),
  selectExportFolder: vi.fn(),
  selectExportPath: vi.fn().mockResolvedValue("C:/output/annotations.coco.json"),
  listTextFiles: vi.fn(),
  readTextFile: vi.fn(),
  migratePluginConfigs: vi.fn().mockResolvedValue({ configs: [], issues: [] }),
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
const pluginFormat: PluginExportFormatDescriptor = {
  selectionId: "plugin:dev.test.export:dev.test.format",
  pluginId: "dev.test.export",
  pluginName: "Test exporter",
  format: {
    id: "dev.test.format",
    displayName: "Test format",
    extensions: ["json"],
    multiFile: true,
  },
  enabled: true,
  disabledReason: null,
  supportsProgress: true,
  supportsCancel: true,
};
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
function Harness({
  existing = false,
  format = "json",
  pendingOnly = false,
}: {
  existing?: boolean;
  format?: ExportFormatId;
  pendingOnly?: boolean;
}) {
  const [active, setActive] = useState<ProjectConfig | null>(existing ? existingConfig : null);
  const [activePath, setActivePath] = useState(
    existing ? "C:/project/my-label-tool.project.json" : "",
  );
  const [selected, setSelected] = useState(format);
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  actions = useProjectActions({
    videos: pendingOnly
      ? projectVideos("C:/project", [{ sourcePath: "C:/one.mp4", folderPath: null, video: null }])
      : videos,
    images: pendingOnly ? [] : images,
    folderPath: "C:/project",
    labels: [{ id: "person", name: "人", color: "#ffffff", shapeType: "rect" }],
    annotationsByImage: annotations,
    activeProjectConfig: active,
    activeProjectConfigPath: activePath,
    selectedExportFormatId: selected,
    customMappingText: "{}",
    pluginExportFormats: [pluginFormat],
    refreshPluginExtensions: async () => {},
    applyProjectTemplate: vi.fn(),
    clearProjectTemplate: vi.fn(),
    replaceAnnotations: useAnnotationStore.getState().replaceAnnotations,
    setActiveProjectConfig: (next) => {
      config(next);
      setActive(next);
    },
    setActiveProjectConfigPath: setActivePath,
    setError: error,
    showMessage: vi.fn(),
    setProjectTemplateId: vi.fn(),
    setSelectedExportFormatId: setSelected,
  });
  return (
    <>
      <ExportPanel
        hasVideos
        videoFrameCount={pendingOnly ? 0 : 4}
        pendingVideoCount={1}
        customMappingText="{}"
        disabled={false}
        isSaving={false}
        selectedFormatId={selected}
        pluginFormats={[pluginFormat]}
        exportError={actions.exportError}
        pluginExportProgress={null}
        canSaveProject
        onChangeCustomMappingText={vi.fn()}
        onCancelPluginExport={vi.fn()}
        onChangeFormat={setSelected}
        onExport={() => void actions.exportSelectedFormat()}
        onSaveProject={() => void actions.saveProjectExport()}
      />
      <OperationStatus />
    </>
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  useOperations.setState({ operations: [] });
  vi.mocked(exportAnnotationsJson).mockResolvedValue(undefined);
  vi.mocked(loadImageSize).mockImplementation(async (path) => ({
    width: path.includes("/one/") ? 100 : 200,
    height: 100,
  }));
  useAnnotationStore.getState().setFrameIndices(projectFrameIndices(videos));
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
      [{ id: "person", name: "person", color: "#fff", shapeType: "any" }],
    );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
it("saves the selected YOLO format instead of the existing project's JSON format", async () => {
  vi.mocked(exportAnnotationsJson).mockResolvedValue(undefined);
  await act(async () => root.render(<Harness existing format="yolo" />));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")!
      .click(),
  );
  expect(exportTextFiles).toHaveBeenCalledOnce();
  expect(exportAnnotationsJson).not.toHaveBeenCalledWith(
    "C:/project/annotations.json",
    expect.anything(),
  );
  expect(config).toHaveBeenLastCalledWith(
    expect.objectContaining({ format: "yolo", annotationPath: "C:/output" }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("exports separate per-video frame txt files and empty frames from the shared format selector and Save button", async () => {
  await act(async () => root.render(<Harness format="yolo" />));
  expect(container.textContent).toContain("1 个未抽帧视频不导出");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")!
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
  expect(config).toHaveBeenCalledWith(
    expect.objectContaining({ format: "yolo", annotationPath: "C:/output" }),
  );
  expect(exportAnnotationsJson).toHaveBeenCalledExactlyOnceWith(
    "C:/project/my-label-tool.project.json",
    expect.objectContaining({ format: "yolo" }),
  );
  expect(container.textContent).not.toContain("导出 YOLO txt");
});
it("writes nothing when the directory chooser is cancelled", async () => {
  vi.mocked(selectExportFolder).mockResolvedValue(null);
  await act(async () => root.render(<Harness format="yolo" />));
  await act(async () => actions.saveProjectExport());
  expect(exportTextFiles).not.toHaveBeenCalled();
  expect(exportAnnotationsJson).not.toHaveBeenCalled();
  expect(config).not.toHaveBeenCalled();
});
it("rejects unsupported shapes before choosing a directory or dropping annotations", async () => {
  useAnnotationStore.getState().replaceAnnotations(
    {
      [videos[0].images[0].path]: [
        { id: "point", type: "point", labelId: "person", points: [10, 10] },
      ],
    },
    [{ id: "person", name: "person", color: "#fff", shapeType: "any" }],
  );
  await act(async () => root.render(<Harness format="yolo" />));
  await act(async () => actions.saveProjectExport());
  // 失败卡片只在导出面板就地呈现，不重复打进全局错误条。
  expect(container.textContent).toContain("YOLO 只支持矩形");
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(
    container.querySelector("[data-operation-error-feedback]")?.parentElement?.textContent,
  ).toContain("YOLO 只支持矩形");
  expect(error).not.toHaveBeenCalledWith(expect.stringContaining("YOLO 只支持矩形"));
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
  expect(container.textContent).toContain("disk full");
});

it("uses the dropdown for Save, reuses its destination, and Save As chooses a new directory", async () => {
  await act(async () => root.render(<Harness existing />));
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = "yolo";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => actions.saveProjectExport());
  await act(async () => actions.saveProjectExport());
  expect(selectExportFolder).toHaveBeenCalledTimes(1);
  expect(exportTextFiles).toHaveBeenCalledTimes(2);
  vi.mocked(selectExportFolder).mockResolvedValue("C:/new-output");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "另存为")!
      .click(),
  );
  expect(selectExportFolder).toHaveBeenCalledTimes(2);
  expect(exportTextFiles).toHaveBeenLastCalledWith("C:/new-output", expect.any(Array));
  expect(config).toHaveBeenLastCalledWith(
    expect.objectContaining({
      format: "yolo",
      annotationPath: "C:/new-output",
      settings: DEFAULT_PROJECT_SETTINGS,
    }),
  );
});
it.each(["yolo", "voc", "coco"] as const)(
  "reopens %s video annotations without mixing same-named frames or losing label IDs",
  async (format) => {
    const files = new Map<string, string>();
    const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "");
    vi.mocked(exportAnnotationsJson).mockImplementation(async (path, value) => {
      files.set(normalize(path), JSON.stringify(value));
    });
    vi.mocked(exportTextFiles).mockImplementation(async (folder, entries) => {
      for (const file of entries) files.set(`${normalize(folder)}/${file.path}`, file.content);
    });
    vi.mocked(listTextFiles).mockImplementation(async (folder, extension) =>
      [...files.keys()]
        .filter(
          (path) =>
            path.slice(0, path.lastIndexOf("/")) === normalize(folder) &&
            path.endsWith(`.${extension}`),
        )
        .map((path) => ({ path, name: path.slice(path.lastIndexOf("/") + 1) })),
    );
    vi.mocked(readTextFile).mockImplementation(async (path) => {
      const result = files.get(normalize(path));
      if (result === undefined) throw new Error(`missing ${path}`);
      return result;
    });
    await act(async () => root.render(<Harness format={format} />));
    await act(async () => actions.saveProjectExport());
    await act(async () => useAnnotationStore.getState().replaceAnnotations({}, []));
    await act(async () => actions.maybeLoadProjectConfig("C:/project", images));
    const annotations = useAnnotationStore.getState().annotationsByImage;
    expect(annotations[videos[0].images[0].path]).toEqual([]);
    expect(annotations[videos[1].images[1].path]).toEqual([]);
    expect(annotations[videos[0].images[1].path][0]).toMatchObject({
      labelId: "person",
      points: [10, 20, 20, 40],
      frameIndex: 30,
    });
    expect(annotations[videos[1].images[0].path][0]).toMatchObject({
      labelId: "person",
      points: [10, 20, 20, 40],
      frameIndex: 0,
    });
  },
);

it("saves only classes for an unprepared-video project and reports zero exported frames", async () => {
  await act(async () => root.render(<Harness format="yolo" pendingOnly />));
  expect(container.textContent).toContain("0 张已抽取视频帧");
  await act(async () => actions.saveProjectExport());
  expect(exportTextFiles).toHaveBeenCalledExactlyOnceWith("C:/output", [
    { path: "classes.txt", content: "人\n" },
  ]);
  expect(exportAnnotationsJson).toHaveBeenCalledExactlyOnceWith(
    "C:/project/my-label-tool.project.json",
    expect.objectContaining({ format: "yolo" }),
  );
});

it("retries a failed save at its existing path without opening an export chooser", async () => {
  await act(async () => root.render(<Harness existing />));
  vi.mocked(exportAnnotationsJson).mockRejectedValueOnce("disk full");
  await act(async () => actions.saveProjectExport());
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === projectText.retrySave,
  );
  expect(retry).toBeDefined();
  vi.mocked(exportAnnotationsJson).mockClear();
  await act(async () => retry!.click());
  expect(exportAnnotationsJson).toHaveBeenCalledWith(
    existingConfig.annotationPath,
    expect.anything(),
  );
  expect(selectExportFolder).not.toHaveBeenCalled();
  expect(useOperations.getState().operations.filter((op) => op.status === "failed")).toHaveLength(
    0,
  );
});
it("settles an explicitly cancelled plugin export without a failure or retry", async () => {
  let reject!: (reason: string) => void;
  vi.mocked(runPluginExport).mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  vi.mocked(cancelPluginExport).mockImplementation(async (exportId) => ({ found: true, exportId }));
  await act(async () => root.render(<Harness format={pluginFormat.selectionId} />));
  let run!: Promise<boolean>;
  await act(async () => {
    run = actions.exportSelectedFormat();
  });
  await act(async () => actions.cancelActivePluginExport());
  expect(cancelPluginExport).toHaveBeenCalledOnce();
  await act(async () => {
    reject("[CANCELLED] 插件调用已取消");
    await run;
  });
  expect(actions.exportError).toBeNull();
  expect(useOperations.getState().operations).toMatchObject([
    { status: "completed", kind: "warning", message: operationText.cancelled },
  ]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("does not treat an unrelated export error mentioning cancellation as a cancelled operation", async () => {
  vi.mocked(runPluginExport).mockRejectedValue("[INTERNAL_ERROR] CANCELLED handler failed");
  await act(async () => root.render(<Harness format={pluginFormat.selectionId} />));
  await act(async () => actions.exportSelectedFormat());
  expect(actions.exportError).toBe("[INTERNAL_ERROR] CANCELLED handler failed");
  expect(useOperations.getState().operations).toMatchObject([{ status: "failed" }]);
});
