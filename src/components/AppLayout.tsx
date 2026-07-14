import type { MutableRefObject } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from "react-konva";
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
  ModeHelpOverlay,
} from "./canvas/CanvasChrome";
import { isLargeImage, type CanvasRect } from "./canvas/geometry";
import type { CanvasContextMenu as CanvasContextMenuState, ImageLayout } from "./canvas/types";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "../types/annotation";
import type { ExportFormatId } from "../types/export";
import type { ProjectConfig } from "../lib/importers";
import type { ImageFile } from "../lib/tauri-api";
import type { ShortcutActionId, ShortcutMap } from "../lib/defaults/shortcuts";
import { isUserTemplate } from "../lib/app-utils";

interface AppLayoutProps {
  activeProjectConfig: ProjectConfig | null;
  annotationToDelete: AnnotationShape | null;
  annotations: AnnotationShape[];
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
  imageLayout: ImageLayout | null;
  imageLoadError: string;
  images: ImageFile[];
  interactionMode: "default" | "select" | "annotate";
  isLabelDirty: boolean;
  isPanning: boolean;
  isShortcutSettingsOpen: boolean;
  labelById: Map<string, LabelConfig>;
  labelShortcuts: string[];
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
  shortcuts: ShortcutMap;
  templates: LabelTemplate[];
  transformerRef: MutableRefObject<KonvaTransformer | null>;
  usedLabelIds: Set<string>;
  cancelLabelChanges: () => void;
  changeAnnotationLabel: (annotationId: string, labelId: string) => void;
  clearCurrentImageAnnotations: () => void;
  confirmDeleteAnnotation: () => void;
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
  newTemplate: () => void;
  openContextMenu: (event: KonvaEventObject<MouseEvent>, annotationId?: string) => void;
  openFolder: () => void;
  redo: () => void;
  resetZoom: () => void;
  saveProjectExport: () => void;
  saveTemplate: () => void;
  saveTemplateAs: () => void;
  selectAdjacentImage: (delta: number) => void;
  selectCurrentLabel: (labelId: string) => void;
  selectShape: (annotationId: string | null) => void;
  selectTemplate: (templateId: string) => void;
  setAnnotationToDelete: (annotation: AnnotationShape | null) => void;
  setContextMenu: (contextMenu: CanvasContextMenuState | null) => void;
  setCustomMappingText: (text: string) => void;
  setImageScale: (scale: number) => void;
  setIsShortcutSettingsOpen: (isOpen: boolean) => void;
  setSelectedExportFormatId: (format: ExportFormatId) => void;
  setSelectedPath: (path: string) => void;
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
  imageLayout,
  imageLoadError,
  images,
  interactionMode,
  isLabelDirty,
  isPanning,
  isShortcutSettingsOpen,
  labelById,
  labelShortcuts,
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
  shortcuts,
  templates,
  transformerRef,
  usedLabelIds,
  cancelLabelChanges,
  changeAnnotationLabel,
  clearCurrentImageAnnotations,
  confirmDeleteAnnotation,
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
  newTemplate,
  openContextMenu,
  openFolder,
  redo,
  resetZoom,
  saveProjectExport,
  saveTemplate,
  saveTemplateAs,
  selectAdjacentImage,
  selectCurrentLabel,
  selectShape,
  selectTemplate,
  setAnnotationToDelete,
  setContextMenu,
  setCustomMappingText,
  setImageScale,
  setIsShortcutSettingsOpen,
  setSelectedExportFormatId,
  setSelectedPath,
  startPanning,
  undo,
  updateLabels,
  updateShortcut,
  zoomFromKeyboard,
}: AppLayoutProps) {
  return (
    <main className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="shrink-0 border-b border-slate-800 p-4">
          <h1 className="text-lg font-semibold">my_label_tool</h1>
          <button
            className="mt-4 w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
            type="button"
            onClick={openFolder}
          >
            打开图片文件夹
          </button>
          <button
            className="mt-2 w-full rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={images.length === 0}
            type="button"
            onClick={importAnnotations}
          >
            导入标注
          </button>
          <button
            className="mt-2 w-full rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800"
            type="button"
            onClick={() => setIsShortcutSettingsOpen(true)}
          >
            快捷键配置
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              className="rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUndo}
              type="button"
              onClick={undo}
            >
              撤销
            </button>
            <button
              className="rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canRedo}
              type="button"
              onClick={redo}
            >
              重做
            </button>
          </div>
          {folderPath && (
            <p className="mt-3 truncate text-xs text-slate-400" title={folderPath}>
              {folderPath}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </div>

        <ExportPanel
          canSaveProject={
            activeProjectConfig !== null && selectedExportFormatId === activeProjectConfig.format
          }
          customMappingText={customMappingText}
          disabled={images.length === 0}
          selectedFormatId={selectedExportFormatId}
          onChangeCustomMappingText={setCustomMappingText}
          onChangeFormat={setSelectedExportFormatId}
          onExport={exportSelectedFormat}
          onSaveProject={saveProjectExport}
        />

        <div className="scrollbar-dark min-h-0 flex-1 overflow-y-auto">
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

        <section className="flex max-h-64 min-h-36 shrink-0 flex-col border-t border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <h2 className="text-sm font-semibold text-slate-200">图片列表</h2>
            <span className="text-xs text-slate-500">{images.length}</span>
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
        className={`relative h-full min-w-0 flex-1 overflow-hidden bg-slate-950 ${isPanning ? "cursor-grabbing" : ""}`}
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
                <Transformer
                  ref={transformerRef}
                  listening={interactionMode === "default"}
                  rotateEnabled={false}
                  visible={interactionMode === "default"}
                />
              </Layer>
            </Stage>
            <ModeHelpOverlay mode={interactionMode} />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            {selectedImage
              ? imageLoadError ||
                (loadedImage ? "画布区域尺寸异常，无法显示图片。" : "正在加载图片...")
              : "选择文件夹后，在这里预览图片。"}
          </div>
        )}
      </div>

      {isShortcutSettingsOpen && (
        <ShortcutSettings
          labelShortcuts={labelShortcuts}
          shortcuts={shortcuts}
          onChangeShortcut={updateShortcut}
          onClose={() => setIsShortcutSettingsOpen(false)}
        />
      )}

      {contextMenu && (
        <CanvasContextMenu
          annotation={contextAnnotation}
          canNextImage={
            images.findIndex((image) => image.path === selectedPath) < images.length - 1
          }
          canPreviousImage={images.findIndex((image) => image.path === selectedPath) > 0}
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
          onOriginalSize={() => {
            setImageScale(1);
            setContextMenu(null);
          }}
          onPreviousImage={() => {
            selectAdjacentImage(-1);
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
