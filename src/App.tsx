import { useEffect, useMemo, useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import type { Transformer as KonvaTransformer } from "konva/lib/shapes/Transformer";
import { AppLayout } from "./components/AppLayout";
import { normalizeShortcutKey } from "./components/settings/ShortcutSettings";
import type {
  CanvasContextMenu,
  DrawingRect,
  ImageLayout,
  InteractionMode,
  PanState,
} from "./components/canvas/types";
import {
  annotationBounds,
  clampContextMenuPosition,
  clampPoint,
  clampRect,
  fitImageLayout,
  getImagePoint,
  getInteractionMode,
  isPointNearAnnotation,
  normalizeRectPoints,
  toCanvasRect,
} from "./components/canvas/geometry";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useExportFormatWarning } from "./hooks/useExportFormatWarning";
import { useImageNavigation } from "./hooks/useImageNavigation";
import { useLabelActions } from "./hooks/useLabelActions";
import { useLabelDisplaySettings } from "./hooks/useLabelDisplaySettings";
import { useImageLoader } from "./hooks/useImageLoader";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useOpenFolder } from "./hooks/useOpenFolder";
import { usePolygonDraft } from "./hooks/usePolygonDraft";
import { useProjectActions } from "./hooks/useProjectActions";
import { useSaveFeedback } from "./hooks/useSaveFeedback";
import { useShortcutsConfig } from "./hooks/useShortcutsConfig";
import { useShapeToolSelection } from "./hooks/useShapeToolSelection";
import { useTransientMessage } from "./hooks/useTransientMessage";
import { useZoomControls } from "./hooks/useZoomControls";
import { DEFAULT_CUSTOM_EXPORT_MAPPING } from "./lib/defaults/exports";
import { DEFAULT_LABELS, DEFAULT_LABEL_TEMPLATES } from "./lib/defaults/labels";
import { isEditableTarget, newAnnotationId } from "./lib/app-utils";
import {
  confirmAction,
  loadLabelConfigs,
  loadLabelTemplates,
  type ImageFile,
} from "./lib/tauri-api";
import { useAnnotationStore } from "./store/useAnnotationStore";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "./types/annotation";
import { isLabelCompatibleWithShape } from "./types/annotation";
import type { ExportFormatId } from "./types/export";
import type { ProjectConfig } from "./lib/importers";
import "./App.css";

