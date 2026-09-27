import { useTextReadStore } from "../store/useTextReadStore";
import { useShortcutStore } from "../store/useShortcutStore";
import { useEffect, useRef, useState } from "react";
import { mergeShortcuts } from "../lib/app-utils";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, type ShortcutMap } from "../lib/defaults/shortcuts";
import { loadShortcuts, saveShortcuts } from "../lib/tauri-api";

export function useShortcutsConfig(setError: (message: string) => void) {
  const readerRevision = useTextReadStore((state) => state.revision);
  const loadedOnce = useRef(false);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    if (loadedOnce.current) return;
    let cancelled = false;

    loadShortcuts()
      .then((savedShortcuts) => {
        if (!cancelled) {
          loadedOnce.current = true;
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
  }, [setError, readerRevision]);

  useEffect(() => useShortcutStore.getState().configure(shortcuts), [shortcuts]);

  function updateShortcut(changes: Partial<ShortcutMap>) {
    const nextShortcuts = { ...shortcuts };
    for (const action of SHORTCUT_ACTIONS) {
      const value = changes[action.id];
      if (action.rebindable && value !== undefined) nextShortcuts[action.id] = value;
    }
    if (SHORTCUT_ACTIONS.every((action) => nextShortcuts[action.id] === shortcuts[action.id]))
      return;
    setShortcuts(nextShortcuts);
    saveShortcuts(nextShortcuts).catch((caughtError: unknown) => {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    });
  }

  return { shortcuts, updateShortcut };
}
