import type { ChangeEvent } from "react";
import { EXPORT_TEMPLATES } from "../../lib/defaults/exports";
import type { ExportFormatId } from "../../types/export";

interface ExportPanelProps {
  customMappingText: string;
  disabled: boolean;
  selectedFormatId: ExportFormatId;
  canSaveProject: boolean;
  onChangeCustomMappingText: (value: string) => void;
  onChangeFormat: (formatId: ExportFormatId) => void;
  onExport: () => void;
  onSaveProject: () => void;
}

export function ExportPanel({
  customMappingText,
  disabled,
  selectedFormatId,
  canSaveProject,
  onChangeCustomMappingText,
  onChangeFormat,
  onExport,
  onSaveProject,
}: ExportPanelProps) {
  const selectedTemplate =
    EXPORT_TEMPLATES.find((template) => template.id === selectedFormatId) ?? EXPORT_TEMPLATES[0];

  function changeFormat(event: ChangeEvent<HTMLSelectElement>) {
    onChangeFormat(event.target.value as ExportFormatId);
  }

  return (
    <section className="shrink-0 border-b border-slate-800 p-4">
      <h2 className="text-sm font-semibold text-slate-200">导出</h2>
      <select
        className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
        value={selectedFormatId}
        onChange={changeFormat}
      >
        {EXPORT_TEMPLATES.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
      <p className="mt-2 text-xs text-slate-400">{selectedTemplate.description}</p>
      {selectedFormatId === "custom" && (
        <textarea
          className="mt-3 h-32 w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100"
          spellCheck={false}
          value={customMappingText}
          onChange={(event) => onChangeCustomMappingText(event.target.value)}
        />
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="rounded bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          type="button"
          disabled={disabled || !canSaveProject}
          onClick={onSaveProject}
        >
          保存
        </button>
        <button
          className="rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={disabled}
          onClick={onExport}
        >
          另存为
        </button>
      </div>
    </section>
  );
}
