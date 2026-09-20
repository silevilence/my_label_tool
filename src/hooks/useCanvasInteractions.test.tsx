import { act } from "react";
import { createRoot } from "react-dom/client";
import type { KonvaEventObject } from "konva/lib/Node";
import { expect, it, vi } from "vitest";
import { useCanvasInteractions } from "./useCanvasInteractions";
import { useDraftGesture } from "./useDraftGesture";

it("leaves Transformer anchors selected while background picking still selects nearby annotations", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const select = vi.fn();
  const highlight = vi.fn();
  let controls!: ReturnType<typeof useCanvasInteractions>;
  const label = { id: "l", name: "label", color: "#ffffff", shapeType: "any" as const };
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
  act(() => controls.handleStageMouseDown(event("image", true)));
  expect(select).toHaveBeenCalledWith("point");
  act(() => root.unmount());
});