function App() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const selectedImageButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedRectRef = useRef<KonvaRect | null>(null);
  const transformerRef = useRef<KonvaTransformer | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const suppressContextMenuRef = useRef(false);
  const [folderPath, setFolderPath] = useState("");
  const [images, setImages] = useState<ImageFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageView, setImageView] = useState<ImageLayout | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [annotationToDelete, setAnnotationToDelete] = useState<AnnotationShape | null>(null);
  const [drawingRect, setDrawingRect] = useState<DrawingRect | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("default");
  const [currentShapeType, setCurrentShapeType] = useState<AnnotationShape["type"]>("rect");
  const [highlightedShapeId, setHighlightedShapeId] = useState<string | null>(null);
  const [labels, setLabels] = useState<LabelConfig[]>(DEFAULT_LABELS);
  const [savedLabels, setSavedLabels] = useState<LabelConfig[]>(DEFAULT_LABELS);
  const [templates, setTemplates] = useState<LabelTemplate[]>(DEFAULT_LABEL_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_LABEL_TEMPLATES[0].id);
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [activeProjectConfigPath, setActiveProjectConfigPath] = useState("");
  const [activeProjectConfig, setActiveProjectConfig] = useState<ProjectConfig | null>(null);
  const [currentLabelId, setCurrentLabelId] = useState(DEFAULT_LABELS[0].id);
  const [isLabelDirty, setIsLabelDirty] = useState(false);
  const [selectedExportFormatId, setSelectedExportFormatId] = useState<ExportFormatId>("json");
  const [customMappingText, setCustomMappingText] = useState(
    JSON.stringify(DEFAULT_CUSTOM_EXPORT_MAPPING, null, 2),
  );
  const [isShortcutSettingsOpen, setIsShortcutSettingsOpen] = useState(false);
  const [error, setError] = useState("");

  const annotationsByImage = useAnnotationStore((state) => state.annotationsByImage);
  const selectedShapeId = useAnnotationStore((state) => state.selectedShapeId);
  const addAnnotation = useAnnotationStore((state) => state.addAnnotation);
  const updateAnnotation = useAnnotationStore((state) => state.updateAnnotation);
  const deleteAnnotation = useAnnotationStore((state) => state.deleteAnnotation);
  const clearImageAnnotations = useAnnotationStore((state) => state.clearImageAnnotations);
  const undo = useAnnotationStore((state) => state.undo);
  const redo = useAnnotationStore((state) => state.redo);
  const replaceAnnotations = useAnnotationStore((state) => state.replaceAnnotations);
  const replaceLabel = useAnnotationStore((state) => state.replaceLabel);
  const selectShape = useAnnotationStore((state) => state.selectShape);
  const canUndo = useAnnotationStore((state) => state.canUndo);
  const canRedo = useAnnotationStore((state) => state.canRedo);
  const annotations = annotationsByImage[selectedPath] ?? [];
  const selectedShape = annotations.find((annotation) => annotation.id === selectedShapeId) ?? null;
  const {
    clearPolygonDraft,
    draftPolygonPoints,
    polygonPoints,
    setPolygonCursorPoint,
    setPolygonPoints,
    undoPolygonDraftPoint,
  } = usePolygonDraft(imageView);

  const labelById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const labelShortcuts = useMemo(
    () => labels.flatMap((label) => (label.shortcut ? [normalizeShortcutKey(label.shortcut)] : [])),
    [labels],
  );
  const usedLabelIds = useMemo(
    () =>
      new Set(
        Object.values(annotationsByImage)
          .flat()
          .map((annotation) => annotation.labelId),
      ),
    [annotationsByImage],
  );
  const currentLabel = labelById.get(currentLabelId) ?? labels[0];
  const { imageLoadError, isImageLoading, loadedImage, selectedImage } = useImageLoader(
    images,
    selectedPath,
  );
  const { selectAdjacentImage, selectAdjacentUnannotatedImage } = useImageNavigation({
    annotationsByImage,
    images,
    selectedPath,
    setSelectedPath,
  });
  const { fitImageHeight, fitImageWidth, resetZoom, setImageScale, zoomAt, zoomFromKeyboard } =
    useZoomControls({
      canvasSize,
      loadedImage,
      setImageView,
    });
  const {
    checkForUpdates,
    installUpdate,
    setUpdateMessage,
    updateMessage,
    updateProgress,
    updateStatus,
  } = useAppUpdate(setError);
  const { shortcuts, updateShortcut } = useShortcutsConfig(setError);
  const {
    helpDisplaySettings,
    labelDisplaySettings,
    labelSwitchHint,
    setHelpDisplaySetting,
    setLabelDisplaySetting,
    showLabelSwitchHint,
  } = useLabelDisplaySettings(labelById);

  const {
    applyProjectTemplate,
    clearProjectTemplate,
    cancelLabelChanges,
    deleteTemplate,
    newTemplate,
    saveTemplate,
    saveTemplateAndUpdateAnnotations,
    saveTemplateAs,
    selectCurrentLabel,
    selectTemplate,
    updateLabels,
  } = useLabelActions({
    activeProjectConfig,
    activeProjectConfigPath,
    annotationsByImage,
    currentLabelId,
    isLabelDirty,
    labels,
    projectTemplateId,
    savedLabels,
    selectedPath,
    selectedShapeId,
    selectedTemplateId,
    templates,
    usedLabelIds,
    replaceLabel,
    replaceAnnotations,
    setActiveProjectConfig,
    setCurrentLabelId,
    setError,
    setIsLabelDirty,
    setLabels,
    setSavedLabels,
    setSelectedTemplateId,
    setTemplates,
    updateAnnotation,
  });

  const { message: transientMessage, showMessage } = useTransientMessage();
  const showErrorMessage = (message: string) => {
    setError("");
    showMessage(message);
  };
  const {
    createProjectFromExternalYolo,
    exportSelectedFormat,
    importAnnotations,
    maybeLoadProjectConfig,
    saveProjectExport,
  } = useProjectActions({
    activeProjectConfig,
    activeProjectConfigPath,
    annotationsByImage,
    customMappingText,
    folderPath,
    images,
    labels,
    selectedExportFormatId,
    applyProjectTemplate,
    clearProjectTemplate,
    replaceAnnotations,
    setActiveProjectConfig,
    setActiveProjectConfigPath,
    setError: showErrorMessage,
    setProjectTemplateId,
    setSelectedExportFormatId,
  });
  const { isSaving, saveWithFeedback, showSaveSuccess } = useSaveFeedback(saveProjectExport);
  const changeExportFormat = useExportFormatWarning({
    annotationsByImage,
    setSelectedExportFormatId,
    showMessage,
  });
  const { changeCurrentLabel, selectShapeType } = useShapeToolSelection({
    currentLabelId,
    labelById,
    labels,
    selectCurrentLabel,
    setCurrentShapeType,
    showLabelSwitchHint,
  });
  const openFolder = useOpenFolder({
    maybeLoadProjectConfig,
    setError,
    setFolderPath,
    setImages,
    setSelectedPath,
  });

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    const updateSize = () => {
      setCanvasSize({
        width: host.clientWidth,
        height: host.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadLabelConfigs(), loadLabelTemplates()])
      .then(([savedLabels, savedTemplates]) => {
        const nextTemplates = [
          ...DEFAULT_LABEL_TEMPLATES,
          ...savedTemplates.filter(
            (template) => !DEFAULT_LABEL_TEMPLATES.some((item) => item.id === template.id),
          ),
        ];
        const nextLabels = savedLabels.length > 0 ? savedLabels : DEFAULT_LABELS;

        if (!cancelled && savedLabels.length > 0) {
          setLabels(nextLabels);
          setSavedLabels(nextLabels);
          setCurrentLabelId(nextLabels[0].id);
        }
        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const label = labelById.get(currentLabelId);
    if (!label) {
      setCurrentLabelId(labels[0].id);
      if (labels[0].shapeType !== "any") {
        setCurrentShapeType(labels[0].shapeType);
      }
    }
  }, [currentLabelId, labelById, labels]);

  useEffect(() => {
    if (!loadedImage || canvasSize.width === 0 || canvasSize.height === 0) {
      setImageView(null);
      return;
    }

    setImageView(fitImageLayout(loadedImage, canvasSize));
  }, [canvasSize, loadedImage]);

  useEffect(() => {
    selectShape(null);
    setDrawingRect(null);
    clearPolygonDraft();
    setHighlightedShapeId(null);
  }, [clearPolygonDraft, selectShape, selectedPath]);

  useEffect(() => {
    function updateMode(event: KeyboardEvent) {
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
    setDrawingRect(null);
    setPolygonCursorPoint(null);
    if (interactionMode !== "select") {
      setHighlightedShapeId(null);
    }
  }, [interactionMode]);

  useEffect(() => {
    if (
      highlightedShapeId &&
      !annotations.some((annotation) => annotation.id === highlightedShapeId)
    ) {
      setHighlightedShapeId(null);
    }
  }, [annotations, highlightedShapeId]);

  useEffect(() => {
    selectedImageButtonRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedPath]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    transformer.nodes(
      selectedShape?.type === "rect" && selectedRectRef.current ? [selectedRectRef.current] : [],
    );
    transformer.getLayer()?.batchDraw();
  }, [selectedShape]);

  useEffect(() => {
    function finishPolygonFromKeyboard(event: KeyboardEvent) {
      if (isEditableTarget(event.target) || currentShapeType !== "polygon") {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        completePolygon();
      } else if (event.key === "Escape") {
        clearPolygonDraft();
      }
    }

    window.addEventListener("keydown", finishPolygonFromKeyboard);
    return () => window.removeEventListener("keydown", finishPolygonFromKeyboard);
  }, [clearPolygonDraft, currentShapeType, polygonPoints, selectedPath, currentLabel]);

  useKeyboardShortcuts({
    labels,
    selectedPath,
    selectedShapeId,
    shortcuts,
    changeCurrentLabel,
    deleteSelectedShape,
    redo,
    save: () => void saveWithFeedback(),
    selectAdjacentImage,
    selectShapeType,
    undoPolygonPoint,
    undo,
    zoomFromKeyboard,
    onShortcutConflict: showMessage,
  });

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
  }, [contextMenu]);

  useEffect(() => {
    if (!isPanning) {
      return;
    }

    function stopPanning() {
      panStateRef.current = null;
      setIsPanning(false);
      window.setTimeout(() => {
        suppressContextMenuRef.current = false;
      }, 250);
    }

    window.addEventListener("mouseup", stopPanning);
    return () => window.removeEventListener("mouseup", stopPanning);
  }, [isPanning]);

  const imageLayout = imageView;

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

  const draftRect =
    drawingRect && imageLayout ? toCanvasRect(normalizeRectPoints(drawingRect), imageLayout) : null;
  const contextAnnotation =
    contextMenu?.annotationId === undefined
      ? null
      : (annotations.find((annotation) => annotation.id === contextMenu.annotationId) ?? null);

  return (
    <AppLayout
      activeProjectConfig={activeProjectConfig}
      annotationToDelete={annotationToDelete}
      annotations={annotations}
      annotationsByImage={annotationsByImage}
      canRedo={canRedo}
      canUndo={canUndo}
      canvasHostRef={canvasHostRef}
      canvasSize={canvasSize}
      contextAnnotation={contextAnnotation}
      contextMenu={contextMenu}
      currentLabel={currentLabel}
      currentShapeType={currentShapeType}
      customMappingText={customMappingText}
      draftPolygonPoints={draftPolygonPoints}
      draftRect={draftRect}
      error={error}
      folderPath={folderPath}
      highlightedShapeId={highlightedShapeId}
      helpDisplaySettings={helpDisplaySettings}
      imageLayout={imageLayout}
      imageLoadError={imageLoadError}
      images={images}
      interactionMode={interactionMode}
      isImageLoading={isImageLoading}
      isLabelDirty={isLabelDirty}
      isPanning={isPanning}
      isSaving={isSaving}
      isShortcutSettingsOpen={isShortcutSettingsOpen}
      labelById={labelById}
      labelDisplaySettings={labelDisplaySettings}
      labelShortcuts={labelShortcuts}
      labelSwitchHint={labelSwitchHint}
      labels={labels}
      loadedImage={loadedImage}
      projectTemplateId={projectTemplateId}
      selectedExportFormatId={selectedExportFormatId}
      selectedImage={selectedImage}
      selectedImageButtonRef={selectedImageButtonRef}
      selectedPath={selectedPath}
      selectedRectRef={selectedRectRef}
      selectedShapeId={selectedShapeId}
      selectedTemplateId={selectedTemplateId}
      showSaveSuccess={showSaveSuccess}
      transientMessage={transientMessage}
      shortcuts={shortcuts}
      templates={templates}
      transformerRef={transformerRef}
      updateMessage={updateMessage}
      updateProgress={updateProgress}
      updateStatus={updateStatus}
      usedLabelIds={usedLabelIds}
      cancelLabelChanges={cancelLabelChanges}
      changeAnnotationLabel={changeAnnotationLabel}
      checkForUpdates={() => void checkForUpdates()}
      clearCurrentImageAnnotations={clearCurrentImageAnnotations}
      confirmDeleteAnnotation={confirmDeleteAnnotation}
      createProjectFromExternalYolo={createProjectFromExternalYolo}
      deleteContextAnnotation={deleteContextAnnotation}
      deleteTemplate={deleteTemplate}
      exportSelectedFormat={exportSelectedFormat}
      fitImageHeight={fitImageHeight}
      fitImageWidth={fitImageWidth}
      handleDragEnd={handleDragEnd}
      handleStageMouseDown={handleStageMouseDown}
      handleStageMouseMove={handleStageMouseMove}
      handleStageMouseUp={handleStageMouseUp}
      handleStageWheel={handleStageWheel}
      handlePointDragEnd={handlePointDragEnd}
      handleTransformEnd={handleTransformEnd}
      handleVertexDragEnd={handleVertexDragEnd}
      importAnnotations={importAnnotations}
      installUpdate={() => void installUpdate()}
      newTemplate={newTemplate}
      openContextMenu={openContextMenu}
      openFolder={openFolder}
      redo={redo}
      resetZoom={resetZoom}
      saveProjectExport={saveWithFeedback}
      saveTemplate={saveTemplate}
      saveTemplateAndUpdateAnnotations={saveTemplateAndUpdateAnnotations}
      saveTemplateAs={saveTemplateAs}
      selectAdjacentImage={selectAdjacentImage}
      selectAdjacentUnannotatedImage={selectAdjacentUnannotatedImage}
      selectCurrentLabel={changeCurrentLabel}
      selectShape={selectShape}
      selectShapeType={selectShapeType}
      selectTemplate={selectTemplate}
      setAnnotationToDelete={setAnnotationToDelete}
      setContextMenu={setContextMenu}
      setCustomMappingText={setCustomMappingText}
      setHelpDisplaySetting={setHelpDisplaySetting}
      setImageScale={setImageScale}
      setIsShortcutSettingsOpen={setIsShortcutSettingsOpen}
      setLabelDisplaySetting={setLabelDisplaySetting}
      setSelectedExportFormatId={changeExportFormat}
      setSelectedPath={setSelectedPath}
      setUpdateMessage={setUpdateMessage}
      startPanning={startPanning}
      undo={undo}
      updateLabels={updateLabels}
      updateShortcut={updateShortcut}
      zoomFromKeyboard={zoomFromKeyboard}
    />
  );
}

export default App;
