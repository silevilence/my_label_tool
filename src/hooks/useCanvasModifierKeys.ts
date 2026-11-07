import { useEffect } from "react";
import { useOverlayStore } from "../store/useOverlayStore";
import { useOperations } from "../store/useOperations";
import { getInteractionMode } from "../components/canvas/geometry";
import type { InteractionMode } from "../components/canvas/types";
import { isEditableTarget } from "../lib/app-utils";
import { shouldPanWithSpace } from "../lib/gestures";

export function useCanvasModifierKeys(
  setInteractionMode: (mode: InteractionMode) => void,
  setSpacePanActive: (active: boolean) => void,
) {
  useEffect(() => {
    function updateMode(event: KeyboardEvent) {
      if (event.type === "keyup" && !event.ctrlKey && !event.shiftKey) {
        setInteractionMode("default");
        return;
      }
      if (
        useOverlayStore.getState().hasBlocking() ||
        useOverlayStore.getState().hasLight() ||
        !useOperations.getState().canEditAnnotations()
      )
        return;
      setInteractionMode(getInteractionMode(event.ctrlKey, event.shiftKey));
    }

    function resetMode() {
      setInteractionMode("default");
    }

    window.addEventListener("keydown", updateMode);
    window.addEventListener("keyup", updateMode);
    window.addEventListener("blur", resetMode);
    return () => {
      window.removeEventListener("keydown", updateMode);
      window.removeEventListener("keyup", updateMode);
      window.removeEventListener("blur", resetMode);
    };
  }, []);

  useEffect(() => {
    function enablePan(event: KeyboardEvent) {
      if (
        !shouldPanWithSpace(event, {
          editableTarget: isEditableTarget(event.target),
          overlayDepth: useOverlayStore.getState().depth(),
          operationAvailable: useOperations.getState().canEditAnnotations(),
        })
      )
        return;
      event.preventDefault();
      setSpacePanActive(true);
    }

    function disablePan(event: KeyboardEvent) {
      if (event.key === " ") {
        setSpacePanActive(false);
      }
    }

    function resetPan() {
      setSpacePanActive(false);
    }

    window.addEventListener("keydown", enablePan);
    window.addEventListener("keyup", disablePan);
    window.addEventListener("blur", resetPan);
    return () => {
      window.removeEventListener("keydown", enablePan);
      window.removeEventListener("keyup", disablePan);
      window.removeEventListener("blur", resetPan);
    };
  }, []);
}
