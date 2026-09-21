import type { ChangeEvent } from "react";
import { EXPORT_TEMPLATES } from "../../lib/defaults/exports";
import type { ExportFormatId } from "../../types/export";
import type { PluginExportFormatDescriptor } from "../../types/plugin";
import { PLUGIN_ZH_CN as pluginText } from "../../i18n/plugin.zh-CN";
import type { PluginExportProgressState } from "../../hooks/useProjectActions";
import { VIDEO_ZH_CN as videoText } from "../../i18n/video.zh-CN";
import { PROJECT_ZH_CN as projectText } from "../../i18n/project.zh-CN";
import { OPERATION_ZH_CN as operationText } from "../../i18n/operations.zh-CN";
import { useOperations } from "../../store/useOperations";

interface ExportPanelProps {
  videoFrameCount?: number;
  pendingVideoCount?: number;
  hasVideos?: boolean;
  customMappingText: string;
  disabled: boolean;
  isSaving: boolean;
  selectedFormatId: ExportFormatId;
  pluginFormats: PluginExportFormatDescriptor[];
  pluginExportProgress: PluginExportProgressState | null;
  exportError: string | null;
  canSaveProject: boolean;
  onChangeCustomMappingText: (value: string) => void;
  onCancelPluginExport: () => void;
  onChangeFormat: (formatId: ExportFormatId) => void;
  onExport: () => void;
  onSaveProject: () => void;
}

export function ExportPanel({
  videoFrameCount = 0,
  pendingVideoCount = 0,
  hasVideos = false,
  customMappingText,
  disabled,
  isSaving,
  selectedFormatId,
  pluginFormats,
  pluginExportProgress,
  exportError,
  canSaveProject,
  onChangeCustomMappingText,
  onCancelPluginExport,
  onChangeFormat,
  onExport,
  onSaveProject,
}: ExportPanelProps) {
  const hasFailedExport = useOperations((state) =>
    state.operations.some(
      (operation) =>
        operation.status === "failed" &&
        (operation.label === operationText.export || operation.label === operationText.save),
    ),
  );
  const selectedTemplate =
    EXPORT_TEMPLATES.find((template) => template.id === selectedFormatId) ?? EXPORT_TEMPLATES[0];
  const selectedPluginFormat = pluginFormats.find(
    (format) => format.selectionId === selectedFormatId,
  );
  const selectedDisabled = selectedPluginFormat ? !selectedPluginFormat.enabled : false;
  const isPluginExporting = pluginExportProgress !== null;

  function changeFormat(event: ChangeEvent<HTMLSelectElement>) {
    onChangeFormat(event.target.value as ExportFormatId);
  }

  return (
    <section className="shrink-0 border-b border-slate-800 p-4">
      <h2 className="text-sm font-semibold text-slate-200">导出</h2>
      <select
        className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        value={selectedFormatId}
        disabled={isSaving || isPluginExporting}
        onChange={changeFormat}
      >
        {EXPORT_TEMPLATES.map((template) => (
          <option key={template.id} value={template.id}>
            {hasVideos && template.id === "json" ? videoText.jsonName : template.name}
          </option>
        ))}
        {pluginFormats.length > 0 && (
          <optgroup label={pluginText.exportFormatGroup}>
            {pluginFormats.map((format) => (
              <option
                disabled={!format.enabled}
                key={format.selectionId}
                value={format.selectionId}
              >
                {pluginText.exportFormatLabel(format.pluginName, format.format.displayName)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <p className="mt-2 text-xs text-slate-400">
        {selectedPluginFormat
          ? (selectedPluginFormat.disabledReason ?? pluginText.exportFormatDescription)
          : hasVideos && selectedFormatId === "json"
            ? videoText.jsonDescription
            : hasVideos && selectedFormatId === "yolo"
              ? videoText.yoloDescription
              : selectedTemplate.description}
      </p>
      {selectedFormatId === "custom" && (
        <textarea
          aria-label={projectText.customExportMapping}
          className="mt-3 h-32 w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          spellCheck={false}
          value={customMappingText}
          onChange={(event) => onChangeCustomMappingText(event.target.value)}
        />
      )}
      {pluginExportProgress && (
        <div className="mt-3 rounded border border-sky-800 bg-sky-950/40 p-2">
          <div className="flex items-center justify-between gap-2 text-xs text-sky-100">
            <span className="truncate">{pluginExportProgress.message}</span>
            {pluginExportProgress.percent !== null && (
              <span>{Math.round(pluginExportProgress.percent)}%</span>
            )}
          </div>
          {pluginExportProgress.percent !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-sky-400 transition-[width]"
                style={{ width: `${pluginExportProgress.percent}%` }}
              />
            </div>
          )}
          {pluginExportProgress.canCancel && (
            <button
              className="mt-2 w-full rounded border border-sky-700 px-2 py-1 text-xs text-sky-100 hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={pluginExportProgress.cancelling}
              onClick={onCancelPluginExport}
            >
              {pluginExportProgress.cancelling
                ? pluginText.exportCancelling
                : pluginText.exportCancel}
            </button>
          )}
        </div>
      )}
      <div data-operation-error-feedback={operationText.export} />
      <div data-operation-error-feedback={operationText.save} />
      {exportError && hasFailedExport && (
        <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          <button
            className="rounded border border-red-400/60 px-3 py-1 text-xs text-red-100 hover:bg-red-500/20 disabled:opacity-50"
            type="button"
            disabled={disabled || selectedDisabled || isSaving || isPluginExporting}
            onClick={onExport}
          >
            {projectText.retryExport}
          </button>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="rounded bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          type="button"
          disabled={
            disabled || selectedDisabled || !canSaveProject || isSaving || isPluginExporting
          }
          onClick={onSaveProject}
        >
          {isSaving ? "保存中..." : "保存"}
        </button>
        <button
          className="rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={disabled || selectedDisabled || isSaving || isPluginExporting}
          onClick={onExport}
        >
          另存为
        </button>
      </div>
      {hasVideos && selectedFormatId === "yolo" && (
        <p className="mt-2 text-xs text-slate-400">
          {videoText.yoloFrameCount(videoFrameCount, pendingVideoCount)}
        </p>
      )}
    </section>
  );
}
