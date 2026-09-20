import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useShortcut } from "./useShortcut";
import { useShortcutStore } from "../store/useShortcutStore";
import { DEFAULT_SHORTCUTS } from "../lib/defaults/shortcuts";
it("registers only available behavior, updates handlers, and removes only its own registration", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"),
    root = createRoot(host);
  const first = vi.fn(),
    second = vi.fn();
  function Owner({ handler }: { handler?: () => void }) {
    useShortcut("test", handler);
    return null;
  }
  act(() => root.render(<Owner handler={first} />));
  useShortcutStore.getState().handlers.test.handler(new KeyboardEvent("keydown"));
  expect(first).toHaveBeenCalledOnce();
  act(() => root.render(<Owner handler={second} />));
  useShortcutStore.getState().handlers.test.handler(new KeyboardEvent("keydown"));
  expect(second).toHaveBeenCalledOnce();
  act(() => root.render(<Owner />));
  expect(useShortcutStore.getState().handlers.test).toBeUndefined();
  const removeFirst = useShortcutStore.getState().register("test", first);
  const removeSecond = useShortcutStore.getState().register("test", second);
  removeFirst();
  expect(useShortcutStore.getState().handlers.test.handler).toBe(second);
  removeSecond();
  useShortcutStore.getState().configure(DEFAULT_SHORTCUTS);
  expect(useShortcutStore.getState().shortcuts).toEqual(DEFAULT_SHORTCUTS);
  act(() => root.unmount());
});
