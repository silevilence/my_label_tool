import type { ChangeEvent } from "react";
import { EXPORT_TEMPLATES } from "../../lib/defaults/exports";
import type { ExportFormatId } from "../../types/export";
import type { PluginExportFormatDescriptor } from "../../types/plugin";
import { PLUGIN_ZH_CN as pluginText } from "../../i18n/plugin.zh-CN";
import type { PluginExportProgressState } from "../../hooks/useProjectActions";

interface ExportPanelProps {
  customMappingText: string;
  disabled: boolean;
  isSaving: boolean;
  selectedFormatId: ExportFormatId;
  pluginFormats: PluginExportFormatDescriptor[];
  pluginExportProgress: PluginExportProgressState | null;
  canSaveProject: boolean;
  onChangeCustomMappingText: (value: string) => void;
  onCancelPluginExport: () => void;
  onChangeFormat: (formatId: ExportFormatId) => void;
  onExport: () => void;
  onSaveProject: () => void;
}

export function ExportPanel({
  customMappingText,
  disabled,
  isSaving,
  selectedFormatId,
  pluginFormats,
  pluginExportProgress,
  canSaveProject,
  onChangeCustomMappingText,
  onCancelPluginExport,
  onChangeFormat,
  onExport,
  onSaveProject,
}: ExportPanelProps) {
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
        disabled={isPluginExporting}
        onChange={changeFormat}
      >
        {EXPORT_TEMPLATES.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
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
          ? selectedPluginFormat.disabledReason ?? pluginText.exportFormatDescription
          : selectedTemplate.description}
      </p>
      {selectedFormatId === "custom" && (
        <textarea
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
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="rounded bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          type="button"
          disabled={
            disabled ||
            selectedPluginFormat !== undefined ||
            !canSaveProject ||
            isSaving ||
            isPluginExporting
          }
          onClick={onSaveProject}
        >
          {isSaving ? "保存中..." : "保存"}
        </button>
        <button
          className="rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={disabled || selectedDisabled || isPluginExporting}
          onClick={onExport}
        >
          另存为
        </button>
      </div>
    </section>
  );
}
