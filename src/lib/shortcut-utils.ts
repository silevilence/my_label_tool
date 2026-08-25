export function normalizeShortcutKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function formatShortcut(shortcut: string): string {
  if (shortcut === " ") {
    return "Space";
  }
  if (shortcut === "\t" || shortcut === "Tab") {
    return "Tab";
  }
  if (shortcut === "ArrowLeft") {
    return "←";
  }
  if (shortcut === "ArrowRight") {
    return "→";
  }
  return shortcut.trim() ? shortcut.toUpperCase() : JSON.stringify(shortcut);
}
