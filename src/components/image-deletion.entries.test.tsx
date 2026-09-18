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
  listProjectVideos: vi.fn().mockResolvedValue([]),
  selectVideoFile: vi.fn().mockResolvedValue("C:/fixture/added.mp4"),
  importVideo: vi.fn(),
  cancelVideoImport: vi.fn().mockResolvedValue(undefined),
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
    await click("打开项目文件夹");
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

  it("integrates multiple videos into the project list, shows the timeline only for video and adds without clearing annotations", async () => {
    const video = (name: string) => ({
      schemaVersion: 1 as const,
      sourcePath: `C:/fixture/${name}.mp4`,
      width: 64,
      height: 48,
      frameInterval: 3,
      totalFrames: 4,
      frames: [0, 3].map((frameIndex, index) => ({
        name: `frame-00000${index}.png`,
        frameIndex,
        timestampSeconds: frameIndex / 10,
      })),
    });
    vi.mocked(api.listProjectVideos).mockResolvedValueOnce(
      ["one", "two"].map((name) => ({
        sourcePath: `C:/fixture/${name}.mp4`,
        folderPath: `C:/fixture/${name}`,
        video: video(name),
      })),
    );
    await openFixture();
    expect(container.querySelector('[aria-label="视频时间轴"]')).toBeNull();
    expect(container.querySelector("main")?.firstElementChild?.tagName).toBe("DIV");
    const clickVideo = async (name: string) => {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(`button[title="C:/fixture/${name}.mp4"]`)!
          .click(),
      );
    };
    await clickVideo("one");
    await key("PageUp");
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe(
      "源帧 1 / 4",
    );
    await key("PageDown");
    await key("PageDown");
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe(
      "源帧 4 / 4",
    );
    const timeline = container.querySelector('section[aria-label="视频时间轴"]')!;
    expect(timeline.closest("aside")).toBeNull();
    expect(timeline.parentElement?.parentElement?.className).toContain("flex-col");
    await act(async () =>
      useAnnotationStore.getState().addAnnotation("C:/fixture/one/frame-000001.png", {
        id: "kept",
        labelId: "person",
        type: "rect",
        points: [1, 2, 3, 4],
      }),
    );
    await clickVideo("two");
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe(
      "源帧 1 / 4",
    );
    await clickVideo("one");
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe(
      "源帧 4 / 4",
    );
    await click("设置");
    await act(async () => {
      await import("./settings/ShortcutSettings");
    });
    const previousFrameRow = [...container.querySelectorAll("p")]
      .find((element) => element.textContent === "上一帧")!
      .closest("div.grid")!;
    await act(async () => previousFrameRow.querySelector<HTMLButtonElement>("button")!.click());
    await key("[");
    expect(api.saveShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({ previousFrame: "[", nextFrame: "PageDown" }),
    );
    await click("关闭");
    await key("PageUp");
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe(
      "源帧 4 / 4",
    );
    await key("[");
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe(
      "源帧 1 / 4",
    );
    const input = document.createElement("input");
    container.append(input);
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })),
    );
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe(
      "源帧 1 / 4",
    );
    input.remove();
    await click("a.png");
    await key("PageDown");
    expect(button("a.png").className).toContain("bg-sky-500");
    expect(container.querySelector('[aria-label="视频时间轴"]')).toBeNull();
    await click("添加视频到项目");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("抽帧间隔");
    vi.mocked(api.importVideo).mockResolvedValueOnce({
      folderPath: "C:/fixture/added",
      video: video("added"),
    });
    await click("准备视频帧");
    expect(api.importVideo).toHaveBeenCalledWith("C:/fixture/added.mp4", "C:/fixture", 30);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("2 张图片 · 3 个视频");
    expect(
      useAnnotationStore.getState().annotationsByImage["C:/fixture/one/frame-000001.png"][0],
    ).toMatchObject({ id: "kept", frameIndex: 3 });
  });

  it("prepares all pending videos from the project menu and preserves ordinary images", async () => {
    vi.mocked(api.listProjectVideos).mockResolvedValueOnce(
      ["one", "two"].map((name) => ({
        sourcePath: `C:/fixture/${name}.mp4`,
        folderPath: null,
        video: null,
      })),
    );
    vi.mocked(api.importVideo).mockImplementation(async (sourcePath, _folder, frameInterval) => ({
      folderPath: `C:/fixture/${sourcePath.includes("one") ? "one" : "two"}`,
      video: {
        schemaVersion: 1,
        sourcePath,
        width: 64,
        height: 48,
        frameInterval,
        totalFrames: 1,
        frames: [{ name: "frame-000000.png", frameIndex: 0, timestampSeconds: 0 }],
      },
    }));
    await openFixture();
    await click("批量抽取未准备视频");
    expect(api.importVideo).toHaveBeenCalledTimes(2);
    expect(api.importVideo).toHaveBeenNthCalledWith(2, "C:/fixture/two.mp4", "C:/fixture", 30);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("完成 2 / 2");
    await click("关闭");
    expect(container.textContent).toContain("2 张图片 · 2 个视频");
    expect(button("批量抽取未准备视频").disabled).toBe(true);
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
