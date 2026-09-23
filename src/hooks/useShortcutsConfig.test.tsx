import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShortcutSettings } from "../components/settings/ShortcutSettings";
import {
  DEFAULT_HELP_DISPLAY_SETTINGS,
  DEFAULT_LABEL_DISPLAY_SETTINGS,
} from "../lib/defaults/display";
import { DEFAULT_SHORTCUTS, type ShortcutMap } from "../lib/defaults/shortcuts";
import { confirmAction } from "../lib/prompts";
import { loadShortcuts, saveShortcuts, loadPrelabelResourceLimits } from "../lib/tauri-api";
import { PRELABEL_RESOURCE_ZH_CN as resourceText } from "../i18n/prelabel-resource.zh-CN";
import { SHORTCUT_ZH_CN as text } from "../i18n/shortcuts.zh-CN";
import { useShortcutStore } from "../store/useShortcutStore";
import { useShortcutsConfig } from "./useShortcutsConfig";
import { useLabelDisplaySettings } from "./useLabelDisplaySettings";
import { DISPLAY_ZH_CN as displayText } from "../i18n/display.zh-CN";

vi.mock("../lib/tauri-api", () => ({
  loadShortcuts: vi.fn(),
  saveShortcuts: vi.fn(),
  loadPrelabelResourceLimits: vi.fn(),
}));
vi.mock("../lib/prompts", () => ({ confirmAction: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let config: ReturnType<typeof useShortcutsConfig>;
const reportError = vi.fn();
const onClose = vi.fn();

function Harness({ labelShortcuts = [] }: { labelShortcuts?: string[] }) {
  config = useShortcutsConfig(reportError);
  const display = useLabelDisplaySettings(new Map());
  return (
    <ShortcutSettings
      shortcuts={config.shortcuts}
      labelShortcuts={labelShortcuts}
      helpDisplaySettings={DEFAULT_HELP_DISPLAY_SETTINGS}
      labelDisplaySettings={DEFAULT_LABEL_DISPLAY_SETTINGS}
      rectSizeDisplaySettings={display.rectSizeDisplaySettings}
      onChangeRectSizeDisplaySetting={display.setRectSizeDisplaySetting}
      onChangeHelpDisplaySetting={vi.fn()}
      onChangeLabelDisplaySetting={vi.fn()}
      onChangeShortcut={config.updateShortcut}
      onClose={onClose}
    />
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(loadShortcuts).mockResolvedValue(DEFAULT_SHORTCUTS);
  vi.mocked(loadPrelabelResourceLimits).mockResolvedValue({
    maxMemoryMiB: 80,
    maxCandidates: 100_000,
  });
  vi.mocked(saveShortcuts).mockResolvedValue(undefined);
  vi.mocked(confirmAction).mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(changes: Partial<ShortcutMap>, labelShortcuts: string[] = []) {
  vi.mocked(loadShortcuts).mockResolvedValue({ ...DEFAULT_SHORTCUTS, ...changes });
  await act(async () => root.render(<Harness labelShortcuts={labelShortcuts} />));
}

async function clickRestore(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("updates each size display switch immediately and restores it after remount", async () => {
  await render({});
  function sizeSwitches() {
    const group = [...document.querySelectorAll("fieldset")].find(
      (item) => item.querySelector("legend")?.textContent === displayText.rectSizeTitle,
    );
    expect(group).toBeDefined();
    return [...group!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  }
  expect(sizeSwitches().map((input) => input.checked)).toEqual([false, false, true]);
  for (const input of sizeSwitches()) {
    await act(async () => input.click());
  }
  expect(sizeSwitches().map((input) => input.checked)).toEqual([true, true, false]);
  await act(async () => root.unmount());
  root = createRoot(host);
  await render({});
  expect(sizeSwitches().map((input) => input.checked)).toEqual([true, true, false]);
});

it("restores every changed shortcut in one state update and one persisted snapshot", async () => {
  await render({ previousImage: "a", nextImage: "d", zoomIn: "w" });
  await clickRestore(text.restoreAllDefaults);
  expect(config.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  expect(useShortcutStore.getState().shortcuts).toEqual(DEFAULT_SHORTCUTS);
  expect(saveShortcuts).toHaveBeenCalledExactlyOnceWith(DEFAULT_SHORTCUTS);
  expect(document.body.textContent).not.toContain(text.restoreAllDefaults);
});

it("validates the complete restored map so swapped bindings can be restored together", async () => {
  await render({ previousImage: "ArrowRight", nextImage: "ArrowLeft" });
  await clickRestore(text.restoreAllDefaults);
  expect(config.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  expect(saveShortcuts).toHaveBeenCalledExactlyOnceWith(DEFAULT_SHORTCUTS);
});

it("rejects restoring one action when its default key belongs to another action", async () => {
  const changes = { previousImage: "a", nextImage: "ArrowLeft" };
  await render(changes);
  await clickRestore(`${text.restoreDefault}：${text.previousImage.label}`);
  expect(config.shortcuts).toMatchObject(changes);
  expect(saveShortcuts).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("同时绑定");
});

it("rejects restoring all defaults when a project label already uses a restored key", async () => {
  await render({ selectRectTool: "j", previousImage: "a" }, ["r"]);
  await clickRestore(text.restoreAllDefaults);
  expect(config.shortcuts.selectRectTool).toBe("j");
  expect(config.shortcuts.previousImage).toBe("a");
  expect(saveShortcuts).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(text.labelBinding("r"));
});

it("keeps bindings unchanged when restoring is cancelled", async () => {
  await render({ previousImage: "a", nextImage: "d" });
  vi.mocked(confirmAction).mockResolvedValue(false);
  await clickRestore(text.restoreAllDefaults);
  expect(config.shortcuts.previousImage).toBe("a");
  expect(config.shortcuts.nextImage).toBe("d");
  expect(saveShortcuts).not.toHaveBeenCalled();
});

it("does not persist attempts to change fixed actions or unchanged bindings", async () => {
  await render({});
  await act(async () => config.updateShortcut({ save: "x", previousImage: "ArrowLeft" }));
  expect(config.shortcuts).toEqual(DEFAULT_SHORTCUTS);
  expect(saveShortcuts).not.toHaveBeenCalled();
});

it("keeps unsaved resource edits when closing is cancelled", async () => {
  await render({});
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${resourceText.memory}"]`,
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "128");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  vi.mocked(confirmAction).mockResolvedValueOnce(false);
  await clickRestore("关闭");
  expect(confirmAction).toHaveBeenCalledWith(resourceText.discard);
  expect(onClose).not.toHaveBeenCalled();
  expect(input.value).toBe("128");
  await clickRestore("关闭");
  expect(onClose).toHaveBeenCalledTimes(1);
});
