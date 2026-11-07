import { expect, it } from "vitest";
import { isReloadShortcut, isReservedReloadBinding } from "./reload-shortcuts";
import { detectConflicts } from "./shortcuts";

it("reserves browser refresh bindings while keeping ordinary R and other shortcuts", () => {
  for (const binding of ["F5", "Shift+F5", "Ctrl+r", "Ctrl+Shift+r"])
    expect(isReservedReloadBinding(binding)).toBe(true);
  for (const binding of ["r", "Alt+r", "F2", "Ctrl+s"])
    expect(isReservedReloadBinding(binding)).toBe(false);
  expect(isReloadShortcut({ key: "r" })).toBe(false);
  expect(isReloadShortcut({ key: "R", ctrlKey: true })).toBe(true);
  expect(isReloadShortcut({ key: "r", metaKey: true })).toBe(true);
  expect(isReloadShortcut({ key: "F5" })).toBe(true);
  expect(
    detectConflicts({}, [{ id: "label", name: "标签", shortcut: "Ctrl+r" }])[0].message,
  ).toContain("保留");
});
