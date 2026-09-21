import { useEffect, type MutableRefObject } from "react";
import type { PanState } from "../components/canvas/types";

/** Mouse release outside the canvas and window focus loss must finish the same pan. */
export function usePanTermination(
  isPanning: boolean,
  panStateRef: MutableRefObject<PanState | null>,
  suppressContextMenuRef: MutableRefObject<boolean>,
  endPan: (cancelDraft: boolean) => void,
) {
  useEffect(() => {
    if (!isPanning) {
      panStateRef.current = null;
      return;
    }
    function stopPanning(event: Event) {
      const pan = panStateRef.current;
      panStateRef.current = null;
      if (pan) endPan(event.type === "mouseup" && pan.button === 1 && !pan.moved);
      window.setTimeout(() => {
        suppressContextMenuRef.current = false;
      }, 250);
    }
    window.addEventListener("mouseup", stopPanning);
    window.addEventListener("blur", stopPanning);
    return () => {
      window.removeEventListener("mouseup", stopPanning);
      window.removeEventListener("blur", stopPanning);
    };
  }, [isPanning, panStateRef, suppressContextMenuRef, endPan]);
}
