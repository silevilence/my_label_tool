import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Overlay } from "./Overlay";
import { useOverlayStore } from "../../store/useOverlayStore";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function key(key: string, shiftKey = false) {
  act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    ),
  );
}
it("registers nested overlays in depth order and delivers Escape only to the dismissible top", () => {
  const outer = vi.fn(),
    inner = vi.fn();
  const render = (allowed: boolean) =>
    act(() =>
      root.render(
        <StrictMode>
          <Overlay onClose={outer} label="outer">
            <button>outer</button>
            <Overlay onClose={inner} canDismiss={() => allowed} label="inner">
              <button>inner</button>
            </Overlay>
          </Overlay>
        </StrictMode>,
      ),
    );
  render(false);
  expect(useOverlayStore.getState().depth()).toBe(2);
  expect(useOverlayStore.getState().hasBlocking()).toBe(true);
  expect(document.activeElement?.textContent).toBe("inner");
  key("Escape");
  expect(inner).not.toHaveBeenCalled();
  expect(outer).not.toHaveBeenCalled();
  render(true);
  key("Escape");
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
});
it("traps focus, restores the opener, and gives short viewports a bounded scrolling panel", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  act(() =>
    root.render(
      <Overlay onClose={vi.fn()} label="test">
        <button>first</button>
        <button>last</button>
      </Overlay>,
    ),
  );
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.className).toContain("max-h-[calc(100dvh-2rem)]");
  expect(panel.className).toContain("overflow-y-auto");
  key("Tab", true);
  expect(document.activeElement?.textContent).toBe("last");
  key("Tab");
  expect(document.activeElement?.textContent).toBe("first");
  opener.focus();
  expect(document.activeElement?.textContent).toBe("first");
  act(() => root.render(null));
  expect(document.activeElement).toBe(opener);
  opener.remove();
});
it("light overlays register independently and closed overlays never gate input", () => {
  act(() =>
    root.render(
      <>
        <Overlay onClose={vi.fn()} open={false}>
          <button>hidden</button>
        </Overlay>
        <Overlay onClose={vi.fn()} kind="light">
          <button>menu</button>
        </Overlay>
      </>,
    ),
  );
  expect(useOverlayStore.getState().depth()).toBe(1);
  expect(useOverlayStore.getState().hasBlocking()).toBe(false);
  expect(useOverlayStore.getState().hasLight()).toBe(true);
  act(() => root.render(null));
  expect(useOverlayStore.getState().depth()).toBe(0);
});

it("excludes hidden controls and collapsed details from the focus cycle", () => {
  act(() =>
    root.render(
      <Overlay onClose={() => {}}>
        <div style={{ display: "none" }}>
          <button>hidden</button>
        </div>
        <input type="hidden" />
        <button>visible</button>
        <details>
          <summary>expand</summary>
          <button>collapsed</button>
        </details>
        <button>last</button>
      </Overlay>,
    ),
  );
  expect(document.activeElement?.textContent).toBe("visible");
  key("Tab");
  expect(document.activeElement?.textContent).toBe("expand");
  key("Tab");
  expect(document.activeElement?.textContent).toBe("last");
  key("Tab");
  expect(document.activeElement?.textContent).toBe("visible");
});
