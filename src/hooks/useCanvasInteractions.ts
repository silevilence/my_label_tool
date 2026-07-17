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
import type {
  CanvasContextMenu,
  DrawingRect,
  ImageLayout,
  PanState,
} from "../components/canvas/types";
import { confirmAction } from "../lib/tauri-api";
import { newAnnotationId } from "../lib/app-utils";
import {
  isLabelCompatibleWithShape,
  type AnnotationShape,
  type LabelConfig,
} from "../types/annotation";

interface UseCanvasInteractionsParams {
  annotations: AnnotationShape[];
  annotationToDelete: AnnotationShape | null;
  contextMenu: CanvasContextMenu | null;
  currentLabel: LabelConfig;
  currentShapeType: AnnotationShape["type"];
  drawingRect: DrawingRect | null;
  highlightedShapeId: string | null;
  imageLayout: ImageLayout | null;
  labelById: Map<string, LabelConfig>;
  labels: LabelConfig[];
  loadedImage: HTMLImageElement | null;
  panStateRef: MutableRefObject<PanState | null>;
  polygonPoints: number[] | null;
  selectedPath: string;
  selectedRectRef: MutableRefObject<KonvaRect | null>;
  selectedShapeId: string | null;
  suppressContextMenuRef: MutableRefObject<boolean>;
  addAnnotation: (path: string, annotation: AnnotationShape) => void;
  clearImageAnnotations: (path: string) => void;
  clearPolygonDraft: () => void;
  deleteAnnotation: (path: string, annotationId: string) => void;
  selectShape: (annotationId: string | null) => void;
  setAnnotationToDelete: (annotation: AnnotationShape | null) => void;
  setContextMenu: (contextMenu: CanvasContextMenu | null) => void;
  setDrawingRect: Dispatch<SetStateAction<DrawingRect | null>>;
  setHighlightedShapeId: Dispatch<SetStateAction<string | null>>;
  setImageView: Dispatch<SetStateAction<ImageLayout | null>>;
  setIsPanning: (isPanning: boolean) => void;
  setPolygonCursorPoint: (point: { x: number; y: number } | null) => void;
  setPolygonPoints: (points: number[] | null) => void;
  undoPolygonDraftPoint: () => boolean;
  updateAnnotation: (
    path: string,
    annotationId: string,
    patch: Partial<AnnotationShape>,
  ) => void;
  zoomAt: (pointer: { x: number; y: number }, scaleBy: number) => void;
}

