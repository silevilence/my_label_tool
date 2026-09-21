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
import { loadShortcuts, saveShortcuts } from "../lib/tauri-api";
import { SHORTCUT_ZH_CN as text } from "../i18n/shortcuts.zh-CN";
import { useShortcutStore } from "../store/useShortcutStore";
import { useShortcutsConfig } from "./useShortcutsConfig";

vi.mock("../lib/tauri-api", () => ({ loadShortcuts: vi.fn(), saveShortcuts: vi.fn() }));
vi.mock("../lib/prompts", () => ({ confirmAction: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let config: ReturnType<typeof useShortcutsConfig>;
const reportError = vi.fn();

function Harness({ labelShortcuts = [] }: { labelShortcuts?: string[] }) {
  config = useShortcutsConfig(reportError);
  return (
    <ShortcutSettings
      shortcuts={config.shortcuts}
      labelShortcuts={labelShortcuts}
      helpDisplaySettings={DEFAULT_HELP_DISPLAY_SETTINGS}
      labelDisplaySettings={DEFAULT_LABEL_DISPLAY_SETTINGS}
      onChangeHelpDisplaySetting={vi.fn()}
      onChangeLabelDisplaySetting={vi.fn()}
      onChangeShortcut={config.updateShortcut}
      onClose={vi.fn()}
    />
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(loadShortcuts).mockResolvedValue(DEFAULT_SHORTCUTS);
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
