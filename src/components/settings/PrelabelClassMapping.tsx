import { useEffect, useMemo, useState } from "react";
import { DEFAULT_LABEL_COLORS } from "../../lib/defaults/labels";
import type { ProjectConfig } from "../../lib/importers";
import {
  createLabelForPrelabelClass,
  isUnmatchedPrelabelMapping,
  resolvePrelabelClassMappings,
} from "../../lib/prelabel-mapping";
import type { LabelConfig } from "../../types/annotation";
import type { PrelabelClassMapping, ResolvedPrelabelClassMapping } from "../../types/prelabel";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import { inputClass } from "./PrelabelModelForm";

export function ClassMappingPanel({
  activeProjectConfig,
  disabled,
  isLabelDirty,
  labels,
  classNames,
  sourceId,
  onSave,
}: {
  activeProjectConfig: ProjectConfig | null;
  disabled: boolean;
  isLabelDirty: boolean;
  labels: LabelConfig[];
  classNames: string[];
  sourceId: string;
  onSave: (mappings: PrelabelClassMapping[], labels: LabelConfig[]) => Promise<void>;
}) {
  const savedMappings = activeProjectConfig?.prelabelMappings?.[sourceId] ?? [];
  const resolved = useMemo(
    () =>
      resolvePrelabelClassMappings(
        sourceId,
        classNames,
        labels,
        activeProjectConfig?.prelabelMappings ?? {},
      ),
    [activeProjectConfig?.prelabelMappings, classNames, labels, sourceId],
  );
  const unmatchedCount = resolved.filter(isUnmatchedPrelabelMapping).length;

  function upsertMapping(next: PrelabelClassMapping): PrelabelClassMapping[] {
    return [
      ...savedMappings.filter((mapping) => mapping.classIndex !== next.classIndex),
      next,
    ].sort((left, right) => left.classIndex - right.classIndex);
  }

  async function bind(mapping: ResolvedPrelabelClassMapping, labelId: string) {
    await onSave(
      upsertMapping({
        classIndex: mapping.classIndex,
        className: mapping.className,
        action: "bind",
        labelId,
      }),
      labels,
    );
  }

  async function create(mapping: ResolvedPrelabelClassMapping) {
    const label = createLabelForPrelabelClass(
      labels,
      mapping.className,
      DEFAULT_LABEL_COLORS[labels.length % DEFAULT_LABEL_COLORS.length],
    );
    await onSave(
      upsertMapping({
        classIndex: mapping.classIndex,
        className: mapping.className,
        action: "create",
        labelId: label.id,
      }),
      [...labels, label],
    );
  }

  async function exclude(mapping: ResolvedPrelabelClassMapping) {
    await onSave(
      upsertMapping({
        classIndex: mapping.classIndex,
        className: mapping.className,
        action: "exclude",
      }),
      labels,
    );
  }

  return (
    <section className="mt-6 border-t border-slate-800 pt-5">
      <h3 className="font-medium text-slate-100">{text.mappingTitle}</h3>
      <p className="mt-1 text-xs text-slate-400">{text.mappingDescription}</p>
      {!activeProjectConfig && (
        <p className="mt-3 rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
          {text.mappingNeedsProject}
        </p>
      )}
      {isLabelDirty && (
        <p className="mt-3 rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
          {text.mappingDirtyLabels}
        </p>
      )}
      <p
        className={`mt-3 rounded border p-3 text-sm ${
          unmatchedCount > 0
            ? "border-amber-500/50 bg-amber-500/10 text-amber-100"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
        }`}
      >
        {unmatchedCount > 0 ? text.mappingUnmatched(unmatchedCount) : text.mappingComplete}
      </p>
      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
        {resolved.map((mapping) => (
          <ClassMappingRow
            disabled={!activeProjectConfig || disabled}
            key={`${mapping.classIndex}:${mapping.className}`}
            labels={labels}
            mapping={mapping}
            onBind={(labelId) => bind(mapping, labelId)}
            onCreate={() => create(mapping)}
            onExclude={() => exclude(mapping)}
          />
        ))}
      </div>
    </section>
  );
}

function ClassMappingRow({
  disabled,
  labels,
  mapping,
  onBind,
  onCreate,
  onExclude,
}: {
  disabled: boolean;
  labels: LabelConfig[];
  mapping: ResolvedPrelabelClassMapping;
  onBind: (labelId: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onExclude: () => Promise<void>;
}) {
  const [selectedLabelId, setSelectedLabelId] = useState(mapping.labelId ?? labels[0]?.id ?? "");
  useEffect(() => {
    setSelectedLabelId(mapping.labelId ?? labels[0]?.id ?? "");
  }, [labels, mapping.labelId]);

  const status =
    mapping.source === "auto-exact"
      ? text.mappingAutoExact
      : mapping.source === "auto-ascii-case-insensitive"
        ? text.mappingAutoAscii
        : mapping.source === "explicit"
          ? text.mappingExplicit
          : mapping.source === "explicit-exclude"
            ? text.mappingExcluded
            : text.mappingUnresolved;
  return (
    <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-100">
          <span className="mr-2 text-xs text-slate-500">{mapping.classIndex}</span>
          {mapping.className}
        </span>
        <span
          className={`text-xs ${
            mapping.labelId || mapping.excluded ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          {status}
          {mapping.labelId
            ? ` → ${labels.find((label) => label.id === mapping.labelId)?.name ?? mapping.labelId}`
            : ""}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <select
          aria-label={text.chooseLabel}
          className={inputClass}
          disabled={disabled || labels.length === 0}
          value={selectedLabelId}
          onChange={(event) => setSelectedLabelId(event.target.value)}
        >
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <button
          className="rounded border border-sky-500/50 px-3 py-2 text-xs text-sky-200 disabled:opacity-50"
          disabled={disabled || !selectedLabelId}
          type="button"
          onClick={() => void onBind(selectedLabelId)}
        >
          {text.bindExisting}
        </button>
        <button
          className="rounded border border-emerald-500/50 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50"
          disabled={disabled}
          type="button"
          onClick={() => void onCreate()}
        >
          {text.createFromClass}
        </button>
        <button
          className="rounded border border-slate-600 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
          disabled={disabled}
          type="button"
          onClick={() => void onExclude()}
        >
          {text.excludeClass}
        </button>
      </div>
    </div>
  );
}
