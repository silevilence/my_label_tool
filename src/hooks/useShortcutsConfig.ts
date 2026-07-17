import { useEffect, useState } from "react";
import { mergeShortcuts } from "../lib/app-utils";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutActionId,
  type ShortcutMap,
} from "../lib/defaults/shortcuts";
import { loadShortcuts, saveShortcuts } from "../lib/tauri-api";

export function useShortcutsConfig(setError: (message: string) => void) {
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    let cancelled = false;

    loadShortcuts()
      .then((savedShortcuts) => {
        if (!cancelled) {
          setShortcuts(mergeShortcuts(savedShortcuts));
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setError]);

  function updateShortcut(actionId: ShortcutActionId, shortcut: string) {
    const nextShortcuts = { ...shortcuts, [actionId]: shortcut };
    setShortcuts(nextShortcuts);
    saveShortcuts(nextShortcuts).catch((caughtError: unknown) => {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    });
  }

  return { shortcuts, updateShortcut };
}
