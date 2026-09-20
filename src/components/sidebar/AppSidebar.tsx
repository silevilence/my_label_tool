import { Overlay } from "../overlay/Overlay";
import { INTERACTION_ZH_CN as interactionText } from "../../i18n/interaction.zh-CN";
import { useState } from "react";
import { ExportPanel } from "../settings/ExportPanel";
import { ImageListContextMenu } from "./ImageListContextMenu";
import { LabelSettings } from "../settings/LabelSettings";
import {
  SHAPE_TYPE_LABELS,
  isLabelCompatibleWithShape,
  type AnnotationShape,
  type AnnotationShapeType,
  type LabelConfig,
  type LabelTemplate,
} from "../../types/annotation";
import type { ExportFormatId } from "../../types/export";
import type { ProjectConfig } from "../../lib/importers";
import type { ImageFile } from "../../lib/tauri-api";
import { isUserTemplate } from "../../lib/app-utils";
import { PRELABEL_ZH_CN } from "../../i18n/prelabel.zh-CN";
import { PLUGIN_ZH_CN } from "../../i18n/plugin.zh-CN";
import { PluginSettings } from "../settings/PluginSettings";
import type { PluginExportFormatDescriptor } from "../../types/plugin";
import type { PluginExportProgressState } from "../../hooks/useProjectActions";
import type { LoadedProjectVideo } from "../../lib/project-media";
import { ProjectMediaList } from "./ProjectMediaList";
import { VIDEO_ZH_CN as videoText } from "../../i18n/video.zh-CN";

interface AppSidebarProps {
  reextractVideo?: (source: string) => void;
  openProjectSettings?: () => void;
  videos?: LoadedProjectVideo[];
  addVideo?: (source?: string) => void;
  canDeleteImage: boolean;
  requestDeleteImage: (path: string) => void;
  activeProjectConfig: ProjectConfig | null;
  annotations: AnnotationShape[];
  annotationsByImage: Record<string, AnnotationShape[]>;
  canRedo: boolean;
  canUndo: boolean;
  currentLabel: LabelConfig;
  currentShapeType: AnnotationShapeType;
  customMappingText: string;
  folderPath: string;
  images: ImageFile[];
  isLabelDirty: boolean;
  isSaving: boolean;
  labels: LabelConfig[];
  projectTemplateId: string;
  selectedExportFormatId: ExportFormatId;
  selectedPath: string;
  selectedTemplateId: string;
  templates: LabelTemplate[];
  pluginTemplateIds: ReadonlySet<string>;
  pluginTemplateSources: ReadonlyMap<string, string>;
  pluginExportFormats: PluginExportFormatDescriptor[];
  pluginExportProgress: PluginExportProgressState | null;
  usedLabelIds: Set<string>;
  cancelLabelChanges: () => void;
  cancelPluginExport: () => void;
  checkForUpdates: () => void;
  clearCurrentImageAnnotations: () => void;
  createProjectFromExternalYolo: () => void;
  deleteTemplate: () => void;
  exportSelectedFormat: () => void;
  exportError: string | null;
  importAnnotations: () => void;
  newTemplate: () => void;
  openFolder: () => void;
  redo: () => void;
  retryPluginConfigMigrations: () => Promise<void>;
  refreshPluginLabelPresets: () => Promise<void>;
  saveProjectExport: () => void;
  saveTemplate: () => void;
  saveTemplateAndUpdateAnnotations: () => void;
  saveTemplateAs: () => void;
  selectCurrentLabel: (labelId: string) => void;
  selectShapeType: (shapeType: AnnotationShapeType) => void;
  selectTemplate: (templateId: string) => void;
  setCustomMappingText: (text: string) => void;
  setIsSearchOpen: (isOpen: boolean) => void;
  setIsShortcutSettingsOpen: (isOpen: boolean) => void;
  setIsPrelabelSettingsOpen: (isOpen: boolean) => void;
  setIsPrelabelExecutionOpen: (isOpen: boolean) => void;
  setSelectedExportFormatId: (format: ExportFormatId) => void;
  setSelectedPath: (path: string) => void;
  undo: () => void;
  updateLabels: (labels: LabelConfig[]) => void;
  updateStatus: string;
}

