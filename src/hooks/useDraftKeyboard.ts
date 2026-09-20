import { useEffect, useRef } from "react";
import { isEditableTarget } from "../lib/app-utils";
import { useOverlayStore } from "../store/useOverlayStore";
import { useOperations } from "../store/useOperations";
import type { useDraftGesture } from "./useDraftGesture";
export function useDraftKeyboard(
  gesture: ReturnType<typeof useDraftGesture>,
  completePolygon: () => void,
) {
  const latest = useRef({ gesture, completePolygon });
  latest.current = { gesture, completePolygon };
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const { gesture, completePolygon } = latest.current;
      if (
        isEditableTarget(event.target) ||
        useOverlayStore.getState().depth() > 0 ||
        !useOperations.getState().canStart("project-annotations")
      )
        return;
      if (event.key === "Escape" && gesture.state !== "idle") {
        event.preventDefault();
        gesture.cancel();
      } else if (event.key === "Enter" && gesture.state === "polygon") {
        event.preventDefault();
        completePolygon();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
}
