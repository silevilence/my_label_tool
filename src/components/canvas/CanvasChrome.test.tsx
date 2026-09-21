import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { KonvaEventObject } from "konva/lib/Node";
import { expect, it, vi } from "vitest";
import {
  AnnotationRect,
  AnnotationPoint,
  AnnotationPolygon,
  ZoomIndicator,
  isFitScale,
} from "./CanvasChrome";
const handlers = vi.hoisted(() => ({
  drag: null as null | ((event: KonvaEventObject<DragEvent>) => void),
  mouseDown: null as null | ((event: KonvaEventObject<MouseEvent>) => void),
  draggable: false,
}));
vi.mock("react-konva", () => ({
  Rect: ({
    onDragStart,
    onMouseDown,
    draggable,
  }: {
    onDragStart: typeof handlers.drag;
    onMouseDown: typeof handlers.mouseDown;
    draggable: boolean;
  }) => {
    handlers.drag = onDragStart;
    handlers.mouseDown = onMouseDown;
    handlers.draggable = draggable;
    return null;
  },
  Circle: ({
    onDragStart,
    onMouseDown,
    draggable,
  }: {
    onDragStart: typeof handlers.drag;
    onMouseDown: typeof handlers.mouseDown;
    draggable: boolean;
  }) => {
    handlers.drag = onDragStart;
    handlers.mouseDown = onMouseDown;
    handlers.draggable = draggable;
    return null;
  },
  Label: () => null,
  Line: () => null,
  Tag: () => null,
  Text: () => null,
}));
it("accepts native touch drags and rejects middle-button and modified drags", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const props: ComponentProps<typeof AnnotationRect> = {
    annotation: { id: "r", labelId: "l", type: "rect", points: [0, 0, 10, 10] },
    label: { id: "l", name: "label", color: "#ffffff", shapeType: "rect" },
    imageLayout: { x: 0, y: 0, scale: 1, width: 100, height: 100 },
    interactionMode: "default",
    isHighlighted: false,
    isPanning: false,
    spacePan: false,
    isSelected: false,
    rectRef: { current: null },
    showLabel: false,
    onContextMenu: vi.fn(),
    onDragEnd: vi.fn(),
    onPanStart: vi.fn(),
    onSelect: vi.fn(),
    onTransformEnd: vi.fn(),
  };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<AnnotationRect {...props} />));
  const stopDrag = vi.fn();
  const drag = (evt: object) =>
    handlers.drag!({ evt, target: { stopDrag } } as unknown as KonvaEventObject<DragEvent>);
  drag({ touches: [{}] });
  expect(stopDrag).not.toHaveBeenCalled();
  drag({ button: 0, buttons: 4 });
  expect(stopDrag).toHaveBeenCalledTimes(1);
  drag({ button: 0, buttons: 1, ctrlKey: true });
  expect(stopDrag).toHaveBeenCalledTimes(2);
  drag({ button: 0, buttons: 1 });
  expect(stopDrag).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
});

it("starts panning from shapes on middle button and space-held left button", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const props: ComponentProps<typeof AnnotationRect> = {
    annotation: { id: "r", labelId: "l", type: "rect", points: [0, 0, 10, 10] },
    label: { id: "l", name: "label", color: "#ffffff", shapeType: "rect" },
    imageLayout: { x: 0, y: 0, scale: 1, width: 100, height: 100 },
    interactionMode: "default",
    isHighlighted: false,
    isPanning: false,
    spacePan: false,
    isSelected: false,
    rectRef: { current: null },
    showLabel: false,
    onContextMenu: vi.fn(),
    onDragEnd: vi.fn(),
    onPanStart: vi.fn(),
    onSelect: vi.fn(),
    onTransformEnd: vi.fn(),
  };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<AnnotationRect {...props} />));
  const down = (evt: { button: number; buttons?: number; ctrlKey?: boolean }) =>
    handlers.mouseDown!({ cancelBubble: false, evt } as unknown as KonvaEventObject<MouseEvent>);
  down({ button: 1 });
  expect(props.onPanStart).toHaveBeenCalledTimes(1);
  down({ button: 0 });
  expect(props.onPanStart).toHaveBeenCalledTimes(1);
  expect(props.onSelect).toHaveBeenCalledWith("r");
  act(() => root.render(<AnnotationRect {...props} spacePan />));
  down({ button: 0 });
  expect(props.onPanStart).toHaveBeenCalledTimes(2);
  expect(props.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.draggable).toBe(false);
  const stopDrag = vi.fn();
  handlers.drag!({
    evt: { button: 0, buttons: 1 },
    target: { stopDrag },
  } as unknown as KonvaEventObject<DragEvent>);
  expect(stopDrag).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it.each(["point", "polygon"] as const)(
  "disables %s dragging before space panning starts",
  (type) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const common = {
      annotation: {
        id: "shape",
        labelId: "l",
        type,
        points: type === "point" ? [10, 10] : [10, 10, 30, 10, 20, 20],
      },
      label: { id: "l", name: "label", color: "#ffffff", shapeType: type },
      imageLayout: { x: 0, y: 0, scale: 1, width: 100, height: 100 },
      interactionMode: "default" as const,
      isHighlighted: false,
      isPanning: false,
      spacePan: true,
      isSelected: true,
      showLabel: false,
      onContextMenu: vi.fn(),
      onPanStart: vi.fn(),
      onSelect: vi.fn(),
    };
    const root = createRoot(document.createElement("div"));
    act(() =>
      root.render(
        type === "point" ? (
          <AnnotationPoint {...common} onPointDragEnd={vi.fn()} />
        ) : (
          <AnnotationPolygon {...common} onVertexDragEnd={vi.fn()} />
        ),
      ),
    );
    expect(handlers.draggable).toBe(false);
    const stopDrag = vi.fn();
    handlers.drag!({
      evt: { button: 0, buttons: 1 },
      target: { stopDrag },
    } as unknown as KonvaEventObject<DragEvent>);
    expect(stopDrag).toHaveBeenCalledOnce();
    handlers.mouseDown!({ evt: { button: 0 } } as unknown as KonvaEventObject<MouseEvent>);
    expect(common.onPanStart).toHaveBeenCalledOnce();
    expect(common.onSelect).not.toHaveBeenCalled();
    act(() => root.unmount());
  },
);

it("renders fit state or percentage and routes indicator actions", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const onReset = vi.fn();
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: ComponentProps<typeof ZoomIndicator> = {
    fit: true,
    onReset,
    onZoomIn,
    onZoomOut,
    scale: null,
  };
  act(() => root.render(<ZoomIndicator {...props} />));
  expect(document.body.textContent).toContain("适应");
  const buttons = () => Array.from(host.querySelectorAll("button"));
  act(() => buttons()[1]!.click());
  expect(onReset).toHaveBeenCalledTimes(1);
  act(() => root.render(<ZoomIndicator {...props} fit={false} scale={1.27} />));
  expect(document.body.textContent).toContain("127%");
  expect(document.body.textContent).not.toContain("适应");
  act(() => buttons()[0]!.click());
  expect(onZoomOut).toHaveBeenCalledTimes(1);
  act(() => buttons()[2]!.click());
  expect(onZoomIn).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  host.remove();
});

it("treats near-equal scales as fit within tolerance", () => {
  expect(isFitScale(0.5, 0.5)).toBe(true);
  expect(isFitScale(0.5000005, 0.5)).toBe(true);
  expect(isFitScale(0.502, 0.5)).toBe(false);
});
