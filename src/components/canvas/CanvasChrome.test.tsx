import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { KonvaEventObject } from "konva/lib/Node";
import { expect, it, vi } from "vitest";
import { AnnotationRect } from "./CanvasChrome";
const handlers = vi.hoisted(() => ({
  drag: null as null | ((event: KonvaEventObject<DragEvent>) => void),
  mouseDown: null as null | ((event: KonvaEventObject<MouseEvent>) => void),
}));
vi.mock("react-konva", () => ({
  Rect: ({
    onDragStart,
    onMouseDown,
  }: {
    onDragStart: typeof handlers.drag;
    onMouseDown: typeof handlers.mouseDown;
  }) => {
    handlers.drag = onDragStart;
    handlers.mouseDown = onMouseDown;
    return null;
  },
  Circle: () => null,
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
  act(() => root.unmount());
});
