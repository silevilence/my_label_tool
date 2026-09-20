import { useVideoFrameNavigation } from "./hooks/useVideoFrameNavigation";
import { useDraftKeyboard } from "./hooks/useDraftKeyboard";
import { useScopeEscape } from "./hooks/useScopeEscape";
import { PromptHost } from "./components/overlay/PromptHost";
import { useOperations } from "./store/useOperations";
import { useOverlayStore } from "./store/useOverlayStore";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import type { Transformer as KonvaTransformer } from "konva/lib/shapes/Transformer";
import { AppLayout } from "./components/AppLayout";
import type { ProjectVideo } from "./types/video";
import { projectVideos, videoForImage } from "./lib/project-media";
import { ProjectVideoDialogs } from "./components/video/ProjectVideoDialogs";
import { VideoTimeline } from "./components/video/VideoTimeline";
import {
  VideoInterpolationPanel,
  type InterpolationPreview,
} from "./components/video/VideoInterpolationPanel";
import { useProjectVideoActions } from "./hooks/useProjectVideoActions";
import { VIDEO_ZH_CN as videoText } from "./i18n/video.zh-CN";
import { DeleteImageDialog } from "./components/DeleteImageDialog";
import { useImageDeletion } from "./hooks/useImageDeletion";
import { normalizeShortcutKey } from "./lib/shortcut-utils";
import type {
  CanvasContextMenu,
  ImageLayout,
  InteractionMode,
  PanState,
} from "./components/canvas/types";
import { fitImageLayout, getInteractionMode, toCanvasPoints } from "./components/canvas/geometry";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useCanvasInteractions } from "./hooks/useCanvasInteractions";
import { useExportFormatWarning } from "./hooks/useExportFormatWarning";
import { useImageNavigation } from "./hooks/useImageNavigation";
import { useLabelActions } from "./hooks/useLabelActions";
import { useLabelDisplaySettings } from "./hooks/useLabelDisplaySettings";
import { useImageLoader } from "./hooks/useImageLoader";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useOpenFolder } from "./hooks/useOpenFolder";
import { useDraftGesture } from "./hooks/useDraftGesture";
import { useProjectActions } from "./hooks/useProjectActions";
import { useSaveFeedback } from "./hooks/useSaveFeedback";
import { useShortcutsConfig } from "./hooks/useShortcutsConfig";
import { useShapeToolSelection } from "./hooks/useShapeToolSelection";
import { useTransientMessage } from "./hooks/useTransientMessage";
import { useProjectSettings } from "./hooks/useProjectSettings";
import { ProjectSettingsDialog } from "./components/settings/ProjectSettingsDialog";
import { useZoomControls } from "./hooks/useZoomControls";
import { usePrelabelModels } from "./hooks/usePrelabelModels";
import { usePrelabelExecution } from "./hooks/usePrelabelExecution";
import { DEFAULT_CUSTOM_EXPORT_MAPPING } from "./lib/defaults/exports";
import { DEFAULT_LABELS, DEFAULT_LABEL_TEMPLATES } from "./lib/defaults/labels";
import { saveProjectConfig, isEditableTarget } from "./lib/app-utils";
import { shouldPanWithSpace } from "./lib/gestures";
import {
  loadLabelConfigs,
  loadLabelTemplates,
  loadPluginLabelPresets,
  loadPluginExportFormats,
  loadPluginPrelabelSources,
} from "./lib/tauri-api";
import {
  getSelectedPluginPresetRefreshImpact,
  mergePluginLabelPresets,
} from "./lib/plugin-label-presets";
import { useAnnotationStore } from "./store/useAnnotationStore";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "./types/annotation";
import type { ExportFormatId } from "./types/export";
import type { ProjectConfig } from "./lib/importers";
import type { PrelabelClassMapping } from "./types/prelabel";
import { PRELABEL_ZH_CN as prelabelText } from "./i18n/prelabel.zh-CN";
import { PLUGIN_ZH_CN as pluginText } from "./i18n/plugin.zh-CN";
import type {
  PluginExportFormatDescriptor,
  PluginLabelPreset,
  PluginPrelabelSourceDescriptor,
} from "./types/plugin";
import { updateProjectPrelabelMappings } from "./lib/prelabel-mapping";
import "./App.css";

