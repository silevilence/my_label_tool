import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageSearchDialog } from "./ImageSearchDialog";
import { useAnnotationStore as store } from "../../store/useAnnotationStore";
vi.mock("../../lib/tauri-api", () => ({ imageFileSrc: (path: string) => path }));
const images = ["a", "b", "c"].map((name) => ({ name: `${name}.png`, path: name }));
let root: Root;
let host: HTMLDivElement;
const close = vi.fn();
const select = vi.fn((path: string) => store.getState().select(path));
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  store.getState().setImages(images);
  store.getState().pushScope({ kind: "video", ids: ["a"], label: "video" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ImageSearchDialog
        images={images}
        labels={[]}
        annotationsByImage={{}}
        selectedPath="a"
        onClose={close}
        onSelectImage={select}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function query(value: string) {
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(value: string) {
  act(() =>
    document.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
it("keeps candidate preview and Escape local without discarding the active video scope", async () => {
  await query("b.png");
  expect(document.querySelector("img")?.getAttribute("alt")).toBe("b.png");
  key("Escape");
  expect(select).not.toHaveBeenCalled();
  expect(store.getState().selectedPath).toBe("a");
  expect(store.getState().scopeStack.map((scope) => scope.kind)).toEqual(["project", "video"]);
  expect(close).toHaveBeenCalledOnce();
});
it("commits the candidate and search scope only on confirmation", async () => {
  await query("b.png");
  key("Enter");
  expect(select).toHaveBeenCalledWith("b");
  expect(store.getState().selectedPath).toBe("b");
  expect(store.getState().scopeStack.slice(-1)[0]).toMatchObject({ kind: "search", ids: ["b"] });
});

it("previews a clicked row without writing selection and commits it on the second click", () => {
  const row = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "c.png",
  )!;
  act(() => row.click());
  expect(document.querySelector("img")?.getAttribute("alt")).toBe("c.png");
  expect(select).not.toHaveBeenCalled();
  expect(store.getState().selectedPath).toBe("a");
  expect(store.getState().scopeStack.slice(-1)[0].kind).toBe("video");
  act(() => row.click());
  expect(select).toHaveBeenCalledExactlyOnceWith("c");
  expect(store.getState().scopeStack.slice(-1)[0]).toMatchObject({
    kind: "search",
    ids: ["a", "b", "c"],
  });
});

it("closes from a backdrop click without writing selection or scope", () => {
  const backdrop = document.querySelector("div.fixed.inset-0")!;
  act(() => backdrop.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(close).toHaveBeenCalledOnce();
  expect(store.getState().selectedPath).toBe("a");
  expect(store.getState().scopeStack.map((scope) => scope.kind)).toEqual(["project", "video"]);
});

it("keeps the dialog open when clicking inside the panel", () => {
  const panel = document.querySelector('[role="dialog"]')!;
  act(() => panel.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(close).not.toHaveBeenCalled();
});
