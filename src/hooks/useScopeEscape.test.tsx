import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it } from "vitest";
import { useScopeEscape } from "./useScopeEscape";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOverlayStore } from "../store/useOverlayStore";

function renderHook() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  function Harness() {
    useScopeEscape();
    return null;
  }
  act(() => root.render(<Harness />));
  return root;
}

function pressEscape(target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  useAnnotationStore.getState().setImages([{ name: "a.png", path: "a" }]);
  useAnnotationStore.setState({ scopeStack: [{ kind: "project" }] });
  useOverlayStore.setState({ stack: [] });
});

it("pops the current scope on Escape and returns to project order", () => {
  useAnnotationStore.getState().pushScope({ kind: "search", ids: ["a"], label: "results" });
  expect(useAnnotationStore.getState().scopeStack).toHaveLength(2);
  const root = renderHook();
  const event = pressEscape();
  expect(event.defaultPrevented).toBe(true);
  expect(useAnnotationStore.getState().scopeStack).toHaveLength(1);
  expect(useAnnotationStore.getState().scopeStack[0].kind).toBe("project");
  act(() => root.unmount());
});

it("keeps the base scope intact when no pushed scope exists", () => {
  const root = renderHook();
  const event = pressEscape();
  expect(event.defaultPrevented).toBe(false);
  expect(useAnnotationStore.getState().scopeStack).toHaveLength(1);
  act(() => root.unmount());
});

it("defers to editable targets and open overlays", () => {
  useAnnotationStore.getState().pushScope({ kind: "search", ids: ["a"], label: "results" });
  const root = renderHook();
  const input = document.createElement("input");
  document.body.appendChild(input);
  const fromInput = pressEscape(input);
  expect(fromInput.defaultPrevented).toBe(false);
  expect(useAnnotationStore.getState().scopeStack).toHaveLength(2);
  act(() => useOverlayStore.getState().register({ id: "o1", parentId: null, kind: "light" }));
  const underOverlay = pressEscape();
  expect(underOverlay.defaultPrevented).toBe(false);
  expect(useAnnotationStore.getState().scopeStack).toHaveLength(2);
  act(() => useOverlayStore.getState().unregister("o1"));
  input.remove();
  act(() => root.unmount());
});
