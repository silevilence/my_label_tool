import { PAN_MOVEMENT_THRESHOLD_PX, resolveGesture } from "../lib/gestures";
import { createTransform } from "../components/canvas/transform";
import type { useDraftGesture } from "./useDraftGesture";
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import {
  annotationBounds,
  clampContextMenuPosition,
  clampPoint,
  clampRect,
  getImagePoint,
  getInteractionMode,
  isPointNearAnnotation,
  normalizeRectPoints,
  toCanvasRect,
} from "../components/canvas/geometry";
import type { CanvasContextMenu, ImageLayout, PanState } from "../components/canvas/types";
import { confirmAction } from "../lib/prompts";
import { newAnnotationId } from "../lib/app-utils";
import {
  isLabelCompatibleWithShape,
  type AnnotationShape,
  type LabelConfig,
} from "../types/annotation";

export type CanvasInteractions = ReturnType<typeof useCanvasInteractions>;

export interface UseCanvasInteractionsParams {
  gesture: ReturnType<typeof useDraftGesture>;
  annotations: AnnotationShape[];
  annotationToDelete: AnnotationShape | null;
  contextMenu: CanvasContextMenu | null;
  currentLabel: LabelConfig;
  currentShapeType: AnnotationShape["type"];
  highlightedShapeId: string | null;
  imageLayout: ImageLayout | null;
  labelById: Map<string, LabelConfig>;
  labels: LabelConfig[];
  loadedImage: HTMLImageElement | null;
  panStateRef: MutableRefObject<PanState | null>;
  spacePanActive: boolean;
  selectedPath: string;
  selectedRectRef: MutableRefObject<KonvaRect | null>;
  selectedShapeId: string | null;
  suppressContextMenuRef: MutableRefObject<boolean>;
  addAnnotation: (path: string, annotation: AnnotationShape) => void;
  clearImageAnnotations: (path: string) => void;
  deleteAnnotation: (path: string, annotationId: string) => void;
  selectShape: (annotationId: string | null) => void;
  setAnnotationToDelete: (annotation: AnnotationShape | null) => void;
  setContextMenu: (contextMenu: CanvasContextMenu | null) => void;
  setHighlightedShapeId: Dispatch<SetStateAction<string | null>>;
  setImageView: Dispatch<SetStateAction<ImageLayout | null>>;
  updateAnnotation: (path: string, annotationId: string, patch: Partial<AnnotationShape>) => void;
  zoomAt: (pointer: { x: number; y: number }, scaleBy: number) => void;
}

