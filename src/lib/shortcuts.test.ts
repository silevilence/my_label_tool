import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from "./defaults/shortcuts";
import {
  detectConflicts,
  eventShortcut,
  resolveShortcut,
  shortcutKey,
  type ShortcutContext,
} from "./shortcuts";
const ctx: ShortcutContext = {
  hasBlockingOverlay: false,
  hasLightOverlay: false,
  isEditableTarget: false,
  busy: false,
  mode: "default",
  shortcuts: DEFAULT_SHORTCUTS,
  labelShortcuts: [{ id: "person", name: "人", shortcut: "1" }],
  available: [...SHORTCUT_ACTIONS.map((action) => action.id), "label:person"],
};
describe("shortcut resolution", () => {
  it("gates blocking, editable and busy contexts; light keeps global shortcuts", () => {
    expect(
      resolveShortcut({ key: "s", ctrlKey: true }, { ...ctx, hasBlockingOverlay: true }),
    ).toBeNull();
    expect(resolveShortcut({ key: "1" }, { ...ctx, isEditableTarget: true })).toBeNull();
    expect(resolveShortcut({ key: "r" }, { ...ctx, busy: true })).toBeNull();
    expect(resolveShortcut({ key: "1" }, { ...ctx, busy: true })).toBeNull();
    expect(resolveShortcut({ key: "Delete" }, { ...ctx, hasLightOverlay: true })).toBeNull();
    expect(resolveShortcut({ key: "1" }, { ...ctx, hasLightOverlay: true })).toBeNull();
    expect(resolveShortcut({ key: "s", metaKey: true }, { ...ctx, hasLightOverlay: true })).toBe(
      "save",
    );
    expect(resolveShortcut({ key: "=" }, { ...ctx, hasLightOverlay: true })).toBe("zoomIn");
  });
  it("chooses a single action by scope, priority and stable id, with labels last", () => {
    const actions = [
      {
        id: "global",
        label: "G",
        scope: "global" as const,
        rebindable: false,
        defaultKey: "1",
        priority: 200,
      },
      ...["z", "b", "a"].map((id) => ({
        id,
        label: id,
        scope: "canvas" as const,
        rebindable: false,
        defaultKey: "1",
        priority: id === "z" ? 0 : 1,
      })),
    ];
    const current = {
      ...ctx,
      actions,
      available: [...actions.map((action) => action.id), "label:person"],
    };
    expect(resolveShortcut({ key: "1" }, current)).toBe("a");
    expect(resolveShortcut({ key: "1" }, { ...current, hasLightOverlay: true })).toBe("global");
    expect(resolveShortcut({ key: "1" }, ctx)).toBe("label:person");
    expect(resolveShortcut({ key: "1" }, { ...ctx, available: [] })).toBeNull();
    expect(resolveShortcut({ key: "PageUp" }, { ...ctx, available: [] })).toBeNull();
  });
  it("reports every collision and preserves fixed bindings", () => {
    const shortcuts = { ...DEFAULT_SHORTCUTS, deleteImage: "Delete", zoomIn: "r", save: "x" };
    const conflicts = detectConflicts(shortcuts, [
      { id: "r", name: "人", shortcut: "r" },
      { id: "empty", name: "空" },
    ]);
    expect(conflicts.find((item) => item.key === "Delete")?.ids).toEqual([
      "deleteImage",
      "deleteShape",
    ]);
    expect(conflicts.find((item) => item.key === "r")?.ids).toEqual([
      "zoomIn",
      "selectRectTool",
      "label:r",
    ]);
    expect(conflicts[0].message).toContain("请修改冲突绑定");
    expect(resolveShortcut({ key: "Delete" }, { ...ctx, shortcuts })).toBe("deleteShape");
    expect(resolveShortcut({ key: "s", ctrlKey: true }, { ...ctx, shortcuts })).toBe("save");
    expect(shortcutKey(SHORTCUT_ACTIONS[0], {})).toBe("F8");
    expect(shortcutKey(SHORTCUT_ACTIONS[0], { deleteImage: "" })).toBe("");
    expect(eventShortcut({ key: "R", altKey: true })).toBe("Alt+r");
    expect(eventShortcut({ key: "Delete", shiftKey: true })).toBe("Shift+Delete");
  });
});
