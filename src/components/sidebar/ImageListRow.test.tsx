import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImageListRow, ScopeBar } from "./ImageListRow";
import { useAnnotationStore } from "../../store/useAnnotationStore";
it("owns scrolling and exposes an exit for the current scope", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  useAnnotationStore.getState().setImages([{ path: "a", name: "a" }]);
  useAnnotationStore.getState().pushScope({ kind: "search", ids: ["a"], label: "Search: a" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <>
        <ImageListRow selected>a</ImageListRow>
        <ImageListRow selected={false}>b</ImageListRow>
        <ScopeBar />
      </>,
    ),
  );
  expect(scroll).toHaveBeenCalledTimes(1);
  expect((scroll.mock.instances[0] as HTMLElement)?.textContent).toBe("a");
  expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  expect(container.textContent).toContain("Search: a");
  act(() => container.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
  expect(container.textContent).toContain("全部项目");
  act(() => root.unmount());
  container.remove();
});
