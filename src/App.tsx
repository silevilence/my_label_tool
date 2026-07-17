import { useEffect, useMemo, useRef, useState } from "react";
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
import { fitImageLayout, getInteractionMode } from "./components/canvas/geometry";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useCanvasInteractions } from "./hooks/useCanvasInteractions";
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
import { isEditableTarget } from "./lib/app-utils";
import { loadLabelConfigs, loadLabelTemplates, type ImageFile } from "./lib/tauri-api";
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
  const imageLayout = imageView;
  const {
    changeAnnotationLabel,
    clearCurrentImageAnnotations,
    completePolygon,
    confirmDeleteAnnotation,
    contextAnnotation,
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
  } = useCanvasInteractions({
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
