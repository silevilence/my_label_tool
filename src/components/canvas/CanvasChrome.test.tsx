import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { KonvaEventObject } from "konva/lib/Node";
import { expect, it, vi } from "vitest";
import { AnnotationRect } from "./CanvasChrome";
const handlers = vi.hoisted(() => ({
  drag: null as null | ((event: KonvaEventObject<DragEvent>) => void),
}));
vi.mock("react-konva", () => ({
  Rect: ({ onDragStart }: { onDragStart: typeof handlers.drag }) => {
    handlers.drag = onDragStart;
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
