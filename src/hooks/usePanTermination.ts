import { useEffect, type MutableRefObject } from "react";
import type { PanState } from "../components/canvas/types";
import { PAN_MOVEMENT_THRESHOLD_PX } from "../lib/gestures";

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
      if (pan) {
        const moved =
          pan.moved ||
          (event instanceof MouseEvent &&
            Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) >=
              PAN_MOVEMENT_THRESHOLD_PX);
        endPan(event.type === "mouseup" && pan.button === 1 && !moved);
      }
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
