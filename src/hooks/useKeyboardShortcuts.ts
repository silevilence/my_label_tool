import { useEffect } from "react";
import { normalizeShortcutKey } from "../components/settings/ShortcutSettings";
import { isEditableTarget } from "../lib/app-utils";
import type { ShortcutMap } from "../lib/defaults/shortcuts";
import type { LabelConfig } from "../types/annotation";

interface UseKeyboardShortcutsParams {
  labels: LabelConfig[];
  selectedPath: string;
  selectedShapeId: string | null;
  shortcuts: ShortcutMap;
  changeCurrentLabel: (labelId: string) => void;
  deleteSelectedShape: () => void;
  redo: () => void;
  save: () => void;
  selectAdjacentImage: (delta: number) => void;
  undo: () => void;
  zoomFromKeyboard: (delta: 1 | -1) => void;
}

export function useKeyboardShortcuts({
  labels,
  selectedPath,
  selectedShapeId,
  shortcuts,
  changeCurrentLabel,
  deleteSelectedShape,
  redo,
  save,
  selectAdjacentImage,
  undo,
  zoomFromKeyboard,
}: UseKeyboardShortcutsParams) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = normalizeShortcutKey(event.key);
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (key === "z") {
          event.preventDefault();
          undo();
          return;
        }
        if (key === "y") {
          event.preventDefault();
          redo();
          return;
        }
        if (key === "s") {
          event.preventDefault();
          save();
          return;
        }
      }

      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      if (key === "Delete" && selectedPath && selectedShapeId) {
        event.preventDefault();
        deleteSelectedShape();
        return;
      }

      if (key === shortcuts.previousImage) {
        event.preventDefault();
        selectAdjacentImage(-1);
        return;
      }
      if (key === shortcuts.nextImage) {
        event.preventDefault();
        selectAdjacentImage(1);
        return;
      }
      if (key === shortcuts.zoomIn) {
        event.preventDefault();
        zoomFromKeyboard(1);
        return;
      }
      if (key === shortcuts.zoomOut) {
        event.preventDefault();
        zoomFromKeyboard(-1);
        return;
      }

      const label = labels.find((item) => item.shortcut === key);
      if (label) {
        event.preventDefault();
        changeCurrentLabel(label.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    changeCurrentLabel,
    deleteSelectedShape,
    labels,
    redo,
    save,
    selectAdjacentImage,
    selectedPath,
    selectedShapeId,
    shortcuts,
    undo,
    zoomFromKeyboard,
  ]);
}
