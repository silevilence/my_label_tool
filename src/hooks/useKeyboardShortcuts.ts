import { useEffect } from "react";
import { formatShortcut, normalizeShortcutKey } from "../components/settings/ShortcutSettings";
import { isEditableTarget } from "../lib/app-utils";
import { SHORTCUT_ACTIONS, type ShortcutMap } from "../lib/defaults/shortcuts";
import type { AnnotationShapeType, LabelConfig } from "../types/annotation";

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
  selectShapeType: (shapeType: AnnotationShapeType) => void;
  undoPolygonPoint: () => boolean;
  undo: () => void;
  zoomFromKeyboard: (delta: 1 | -1) => void;
  onShortcutConflict: (message: string) => void;
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
  selectShapeType,
  undoPolygonPoint,
  undo,
  zoomFromKeyboard,
  onShortcutConflict,
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
        notifyConfigConflict(key);
        return;
      }
      if (key === shortcuts.undoPolygonPoint && undoPolygonPoint()) {
        event.preventDefault();
        return;
      }

      const label = labels.find((item) => item.shortcut === key);
      if (label) {
        event.preventDefault();
        changeCurrentLabel(label.id);
        notifyConfigConflict(key);
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
      if (key === shortcuts.selectRectTool) {
        event.preventDefault();
        selectShapeType("rect");
        return;
      }
      if (key === shortcuts.selectPolygonTool) {
        event.preventDefault();
        selectShapeType("polygon");
        return;
      }
      if (key === shortcuts.selectPointTool) {
        event.preventDefault();
        selectShapeType("point");
        return;
      }

      function notifyConfigConflict(shortcut: string) {
        const action = SHORTCUT_ACTIONS.find((item) => shortcuts[item.id] === shortcut);
        if (action) {
          onShortcutConflict(
            `快捷键 ${formatShortcut(shortcut)} 同时绑定了「${action.label}」，已按更高优先级处理。`,
          );
        }
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
    selectShapeType,
    selectedPath,
    selectedShapeId,
    shortcuts,
    undo,
    undoPolygonPoint,
    zoomFromKeyboard,
    onShortcutConflict,
  ]);
}