export function useCanvasInteractions({
  gesture,
  annotations,
  annotationToDelete,
  contextMenu,
  currentLabel,
  currentShapeType,
  highlightedShapeId,
  imageLayout,
  labelById,
  labels,
  loadedImage,
  panStateRef,
  spacePanActive,
  selectedPath,
  selectedRectRef,
  selectedShapeId,
  suppressContextMenuRef,
  addAnnotation,
  clearImageAnnotations,
  deleteAnnotation,
  selectShape,
  setAnnotationToDelete,
  setContextMenu,
  setHighlightedShapeId,
  setImageView,
  updateAnnotation,
  zoomAt,
}: UseCanvasInteractionsParams) {
  const drawingRect =
    gesture.draft.kind === "rect"
      ? {
          startX: gesture.draft.start.x,
          startY: gesture.draft.start.y,
          currentX: gesture.draft.current.x,
          currentY: gesture.draft.current.y,
        }
      : null;
  useEffect(() => {
    if (
      highlightedShapeId &&
      !annotations.some((annotation) => annotation.id === highlightedShapeId)
    ) {
      setHighlightedShapeId(null);
    }
  }, [annotations, highlightedShapeId, setHighlightedShapeId]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeOnMouseDown(event: MouseEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[data-context-menu="true"]')
      ) {
        return;
      }
      setContextMenu(null);
    }

    window.addEventListener("mousedown", closeOnMouseDown);
    return () => {
      window.removeEventListener("mousedown", closeOnMouseDown);
    };
  }, [contextMenu, setContextMenu]);

  const draftRect =
    drawingRect && imageLayout ? toCanvasRect(normalizeRectPoints(drawingRect), imageLayout) : null;

  function openContextMenu(event: KonvaEventObject<MouseEvent>, annotationId?: string) {
    event.evt.preventDefault();
    if (
      resolveGesture(event.evt, {
        mode: getInteractionMode(event.evt.ctrlKey, event.evt.shiftKey),
        shapeType: currentShapeType,
        hit: Boolean(annotationId),
      }) !== "context" ||
      suppressContextMenuRef.current
    ) {
      suppressContextMenuRef.current = false;
      setContextMenu(null);
      return;
    }

    const targetAnnotationId = annotationId ?? findAnnotationAtPointer(event);
    if (targetAnnotationId) {
      selectShape(targetAnnotationId);
    }
    setContextMenu({
      ...clampContextMenuPosition(
        { x: event.evt.clientX, y: event.evt.clientY },
        Boolean(targetAnnotationId),
      ),
      annotationId: targetAnnotationId,
    });
  }

  function changeAnnotationLabel(annotationId: string, labelId: string) {
    const annotation = annotations.find((item) => item.id === annotationId);
    const label = labelById.get(labelId);
    const hasCompatibleLabels = labels.some((item) =>
      isLabelCompatibleWithShape(item, annotation?.type ?? "rect"),
    );
    if (
      !annotation ||
      !label ||
      (hasCompatibleLabels && !isLabelCompatibleWithShape(label, annotation.type))
    ) {
      return;
    }

    updateAnnotation(selectedPath, annotationId, { labelId });
    setContextMenu(null);
  }

  function deleteSelectedShape() {
    if (selectedPath && selectedShapeId) {
      deleteAnnotation(selectedPath, selectedShapeId);
      gesture.cancel();
    }
  }

  function deleteContextAnnotation(annotation: AnnotationShape) {
    setAnnotationToDelete(annotation);
    setContextMenu(null);
  }

  function confirmDeleteAnnotation() {
    if (annotationToDelete) {
      deleteAnnotation(selectedPath, annotationToDelete.id);
      setAnnotationToDelete(null);
    }
  }

  async function clearCurrentImageAnnotations() {
    if (
      selectedPath &&
      annotations.length > 0 &&
      (await confirmAction(`清空当前图片的 ${annotations.length} 个标注？可用 Ctrl+Z 撤销。`))
    ) {
      clearImageAnnotations(selectedPath);
      gesture.cancel();
      setContextMenu(null);
    }
  }

  function findAnnotationAtPointer(event: KonvaEventObject<MouseEvent>): string | undefined {
    if (!imageLayout) {
      return undefined;
    }

    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) {
      return undefined;
    }

    const selected = annotations.find((annotation) => annotation.id === selectedShapeId);
    if (selected && isPointNearAnnotation(pointer, selected, imageLayout, 16)) {
      return selected.id;
    }

    return annotations.find((annotation) =>
      isPointNearAnnotation(pointer, annotation, imageLayout, 8),
    )?.id;
  }

  function findAnnotationCandidatesAtPointer(
    pointer: { x: number; y: number },
    tolerance = 8,
  ): string[] {
    if (!imageLayout) {
      return [];
    }

    return annotations
      .map((annotation, index) => {
        const bounds = annotationBounds(annotation);
        return {
          annotation,
          area: bounds.width * bounds.height,
          index,
        };
      })
      .filter((item) => isPointNearAnnotation(pointer, item.annotation, imageLayout, tolerance))
      .sort((a, b) => a.area - b.area || b.index - a.index)
      .map((item) => item.annotation.id);
  }

  function cycleHighlightedCandidate(pointer: { x: number; y: number }, direction: 1 | -1) {
    const candidates = findAnnotationCandidatesAtPointer(pointer);
    if (candidates.length === 0) {
      setHighlightedShapeId(null);
      return;
    }

    setHighlightedShapeId((currentId) => {
      const baseId = currentId ?? selectedShapeId;
      const index = baseId ? candidates.indexOf(baseId) : -1;
      return candidates[(index + direction + candidates.length) % candidates.length];
    });
  }

  function handleStageWheel(event: KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();

    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }

    if (getInteractionMode(event.evt.ctrlKey, event.evt.shiftKey) === "select") {
      cycleHighlightedCandidate(pointer, event.evt.deltaY > 0 ? 1 : -1);
      return;
    }

    // 全画布均可缩放：锚点夹取到图片矩形内，避免图外滚动把图片甩出视野。
    const anchor = imageLayout
      ? {
          x: Math.min(Math.max(pointer.x, imageLayout.x), imageLayout.x + imageLayout.width),
          y: Math.min(Math.max(pointer.y, imageLayout.y), imageLayout.y + imageLayout.height),
        }
      : pointer;
    const step = event.evt.ctrlKey ? 1.04 : 1.12;
    zoomAt(anchor, event.evt.deltaY < 0 ? step : 1 / step);
  }

  function handleStageMouseDown(event: KonvaEventObject<MouseEvent>) {
    setContextMenu(null);

    const isBackground =
      event.target === event.target.getStage() || event.target.name() === "image";
    const intent = resolveGesture(event.evt, {
      mode: getInteractionMode(event.evt.ctrlKey, event.evt.shiftKey),
      shapeType: currentShapeType,
      hit: !isBackground,
      spacePan: spacePanActive,
    });
    if (intent === "pan") {
      startPanning(event);
      return;
    }
    if (intent === "context" || intent === null) return;
    // In default mode, shape handlers own hits and Transformer anchors retain selection.
    // Shift selection continues through the Stage picking branch below.
    if (!isBackground && getInteractionMode(event.evt.ctrlKey, event.evt.shiftKey) === "default")
      return;

    if (!imageLayout || !loadedImage || !selectedPath) {
      return;
    }

    if (intent === "select") {
      const pointer = event.target.getStage()?.getPointerPosition();
      const candidates = pointer ? findAnnotationCandidatesAtPointer(pointer) : [];
      const nextId =
        highlightedShapeId && candidates.includes(highlightedShapeId)
          ? highlightedShapeId
          : (candidates[0] ?? null);
      selectShape(nextId);
      setHighlightedShapeId(nextId);
      gesture.cancel();
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      selectShape(null);
      return;
    }

    selectShape(null);
    if (intent === "draw-polygon" && event.evt.detail >= 2) {
      completePolygon();
      return;
    }
    gesture.start(intent, point);
    if (intent === "draw-point") commitAnnotation();
  }

  function undoPolygonPoint() {
    return gesture.undoVertex();
  }

  function handleStageMouseMove(event: KonvaEventObject<MouseEvent>) {
    const panState = panStateRef.current;
    if (panState && gesture.state === "pan") {
      const deltaX = event.evt.clientX - panState.startX;
      const deltaY = event.evt.clientY - panState.startY;
      if (Math.hypot(deltaX, deltaY) >= PAN_MOVEMENT_THRESHOLD_PX) panState.moved = true;
      if (!panState.moved) return;
      setImageView((layout) =>
        layout ? { ...layout, x: panState.layoutX + deltaX, y: panState.layoutY + deltaY } : layout,
      );
      return;
    }

    if (!imageLayout || !loadedImage) {
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      return;
    }

    gesture.update(point);
  }

  function handleStageMouseUp() {
    if (gesture.state === "pan") {
      const panState = panStateRef.current;
      panStateRef.current = null;
      gesture.endPan(panState?.button === 1 && !panState.moved);
      return;
    }
    if (gesture.state === "rect") commitAnnotation();
  }

  function commitAnnotation() {
    if (!selectedPath) return;
    const result = gesture.commit();
    if (result)
      addAnnotation(selectedPath, {
        id: newAnnotationId(),
        ...result,
        labelId: currentLabel.id,
        frameIndex: 0,
      });
  }

  function completePolygon() {
    if (gesture.state === "polygon") commitAnnotation();
  }

  function startPanning(event: KonvaEventObject<MouseEvent>) {
    event.evt.preventDefault();
    if (!imageLayout) {
      return;
    }
    suppressContextMenuRef.current = true;
    panStateRef.current = {
      button: event.evt.button,
      moved: false,
      startX: event.evt.clientX,
      startY: event.evt.clientY,
      layoutX: imageLayout.x,
      layoutY: imageLayout.y,
    };
    gesture.start("pan", { x: event.evt.clientX, y: event.evt.clientY });
  }

  function handleDragEnd(annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) {
    if (!imageLayout || !loadedImage) {
      return;
    }

    const node = event.target;
    const [, , width, height] = annotation.points;
    const nextRect = clampRect(
      {
        ...createTransform(imageLayout).toImage({ x: node.x(), y: node.y() }),
        width,
        height,
      },
      loadedImage,
    );

    updateAnnotation(selectedPath, annotation.id, {
      points: [nextRect.x, nextRect.y, nextRect.width, nextRect.height],
    });
  }

  function handlePointDragEnd(annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) {
    if (!imageLayout || !loadedImage) {
      return;
    }

    const point = clampPoint(
      createTransform(imageLayout).toImage({ x: event.target.x(), y: event.target.y() }),
      loadedImage,
    );
    updateAnnotation(selectedPath, annotation.id, { points: [point.x, point.y] });
  }

  function handleVertexDragEnd(
    annotation: AnnotationShape,
    vertexIndex: number,
    event: KonvaEventObject<DragEvent>,
  ) {
    if (!imageLayout || !loadedImage) {
      return;
    }

    const point = clampPoint(
      createTransform(imageLayout).toImage({ x: event.target.x(), y: event.target.y() }),
      loadedImage,
    );
    const points = [...annotation.points];
    points[vertexIndex * 2] = point.x;
    points[vertexIndex * 2 + 1] = point.y;
    updateAnnotation(selectedPath, annotation.id, { points });
  }

  function handleTransformEnd(annotation: AnnotationShape) {
    const node = selectedRectRef.current;
    if (!node || !imageLayout || !loadedImage) {
      return;
    }

    const nextRect = clampRect(
      {
        ...createTransform(imageLayout).toImage({ x: node.x(), y: node.y() }),
        width: createTransform(imageLayout).toImageLength(node.width() * node.scaleX()),
        height: createTransform(imageLayout).toImageLength(node.height() * node.scaleY()),
      },
      loadedImage,
    );

    node.scaleX(1);
    node.scaleY(1);
    updateAnnotation(selectedPath, annotation.id, {
      points: [nextRect.x, nextRect.y, nextRect.width, nextRect.height],
    });
  }

  return {
    changeAnnotationLabel,
    clearCurrentImageAnnotations,
    confirmDeleteAnnotation,
    contextAnnotation:
      contextMenu?.annotationId === undefined
        ? null
        : (annotations.find((annotation) => annotation.id === contextMenu.annotationId) ?? null),
    deleteContextAnnotation,
    deleteSelectedShape,
    draftRect,
    handleDragEnd,
    handlePointDragEnd,
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
    handleStageWheel,
    handleTransformEnd,
    handleVertexDragEnd,
    openContextMenu,
    startPanning,
    undoPolygonPoint,
    completePolygon,
  };
}
