import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import type { Transformer as KonvaTransformer } from "konva/lib/shapes/Transformer";
import { ExportPanel } from "./settings/ExportPanel";
import { LabelSettings } from "./settings/LabelSettings";
import { ShortcutSettings } from "./settings/ShortcutSettings";
import {
  AnnotationRect,
  CanvasContextMenu,
  DeleteAnnotationDialog,
  LabelShortcutOverlay,
  ModeHelpOverlay,
  type OverlayCorner,
} from "./canvas/CanvasChrome";
import { ImageSearchDialog } from "./sidebar/ImageSearchDialog";
import {
  isLargeImage,
  isPointNearCanvasRect,
  toCanvasRect,
  type CanvasRect,
} from "./canvas/geometry";
import type { CanvasContextMenu as CanvasContextMenuState, ImageLayout } from "./canvas/types";
import type { InteractionMode } from "./canvas/types";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "../types/annotation";
import type { ExportFormatId } from "../types/export";
import type { ProjectConfig } from "../lib/importers";
import type { ImageFile } from "../lib/tauri-api";
import type { ShortcutActionId, ShortcutMap } from "../lib/defaults/shortcuts";
import type { HelpDisplaySettings, LabelDisplaySettings } from "../lib/defaults/display";
import type { AppUpdateProgress, AppUpdateStatus } from "../lib/updater";
import { isEditableTarget, isUserTemplate } from "../lib/app-utils";

interface AppLayoutProps {
  activeProjectConfig: ProjectConfig | null;
  annotationToDelete: AnnotationShape | null;
  annotations: AnnotationShape[];
  annotationsByImage: Record<string, AnnotationShape[]>;
  canRedo: boolean;
  canUndo: boolean;
  canvasHostRef: MutableRefObject<HTMLDivElement | null>;
  canvasSize: { width: number; height: number };
  contextAnnotation: AnnotationShape | null;
  contextMenu: CanvasContextMenuState | null;
  currentLabel: LabelConfig;
  customMappingText: string;
  draftRect: CanvasRect | null;
  error: string;
  folderPath: string;
  highlightedShapeId: string | null;
  helpDisplaySettings: HelpDisplaySettings;
  imageLayout: ImageLayout | null;
  imageLoadError: string;
  images: ImageFile[];
  interactionMode: InteractionMode;
  isImageLoading: boolean;
  isLabelDirty: boolean;
  isPanning: boolean;
  isSaving: boolean;
  isShortcutSettingsOpen: boolean;
  labelById: Map<string, LabelConfig>;
  labelDisplaySettings: LabelDisplaySettings;
  labelShortcuts: string[];
  labelSwitchHint: LabelConfig | null;
  labels: LabelConfig[];
  loadedImage: HTMLImageElement | null;
  projectTemplateId: string;
  selectedExportFormatId: ExportFormatId;
  selectedImage: ImageFile | null;
  selectedImageButtonRef: MutableRefObject<HTMLButtonElement | null>;
  selectedPath: string;
  selectedRectRef: MutableRefObject<KonvaRect | null>;
  selectedShapeId: string | null;
  selectedTemplateId: string;
  showSaveSuccess: boolean;
  shortcuts: ShortcutMap;
  templates: LabelTemplate[];
  transformerRef: MutableRefObject<KonvaTransformer | null>;
  updateMessage: string;
  updateProgress: AppUpdateProgress | null;
  updateStatus: AppUpdateStatus;
  usedLabelIds: Set<string>;
  cancelLabelChanges: () => void;
  changeAnnotationLabel: (annotationId: string, labelId: string) => void;
  checkForUpdates: () => void;
  clearCurrentImageAnnotations: () => void;
  confirmDeleteAnnotation: () => void;
  createProjectFromExternalYolo: () => void;
  deleteContextAnnotation: (annotation: AnnotationShape) => void;
  deleteTemplate: () => void;
  exportSelectedFormat: () => void;
  fitImageHeight: () => void;
  fitImageWidth: () => void;
  handleDragEnd: (annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) => void;
  handleStageMouseDown: (event: KonvaEventObject<MouseEvent>) => void;
  handleStageMouseMove: (event: KonvaEventObject<MouseEvent>) => void;
  handleStageMouseUp: () => void;
  handleStageWheel: (event: KonvaEventObject<WheelEvent>) => void;
  handleTransformEnd: (annotation: AnnotationShape) => void;
  importAnnotations: () => void;
  installUpdate: () => void;
  newTemplate: () => void;
  openContextMenu: (event: KonvaEventObject<MouseEvent>, annotationId?: string) => void;
  openFolder: () => void;
  redo: () => void;
  resetZoom: () => void;
  saveProjectExport: () => void;
  saveTemplate: () => void;
  saveTemplateAndUpdateAnnotations: () => void;
  saveTemplateAs: () => void;
  selectAdjacentImage: (delta: number) => void;
  selectAdjacentUnannotatedImage: (delta: 1 | -1) => void;
  selectCurrentLabel: (labelId: string) => void;
  selectShape: (annotationId: string | null) => void;
  selectTemplate: (templateId: string) => void;
  setAnnotationToDelete: (annotation: AnnotationShape | null) => void;
  setContextMenu: (contextMenu: CanvasContextMenuState | null) => void;
  setCustomMappingText: (text: string) => void;
  setHelpDisplaySetting: (setting: keyof HelpDisplaySettings, visible: boolean) => void;
  setImageScale: (scale: number) => void;
  setIsShortcutSettingsOpen: (isOpen: boolean) => void;
  setSelectedExportFormatId: (format: ExportFormatId) => void;
  setSelectedPath: (path: string) => void;
  setUpdateMessage: (message: string) => void;
  setLabelDisplaySetting: (mode: InteractionMode, visible: boolean) => void;
  startPanning: (event: KonvaEventObject<MouseEvent>) => void;
  undo: () => void;
  updateLabels: (labels: LabelConfig[]) => void;
  updateShortcut: (actionId: ShortcutActionId, shortcut: string) => void;
  zoomFromKeyboard: (delta: 1 | -1) => void;
}