function App() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const selectedRectRef = useRef<KonvaRect | null>(null);
  const transformerRef = useRef<KonvaTransformer | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const suppressContextMenuRef = useRef(false);
  const [folderPath, setFolderPath] = useState("");
  const [videoEntries, setVideoEntries] = useState<ProjectVideo[]>([]);
  const [interpolationPreview, setInterpolationPreview] = useState<InterpolationPreview | null>(
    null,
  );
  const images = useAnnotationStore((state) => state.images);
  const setImages = useAnnotationStore((state) => state.setImages);
  const selectedPath = useAnnotationStore((state) => state.selectedPath);
  const setSelectedPath = useAnnotationStore((state) => state.select);
  const videos = useMemo(() => projectVideos(folderPath, videoEntries), [folderPath, videoEntries]);
  const selectedVideo = videoForImage(videos, selectedPath);
  const video = selectedVideo?.scopedVideo ?? null;
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageView, setImageView] = useState<ImageLayout | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const gesture = useDraftGesture();
  const isPanning = gesture.state === "pan";
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [annotationToDelete, setAnnotationToDelete] = useState<AnnotationShape | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("default");
  const [currentShapeType, setCurrentShapeType] = useState<AnnotationShape["type"]>("rect");
  const [highlightedShapeId, setHighlightedShapeId] = useState<string | null>(null);
  const [labels, setLabels] = useState<LabelConfig[]>(DEFAULT_LABELS);
  const [savedLabels, setSavedLabels] = useState<LabelConfig[]>(DEFAULT_LABELS);
  const [templates, setTemplates] = useState<LabelTemplate[]>(DEFAULT_LABEL_TEMPLATES);
  const [pluginTemplateIds, setPluginTemplateIds] = useState<Set<string>>(new Set());
  const [pluginTemplateSources, setPluginTemplateSources] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const pluginTemplateIdsRef = useRef<ReadonlySet<string>>(new Set());
  const pluginPresetsRef = useRef<PluginLabelPreset[]>([]);
  const [pluginExportFormats, setPluginExportFormats] = useState<PluginExportFormatDescriptor[]>(
    [],
  );
  const [pluginPrelabelSources, setPluginPrelabelSources] = useState<
    PluginPrelabelSourceDescriptor[]
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_LABEL_TEMPLATES[0].id);
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [activeProjectConfigPath, setActiveProjectConfigPath] = useState("");
  const [activeProjectConfig, setActiveProjectConfigState] = useState<ProjectConfig | null>(null);
  const activeProjectConfigRef = useRef<ProjectConfig | null>(null);
  const setActiveProjectConfig = useCallback((nextConfig: SetStateAction<ProjectConfig | null>) => {
    if (typeof nextConfig === "function") {
      setActiveProjectConfigState((current) => {
        const resolved = nextConfig(current);
        activeProjectConfigRef.current = resolved;
        return resolved;
      });
      return;
    }

    activeProjectConfigRef.current = nextConfig;
    setActiveProjectConfigState(nextConfig);
  }, []);
  const projectSettings = useProjectSettings(
    folderPath,
    activeProjectConfig,
    activeProjectConfigPath,
    setActiveProjectConfig,
  );
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const [currentLabelId, setCurrentLabelId] = useState(DEFAULT_LABELS[0].id);
  const [isLabelDirty, setIsLabelDirty] = useState(false);
  const [selectedExportFormatId, setSelectedExportFormatId] = useState<ExportFormatId>("json");
  const [customMappingText, setCustomMappingText] = useState(
    JSON.stringify(DEFAULT_CUSTOM_EXPORT_MAPPING, null, 2),
  );
  const [isShortcutSettingsOpen, setIsShortcutSettingsOpen] = useState(false);
  const [isPrelabelSettingsOpen, setIsPrelabelSettingsOpen] = useState(false);
  const [isPrelabelExecutionOpen, setIsPrelabelExecutionOpen] = useState(false);
  // 画布插值等非操作警告：保留 5 秒可关闭条（既有语义）；各 hook 的操作错误统一走操作卡片。
  const { message: error, showMessage: setCanvasWarning } = useTransientMessage(5000);
  const setError = useCallback((message: string) => {
    useOperations.getState().pushError("操作失败", message);
  }, []);

  const prelabelModels = usePrelabelModels(setError);

  const annotationsByImage = useAnnotationStore((state) => state.annotationsByImage);
  const frameNavigation = useVideoFrameNavigation(video, selectedVideo?.images ?? [], selectedPath);
  const selectedShapeId = useAnnotationStore((state) => state.selectedShapeId);
  const addAnnotation = useAnnotationStore((state) => state.addAnnotation);
  const updateAnnotation = useAnnotationStore((state) => state.updateAnnotation);
  const deleteAnnotation = useAnnotationStore((state) => state.deleteAnnotation);
  const clearImageAnnotations = useAnnotationStore((state) => state.clearImageAnnotations);
  const undo = useAnnotationStore((state) => state.undo);
  const redo = useAnnotationStore((state) => state.redo);
  const replaceAnnotations = useAnnotationStore((state) => state.replaceAnnotations);
  const insertAnnotationsBatch = useAnnotationStore((state) => state.insertAnnotationsBatch);
  const replaceLabel = useAnnotationStore((state) => state.replaceLabel);
  const selectShape = useAnnotationStore((state) => state.selectShape);
  const canUndo = useAnnotationStore((state) => state.canUndo);
  const canRedo = useAnnotationStore((state) => state.canRedo);
  const annotations = annotationsByImage[selectedPath] ?? [];
  const selectedShape = annotations.find((annotation) => annotation.id === selectedShapeId) ?? null;
  const polygonPoints = gesture.draft.kind === "polygon" ? gesture.draft.points : null;
  const polygonCursor = gesture.draft.kind === "polygon" ? gesture.draft.cursor : null;
  const draftPolygonPoints =
    polygonPoints && imageView
      ? toCanvasPoints(
          polygonCursor ? [...polygonPoints, polygonCursor.x, polygonCursor.y] : polygonPoints,
          imageView,
        )
      : null;
  const cancelDraft = gesture.cancel;
  const interruptDraft = gesture.interrupt;

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
  const refreshPluginLabelPresets = useCallback(async () => {
    const [snapshot, exportSnapshot, prelabelSnapshot] = await Promise.all([
      loadPluginLabelPresets(),
      loadPluginExportFormats(),
      loadPluginPrelabelSources(folderPath || null),
    ]);
    setPluginExportFormats(exportSnapshot.formats);
    setPluginPrelabelSources(prelabelSnapshot.sources);
    if (
      selectedExportFormatId.startsWith("plugin:") &&
      !exportSnapshot.formats.some((format) => format.selectionId === selectedExportFormatId)
    ) {
      setSelectedExportFormatId("json");
    }
    const previousPresets = pluginPresetsRef.current;
    const selectedPresetImpact = getSelectedPluginPresetRefreshImpact(
      previousPresets,
      snapshot.presets,
      selectedTemplateId,
    );
    const merged = mergePluginLabelPresets(
      withActiveProjectTemplate(templates, activeProjectConfigRef.current),
      pluginTemplateIdsRef.current,
      snapshot.presets,
    );
    pluginTemplateIdsRef.current = merged.pluginTemplateIds;
    setPluginTemplateIds(merged.pluginTemplateIds);
    setPluginTemplateSources(merged.sourceByTemplateId);
    setTemplates(merged.templates);
    pluginPresetsRef.current = snapshot.presets;

    if (selectedPresetImpact === "removed") {
      setSelectedTemplateId(DEFAULT_LABEL_TEMPLATES[0].id);
      setIsLabelDirty(true);
    } else if (selectedPresetImpact === "updated") {
      setIsLabelDirty(true);
    }
    const messages = [
      snapshot.warning,
      exportSnapshot.warning,
      prelabelSnapshot.warning,
      merged.collisions.length > 0 ? pluginText.labelPresetCollision(merged.collisions) : null,
    ].filter((message): message is string => Boolean(message));
    if (messages.length > 0) setError(messages.join("；"));
  }, [folderPath, selectedExportFormatId, selectedTemplateId, templates]);
  const currentLabel = labelById.get(currentLabelId) ?? labels[0];
  const { imageLoadError, isImageLoading, loadedImage, selectedImage } = useImageLoader(
    images,
    selectedPath,
  );
  const { selectAdjacentImage, selectAdjacentUnannotatedImage } = useImageNavigation();
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

  const { message: transientMessage, showMessage } = useTransientMessage();
  useScopeEscape();
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
    readOnlyTemplateIds: pluginTemplateIds,
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
    showMessage,
    setLabels,
    setSavedLabels,
    setSelectedTemplateId,
    setTemplates,
    updateAnnotation,
  });

  const {
    cancelActivePluginExport,
    createProjectFromExternalYolo,
    exportSelectedFormat,
    exportError,
    importAnnotations,
    maybeLoadProjectConfig,
    pluginExportProgress,
    retryPluginConfigMigrations,
    saveProjectExport,
  } = useProjectActions({
    videos,
    activeProjectConfig,
    activeProjectConfigPath,
    annotationsByImage,
    customMappingText,
    folderPath,
    images,
    labels,
    selectedExportFormatId,
    pluginExportFormats,
    refreshPluginExtensions: refreshPluginLabelPresets,
    applyProjectTemplate,
    clearProjectTemplate,
    replaceAnnotations,
    setActiveProjectConfig,
    setActiveProjectConfigPath,
    setError,
    showMessage,
    setProjectTemplateId,
    setSelectedExportFormatId,
  });
  const { isSaving, saveWithFeedback, showSaveSuccess } = useSaveFeedback(saveProjectExport);
  const prelabelExecution = usePrelabelExecution({
    activeProjectConfig,
    annotationsByImage,
    images,
    labels,
    library: prelabelModels.library,
    pluginSources: pluginPrelabelSources,
    projectFolder: folderPath,
    refreshPluginSources: refreshPluginLabelPresets,
    selectedPath,
    insertAnnotationsBatch,
    setError,
  });

  const imageDeletionBusy = useOperations(
    (state) => !state.canStart(["project-annotations", "export-dir", "video-frames"]),
  );
  const imageDeletion = useImageDeletion({
    folderPath,
    busy: imageDeletionBusy,
    setError,
  });
  function requestDeleteImage(path: string) {
    if (videoForImage(videos, path)) {
      setError(videoText.deleteDisabled);
      return;
    }
    setContextMenu(null);
    imageDeletion.request(path);
  }

  async function savePrelabelMappings(
    modelId: string,
    mappings: PrelabelClassMapping[],
    nextLabels: LabelConfig[],
  ) {
    if (!activeProjectConfig || !activeProjectConfigPath) {
      throw new Error(prelabelText.mappingSaveNeedsProject);
    }
    if (isLabelDirty) {
      throw new Error(prelabelText.mappingSaveDirtyLabels);
    }
    const nextConfig = updateProjectPrelabelMappings(
      activeProjectConfig,
      modelId,
      mappings,
      nextLabels,
    );
    await saveProjectConfig(activeProjectConfigPath, nextConfig);
    setActiveProjectConfig(nextConfig);
    applyProjectTemplate(nextConfig.template, nextLabels);
  }
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
    setProjectVideos: setVideoEntries,
    maybeLoadProjectConfig,
    setError,
    setFolderPath,
    setImages,
    setSelectedPath,
  });
  const videoImport = useProjectVideoActions({
    folderPath,
    entries: videoEntries,
    blocked: imageDeletionBusy,
    images,
    setEntries: setVideoEntries,
    setImages,
    setSelectedPath,
    setError,
    openFolder,
  });
  const { addVideo } = videoImport;
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
    highlightedShapeId,
    imageLayout,
    labelById,
    labels,
    loadedImage,
    panStateRef,
    spacePanActive,
    gesture,
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

    Promise.all([
      loadLabelConfigs(),
      loadLabelTemplates(),
      loadPluginLabelPresets(),
      loadPluginExportFormats(),
    ])
      .then(([savedLabels, savedTemplates, pluginSnapshot, exportSnapshot]) => {
        const currentProject = activeProjectConfigRef.current;
        const baseTemplates = [
          ...DEFAULT_LABEL_TEMPLATES,
          ...savedTemplates.filter(
            (template) => !DEFAULT_LABEL_TEMPLATES.some((item) => item.id === template.id),
          ),
        ];
        const merged = mergePluginLabelPresets(
          withActiveProjectTemplate(baseTemplates, currentProject),
          new Set(),
          pluginSnapshot.presets,
        );
        const nextLabels = savedLabels.length > 0 ? savedLabels : DEFAULT_LABELS;

        if (!cancelled && !currentProject && savedLabels.length > 0) {
          setLabels(nextLabels);
          setSavedLabels(nextLabels);
          setCurrentLabelId(nextLabels[0].id);
        }
        if (!cancelled) {
          pluginPresetsRef.current = pluginSnapshot.presets;
          pluginTemplateIdsRef.current = merged.pluginTemplateIds;
          setPluginTemplateIds(merged.pluginTemplateIds);
          setPluginTemplateSources(merged.sourceByTemplateId);
          setPluginExportFormats(exportSnapshot.formats);
          setTemplates(merged.templates);
          const messages = [
            pluginSnapshot.warning,
            exportSnapshot.warning,
            merged.collisions.length > 0
              ? pluginText.labelPresetCollision(merged.collisions)
              : null,
          ].filter((message): message is string => Boolean(message));
          if (messages.length > 0) setError(messages.join("；"));
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
    loadPluginPrelabelSources(folderPath || null)
      .then((snapshot) => {
        if (!cancelled) {
          setPluginPrelabelSources(snapshot.sources);
          if (snapshot.warning) setError(snapshot.warning);
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
  }, [folderPath]);

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
    setImageView(null);
  }, [loadedImage]);

  useEffect(() => {
    if (!loadedImage || canvasSize.width === 0 || canvasSize.height === 0) return;
    // Fit each newly loaded image once, including when its host is measured later.
    // Status cards and window resizing must preserve an existing zoom/pan view.
    setImageView((current) => current ?? fitImageLayout(loadedImage, canvasSize));
  }, [canvasSize, loadedImage]);

  useEffect(() => {
    selectShape(null);
    cancelDraft();
    setHighlightedShapeId(null);
  }, [cancelDraft, selectShape, selectedPath]);

  useEffect(() => {
    function updateMode(event: KeyboardEvent) {
      if (event.type === "keyup" && !event.ctrlKey && !event.shiftKey) {
        setInteractionMode("default");
        return;
      }
      if (
        useOverlayStore.getState().hasBlocking() ||
        useOverlayStore.getState().hasLight() ||
        !useOperations.getState().canStart("project-annotations")
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
          operationAvailable: useOperations.getState().canStart("project-annotations"),
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

  useEffect(() => {
    interruptDraft();
    if (interactionMode !== "select") {
      setHighlightedShapeId(null);
    }
  }, [interactionMode, interruptDraft]);

  useEffect(() => cancelDraft(), [currentShapeType, cancelDraft]);

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

  useDraftKeyboard(gesture, completePolygon);

  useKeyboardShortcuts({
    selectAdjacentFrame: selectedVideo ? frameNavigation.step : undefined,
    deleteCurrentImage: () => requestDeleteImage(selectedPath),
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
    undoPolygonPoint: gesture.state === "polygon" ? undoPolygonPoint : undefined,
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
      cancelDraft();
      window.setTimeout(() => {
        suppressContextMenuRef.current = false;
      }, 250);
    }

    window.addEventListener("mouseup", stopPanning);
    return () => window.removeEventListener("mouseup", stopPanning);
  }, [isPanning, cancelDraft]);

  return (
    <>
      <AppLayout
        reextractVideo={
          !projectSettings.loading
            ? (source) =>
                videoImport.requestReextract(source, projectSettings.settings.videoExtraction)
            : undefined
        }
        projectSettings={
          isProjectSettingsOpen &&
          activeProjectConfig && (
            <ProjectSettingsDialog
              folder={folderPath}
              model={projectSettings}
              pendingCount={videos.filter((asset) => !asset.video).length}
              onClose={() => setIsProjectSettingsOpen(false)}
              onBatch={
                !imageDeletionBusy && videos.some((asset) => !asset.video)
                  ? () => {
                      setIsProjectSettingsOpen(false);
                      void videoImport.startBatch(
                        projectSettings.settings.videoExtraction,
                        folderPath,
                        videos.filter((asset) => !asset.video).map((asset) => asset.sourcePath),
                      );
                    }
                  : undefined
              }
            />
          )
        }
        interpolationShape={
          interpolationPreview?.source === annotationsByImage &&
          interpolationPreview.video === video
            ? (interpolationPreview.plan.entries.find((entry) => entry.imagePath === selectedPath)
                ?.generated ?? null)
            : null
        }
        error={error}
        onDismissError={() => setCanvasWarning("")}
        openProjectSettings={
          activeProjectConfig && activeProjectConfigPath && !imageDeletionBusy
            ? () => setIsProjectSettingsOpen(true)
            : undefined
        }
        videos={videos}
        addVideo={(source) => {
          if (!imageDeletionBusy && !imageDeletion.target) void addVideo(source);
        }}
        canvasFooter={
          <>
            {video && (
              <VideoTimeline
                frames={frameNavigation.frames}
                currentIndex={frameNavigation.currentIndex}
                totalFrames={video.totalFrames}
                disabled={imageDeletionBusy}
                onSelectFrame={frameNavigation.select}
              />
            )}
            {video && (
              <VideoInterpolationPanel
                key={selectedVideo?.sourcePath}
                video={video}
                images={selectedVideo?.images ?? []}
                selectedPath={selectedPath}
                selectedShape={selectedShape}
                disabled={imageDeletionBusy}
                onSelect={frameNavigation.select}
                onError={setCanvasWarning}
                onPreviewChange={setInterpolationPreview}
              />
            )}
          </>
        }
        canDeleteImage={!imageDeletionBusy && !imageDeletion.target}
        requestDeleteImage={requestDeleteImage}
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
        spacePanActive={spacePanActive}
        isSaving={isSaving}
        isShortcutSettingsOpen={isShortcutSettingsOpen}
        isPrelabelSettingsOpen={isPrelabelSettingsOpen}
        isPrelabelExecutionOpen={isPrelabelExecutionOpen}
        labelById={labelById}
        labelDisplaySettings={labelDisplaySettings}
        labelShortcuts={labelShortcuts}
        labelSwitchHint={labelSwitchHint}
        labels={labels}
        loadedImage={loadedImage}
        projectTemplateId={projectTemplateId}
        selectedExportFormatId={selectedExportFormatId}
        selectedImage={selectedImage}
        selectedPath={selectedPath}
        selectedRectRef={selectedRectRef}
        selectedShapeId={selectedShapeId}
        selectedTemplateId={selectedTemplateId}
        showSaveSuccess={showSaveSuccess}
        transientMessage={transientMessage}
        shortcuts={shortcuts}
        templates={templates}
        pluginExportFormats={pluginExportFormats}
        pluginPrelabelSources={pluginPrelabelSources}
        pluginExportProgress={pluginExportProgress}
        pluginTemplateIds={pluginTemplateIds}
        pluginTemplateSources={pluginTemplateSources}
        transformerRef={transformerRef}
        updateMessage={updateMessage}
        updateProgress={updateProgress}
        updateStatus={updateStatus}
        usedLabelIds={usedLabelIds}
        cancelLabelChanges={cancelLabelChanges}
        cancelPluginExport={() => void cancelActivePluginExport()}
        changeAnnotationLabel={changeAnnotationLabel}
        checkForUpdates={() => void checkForUpdates()}
        clearCurrentImageAnnotations={clearCurrentImageAnnotations}
        confirmDeleteAnnotation={confirmDeleteAnnotation}
        createProjectFromExternalYolo={createProjectFromExternalYolo}
        deleteContextAnnotation={deleteContextAnnotation}
        deleteTemplate={deleteTemplate}
        exportSelectedFormat={exportSelectedFormat}
        exportError={exportError}
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
        openFolder={() => {
          if (
            useOperations.getState().canStart(["project-annotations", "export-dir", "video-frames"])
          )
            void openFolder();
        }}
        redo={redo}
        retryPluginConfigMigrations={retryPluginConfigMigrations}
        refreshPluginLabelPresets={refreshPluginLabelPresets}
        resetZoom={resetZoom}
        saveProjectExport={saveWithFeedback}
        savePrelabelMappings={savePrelabelMappings}
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
        setIsPrelabelSettingsOpen={setIsPrelabelSettingsOpen}
        setIsPrelabelExecutionOpen={setIsPrelabelExecutionOpen}
        prelabelModels={prelabelModels}
        prelabelExecution={prelabelExecution}
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
      <ProjectVideoDialogs actions={videoImport} settings={projectSettings} folder={folderPath} />
      <PromptHost />
      {imageDeletion.target && (
        <DeleteImageDialog
          target={imageDeletion.target}
          annotationCount={annotationsByImage[imageDeletion.target.image.path]?.length ?? 0}
          isDeleting={imageDeletion.isDeleting}
          error={imageDeletion.error}
          onCancel={imageDeletion.cancel}
          onConfirm={() => void imageDeletion.confirm()}
        />
      )}
    </>
  );
}

export default App;

function withActiveProjectTemplate(
  templates: LabelTemplate[],
  projectConfig: ProjectConfig | null,
): LabelTemplate[] {
  if (!projectConfig) {
    return templates;
  }

  const projectTemplate = {
    ...projectConfig.template,
    labels: projectConfig.labels,
  };
  return [...templates.filter((template) => template.id !== projectTemplate.id), projectTemplate];
}
