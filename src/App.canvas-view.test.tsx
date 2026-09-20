import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import type { AppLayout } from "./components/AppLayout";
import type { KonvaEventObject } from "konva/lib/Node";
import { useAnnotationStore } from "./store/useAnnotationStore";
import { useOperations } from "./store/useOperations";
import { EMPTY_PRELABEL_MODEL_LIBRARY } from "./types/prelabel";

const fixture = vi.hoisted(() => ({
  layout: null as ComponentProps<typeof AppLayout> | null,
  image: null as HTMLImageElement | null,
}));
vi.mock("./components/AppLayout", async (importOriginal) => {
  const original = await importOriginal<typeof import("./components/AppLayout")>();
  return {
    AppLayout: (props: ComponentProps<typeof AppLayout>) => {
      fixture.layout = props;
      return <original.AppLayout {...props} />;
    },
  };
});
vi.mock("./hooks/useImageLoader", () => ({
  useImageLoader: () => ({
    loadedImage: fixture.image,
    selectedImage: { name: "a.png", path: "a.png" },
    imageLoadError: "",
    isImageLoading: false,
  }),
}));
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
vi.mock("./lib/updater", () => ({ checkAppUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock("./lib/tauri-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/tauri-api")>()),
  loadLabelConfigs: vi.fn().mockResolvedValue([]),
  loadLabelTemplates: vi.fn().mockResolvedValue([]),
  loadShortcuts: vi.fn().mockResolvedValue({}),
  loadPluginLabelPresets: vi.fn().mockResolvedValue({ presets: [], warning: null }),
  loadPluginExportFormats: vi.fn().mockResolvedValue({ formats: [], warning: null }),
  loadPluginPrelabelSources: vi.fn().mockResolvedValue({ sources: [], warning: null }),
  loadPrelabelModelLibrary: vi.fn().mockImplementation(async () => EMPTY_PRELABEL_MODEL_LIBRARY),
  imageFileSrc: (path: string) => path,
}));

let root: Root;
let host: HTMLDivElement;
let notifyResize: () => void;
function image(width: number, height: number) {
  return Object.defineProperties(new Image(), {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
}
function resize(width: number, height: number) {
  const canvas = fixture.layout!.canvasHostRef.current!;
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  act(() => notifyResize());
}
function pointer(x: number, y: number) {
  return {
    evt: new MouseEvent("mousemove", { clientX: x, clientY: y }),
  } as KonvaEventObject<MouseEvent>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notifyResize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useOperations.setState({ operations: [] });
  useAnnotationStore.getState().setImages([{ name: "a.png", path: "a.png" }]);
  useAnnotationStore.getState().select("a.png");
  fixture.image = image(400, 300);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("preserves zoom and pan through status cards, expiry, and host resizing", async () => {
  await act(async () => root.render(<App />));
  expect(fixture.layout!.imageLayout).toBeNull();
  resize(800, 600);
  expect(fixture.layout!.imageLayout).toEqual({ x: 0, y: 0, width: 800, height: 600, scale: 2 });
  act(() => fixture.layout!.setImageScale(3));
  act(() => fixture.layout!.startPanning(pointer(100, 100)));
  act(() => fixture.layout!.handleStageMouseMove(pointer(125, 140)));
  act(() => fixture.layout!.handleStageMouseUp());
  const view = fixture.layout!.imageLayout;
  expect(view).toEqual({ x: -175, y: -110, width: 1200, height: 900, scale: 3 });
  act(() => useOperations.getState().begin({ label: "saved", resource: "export-dir" }).complete());
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  resize(800, 532);
  expect(fixture.layout!.imageLayout).toBe(view);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(host.querySelector('[role="status"]')).toBeNull();
  resize(800, 600);
  expect(fixture.layout!.imageLayout).toBe(view);
  resize(0, 0);
  resize(1000, 700);
  expect(fixture.layout!.imageLayout).toBe(view);
  act(() => fixture.layout!.resetZoom());
  expect(fixture.layout!.imageLayout?.scale).toBeCloseTo(700 / 300);
});

it("fits replacement images to the latest host size, including delayed measurement", async () => {
  await act(async () => root.render(<App />));
  resize(800, 600);
  act(() => fixture.layout!.setImageScale(3));
  fixture.image = image(200, 100);
  await act(async () => root.render(<App />));
  expect(fixture.layout!.imageLayout).toEqual({ x: 0, y: 100, width: 800, height: 400, scale: 4 });
  fixture.image = null;
  await act(async () => root.render(<App />));
  expect(fixture.layout!.imageLayout).toBeNull();
  resize(0, 0);
  fixture.image = image(400, 300);
  await act(async () => root.render(<App />));
  expect(fixture.layout!.imageLayout).toBeNull();
  resize(1000, 600);
  expect(fixture.layout!.imageLayout).toEqual({ x: 100, y: 0, width: 800, height: 600, scale: 2 });
});
