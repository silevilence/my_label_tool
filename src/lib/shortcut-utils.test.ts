import { describe, expect, it } from "vitest";
import { formatShortcut, normalizeShortcutKey } from "./shortcut-utils";

describe("shortcut utilities", () => {
  it("normalizes only single-character shortcuts", () => {
    expect(normalizeShortcutKey("Q")).toBe("q");
    expect(normalizeShortcutKey("ArrowLeft")).toBe("ArrowLeft");
  });

  it("formats named, directional, and printable shortcuts", () => {
    expect(formatShortcut(" ")).toBe("Space");
    expect(formatShortcut("\t")).toBe("Tab");
    expect(formatShortcut("Tab")).toBe("Tab");
    expect(formatShortcut("ArrowLeft")).toBe("←");
    expect(formatShortcut("ArrowRight")).toBe("→");
    expect(formatShortcut("q")).toBe("Q");
    expect(formatShortcut("\n")).toBe('"\\n"');
  });
});
