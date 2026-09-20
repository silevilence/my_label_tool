import { useEffect } from "react";
import { useShortcut } from "./useShortcut";
import { useShortcutStore } from "../store/useShortcutStore";
import { useOverlayStore } from "../store/useOverlayStore";
import { detectConflicts, eventShortcut, resolveShortcut } from "../lib/shortcuts";
import { isEditableTarget } from "../lib/app-utils";
import type { ShortcutMap } from "../lib/defaults/shortcuts";
import type { AnnotationShapeType, LabelConfig } from "../types/annotation";

interface UseKeyboardShortcutsParams {
  enabled?: boolean;
  deleteCurrentImage: () => void;
  labels: LabelConfig[];
  selectedPath: string;
  selectedShapeId: string | null;
  shortcuts: ShortcutMap;
  changeCurrentLabel: (labelId: string) => void;
  deleteSelectedShape: () => void;
  redo: () => void;
  save: () => void;
  selectAdjacentImage: (delta: number) => void;
  selectAdjacentFrame?: (delta: -1 | 1) => void;
  selectShapeType: (shapeType: AnnotationShapeType) => void;
  undoPolygonPoint: () => boolean;
  undo: () => void;
  zoomFromKeyboard: (delta: 1 | -1) => void;
  onShortcutConflict: (message: string) => void;
}

export function useKeyboardShortcuts({
  enabled = true,
  deleteCurrentImage,
  labels,
  selectedPath,
  selectedShapeId,
  shortcuts,
  changeCurrentLabel,
  deleteSelectedShape,
  redo,
  save,
  selectAdjacentImage,
  selectAdjacentFrame,
  selectShapeType,
  undoPolygonPoint,
  undo,
  zoomFromKeyboard,
  onShortcutConflict,
}: UseKeyboardShortcutsParams) {
  useShortcut("undo", undo);
  useShortcut("redo", redo);
  useShortcut("save", save);
  useShortcut("deleteShape", selectedPath && selectedShapeId ? deleteSelectedShape : undefined);
  useShortcut(
    "deleteImage",
    selectedPath
      ? (event) => {
          if (!event.repeat) deleteCurrentImage();
        }
      : undefined,
  );
  useShortcut("previousImage", selectedPath ? () => selectAdjacentImage(-1) : undefined);
  useShortcut("nextImage", selectedPath ? () => selectAdjacentImage(1) : undefined);
  useShortcut("previousFrame", selectAdjacentFrame ? () => selectAdjacentFrame(-1) : undefined);
  useShortcut("nextFrame", selectAdjacentFrame ? () => selectAdjacentFrame(1) : undefined);
  useShortcut("zoomIn", () => zoomFromKeyboard(1));
  useShortcut("zoomOut", () => zoomFromKeyboard(-1));
  useShortcut("selectRectTool", () => selectShapeType("rect"));
  useShortcut("selectPolygonTool", () => selectShapeType("polygon"));
  useShortcut("selectPointTool", () => selectShapeType("point"));
  useShortcut("undoPolygonPoint", () => {
    undoPolygonPoint();
  });
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!enabled || event.defaultPrevented) return;
      const overlay = useOverlayStore.getState();
      const handlers = useShortcutStore.getState().handlers;
      const action = resolveShortcut(event, {
        hasBlockingOverlay: overlay.hasBlocking(),
        hasLightOverlay: overlay.hasLight(),
        isEditableTarget: isEditableTarget(event.target),
        busy: false,
        mode: "default",
        shortcuts,
        labelShortcuts: labels,
        available: [...Object.keys(handlers), ...labels.map((label) => `label:${label.id}`)],
      });
      if (!action) return;
      event.preventDefault();
      const conflict = detectConflicts(shortcuts, labels).find(
        (item) => item.key === eventShortcut(event),
      );
      if (conflict) onShortcutConflict(conflict.message);
      if (action.startsWith("label:")) changeCurrentLabel(action.slice(6));
      else handlers[action]?.handler(event);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, labels, shortcuts, changeCurrentLabel, onShortcutConflict]);
}