export function useCanvasInteractions({
  annotations,
  annotationToDelete,
  contextMenu,
  currentLabel,
  currentShapeType,
  drawingRect,
  highlightedShapeId,
  imageLayout,
  labelById,
  labels,
  loadedImage,
  panStateRef,
  polygonPoints,
  selectedPath,
  selectedRectRef,
  selectedShapeId,
  suppressContextMenuRef,
  addAnnotation,
  clearImageAnnotations,
  clearPolygonDraft,
  deleteAnnotation,
  selectShape,
  setAnnotationToDelete,
  setContextMenu,
  setDrawingRect,
  setHighlightedShapeId,
  setImageView,
  setIsPanning,
  setPolygonCursorPoint,
  setPolygonPoints,
  undoPolygonDraftPoint,
  updateAnnotation,
  zoomAt,
}: UseCanvasInteractionsParams) {
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

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("mousedown", closeOnMouseDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnMouseDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu, setContextMenu]);

  const draftRect =
    drawingRect && imageLayout ? toCanvasRect(normalizeRectPoints(drawingRect), imageLayout) : null;

  function openContextMenu(event: KonvaEventObject<MouseEvent>, annotationId?: string) {
    event.evt.preventDefault();
    if (event.evt.ctrlKey || suppressContextMenuRef.current) {
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
      setDrawingRect(null);
      clearPolygonDraft();
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
      setDrawingRect(null);
      clearPolygonDraft();
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

    if (
      imageLayout &&
      (pointer.x < imageLayout.x ||
        pointer.y < imageLayout.y ||
        pointer.x > imageLayout.x + imageLayout.width ||
        pointer.y > imageLayout.y + imageLayout.height)
    ) {
      return;
    }

    if (getInteractionMode(event.evt.ctrlKey, event.evt.shiftKey) === "select") {
      cycleHighlightedCandidate(pointer, event.evt.deltaY > 0 ? 1 : -1);
      return;
    }

    const step = event.evt.ctrlKey ? 1.04 : 1.12;
    zoomAt(pointer, event.evt.deltaY < 0 ? step : 1 / step);
  }

  function handleStageMouseDown(event: KonvaEventObject<MouseEvent>) {
    setContextMenu(null);

    if (event.evt.button === 1) {
      event.evt.preventDefault();
      setDrawingRect(null);
      setPolygonCursorPoint(null);
      return;
    }

    if (event.evt.button === 2 && event.evt.ctrlKey) {
      startPanning(event);
      return;
    }

    if (event.evt.button !== 0) {
      return;
    }

    if (!imageLayout || !loadedImage || !selectedPath) {
      return;
    }

    const mode = getInteractionMode(event.evt.ctrlKey, event.evt.shiftKey);
    if (mode === "select") {
      const pointer = event.target.getStage()?.getPointerPosition();
      const candidates = pointer ? findAnnotationCandidatesAtPointer(pointer) : [];
      const nextId =
        highlightedShapeId && candidates.includes(highlightedShapeId)
          ? highlightedShapeId
          : (candidates[0] ?? null);
      selectShape(nextId);
      setHighlightedShapeId(nextId);
      setDrawingRect(null);
      return;
    }

    const isBackground =
      event.target === event.target.getStage() || event.target.name() === "image";
    if (mode !== "annotate" && !isBackground) {
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      selectShape(null);
      return;
    }

    selectShape(null);
    setDrawingRect(null);

    if (currentShapeType === "point") {
      addAnnotation(selectedPath, {
        id: newAnnotationId(),
        type: "point",
        labelId: currentLabel.id,
        points: [point.x, point.y],
        frameIndex: 0,
      });
      return;
    }

    if (currentShapeType === "polygon") {
      if (event.evt.detail >= 2) {
        completePolygon();
        return;
      }

      const nextPoints = [...(polygonPoints ?? []), point.x, point.y];
      setPolygonPoints(nextPoints);
      setPolygonCursorPoint(point);
      return;
    }

    setDrawingRect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  }

  function undoPolygonPoint() {
    if (currentShapeType !== "polygon" || !polygonPoints || polygonPoints.length === 0) {
      return false;
    }
    return undoPolygonDraftPoint();
  }

  function handleStageMouseMove(event: KonvaEventObject<MouseEvent>) {
    const panState = panStateRef.current;
    if (panState) {
      const deltaX = event.evt.clientX - panState.startX;
      const deltaY = event.evt.clientY - panState.startY;
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

    if (drawingRect) {
      setDrawingRect({ ...drawingRect, currentX: point.x, currentY: point.y });
    }
    if (polygonPoints) {
      setPolygonCursorPoint(point);
    }
  }

  function handleStageMouseUp() {
    if (panStateRef.current) {
      panStateRef.current = null;
      setIsPanning(false);
      return;
    }

    if (!drawingRect || !selectedPath) {
      return;
    }

    const points = normalizeRectPoints(drawingRect);
    setDrawingRect(null);

    if (points[2] < 3 || points[3] < 3) {
      return;
    }

    addAnnotation(selectedPath, {
      id: newAnnotationId(),
      type: "rect",
      labelId: currentLabel.id,
      points,
      frameIndex: 0,
    });
  }

  function completePolygon() {
    if (!selectedPath || !polygonPoints || polygonPoints.length < 6) {
      return;
    }

    addPolygon(polygonPoints);
  }

  function addPolygon(points: number[]) {
    if (!selectedPath) {
      return;
    }

    addAnnotation(selectedPath, {
      id: newAnnotationId(),
      type: "polygon",
      labelId: currentLabel.id,
      points,
      frameIndex: 0,
    });
    clearPolygonDraft();
  }

  function startPanning(event: KonvaEventObject<MouseEvent>) {
    event.evt.preventDefault();
    suppressContextMenuRef.current = true;
    if (!imageLayout) {
      return;
    }

    panStateRef.current = {
      startX: event.evt.clientX,
      startY: event.evt.clientY,
      layoutX: imageLayout.x,
      layoutY: imageLayout.y,
    };
    setDrawingRect(null);
    setIsPanning(true);
  }

  function handleDragEnd(annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) {
    if (!imageLayout || !loadedImage) {
      return;
    }

    const node = event.target;
    const [, , width, height] = annotation.points;
    const nextRect = clampRect(
      {
        x: (node.x() - imageLayout.x) / imageLayout.scale,
        y: (node.y() - imageLayout.y) / imageLayout.scale,
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
      {
        x: (event.target.x() - imageLayout.x) / imageLayout.scale,
        y: (event.target.y() - imageLayout.y) / imageLayout.scale,
      },
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
      {
        x: (event.target.x() - imageLayout.x) / imageLayout.scale,
        y: (event.target.y() - imageLayout.y) / imageLayout.scale,
      },
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
        x: (node.x() - imageLayout.x) / imageLayout.scale,
        y: (node.y() - imageLayout.y) / imageLayout.scale,
        width: (node.width() * node.scaleX()) / imageLayout.scale,
        height: (node.height() * node.scaleY()) / imageLayout.scale,
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
