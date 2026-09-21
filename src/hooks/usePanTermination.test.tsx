import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PanState } from "../components/canvas/types";
import { useDraftGesture } from "./useDraftGesture";
import { useDraftKeyboard } from "./useDraftKeyboard";
import { usePanTermination } from "./usePanTermination";

let root: Root;
let gesture: ReturnType<typeof useDraftGesture>;
const panStateRef: { current: PanState | null } = { current: null };
const suppressContextMenuRef = { current: false };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  panStateRef.current = null;
  suppressContextMenuRef.current = false;
  function Harness() {
    gesture = useDraftGesture();
    useDraftKeyboard(gesture, () => gesture.commit());
    usePanTermination(gesture.state === "pan", panStateRef, suppressContextMenuRef, gesture.endPan);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  act(() => gesture.start("draw-polygon", { x: 10, y: 20 }));
});

afterEach(() => {
  act(() => root.unmount());
  vi.runAllTimers();
  vi.useRealTimers();
});

function startPan(moved: boolean) {
  act(() => {
    panStateRef.current = { button: 1, moved, startX: 1, startY: 2, layoutX: 0, layoutY: 0 };
    suppressContextMenuRef.current = true;
    gesture.start("pan", { x: 1, y: 2 });
  });
}

it.each([false, true])("restores the draft on window blur even when moved=%s", (moved) => {
  startPan(moved);
  act(() => window.dispatchEvent(new Event("blur")));
  expect(gesture.draft).toEqual({ kind: "polygon", points: [10, 20], cursor: { x: 10, y: 20 } });
  expect(panStateRef.current).toBeNull();
  act(() => vi.advanceTimersByTime(250));
  expect(suppressContextMenuRef.current).toBe(false);
});

it("cancels a middle click released outside the canvas", () => {
  startPan(false);
  act(() => window.dispatchEvent(new MouseEvent("mouseup")));
  expect(gesture.state).toBe("idle");
  expect(panStateRef.current).toBeNull();
});

it("does not restore an explicitly cancelled draft on later mouseup or blur", () => {
  startPan(true);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(gesture.state).toBe("idle");
  expect(panStateRef.current).toBeNull();
  act(() => {
    window.dispatchEvent(new MouseEvent("mouseup"));
    window.dispatchEvent(new Event("blur"));
  });
  expect(gesture.state).toBe("idle");
});
