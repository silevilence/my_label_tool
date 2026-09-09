import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LabelConfig, LabelTemplate } from "./types/annotation";
import { DEFAULT_LABELS } from "./lib/defaults/labels";

const tauriMocks = vi.hoisted(() => ({
  confirmAction: vi.fn(),
  exportAnnotationsJson: vi.fn(),
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
vi.mock("./lib/app-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/app-utils")>()),
  loadImageSize: vi.fn(() => Promise.resolve({ width: 100, height: 100 })),
}));
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

    tauriMocks.confirmAction.mockResolvedValue(true);
    tauriMocks.exportAnnotationsJson.mockResolvedValue(undefined);
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
      await flushMicrotasks();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='open-folder']")?.click();
      await flushMicrotasks();
    });
  }

  async function flushMicrotasks() {
    for (let index = 0; index < 24; index += 1) {
      await Promise.resolve();
    }
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

  it("prefers the project config file and never asks to import YOLO annotations", async () => {
    tauriMocks.loadLabelConfigs.mockResolvedValue(DEFAULT_LABELS);
    tauriMocks.listTextFiles.mockImplementation((_folder: string, extension: string) =>
      Promise.resolve(
        extension === "json"
          ? [
              {
                path: "C:\\project\\my-label-tool.project.json",
                name: "my-label-tool.project.json",
              },
            ]
          : [
              { path: "C:\\project\\classes.txt", name: "classes.txt" },
              { path: "C:\\project\\cat.txt", name: "cat.txt" },
            ],
      ),
    );

    await renderAndOpenFolder();

    expect(tauriMocks.confirmAction).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='labels']")?.textContent).toBe("猫,狗");
  });
});

describe("App YOLO folder auto load", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();

    tauriMocks.confirmAction.mockResolvedValue(true);
    tauriMocks.exportAnnotationsJson.mockResolvedValue(undefined);
    tauriMocks.loadLabelConfigs.mockResolvedValue(DEFAULT_LABELS);
    tauriMocks.loadLabelTemplates.mockResolvedValue([]);
    tauriMocks.loadPluginLabelPresets.mockResolvedValue({ presets: [], warning: null });
    tauriMocks.loadPluginExportFormats.mockResolvedValue({ formats: [], warning: null });
    tauriMocks.loadPluginPrelabelSources.mockResolvedValue({ sources: [], warning: null });
    tauriMocks.loadPrelabelModelLibrary.mockResolvedValue({ models: [], selectedModelId: null });
    tauriMocks.loadShortcuts.mockResolvedValue({});
    tauriMocks.migratePluginConfigs.mockResolvedValue({ configs: [], issues: [] });
    tauriMocks.selectImageFolder.mockResolvedValue("C:\\project");
    tauriMocks.listImageFiles.mockResolvedValue([
      { path: "C:\\project\\cat.jpg", name: "cat.jpg" },
    ]);
    tauriMocks.listTextFiles.mockImplementation((_folder: string, extension: string) =>
      Promise.resolve(
        extension === "json"
          ? []
          : [
              { path: "C:\\project\\classes.txt", name: "classes.txt" },
              { path: "C:\\project\\cat.txt", name: "cat.txt" },
            ],
      ),
    );
    tauriMocks.readTextFile.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("classes.txt")
          ? "cat\ndog"
          : path.endsWith("cat.txt")
            ? "0 0.5 0.5 0.2 0.2"
            : "",
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderAndOpenFolder() {
    await act(async () => {
      root.render(<App />);
      await flushMicrotasks();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='open-folder']")?.click();
      await flushMicrotasks();
    });
  }

  async function flushMicrotasks() {
    for (let index = 0; index < 24; index += 1) {
      await Promise.resolve();
    }
  }

  function templateValue(): string {
    const select = container.querySelector<HTMLSelectElement>("[data-testid='selected-template']");
    return select?.value ?? "";
  }

  it("loads YOLO annotations after confirmation and keeps matching shortcuts", async () => {
    tauriMocks.loadLabelConfigs.mockResolvedValue([
      { id: "cat", name: "cat", color: "#111111", shortcut: "1", shapeType: "any" },
      { id: "dog", name: "dog", color: "#222222", shortcut: "2", shapeType: "any" },
    ]);

    await renderAndOpenFolder();

    expect(tauriMocks.confirmAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='labels']")?.textContent).toBe("cat,dog");
    expect(templateValue()).toBe("project-config");

    const savedCall = tauriMocks.exportAnnotationsJson.mock.calls[tauriMocks.exportAnnotationsJson.mock.calls.length - 1];
    const savedConfig = savedCall?.[1] as {
      labels: LabelConfig[];
    };
    expect(savedConfig.labels).toEqual([
      { id: "cat", name: "cat", color: "#111111", shortcut: "1", shapeType: "any" },
      { id: "dog", name: "dog", color: "#222222", shortcut: "2", shapeType: "any" },
    ]);
  });

  it("keeps the default labels when the confirmation is declined", async () => {
    tauriMocks.confirmAction.mockResolvedValue(false);

    await renderAndOpenFolder();

    expect(tauriMocks.confirmAction).toHaveBeenCalledTimes(1);
    expect(tauriMocks.exportAnnotationsJson).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='labels']")?.textContent).toBe("人,车,其他");
    expect(templateValue()).toBe("common-detection");
  });

  it("does not ask when no txt file matches the images or classes.txt", async () => {
    tauriMocks.listTextFiles.mockImplementation((_folder: string, extension: string) =>
      Promise.resolve(
        extension === "json" ? [] : [{ path: "C:\\project\\readme.txt", name: "readme.txt" }],
      ),
    );

    await renderAndOpenFolder();

    expect(tauriMocks.confirmAction).not.toHaveBeenCalled();
    expect(tauriMocks.exportAnnotationsJson).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='labels']")?.textContent).toBe("人,车,其他");
  });

  it("falls back to the default labels and reports the error when loading fails", async () => {
    tauriMocks.readTextFile.mockRejectedValue(new Error("标注文件读取失败"));

    await renderAndOpenFolder();

    expect(tauriMocks.confirmAction).toHaveBeenCalledTimes(1);
    expect(tauriMocks.exportAnnotationsJson).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='labels']")?.textContent).toBe("人,车,其他");
    expect(templateValue()).toBe("common-detection");
  });
});
