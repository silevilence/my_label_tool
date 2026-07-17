import { useRef, type MutableRefObject } from "react";
import { ExportPanel } from "../settings/ExportPanel";
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

interface AppSidebarProps {
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
  selectedImageButtonRef: MutableRefObject<HTMLButtonElement | null>;
  selectedPath: string;
  selectedTemplateId: string;
  templates: LabelTemplate[];
  usedLabelIds: Set<string>;
  cancelLabelChanges: () => void;
  checkForUpdates: () => void;
  clearCurrentImageAnnotations: () => void;
  createProjectFromExternalYolo: () => void;
  deleteTemplate: () => void;
  exportSelectedFormat: () => void;
  importAnnotations: () => void;
  newTemplate: () => void;
  openFolder: () => void;
  redo: () => void;
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
  setSelectedExportFormatId: (format: ExportFormatId) => void;
  setSelectedPath: (path: string) => void;
  undo: () => void;
  updateLabels: (labels: LabelConfig[]) => void;
  updateStatus: string;
}

export function AppSidebar({
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
  selectedImageButtonRef,
  selectedPath,
  selectedTemplateId,
  templates,
  usedLabelIds,
  cancelLabelChanges,
  checkForUpdates,
  clearCurrentImageAnnotations,
  createProjectFromExternalYolo,
  deleteTemplate,
  exportSelectedFormat,
  importAnnotations,
  newTemplate,
  openFolder,
  redo,
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
  setSelectedExportFormatId,
  setSelectedPath,
  undo,
  updateLabels,
  updateStatus,
}: AppSidebarProps) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const selectedImageIndex = images.findIndex((image) => image.path === selectedPath);
  const currentImageNumber = selectedImageIndex >= 0 ? selectedImageIndex + 1 : 0;
  const annotatedCount = images.filter(
    (image) => (annotationsByImage[image.path] ?? []).length > 0,
  ).length;
  const progressPercent = images.length > 0 ? (currentImageNumber / images.length) * 100 : 0;
  const compatibleCurrentLabels = labels.filter((label) =>
    isLabelCompatibleWithShape(label, currentShapeType),
  );
  const currentToolLabels = compatibleCurrentLabels.length > 0 ? compatibleCurrentLabels : labels;

  function closeMenu() {
    menuRef.current?.removeAttribute("open");
  }

  return (
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
          canSaveTemplate={isUserTemplate(selectedTemplateId) || selectedTemplateId === projectTemplateId}
          canDeleteTemplate={isUserTemplate(selectedTemplateId) && selectedTemplateId !== projectTemplateId}
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
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: currentLabel.color }} />
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
  );
}
