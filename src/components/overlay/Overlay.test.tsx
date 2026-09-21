import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Overlay } from "./Overlay";
import { useOverlayStore } from "../../store/useOverlayStore";
import { ShortcutSettings } from "../settings/ShortcutSettings";
import { DEFAULT_SHORTCUTS } from "../../lib/defaults/shortcuts";
import {
  DEFAULT_HELP_DISPLAY_SETTINGS,
  DEFAULT_LABEL_DISPLAY_SETTINGS,
} from "../../lib/defaults/display";

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
it("traps focus and restores the opener", () => {
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

it("cancels shortcut recording before closing its nested settings overlay", () => {
  const outer = vi.fn(),
    close = vi.fn(),
    change = vi.fn();
  act(() =>
    root.render(
      <Overlay onClose={outer} label="parent">
        <ShortcutSettings
          helpDisplaySettings={DEFAULT_HELP_DISPLAY_SETTINGS}
          labelDisplaySettings={DEFAULT_LABEL_DISPLAY_SETTINGS}
          labelShortcuts={[]}
          shortcuts={DEFAULT_SHORTCUTS}
          onChangeHelpDisplaySetting={vi.fn()}
          onChangeLabelDisplaySetting={vi.fn()}
          onChangeShortcut={change}
          onClose={close}
        />
      </Overlay>,
    ),
  );
  act(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent === "录制")!.click(),
  );
  expect(document.body.textContent).toContain("按键中...");
  key("Escape");
  expect(document.body.textContent).not.toContain("按键中...");
  expect(close).not.toHaveBeenCalled();
  expect(outer).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
  key("Escape");
  expect(close).toHaveBeenCalledOnce();
  expect(outer).not.toHaveBeenCalled();
});

it("allows modifier release through pointer-only overlays and suppresses backdrop context menus", () => {
  const release = vi.fn();
  window.addEventListener("keyup", release);
  act(() =>
    root.render(
      <Overlay onClose={vi.fn()} pointerOnly label="delete" describedBy="consequence">
        <p id="consequence">consequence</p>
        <button>confirm</button>
      </Overlay>,
    ),
  );
  const panel = document.querySelector('[role="dialog"]')!;
  expect(panel.getAttribute("aria-describedby")).toBe("consequence");
  act(() => panel.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", bubbles: true })));
  expect(release).toHaveBeenCalledOnce();
  for (const type of ["keydown", "keyup"]) {
    const ordinary = new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true });
    act(() => panel.dispatchEvent(ordinary));
    expect(ordinary.defaultPrevented).toBe(true);
  }
  expect(release).toHaveBeenCalledOnce();
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  panel.parentElement!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  window.removeEventListener("keyup", release);
});

it("keeps anchored menus near the pointer and clamps against measured bounds", () => {
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200,
    height: 100,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 100,
    toJSON: () => ({}),
  });
  const render = (y: number) =>
    act(() =>
      root.render(
        <Overlay onClose={vi.fn()} kind="light" anchor={{ x: 50, y }}>
          <button>menu</button>
        </Overlay>,
      ),
    );
  render(window.innerHeight - 150);
  const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(parseFloat(panel.style.top)).toBe(window.innerHeight - 150);
  render(window.innerHeight - 10);
  expect(parseFloat(panel.style.top) + 100).toBeLessThanOrEqual(window.innerHeight - 8);
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 180 });
  act(() => window.dispatchEvent(new Event("resize")));
  expect(panel.style.maxWidth).toBe("164px");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
  rect.mockRestore();
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

it.each([false, true])("gates outside dismissal for anchored=%s", (anchored) => {
  const close = vi.fn();
  const render = (allowed: boolean | (() => boolean)) =>
    act(() =>
      root.render(
        <Overlay
          label="gated"
          onClose={close}
          canDismiss={allowed}
          closeOnBackdrop
          kind={anchored ? "light" : "blocking"}
          anchor={anchored ? { x: 10, y: 10 } : undefined}
        >
          <button>
            <span>inside</span>
          </button>
        </Overlay>,
      ),
    );
  render(false);
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(close).not.toHaveBeenCalled();
  render(() => false);
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(close).not.toHaveBeenCalled();
  render(() => true);
  act(() =>
    document
      .querySelector('[role="dialog"] span')!
      .dispatchEvent(new Event("pointerdown", { bubbles: true })),
  );
  expect(close).not.toHaveBeenCalled();
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(close).toHaveBeenCalledOnce();
});
