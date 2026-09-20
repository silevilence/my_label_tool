import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useDraftGesture } from "./useDraftGesture";
import { useDraftKeyboard } from "./useDraftKeyboard";
import { useOverlayStore } from "../store/useOverlayStore";
it("uses the same cancellation for rectangle and polygon and commits immediate point clicks", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let gesture!: ReturnType<typeof useDraftGesture>;
  function Harness() {
    gesture = useDraftGesture();
    useDraftKeyboard(gesture, () => gesture.commit());
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  for (const intent of ["draw-rect", "draw-polygon"] as const) {
    act(() => gesture.start(intent, { x: 1, y: 2 }));
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })),
    );
    expect(gesture.state).toBe("idle");
  }
  act(() => {
    gesture.start("draw-point", { x: 1, y: 2 });
    expect(gesture.commit()).toEqual({ type: "point", points: [1, 2] });
  });
  act(() => {
    gesture.start("draw-polygon", { x: 1, y: 2 });
    expect(gesture.commit()).toBeNull();
  });
  expect(gesture.state).toBe("polygon");
  act(() => {
    useOverlayStore.getState().register({ id: "test", kind: "light", parentId: null });
  });
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(gesture.state).toBe("polygon");
  act(() => useOverlayStore.getState().unregister("test"));
  act(() => {
    expect(gesture.undoVertex()).toBe(true);
  });
  expect(gesture.state).toBe("idle");
  act(() => {
    expect(gesture.undoVertex()).toBe(false);
    gesture.update({ x: 3, y: 4 });
  });
  act(() => root.unmount());
});
