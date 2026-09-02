import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LabelConfig, LabelTemplate } from "./types/annotation";
import { DEFAULT_LABELS } from "./lib/defaults/labels";

const tauriMocks = vi.hoisted(() => ({
  listImageFiles: vi.fn(),
  listTextFiles: vi.fn(),
  loadLabelConfigs: vi.fn(),
  loadLabelTemplates: vi.fn(),
  loadPluginExportFormats: vi.fn(),
  loadPluginLabelPresets: vi.fn(),
  loadPluginPrelabelSources: vi.fn(),
  loadPrelabelModelLibrary: vi.fn(),
  loadShortcuts: vi.fn(),
  migratePluginConfigs: vi.fn(),
  readTextFile: vi.fn(),
  selectImageFolder: vi.fn(),
}));

vi.mock("./lib/tauri-api", () => tauriMocks);
vi.mock("./hooks/useImageLoader", () => ({
  useImageLoader: () => ({
    imageLoadError: "",
    isImageLoading: false,
    loadedImage: null,
    selectedImage: null,
  }),
}));
vi.mock("./hooks/useAppUpdate", () => ({
  useAppUpdate: () => ({
    checkForUpdates: vi.fn(),
    installUpdate: vi.fn(),
    setUpdateMessage: vi.fn(),
    updateMessage: "",
    updateProgress: null,
    updateStatus: "idle",
  }),
}));
vi.mock("./components/AppLayout", () => ({
  AppLayout: ({
    labels,
    openFolder,
    selectedTemplateId,
    templates,
  }: {
    labels: LabelConfig[];
    openFolder: () => void;
    selectedTemplateId: string;
    templates: LabelTemplate[];
  }) => (
    <main>
      <button data-testid="open-folder" onClick={openFolder}>
        打开目录
      </button>
      <select
        aria-label="标签模板"
        data-testid="selected-template"
        value={selectedTemplateId}
        onChange={() => undefined}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
      <output data-testid="labels">{labels.map((label) => label.name).join(",")}</output>
    </main>
  ),
}));

import App from "./App";

const projectLabels: LabelConfig[] = [
  { id: "cat", name: "猫", color: "#123456", shapeType: "rect" },
  { id: "dog", name: "狗", color: "#654321", shapeType: "rect" },
];

const projectConfig = {
  schemaVersion: 1,
  format: "json",
  annotationPath: "C:\\project\\annotations.json",
  exportedAt: "2026-09-02T00:00:00.000Z",
  imageFolder: "C:\\project",
  labels: projectLabels,
  template: { id: "project-config", name: "项目临时配置" },
  exportOptions: { format: "json" },
};

describe("App project labels", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();

    tauriMocks.loadLabelTemplates.mockResolvedValue([]);
    tauriMocks.loadPluginLabelPresets.mockResolvedValue({ presets: [], warning: null });
    tauriMocks.loadPluginExportFormats.mockResolvedValue({ formats: [], warning: null });
    tauriMocks.loadPluginPrelabelSources.mockResolvedValue({ sources: [], warning: null });
    tauriMocks.loadPrelabelModelLibrary.mockResolvedValue({ models: [], selectedModelId: null });
    tauriMocks.loadShortcuts.mockResolvedValue({});
    tauriMocks.selectImageFolder.mockResolvedValue("C:\\project");
    tauriMocks.listImageFiles.mockResolvedValue([
      { path: "C:\\project\\cat.jpg", name: "cat.jpg" },
    ]);
    tauriMocks.listTextFiles.mockResolvedValue([
      {
        path: "C:\\project\\my-label-tool.project.json",
        name: "my-label-tool.project.json",
      },
    ]);
    tauriMocks.readTextFile.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("my-label-tool.project.json")
          ? JSON.stringify(projectConfig)
          : JSON.stringify({
              labels: projectLabels,
              images: [{ name: "cat.jpg", annotations: [] }],
            }),
      ),
    );
    tauriMocks.migratePluginConfigs.mockResolvedValue({ configs: [], issues: [] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderAndOpenFolder() {
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='open-folder']")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("keeps the project template after plugin extension refresh", async () => {
    tauriMocks.loadLabelConfigs.mockResolvedValue(DEFAULT_LABELS);

    await renderAndOpenFolder();

    expect(container.querySelector("[data-testid='selected-template']")).toHaveProperty(
      "value",
      "project-config",
    );
    expect(container.querySelector("[data-testid='labels']")?.textContent).toBe("猫,狗");
  });

  it("keeps project labels when startup initialization finishes after opening the folder", async () => {
    let resolveGlobalLabels: ((labels: LabelConfig[]) => void) | undefined;
    tauriMocks.loadLabelConfigs.mockImplementation(
      () =>
        new Promise<LabelConfig[]>((resolve) => {
          resolveGlobalLabels = resolve;
        }),
    );

    await renderAndOpenFolder();

    await act(async () => {
      resolveGlobalLabels?.(DEFAULT_LABELS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='labels']")?.textContent).toBe("猫,狗");
  });
});
