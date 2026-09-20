import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImageListRow, ScopeBar } from "./ImageListRow";
import { useAnnotationStore } from "../../store/useAnnotationStore";
it("delegates selected-row scrolling to the list and exposes an exit for the current scope", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
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
  // 行组件不再自行 scrollIntoView；选中定位由列表容器按索引计算 scrollTop。
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Search: a");
  act(() => container.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
  expect(container.textContent).toContain("全部项目");
  act(() => root.unmount());
  container.remove();
});