export function AppLayout({
  activeProjectConfig,
  annotationToDelete,
  annotations,
  annotationsByImage,
  canRedo,
  canUndo,
  canvasHostRef,
  canvasSize,
  contextAnnotation,
  contextMenu,
  currentLabel,
  customMappingText,
  draftRect,
  error,
  folderPath,
  highlightedShapeId,
  helpDisplaySettings,
  imageLayout,
  imageLoadError,
  images,
  interactionMode,
  isImageLoading,
  isLabelDirty,
  isPanning,
  isSaving,
  isShortcutSettingsOpen,
  labelById,
  labelDisplaySettings,
  labelShortcuts,
  labelSwitchHint,
  labels,
  loadedImage,
  projectTemplateId,
  selectedExportFormatId,
  selectedImage,
  selectedImageButtonRef,
  selectedPath,
  selectedRectRef,
  selectedShapeId,
  selectedTemplateId,
  showSaveSuccess,
  shortcuts,
  templates,
  transformerRef,
  updateMessage,
  updateProgress,
  updateStatus,
  usedLabelIds,
  cancelLabelChanges,
  changeAnnotationLabel,
  checkForUpdates,
  clearCurrentImageAnnotations,
  confirmDeleteAnnotation,
  createProjectFromExternalYolo,
  deleteContextAnnotation,
  deleteTemplate,
  exportSelectedFormat,
  fitImageHeight,
  fitImageWidth,
  handleDragEnd,
  handleStageMouseDown,
  handleStageMouseMove,
  handleStageMouseUp,
  handleStageWheel,
  handleTransformEnd,
  importAnnotations,
  installUpdate,
  newTemplate,
  openContextMenu,
  openFolder,
  redo,
  resetZoom,
  saveProjectExport,
  saveTemplate,
  saveTemplateAndUpdateAnnotations,
  saveTemplateAs,
  selectAdjacentImage,
  selectAdjacentUnannotatedImage,
  selectCurrentLabel,
  selectShape,
  selectTemplate,
  setAnnotationToDelete,
  setContextMenu,
  setCustomMappingText,
  setHelpDisplaySetting,
  setImageScale,
  setIsShortcutSettingsOpen,
  setSelectedExportFormatId,
  setSelectedPath,
  setUpdateMessage,
  setLabelDisplaySetting,
  startPanning,
  undo,
  updateLabels,
  updateShortcut,
  zoomFromKeyboard,
}: AppLayoutProps) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const [canvasPointer, setCanvasPointer] = useState<{ x: number; y: number } | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const selectedImageIndex = images.findIndex((image) => image.path === selectedPath);
  const currentImageNumber = selectedImageIndex >= 0 ? selectedImageIndex + 1 : 0;
  const annotatedCount = images.filter(
    (image) => (annotationsByImage[image.path] ?? []).length > 0,
  ).length;
  const progressPercent = images.length > 0 ? (currentImageNumber / images.length) * 100 : 0;
  const hasPreviousUnannotatedImage = images
    .slice(0, Math.max(selectedImageIndex, 0))
    .some((image) => (annotationsByImage[image.path] ?? []).length === 0);
  const hasNextUnannotatedImage =
    selectedImageIndex >= 0 &&
    images
      .slice(selectedImageIndex + 1)
      .some((image) => (annotationsByImage[image.path] ?? []).length === 0);
  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f" &&
        images.length > 0 &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    }

    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [images.length]);

  function closeMenu() {
    menuRef.current?.removeAttribute("open");
  }

  function updateCanvasPointer(event: ReactMouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setCanvasPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  const modeHelpCorner: OverlayCorner =
    canvasPointer && canvasPointer.x < 360 && canvasPointer.y < 220 ? "bottom-left" : "top-left";
  const labelShortcutCorner: OverlayCorner =
    canvasPointer && canvasPointer.x > canvasSize.width - 360 && canvasPointer.y < 220
      ? "bottom-right"
      : "top-right";
  const isPointerInImage =
    canvasPointer !== null &&
    imageLayout !== null &&
    canvasPointer.x >= imageLayout.x &&
    canvasPointer.y >= imageLayout.y &&
    canvasPointer.x <= imageLayout.x + imageLayout.width &&
    canvasPointer.y <= imageLayout.y + imageLayout.height;
  const isPointerOnAnnotation =
    canvasPointer !== null &&
    imageLayout !== null &&
    annotations.some((annotation) =>
      isPointNearCanvasRect(canvasPointer, toCanvasRect(annotation.points, imageLayout), 8),
    );
  const isAnnotatingPointer =
    !isPanning &&
    isPointerInImage &&
    (interactionMode === "annotate" || (interactionMode === "default" && !isPointerOnAnnotation));
  const annotationGuideLines =
    helpDisplaySettings.showAnnotationGuideLines && isAnnotatingPointer && canvasPointer && imageLayout
      ? {
          horizontal: [
            imageLayout.x,
            canvasPointer.y,
            imageLayout.x + imageLayout.width,
            canvasPointer.y,
          ],
          vertical: [
            canvasPointer.x,
            imageLayout.y,
            canvasPointer.x,
            imageLayout.y + imageLayout.height,
          ],
        }
      : null;
  const canvasCursorClass =
    helpDisplaySettings.showAnnotationCrosshairCursor && isAnnotatingPointer
      ? "cursor-crosshair"
      : "";

  return (
    <main className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="shrink-0 border-b border-slate-800 p-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="truncate text-lg font-semibold">my_label_tool</h1>
            <details ref={menuRef} className="group relative">
              <summary
                aria-label="打开菜单"
                className="cursor-pointer list-none rounded border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-800"
                title="菜单"
              >
                ☰
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-56 space-y-1 rounded-lg border border-slate-700 bg-slate-950 p-2 shadow-2xl">
                <button
                  className="w-full rounded bg-sky-500 px-3 py-2 text-left text-sm font-medium text-white hover:bg-sky-400"
                  type="button"
                  onClick={() => {
                    closeMenu();
                    openFolder();
                  }}
                >
                  打开图片文件夹
                </button>
                <div className="border-t border-slate-800 pt-1">
                  <div className="px-2 py-1 text-xs text-slate-500">导入标注</div>
                  <button
                    className="w-full rounded px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={images.length === 0}
                    type="button"
                    onClick={() => {
                      closeMenu();
                      importAnnotations();
                    }}
                  >
                    导入本工具项目
                  </button>
                  <button
                    className="w-full rounded px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={images.length === 0}
                    type="button"
                    onClick={() => {
                      closeMenu();
                      createProjectFromExternalYolo();
                    }}
                  >
                    从 YOLO 创建项目
                  </button>
                  {["COCO", "VOC", "Custom"].map((format) => (
                    <button
                      className="w-full rounded px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-800"
                      key={format}
                      type="button"
                      onClick={() => {
                        closeMenu();
                        window.alert(`${format} 外部项目创建暂未实现`);
                      }}
                    >
                      从 {format} 创建项目（暂未实现）
                    </button>
                  ))}
                </div>
                <button
                  className="w-full rounded border border-slate-700 px-3 py-2 text-left text-sm font-medium text-slate-100 hover:bg-slate-800"
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setIsShortcutSettingsOpen(true);
                  }}
                >
                  设置
                </button>
                <button
                  className="w-full rounded border border-slate-700 px-3 py-2 text-left text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                  disabled={updateStatus === "checking" || updateStatus === "downloading"}
                  type="button"
                  onClick={() => {
                    closeMenu();
                    checkForUpdates();
                  }}
                >
                  检查更新
                </button>
              </div>
            </details>
          </div>
          <p className="mt-3 truncate text-xs text-slate-400" title={folderPath || "请选择目录"}>
            {folderPath || "请选择目录"}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              aria-label="撤销"
              className="rounded border border-slate-700 px-3 py-2 text-lg font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUndo}
              title="撤销（Ctrl+Z）"
              type="button"
              onClick={undo}
            >
              ↶
            </button>
            <button
              aria-label="重做"
              className="rounded border border-slate-700 px-3 py-2 text-lg font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canRedo}
              title="重做（Ctrl+Y）"
              type="button"
              onClick={redo}
            >
              ↷
            </button>
          </div>
        </div>

        <ExportPanel
          canSaveProject={
            activeProjectConfig !== null && selectedExportFormatId === activeProjectConfig.format
          }
          customMappingText={customMappingText}
          disabled={images.length === 0}
          isSaving={isSaving}
          selectedFormatId={selectedExportFormatId}
          onChangeCustomMappingText={setCustomMappingText}
          onChangeFormat={setSelectedExportFormatId}
          onExport={exportSelectedFormat}
          onSaveProject={saveProjectExport}
        />

        <div className="scrollbar-dark min-h-0 max-h-[45vh] overflow-y-auto">
          <LabelSettings
            canSaveTemplate={
              isUserTemplate(selectedTemplateId) || selectedTemplateId === projectTemplateId
            }
            canDeleteTemplate={
              isUserTemplate(selectedTemplateId) && selectedTemplateId !== projectTemplateId
            }
            isDirty={isLabelDirty}
            labels={labels}
            selectedTemplateId={selectedTemplateId}
            templates={templates}
            usedLabelIds={usedLabelIds}
            onCancelChanges={cancelLabelChanges}
            onChangeLabels={updateLabels}
            onDeleteTemplate={deleteTemplate}
            onNewTemplate={newTemplate}
            onSaveAndUpdateTemplate={saveTemplateAndUpdateAnnotations}
            onSaveTemplate={saveTemplate}
            onSaveTemplateAs={saveTemplateAs}
            onSelectTemplate={selectTemplate}
          />

          <section className="border-b border-slate-800 p-4">
            <label className="block text-sm text-slate-300">
              当前标签（新框使用）
              <select
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={currentLabel.id}
                onChange={(event) => selectCurrentLabel(event.target.value)}
              >
                {labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.shortcut ? `${label.name} (${label.shortcut})` : label.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: currentLabel.color }}
              />
              <span>{currentLabel.name}</span>
              {currentLabel.shortcut && (
                <span className="text-xs text-slate-500">快捷键 {currentLabel.shortcut}</span>
              )}
            </div>
            <button
              className="mt-3 w-full rounded border border-red-500/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={annotations.length === 0}
              type="button"
              onClick={clearCurrentImageAnnotations}
            >
              清空当前图片标注
            </button>
          </section>
        </div>

        <section className="flex min-h-44 flex-1 flex-col border-t border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-200">图片列表</h2>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs text-slate-500">
                  已标注 {annotatedCount} / 未标注 {images.length - annotatedCount} / 总数{" "}
                  {images.length}
                </span>
                <button
                  aria-label="搜索图片"
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={images.length === 0}
                  title="搜索图片（Ctrl+F）"
                  type="button"
                  onClick={() => setIsSearchOpen(true)}
                >
                  🔍
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full bg-sky-500" style={{ width: `${progressPercent}%` }} />
              </div>
              <span className="w-14 text-right text-xs text-slate-400">
                {currentImageNumber}/{images.length}
              </span>
            </div>
          </div>
          <div className="scrollbar-dark min-h-0 flex-1 overflow-auto p-2">
            {images.length === 0 ? (
              <p className="p-2 text-sm text-slate-400">
                {folderPath
                  ? "没有找到可加载的 jpg/png/bmp 图片；空文件或损坏图片会被跳过。"
                  : "请选择包含 jpg/png/bmp 的文件夹。"}
              </p>
            ) : (
              images.map((image) => (
                <button
                  className={`block w-full truncate rounded px-3 py-2 text-left text-sm ${
                    image.path === selectedPath
                      ? "bg-sky-500 text-white"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                  key={image.path}
                  ref={(node) => {
                    if (image.path === selectedPath) {
                      selectedImageButtonRef.current = node;
                    }
                  }}
                  title={image.path}
                  type="button"
                  onClick={() => setSelectedPath(image.path)}
                >
                  {image.name}
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <div
        ref={canvasHostRef}
        className={`relative h-full min-w-0 flex-1 overflow-hidden bg-slate-950 ${isPanning ? "cursor-grabbing" : canvasCursorClass}`}
        onMouseLeave={() => setCanvasPointer(null)}
        onMouseMove={updateCanvasPointer}
      >
        {selectedImage && loadedImage && imageLayout ? (
          <>
            <Stage
              width={canvasSize.width}
              height={canvasSize.height}
              onMouseDown={handleStageMouseDown}
              onMouseMove={handleStageMouseMove}
              onMouseUp={handleStageMouseUp}
              onWheel={handleStageWheel}
              onContextMenu={openContextMenu}
            >
              <Layer>
                <KonvaImage
                  height={imageLayout.height}
                  image={loadedImage}
                  imageSmoothingEnabled={!isLargeImage(loadedImage)}
                  name="image"
                  perfectDrawEnabled={false}
                  width={imageLayout.width}
                  x={imageLayout.x}
                  y={imageLayout.y}
                />
                {annotations.map((annotation) => (
                  <AnnotationRect
                    annotation={annotation}
                    imageLayout={imageLayout}
                    interactionMode={interactionMode}
                    isHighlighted={annotation.id === highlightedShapeId}
                    isSelected={annotation.id === selectedShapeId}
                    isPanning={isPanning}
                    key={annotation.id}
                    label={labelById.get(annotation.labelId) ?? labels[0]}
                    rectRef={selectedRectRef}
                    showLabel={labelDisplaySettings[interactionMode]}
                    onContextMenu={openContextMenu}
                    onDragEnd={handleDragEnd}
                    onPanStart={startPanning}
                    onSelect={selectShape}
                    onTransformEnd={handleTransformEnd}
                  />
                ))}
                {draftRect && (
                  <Rect {...draftRect} dash={[6, 4]} stroke={currentLabel.color} strokeWidth={2} />
                )}
                {annotationGuideLines && (
                  <>
                    <Line
                      listening={false}
                      opacity={0.9}
                      perfectDrawEnabled={false}
                      points={annotationGuideLines.horizontal}
                      stroke="#facc15"
                      strokeWidth={1}
                    />
                    <Line
                      listening={false}
                      opacity={0.9}
                      perfectDrawEnabled={false}
                      points={annotationGuideLines.vertical}
                      stroke="#facc15"
                      strokeWidth={1}
                    />
                  </>
                )}
                <Transformer
                  ref={transformerRef}
                  keepRatio={false}
                  listening={interactionMode === "default"}
                  rotateEnabled={false}
                  visible={interactionMode === "default"}
                />
              </Layer>
            </Stage>
            {helpDisplaySettings.showModeHelp && (
              <ModeHelpOverlay
                corner={modeHelpCorner}
                mode={interactionMode}
                shortcuts={shortcuts}
              />
            )}
            {interactionMode === "default" && helpDisplaySettings.showLabelShortcuts && (
              <LabelShortcutOverlay
                corner={labelShortcutCorner}
                currentLabelId={currentLabel.id}
                labels={labels}
              />
            )}
            {labelSwitchHint && (
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/85 px-4 py-2 text-sm text-slate-100 shadow-xl">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: labelSwitchHint.color }}
                />
                <span>当前标签：{labelSwitchHint.name}</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            {selectedImage && isImageLoading ? (
              <div className="w-56 text-center">
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="progress-indeterminate h-full w-1/2 rounded-full bg-sky-400" />
                </div>
                <div>正在加载图片...</div>
              </div>
            ) : selectedImage ? (
              imageLoadError || (loadedImage ? "画布区域尺寸异常，无法显示图片。" : "正在加载图片...")
            ) : (
              "选择文件夹后，在这里预览图片。"
            )}
          </div>
        )}
      </div>

      {isSaving && (
        <div className="pointer-events-none fixed left-1/2 top-5 z-[70] w-72 -translate-x-1/2 rounded-xl border border-sky-400/40 bg-slate-950/90 p-4 text-sm text-slate-100 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <span>正在保存...</span>
            <span className="text-xs text-slate-400">Ctrl+S</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="progress-indeterminate h-full w-1/2 rounded-full bg-sky-400" />
          </div>
        </div>
      )}

      {showSaveSuccess && (
        <div className="pointer-events-none fixed left-1/2 top-5 z-[70] -translate-x-1/2 rounded-full border border-emerald-400/40 bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white shadow-2xl">
          保存完成
        </div>
      )}

      {error && (
        <div
          className="pointer-events-none fixed left-1/2 top-5 z-[80] max-w-xl -translate-x-1/2 rounded-xl border border-red-400/50 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-2xl"
          role="alert"
        >
          {error}
        </div>
      )}

      {isSearchOpen && (
        <ImageSearchDialog
          images={images}
          selectedPath={selectedPath}
          onClose={() => setIsSearchOpen(false)}
          onSelectImage={setSelectedPath}
        />
      )}

      {updateMessage && (
        <div className="fixed right-5 top-5 z-[75] w-80 rounded-xl border border-slate-700 bg-slate-950/95 p-4 text-sm text-slate-100 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">
                {updateStatus === "available"
                  ? "发现更新"
                  : updateStatus === "error"
                    ? "更新失败"
                    : "自动更新"}
              </div>
              <p className="mt-1 text-slate-300">{updateMessage}</p>
            </div>
            {updateStatus !== "checking" && updateStatus !== "downloading" && (
              <button
                aria-label="关闭更新提示"
                className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                type="button"
                onClick={() => setUpdateMessage("")}
              >
                ×
              </button>
            )}
          </div>
          {updateStatus === "downloading" && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full bg-sky-400 ${
                    updateProgress?.percent == null ? "progress-indeterminate w-1/2" : ""
                  }`}
                  style={
                    updateProgress?.percent == null
                      ? undefined
                      : { width: `${updateProgress?.percent ?? 0}%` }
                  }
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {updateProgress?.percent == null
                  ? "正在下载..."
                  : `已下载 ${updateProgress?.percent ?? 0}%`}
              </div>
            </div>
          )}
          {updateStatus === "available" && (
            <div className="mt-3 flex gap-2">
              <button
                className="rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
                type="button"
                onClick={installUpdate}
              >
                立即更新
              </button>
              <button
                className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                type="button"
                onClick={() => setUpdateMessage("")}
              >
                稍后
              </button>
            </div>
          )}
        </div>
      )}

      {isShortcutSettingsOpen && (
        <ShortcutSettings
          helpDisplaySettings={helpDisplaySettings}
          labelDisplaySettings={labelDisplaySettings}
          labelShortcuts={labelShortcuts}
          shortcuts={shortcuts}
          onChangeHelpDisplaySetting={setHelpDisplaySetting}
          onChangeLabelDisplaySetting={setLabelDisplaySetting}
          onChangeShortcut={updateShortcut}
          onClose={() => setIsShortcutSettingsOpen(false)}
        />
      )}

      {contextMenu && (
        <CanvasContextMenu
          annotation={contextAnnotation}
          canNextImage={selectedImageIndex >= 0 && selectedImageIndex < images.length - 1}
          canNextUnannotatedImage={hasNextUnannotatedImage}
          canPreviousImage={selectedImageIndex > 0}
          canPreviousUnannotatedImage={hasPreviousUnannotatedImage}
          labels={labels}
          x={contextMenu.x}
          y={contextMenu.y}
          onChangeLabel={changeAnnotationLabel}
          onDeleteAnnotation={deleteContextAnnotation}
          onFitHeight={() => {
            fitImageHeight();
            setContextMenu(null);
          }}
          onFitWidth={() => {
            fitImageWidth();
            setContextMenu(null);
          }}
          onNextImage={() => {
            selectAdjacentImage(1);
            setContextMenu(null);
          }}
          onNextUnannotatedImage={() => {
            selectAdjacentUnannotatedImage(1);
            setContextMenu(null);
          }}
          onOriginalSize={() => {
            setImageScale(1);
            setContextMenu(null);
          }}
          onPreviousImage={() => {
            selectAdjacentImage(-1);
            setContextMenu(null);
          }}
          onPreviousUnannotatedImage={() => {
            selectAdjacentUnannotatedImage(-1);
            setContextMenu(null);
          }}
          onResetZoom={() => {
            resetZoom();
            setContextMenu(null);
          }}
          onZoomIn={() => {
            zoomFromKeyboard(1);
            setContextMenu(null);
          }}
          onZoomOut={() => {
            zoomFromKeyboard(-1);
            setContextMenu(null);
          }}
        />
      )}

      {annotationToDelete && (
        <DeleteAnnotationDialog
          labelName={labelById.get(annotationToDelete.labelId)?.name ?? "当前标注"}
          onCancel={() => setAnnotationToDelete(null)}
          onConfirm={confirmDeleteAnnotation}
        />
      )}
    </main>
  );
}
