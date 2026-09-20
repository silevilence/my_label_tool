import { act } from "react";
import { createRoot } from "react-dom/client";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Mock } from "vitest";
import { expect, it, vi } from "vitest";
import { useCanvasInteractions, type CanvasInteractions, type UseCanvasInteractionsParams } from "./useCanvasInteractions";
import { useDraftGesture } from "./useDraftGesture";
import type { ImageLayout } from "../components/canvas/types";

it("leaves Transformer anchors selected while background picking still selects nearby annotations", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const select = vi.fn();
  const highlight = vi.fn();
  let controls!: CanvasInteractions;
  function Harness() {
    const gesture = useDraftGesture();
    controls = useCanvasInteractions({
      gesture,
      annotations: [{ id: "point", type: "point", labelId: "l", points: [20, 20] }],
      annotationToDelete: null,
      contextMenu: null,
      currentLabel: label,
      currentShapeType: "rect",
      highlightedShapeId: null,
      imageLayout: { x: 0, y: 0, width: 100, height: 100, scale: 1 },
      labelById: new Map([[label.id, label]]),
      labels: [label],
      loadedImage: Object.assign(new Image(), { width: 100, height: 100 }),
      panStateRef: { current: null },
      spacePanActive: false,
      selectedPath: "a",
      selectedRectRef: { current: null },
      selectedShapeId: "rectangle",
      suppressContextMenuRef: { current: false },
      addAnnotation: vi.fn(),
      clearImageAnnotations: vi.fn(),
      deleteAnnotation: vi.fn(),
      selectShape: select,
      setAnnotationToDelete: vi.fn(),
      setContextMenu: vi.fn(),
      setHighlightedShapeId: highlight,
      setImageView: vi.fn(),
      updateAnnotation: vi.fn(),
      zoomAt: vi.fn(),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  const stage = { getPointerPosition: () => ({ x: 20, y: 20 }) };
  const event = (name: string, shiftKey = false) =>
    ({
      target: { name: () => name, getStage: () => stage },
      evt: new MouseEvent("mousedown", { button: 0, shiftKey }),
    }) as unknown as KonvaEventObject<MouseEvent>;
  act(() => controls.handleStageMouseDown(event("top-left _anchor")));
  expect(select).not.toHaveBeenCalled();
  expect(highlight).not.toHaveBeenCalled();
  act(() => controls.handleStageMouseDown(event("annotation", true)));
  expect(select).toHaveBeenLastCalledWith("point");
  expect(highlight).toHaveBeenLastCalledWith("point");
  select.mockClear();
  act(() => controls.handleStageMouseDown(event("image", true)));
  expect(select).toHaveBeenCalledWith("point");
  stage.getPointerPosition = () => ({ x: 90, y: 90 });
  act(() => controls.handleStageMouseDown(event("image", true)));
  expect(select).toHaveBeenLastCalledWith(null);
  expect(highlight).toHaveBeenLastCalledWith(null);
  act(() => root.unmount());
});

const label = { id: "l", name: "label", color: "#ffffff", shapeType: "any" as const };

function renderHarness(overrides: Partial<UseCanvasInteractionsParams> = {}): {
  current: CanvasInteractions;
} {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // Refs 必须稳定：组件体内字面量会在 setDraft 重渲染后丢失 mousedown 写入的 pan 状态。
  const panStateRef = { current: null };
  const selectedRectRef = { current: null };
  const suppressContextMenuRef = { current: false };
  const box = {} as { current: CanvasInteractions };
  function Harness() {
    const gesture = useDraftGesture();
    box.current = useCanvasInteractions({
      gesture,
      annotations: [],
      annotationToDelete: null,
      contextMenu: null,
      currentLabel: label,
      currentShapeType: "rect",
      highlightedShapeId: null,
      imageLayout: { x: 0, y: 0, width: 100, height: 100, scale: 1 },
      labelById: new Map([[label.id, label]]),
      labels: [label],
      loadedImage: Object.assign(new Image(), { width: 100, height: 100 }),
      panStateRef,
      spacePanActive: false,
      selectedPath: "a",
      selectedRectRef,
      selectedShapeId: null,
      suppressContextMenuRef,
      addAnnotation: vi.fn(),
      clearImageAnnotations: vi.fn(),
      deleteAnnotation: vi.fn(),
      selectShape: vi.fn(),
      setAnnotationToDelete: vi.fn(),
      setContextMenu: vi.fn(),
      setHighlightedShapeId: vi.fn(),
      setImageView: vi.fn(),
      updateAnnotation: vi.fn(),
      zoomAt: vi.fn(),
      ...overrides,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  return box;
}

function stageEvent(
  evtInit: MouseEventInit,
  pointer: { x: number; y: number },
): KonvaEventObject<MouseEvent> {
  return {
    target: { name: () => "image", getStage: () => ({ getPointerPosition: () => pointer }) },
    evt: new MouseEvent("mousedown", { clientX: pointer.x, clientY: pointer.y, ...evtInit }),
  } as unknown as KonvaEventObject<MouseEvent>;
}

function appliedLayout(setImageView: Mock, layout: ImageLayout | null): ImageLayout | null {
  const update = setImageView.mock.lastCall?.[0] as (l: ImageLayout | null) => ImageLayout | null;
  return update(layout);
}

it("pans on middle drag and ends the gesture on mouse up", () => {
  const setImageView = vi.fn();
  const controls = renderHarness({ setImageView });
  act(() => controls.current.handleStageMouseDown(stageEvent({ button: 1 }, { x: 40, y: 40 })));
  act(() => controls.current.handleStageMouseMove(stageEvent({ buttons: 4 }, { x: 70, y: 50 })));
  expect(appliedLayout(setImageView, { x: 0, y: 0, width: 100, height: 100, scale: 1 })).toEqual({
    x: 30,
    y: 10,
    width: 100,
    height: 100,
    scale: 1,
  });
  act(() => controls.current.handleStageMouseUp());
  setImageView.mockClear();
  act(() => controls.current.handleStageMouseMove(stageEvent({ buttons: 4 }, { x: 90, y: 90 })));
  expect(setImageView).not.toHaveBeenCalled();
});

it("pans with space-held left button instead of drawing", () => {
  const setImageView = vi.fn();
  const addAnnotation = vi.fn();
  const controls = renderHarness({ spacePanActive: true, setImageView, addAnnotation });
  act(() => controls.current.handleStageMouseDown(stageEvent({ button: 0 }, { x: 40, y: 40 })));
  act(() => controls.current.handleStageMouseMove(stageEvent({ buttons: 1 }, { x: 55, y: 45 })));
  expect(appliedLayout(setImageView, { x: 0, y: 0, width: 100, height: 100, scale: 1 })).toEqual({
    x: 15,
    y: 5,
    width: 100,
    height: 100,
    scale: 1,
  });
  act(() => controls.current.handleStageMouseUp());
  expect(addAnnotation).not.toHaveBeenCalled();
});

it("zooms from wheel outside the image with the anchor clamped into the image rect", () => {
  const zoomAt = vi.fn();
  const controls = renderHarness({ zoomAt });
  const wheel = (pointer: { x: number; y: number }, init: WheelEventInit) =>
    controls.current.handleStageWheel({
      target: { name: () => "image", getStage: () => ({ getPointerPosition: () => pointer }) },
      evt: new WheelEvent("wheel", { cancelable: true, ...init }),
    } as unknown as KonvaEventObject<WheelEvent>);
  act(() => wheel({ x: 150, y: -20 }, { deltaY: 120 }));
  expect(zoomAt).toHaveBeenLastCalledWith({ x: 100, y: 0 }, 1 / 1.12);
  act(() => wheel({ x: 50, y: 60 }, { deltaY: 120 }));
  expect(zoomAt).toHaveBeenLastCalledWith({ x: 50, y: 60 }, 1 / 1.12);
  act(() => wheel({ x: 50, y: 60 }, { deltaY: -120, ctrlKey: true }));
  expect(zoomAt).toHaveBeenLastCalledWith({ x: 50, y: 60 }, 1.04);
});
