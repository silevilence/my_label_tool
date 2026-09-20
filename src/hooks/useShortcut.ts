import { useEffect, useRef } from "react";
import { useShortcutStore } from "../store/useShortcutStore";

/** The owner mounts the behavior; absent handlers never consume keyboard input. */
export function useShortcut(id: string, handler: ((event: KeyboardEvent) => void) | undefined) {
  const latest = useRef(handler);
  latest.current = handler;
  const enabled = handler !== undefined;
  useEffect(() => {
    if (enabled)
      return useShortcutStore.getState().register(id, (event) => latest.current?.(event));
  }, [id, enabled]);
}
