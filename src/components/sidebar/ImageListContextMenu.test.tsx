import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageListContextMenu } from "./ImageListContextMenu";
import { useShortcutStore } from "../../store/useShortcutStore";
import { DEFAULT_SHORTCUTS } from "../../lib/defaults/shortcuts";

const image = { name: "a.png", path: "C:/p/a.png" } as never;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let list: HTMLDivElement;
const onClose = vi.fn();

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  list = document.createElement("div");
  Object.defineProperty(list, "scrollTop", { value: 0, writable: true, configurable: true });
  document.body.appendChild(list);
  act(() =>
    root.render(
      <ImageListContextMenu
        image={image}
        x={10}
        y={10}
        disabled={false}
        onDelete={vi.fn()}
        onClose={onClose}
      />,
    ),
  );
}

function scrollTo(top: number) {
  list.scrollTop = top;
  act(() => list.dispatchEvent(new Event("scroll", { bubbles: true })));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onClose.mockClear();
  useShortcutStore.getState().configure({ ...DEFAULT_SHORTCUTS, deleteImage: "F8" });
  render();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  list.remove();
});

it("shows the bound delete shortcut next to the menu item", () => {
  const item = [...document.body.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("删除图片"),
  )!;
  expect(item.textContent).toContain("F8");
});

it("stays open under small scroll movement and closes past the threshold", () => {
  scrollTo(8);
  expect(onClose).not.toHaveBeenCalled();
  scrollTo(18);
  expect(onClose).not.toHaveBeenCalled();
  scrollTo(60);
  expect(onClose).toHaveBeenCalledTimes(1);
});