export function AppSidebar({
  reextractVideo,
  openProjectSettings,
  videos = [],
  addVideo,
  canDeleteImage,
  requestDeleteImage,
  activeProjectConfig,
  annotations,
  annotationsByImage,
  canRedo,
  canUndo,
  currentLabel,
  currentShapeType,
  customMappingText,
  folderPath,
  images,
  isLabelDirty,
  isSaving,
  labels,
  projectTemplateId,
  selectedExportFormatId,
  selectedPath,
  selectedTemplateId,
  templates,
  pluginTemplateIds,
  pluginTemplateSources,
  pluginExportFormats,
  pluginExportProgress,
  usedLabelIds,
  cancelLabelChanges,
  cancelPluginExport,
  checkForUpdates,
  clearCurrentImageAnnotations,
  createProjectFromExternalYolo,
  deleteTemplate,
  exportSelectedFormat,
  exportError,
  importAnnotations,
  newTemplate,
  openFolder,
  redo,
  retryPluginConfigMigrations,
  refreshPluginLabelPresets,
  saveProjectExport,
  saveTemplate,
  saveTemplateAndUpdateAnnotations,
  saveTemplateAs,
  selectCurrentLabel,
  selectShapeType,
  selectTemplate,
  setCustomMappingText,
  setIsSearchOpen,
  setIsShortcutSettingsOpen,
  setIsPrelabelSettingsOpen,
  setIsPrelabelExecutionOpen,
  setSelectedExportFormatId,
  setSelectedPath,
  undo,
  updateLabels,
  updateStatus,
}: AppSidebarProps) {
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [isPluginSettingsOpen, setIsPluginSettingsOpen] = useState(false);
  const [imageMenu, setImageMenu] = useState<{ image: ImageFile; x: number; y: number } | null>(
    null,
  );
  const [videoMenu, setVideoMenu] = useState<{ source: string; x: number; y: number } | null>(null);
  const annotatedCount = images.filter(
    (image) => (annotationsByImage[image.path] ?? []).length > 0,
  ).length;
  const progressPercent = images.length > 0 ? (annotatedCount / images.length) * 100 : 0;
  const compatibleCurrentLabels = labels.filter((label) =>
    isLabelCompatibleWithShape(label, currentShapeType),
  );
  const currentToolLabels = compatibleCurrentLabels.length > 0 ? compatibleCurrentLabels : labels;

  function closeMenu() {
    setMenuAnchor(null);
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <div className="shrink-0 border-b border-slate-800 p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate text-lg font-semibold">my_label_tool</h1>
          <div className="relative">
            <button
              type="button"
              aria-label={interactionText.openMenu}
              aria-expanded={menuAnchor !== null}
              onPointerDown={(event) => {
                if (menuAnchor) event.stopPropagation();
              }}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMenuAnchor(menuAnchor ? null : { x: rect.right - 224, y: rect.bottom + 8 });
              }}
              className="cursor-pointer list-none rounded border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-800"
              title={interactionText.mainMenu}
            >
              ☰
            </button>
            {menuAnchor && (
              <Overlay
                kind="light"
                label={interactionText.mainMenu}
                anchor={menuAnchor}
                onClose={closeMenu}
              >
                <div className="w-56 space-y-1 rounded-lg border border-slate-700 bg-slate-950 p-2 shadow-2xl">
                  <button
                    className="w-full rounded bg-sky-500 px-3 py-2 text-left text-sm font-medium text-white hover:bg-sky-400"
                    type="button"
                    onClick={() => {
                      closeMenu();
                      openFolder();
                    }}
                  >
                    {videoText.openProject}
                  </button>
                  {addVideo && (
                    <button
                      type="button"
                      className="w-full rounded px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                      onClick={() => {
                        closeMenu();
                        addVideo();
                      }}
                    >
                      {videoText.add}
                    </button>
                  )}
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
                        className="w-full cursor-not-allowed rounded px-3 py-2 text-left text-sm text-slate-500"
                        disabled
                        key={format}
                        title="外部项目创建暂未实现"
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
                      setIsPrelabelSettingsOpen(true);
                    }}
                  >
                    {PRELABEL_ZH_CN.menuLabel}
                  </button>
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
                    className="w-full rounded border border-slate-700 px-3 py-2 text-left text-sm font-medium text-slate-100 hover:bg-slate-800"
                    type="button"
                    onClick={() => {
                      closeMenu();
                      setIsPluginSettingsOpen(true);
                    }}
                  >
                    {PLUGIN_ZH_CN.menuLabel}
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
              </Overlay>
            )}
          </div>
        </div>
        <p className="mt-3 truncate text-xs text-slate-400" title={folderPath || "请选择目录"}>
          {folderPath || "请选择目录"}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            aria-label="撤销"
            className="h-9 w-10 shrink-0 rounded border border-slate-700 text-lg font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canUndo}
            title="撤销（Ctrl+Z）"
            type="button"
            onClick={undo}
          >
            ↶
          </button>
          <button
            aria-label="重做"
            className="h-9 w-10 shrink-0 rounded border border-slate-700 text-lg font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canRedo}
            title="重做（Ctrl+Y）"
            type="button"
            onClick={redo}
          >
            ↷
          </button>
          <button
            type="button"
            onClick={openProjectSettings}
            disabled={!activeProjectConfig || !openProjectSettings}
            title={activeProjectConfig ? videoText.projectSettings : videoText.settingsNeedProject}
            className="ml-auto h-9 rounded border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {videoText.projectSettings}
          </button>
        </div>
      </div>

      <ExportPanel
        videoFrameCount={videos.reduce((sum, video) => sum + video.images.length, 0)}
        pendingVideoCount={videos.filter((video) => !video.video).length}
        hasVideos={videos.length > 0}
        canSaveProject={images.length > 0 || videos.length > 0}
        customMappingText={customMappingText}
        disabled={!folderPath}
        isSaving={isSaving}
        selectedFormatId={selectedExportFormatId}
        pluginFormats={pluginExportFormats}
        pluginExportProgress={pluginExportProgress}
        exportError={exportError}
        onChangeCustomMappingText={setCustomMappingText}
        onCancelPluginExport={cancelPluginExport}
        onChangeFormat={setSelectedExportFormatId}
        onExport={exportSelectedFormat}
        onSaveProject={saveProjectExport}
      />

      <section className="shrink-0 border-b border-slate-800 p-4">
        <button
          className="w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
          type="button"
          onClick={() => setIsPrelabelExecutionOpen(true)}
        >
          {PRELABEL_ZH_CN.executionTitle}
        </button>
      </section>

      <div className="scrollbar-dark min-h-0 max-h-[45vh] overflow-y-auto">
        <LabelSettings
          canSaveTemplate={
            (isUserTemplate(selectedTemplateId) && !pluginTemplateIds.has(selectedTemplateId)) ||
            selectedTemplateId === projectTemplateId
          }
          canDeleteTemplate={
            isUserTemplate(selectedTemplateId) &&
            selectedTemplateId !== projectTemplateId &&
            !pluginTemplateIds.has(selectedTemplateId)
          }
          isDirty={isLabelDirty}
          labels={labels}
          selectedTemplateId={selectedTemplateId}
          templates={templates}
          pluginTemplateSources={pluginTemplateSources}
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
          <div className="mb-3 grid grid-cols-3 gap-2">
            {(["rect", "polygon", "point"] as const).map((shapeType) => {
              return (
                <button
                  className={`rounded border px-2 py-1.5 text-xs font-medium ${
                    currentShapeType === shapeType
                      ? "border-sky-400 bg-sky-500 text-white"
                      : "border-slate-700 text-slate-300 hover:bg-slate-800"
                  }`}
                  key={shapeType}
                  type="button"
                  onClick={() => selectShapeType(shapeType)}
                >
                  {SHAPE_TYPE_LABELS[shapeType]}
                </button>
              );
            })}
          </div>
          <label className="block text-sm text-slate-300">
            当前标签（新框使用）
            <select
              className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              value={currentLabel.id}
              onChange={(event) => selectCurrentLabel(event.target.value)}
            >
              {currentToolLabels.map((label) => (
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
            <span className="ml-auto text-xs text-slate-500">
              {SHAPE_TYPE_LABELS[currentShapeType]}
            </span>
          </div>
          <button
            className="mt-3 w-full rounded border border-red-500/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={annotations.length === 0}
            type="button"
            onClick={clearCurrentImageAnnotations}
          >
            {videos.some((video) => video.images.some((image) => image.path === selectedPath))
              ? videoText.clearFrame
              : "清空当前图片标注"}
          </button>
        </section>
      </div>

      <section className="flex min-h-44 flex-1 flex-col border-t border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">{videoText.mediaList}</h2>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs text-slate-500">
                {videos.length
                  ? videoText.assetCount(
                      images.length -
                        videos.reduce((total, video) => total + video.images.length, 0),
                      videos.length,
                    )
                  : videoText.imageCount(annotatedCount, images.length)}
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
            <div
              aria-label="标注进度"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(progressPercent)}
              aria-valuetext={`已标注 ${annotatedCount} / ${images.length}`}
              className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
              role="progressbar"
            >
              <div className="h-full bg-sky-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="w-16 text-right text-xs text-slate-400" title="已标注 / 素材总数">
              {annotatedCount}/{images.length}
            </span>
          </div>
        </div>
        <ProjectMediaList
          folderPath={folderPath}
          images={images}
          videos={videos}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
          onPrepare={(source) => addVideo?.(source)}
          onVideoMenu={(source, x, y) => {
            setImageMenu(null);
            setVideoMenu({ source, x, y });
          }}
          onImageMenu={(image, x, y) => setImageMenu({ image, x, y })}
        />
      </section>
      {imageMenu && images.includes(imageMenu.image) && (
        <ImageListContextMenu
          {...imageMenu}
          disabled={!canDeleteImage}
          onDelete={requestDeleteImage}
          onClose={() => setImageMenu(null)}
        />
      )}
      {videoMenu && (
        <ImageListContextMenu
          image={{ path: videoMenu.source, name: videoMenu.source }}
          x={videoMenu.x}
          y={videoMenu.y}
          actionLabel={videoText.reextract}
          disabled={
            !reextractVideo || !videos.find((asset) => asset.sourcePath === videoMenu.source)?.video
          }
          onDelete={(source) => reextractVideo?.(source)}
          onClose={() => setVideoMenu(null)}
        />
      )}
      {isPluginSettingsOpen && (
        <PluginSettings
          projectDir={folderPath || null}
          onRetryConfigMigration={retryPluginConfigMigrations}
          onPluginsChanged={refreshPluginLabelPresets}
          onClose={() => setIsPluginSettingsOpen(false)}
        />
      )}
    </aside>
  );
}
