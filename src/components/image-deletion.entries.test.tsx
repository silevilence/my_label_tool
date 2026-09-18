import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { CanvasContextMenu } from "./canvas/CanvasChrome";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { IMAGE_DELETION_ZH_CN as text } from "../i18n/image-deletion.zh-CN";
import { EMPTY_PRELABEL_MODEL_LIBRARY } from "../types/prelabel";
import * as api from "../lib/tauri-api";

vi.mock("react-konva", () =>
  Object.fromEntries(
    [
      "Circle",
      "Image",
      "Layer",
      "Label",
      "Line",
      "Rect",
      "Stage",
      "Tag",
      "Text",
      "Transformer",
    ].map((name) => [name, () => null]),
  ),
);
vi.mock("../lib/updater", () => ({ checkAppUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/tauri-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/tauri-api")>()),
  loadLabelConfigs: vi.fn().mockResolvedValue([]),
  loadLabelTemplates: vi.fn().mockResolvedValue([]),
  loadShortcuts: vi.fn().mockResolvedValue({}),
  saveShortcuts: vi.fn().mockResolvedValue(undefined),
  loadPluginLabelPresets: vi.fn().mockResolvedValue({ presets: [], warning: null }),
  loadPluginExportFormats: vi.fn().mockResolvedValue({ formats: [], warning: null }),
  loadPluginPrelabelSources: vi.fn().mockResolvedValue({ sources: [], warning: null }),
  loadPrelabelModelLibrary: vi.fn(),
  listImageFiles: vi.fn(),
  loadVideoProject: vi.fn().mockResolvedValue(null),
  listTextFiles: vi.fn().mockResolvedValue([]),
  selectImageFolder: vi.fn().mockResolvedValue("C:/fixture"),
  recycleImageFile: vi.fn().mockResolvedValue(undefined),
  imageFileSrc: (path: string) => path,
}));

describe("image deletion entry wiring", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.loadPrelabelModelLibrary).mockResolvedValue(EMPTY_PRELABEL_MODEL_LIBRARY);
    vi.mocked(api.listImageFiles).mockResolvedValue(
      ["a", "b"].map((name) => ({ name: `${name}.png`, path: `C:/fixture/${name}.png` })),
    );
    useAnnotationStore.getState().replaceAnnotations({});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function button(label: string) {
    const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === label,
    );
    if (!found) throw new Error(`missing button ${label}`);
    return found;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function key(value: string) {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
      );
    });
  }
  async function openFixture() {
    await act(async () => root.render(<App />));
    await click("打开图片文件夹");
  }
  it("list context menu targets the clicked file without changing the selected image; F8 targets current", async () => {
    await openFixture();
    expect(button("a.png").className).toContain("bg-sky-500");
    await act(async () => {
      button("b.png").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 200,
        }),
      );
    });
    await click(text.deleteImage);
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("b.png");
    expect(button("a.png").className).toContain("bg-sky-500");
    await key("Escape");
    await key("F8");
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("a.png");
    await act(async () => vi.advanceTimersByTime(3000));
    await act(async () => {
      button(text.confirm).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(api.recycleImageFile).toHaveBeenCalledExactlyOnceWith("C:/fixture", "C:/fixture/a.png");
    expect(button("b.png").className).toContain("bg-sky-500");
  });

  it("canvas menu offers a distinct deletion action and disables it without a deletable image", async () => {
    const onDeleteImage = vi.fn();
    const props = {
      annotation: null,
      labels: [],
      x: 0,
      y: 0,
      canNextImage: false,
      canPreviousImage: false,
      canNextUnannotatedImage: false,
      canPreviousUnannotatedImage: false,
      onDeleteImage,
      onChangeLabel: vi.fn(),
      onDeleteAnnotation: vi.fn(),
      onFitHeight: vi.fn(),
      onFitWidth: vi.fn(),
      onNextImage: vi.fn(),
      onNextUnannotatedImage: vi.fn(),
      onOriginalSize: vi.fn(),
      onPreviousImage: vi.fn(),
      onPreviousUnannotatedImage: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    };
    await act(async () => root.render(<CanvasContextMenu {...props} canDeleteImage={false} />));
    expect(button(text.deleteCurrentImage).disabled).toBe(true);
    await click(text.deleteCurrentImage);
    expect(onDeleteImage).not.toHaveBeenCalled();
    await act(async () => root.render(<CanvasContextMenu {...props} canDeleteImage />));
    await click(text.deleteCurrentImage);
    expect(onDeleteImage).toHaveBeenCalledOnce();
  });

  it("settings reject fixed and label conflicts and rebinding takes effect immediately", async () => {
    await openFixture();
    await click("设置");
    // Lazy settings import is not timer-driven; flush its module load using real timers.
    vi.useRealTimers();
    await act(async () => {
      await import("./settings/ShortcutSettings");
    });
    const description = [...container.querySelectorAll("p")].find(
      (node) => node.textContent === text.deleteCurrentImage,
    )!;
    const record =
      description.parentElement?.parentElement?.querySelector<HTMLButtonElement>("button");
    expect(record).toBeTruthy();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    await act(async () => record?.click());
    await key("Delete");
    await key("1");
    await key("ArrowLeft");
    expect(alert).toHaveBeenCalledTimes(3);
    expect(api.saveShortcuts).not.toHaveBeenCalled();
    await key("F9");
    expect(api.saveShortcuts).toHaveBeenCalledWith(expect.objectContaining({ deleteImage: "F9" }));
    await click("关闭");
    await key("F8");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    await key("F9");
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    alert.mockRestore();
  });
});
