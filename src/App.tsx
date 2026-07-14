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
  clamp,
  clampContextMenuPosition,
  clampRect,
  fitImageLayout,
  getImagePoint,
  getFitScale,
  getInteractionMode,
  isPointNearCanvasRect,
  normalizeRectPoints,
  toCanvasRect,
} from "./components/canvas/geometry";
import { useLabelActions } from "./hooks/useLabelActions";
import { useProjectActions } from "./hooks/useProjectActions";
import { DEFAULT_CUSTOM_EXPORT_MAPPING } from "./lib/defaults/exports";
import { DEFAULT_LABELS, DEFAULT_LABEL_TEMPLATES } from "./lib/defaults/labels";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutActionId,
  type ShortcutMap,
} from "./lib/defaults/shortcuts";
import { isEditableTarget, mergeShortcuts, newAnnotationId } from "./lib/app-utils";
import {
  imageFileSrc,
  confirmAction,
  listImageFiles,
  loadLabelConfigs,
  loadLabelTemplates,
  loadShortcuts,
  saveShortcuts,
  selectImageFolder,
  type ImageFile,
} from "./lib/tauri-api";
import { useAnnotationStore } from "./store/useAnnotationStore";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "./types/annotation";
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
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [imageLoadError, setImageLoadError] = useState("");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageView, setImageView] = useState<ImageLayout | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [annotationToDelete, setAnnotationToDelete] = useState<AnnotationShape | null>(null);
  const [drawingRect, setDrawingRect] = useState<DrawingRect | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("default");
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
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(DEFAULT_SHORTCUTS);
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

  const selectedImage = useMemo(
    () => images.find((image) => image.path === selectedPath) ?? null,
    [images, selectedPath],
  );

  const {
    applyProjectTemplate,
    cancelLabelChanges,
    currentTemplateSnapshot,
    deleteTemplate,
    newTemplate,
    saveTemplate,
    saveTemplateAs,
    selectCurrentLabel,
    selectTemplate,
    updateLabels,
  } = useLabelActions({
    activeProjectConfig,
    activeProjectConfigPath,
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

  const { exportSelectedFormat, importAnnotations, maybeLoadProjectConfig, saveProjectExport } =
    useProjectActions({
      activeProjectConfig,
      activeProjectConfigPath,
      annotationsByImage,
      customMappingText,
      folderPath,
      images,
      labels,
      selectedExportFormatId,
      applyProjectTemplate,
      currentTemplateSnapshot,
      replaceAnnotations,
      setActiveProjectConfig,
      setActiveProjectConfigPath,
      setError,
      setProjectTemplateId,
      setSelectedExportFormatId,
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
    let cancelled = false;

    loadShortcuts()
      .then((savedShortcuts) => {
        if (!cancelled) {
          setShortcuts(mergeShortcuts(savedShortcuts));
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
    if (!labelById.has(currentLabelId)) {
      setCurrentLabelId(labels[0].id);
    }
  }, [currentLabelId, labelById, labels]);

  useEffect(() => {
    if (!selectedImage) {
      setLoadedImage(null);
      setImageLoadError("");
      return;
    }

    let cancelled = false;
    const image = new Image();
    setLoadedImage(null);
    setImageLoadError("");

    image.onload = () => {
      if (!cancelled) {
        setLoadedImage(image);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setImageLoadError(`图片加载失败：${selectedImage.name}`);
      }
    };
    image.src = imageFileSrc(selectedImage.path);

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [selectedImage]);

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
    setHighlightedShapeId(null);
  }, [selectShape, selectedPath]);

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

    transformer.nodes(selectedShape && selectedRectRef.current ? [selectedRectRef.current] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedShape]);

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
      }

      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      if (key === "Delete" && selectedPath && selectedShapeId) {
        event.preventDefault();
        deleteAnnotation(selectedPath, selectedShapeId);
        setDrawingRect(null);
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
      if (!label) {
        return;
      }

      event.preventDefault();
      selectCurrentLabel(label.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    deleteAnnotation,
    images,
    imageView,
    labels,
    redo,
    selectedPath,
    selectedShapeId,
    shortcuts,
    undo,
  ]);

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

  async function openFolder() {
    setError("");

    try {
      const path = await selectImageFolder();
      if (!path) {
        return;
      }

      const nextImages = await listImageFiles(path);
      setFolderPath(path);
      setImages(nextImages);
      setSelectedPath(nextImages[0]?.path ?? "");
      await maybeLoadProjectConfig(path, nextImages);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  }

  function selectAdjacentImage(delta: number) {
    if (images.length === 0) {
      return;
    }

    const index = Math.max(
      0,
      images.findIndex((image) => image.path === selectedPath),
    );
    const nextIndex = Math.min(images.length - 1, Math.max(0, index + delta));
    if (nextIndex !== index) {
      setSelectedPath(images[nextIndex].path);
    }
  }

  function zoomFromKeyboard(delta: 1 | -1) {
    zoomAt({ x: canvasSize.width / 2, y: canvasSize.height / 2 }, delta > 0 ? 1.12 : 1 / 1.12);
  }

  function setImageScale(scale: number) {
    if (!loadedImage) {
      return;
    }

    const width = loadedImage.naturalWidth * scale;
    const height = loadedImage.naturalHeight * scale;
    setImageView({
      scale,
      width,
      height,
      x: (canvasSize.width - width) / 2,
      y: (canvasSize.height - height) / 2,
    });
  }

  function fitImageWidth() {
    if (loadedImage) {
      setImageScale(canvasSize.width / loadedImage.naturalWidth);
    }
  }

  function fitImageHeight() {
    if (loadedImage) {
      setImageScale(canvasSize.height / loadedImage.naturalHeight);
    }
  }

  function resetZoom() {
    if (loadedImage) {
      setImageView(fitImageLayout(loadedImage, canvasSize));
    }
  }

  function zoomAt(point: { x: number; y: number }, factor: number) {
    if (!loadedImage) {
      return;
    }

    setImageView((layout) => {
      if (!layout) {
        return layout;
      }

      const fitScale = getFitScale(loadedImage, canvasSize);
      const nextScale = clamp(layout.scale * factor, fitScale * 0.25, fitScale * 8);
      if (nextScale === layout.scale) {
        return layout;
      }

      const imageX = (point.x - layout.x) / layout.scale;
      const imageY = (point.y - layout.y) / layout.scale;
      return {
        scale: nextScale,
        width: loadedImage.naturalWidth * nextScale,
        height: loadedImage.naturalHeight * nextScale,
        x: point.x - imageX * nextScale,
        y: point.y - imageY * nextScale,
      };
    });
  }

  function updateShortcut(actionId: ShortcutActionId, shortcut: string) {
    const nextShortcuts = { ...shortcuts, [actionId]: shortcut };
    setShortcuts(nextShortcuts);
    saveShortcuts(nextShortcuts).catch(reportError);
  }

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
    updateAnnotation(selectedPath, annotationId, { labelId });
    setContextMenu(null);
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
    if (
      selected &&
      isPointNearCanvasRect(pointer, toCanvasRect(selected.points, imageLayout), 16)
    ) {
      return selected.id;
    }

    return annotations.find((annotation) =>
      isPointNearCanvasRect(pointer, toCanvasRect(annotation.points, imageLayout), 8),
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
        const [, , width, height] = annotation.points;
        return {
          annotation,
          area: width * height,
          index,
          rect: toCanvasRect(annotation.points, imageLayout),
        };
      })
      .filter((item) => isPointNearCanvasRect(pointer, item.rect, tolerance))
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
    setDrawingRect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
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

    if (!drawingRect || !imageLayout || !loadedImage) {
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      return;
    }

    setDrawingRect({ ...drawingRect, currentX: point.x, currentY: point.y });
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

  function reportError(caughtError: unknown) {
    setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
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
      canRedo={canRedo}
      canUndo={canUndo}
      canvasHostRef={canvasHostRef}
      canvasSize={canvasSize}
      contextAnnotation={contextAnnotation}
      contextMenu={contextMenu}
      currentLabel={currentLabel}
      customMappingText={customMappingText}
      draftRect={draftRect}
      error={error}
      folderPath={folderPath}
      highlightedShapeId={highlightedShapeId}
      imageLayout={imageLayout}
      imageLoadError={imageLoadError}
      images={images}
      interactionMode={interactionMode}
      isLabelDirty={isLabelDirty}
      isPanning={isPanning}
      isShortcutSettingsOpen={isShortcutSettingsOpen}
      labelById={labelById}
      labelShortcuts={labelShortcuts}
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
      shortcuts={shortcuts}
      templates={templates}
      transformerRef={transformerRef}
      usedLabelIds={usedLabelIds}
      cancelLabelChanges={cancelLabelChanges}
      changeAnnotationLabel={changeAnnotationLabel}
      clearCurrentImageAnnotations={clearCurrentImageAnnotations}
      confirmDeleteAnnotation={confirmDeleteAnnotation}
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
      handleTransformEnd={handleTransformEnd}
      importAnnotations={importAnnotations}
      newTemplate={newTemplate}
      openContextMenu={openContextMenu}
      openFolder={openFolder}
      redo={redo}
      resetZoom={resetZoom}
      saveProjectExport={saveProjectExport}
      saveTemplate={saveTemplate}
      saveTemplateAs={saveTemplateAs}
      selectAdjacentImage={selectAdjacentImage}
      selectCurrentLabel={selectCurrentLabel}
      selectShape={selectShape}
      selectTemplate={selectTemplate}
      setAnnotationToDelete={setAnnotationToDelete}
      setContextMenu={setContextMenu}
      setCustomMappingText={setCustomMappingText}
      setImageScale={setImageScale}
      setIsShortcutSettingsOpen={setIsShortcutSettingsOpen}
      setSelectedExportFormatId={setSelectedExportFormatId}
      setSelectedPath={setSelectedPath}
      startPanning={startPanning}
      undo={undo}
      updateLabels={updateLabels}
      updateShortcut={updateShortcut}
      zoomFromKeyboard={zoomFromKeyboard}
    />
  );
}

export default App;
