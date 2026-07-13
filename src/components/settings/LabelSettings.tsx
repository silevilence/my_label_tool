import { useState } from "react";
import { DEFAULT_LABEL_COLORS } from "../../lib/defaults/labels";
import type { LabelConfig, LabelTemplate } from "../../types/annotation";

interface LabelSettingsProps {
  labels: LabelConfig[];
  templates: LabelTemplate[];
  selectedTemplateId: string;
  isDirty: boolean;
  canSaveTemplate: boolean;
  canDeleteTemplate: boolean;
  usedLabelIds: Set<string>;
  onCancelChanges: () => void;
  onChangeLabels: (labels: LabelConfig[]) => void;
  onDeleteTemplate: () => void;
  onNewTemplate: () => void;
  onSaveTemplate: () => void;
  onSaveTemplateAs: () => void;
  onSelectTemplate: (templateId: string) => void;
}

export function LabelSettings({
  labels,
  templates,
  selectedTemplateId,
  isDirty,
  canSaveTemplate,
  canDeleteTemplate,
  usedLabelIds,
  onCancelChanges,
  onChangeLabels,
  onDeleteTemplate,
  onNewTemplate,
  onSaveTemplate,
  onSaveTemplateAs,
  onSelectTemplate,
}: LabelSettingsProps) {
  const [newLabelName, setNewLabelName] = useState("");

  function addLabel() {
    const name = newLabelName.trim();
    if (!name) {
      return;
    }

    onChangeLabels([
      ...labels,
      {
        id: newLabelId(labels, name),
        name,
        color: DEFAULT_LABEL_COLORS[labels.length % DEFAULT_LABEL_COLORS.length],
        shapeType: "rect",
      },
    ]);
    setNewLabelName("");
  }

  function patchLabel(labelId: string, patch: Partial<LabelConfig>) {
    onChangeLabels(labels.map((label) => (label.id === labelId ? { ...label, ...patch } : label)));
  }

  function updateShortcut(labelId: string, value: string) {
    const shortcut = value.trim().toLowerCase();
    if (!shortcut) {
      patchLabel(labelId, { shortcut: undefined });
      return;
    }

    if (!/^[a-z0-9]$/.test(shortcut)) {
      window.alert("快捷键只能是单个数字或字母。");
      return;
    }

    const conflict = labels.find((label) => label.id !== labelId && label.shortcut === shortcut);
    if (conflict) {
      window.alert(`快捷键 ${shortcut} 已被「${conflict.name}」使用。`);
      return;
    }

    patchLabel(labelId, { shortcut });
  }

  function deleteLabel(label: LabelConfig) {
    if (labels.length === 1) {
      window.alert("至少需要保留一个标签。");
      return;
    }

    if (
      usedLabelIds.has(label.id) &&
      !window.confirm(`「${label.name}」已被矩形框使用，删除后这些框会改为第一个可用标签。`)
    ) {
      return;
    }

    onChangeLabels(labels.filter((item) => item.id !== label.id));
  }

  return (
    <section className="border-b border-slate-800 p-4">
      <h2 className="text-sm font-medium text-slate-200">标签配置</h2>

      <div className="mt-3 grid gap-2">
        <select
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          value={selectedTemplateId}
          onChange={(event) => onSelectTemplate(event.target.value)}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700"
            type="button"
            onClick={onNewTemplate}
          >
            新增模板
          </button>
          <button
            className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            type="button"
            disabled={!isDirty && canSaveTemplate}
            title={canSaveTemplate ? undefined : "内置模板会自动另存为新模板"}
            onClick={onSaveTemplate}
          >
            保存
          </button>
          <button
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-600"
            type="button"
            disabled={!isDirty}
            onClick={onCancelChanges}
          >
            取消修改
          </button>
          <button
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-slate-700"
            type="button"
            onClick={onSaveTemplateAs}
          >
            另存为
          </button>
          <button
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-600"
            type="button"
            disabled={!canDeleteTemplate}
            title={canDeleteTemplate ? undefined : "内置模板不能删除"}
            onClick={onDeleteTemplate}
          >
            删除模板
          </button>
        </div>
        {isDirty && <p className="text-xs text-amber-300">有未保存的标签修改。</p>}
      </div>

      <div className="mt-3 space-y-2">
        {labels.map((label) => (
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2" key={label.id}>
            <input
              className="min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              value={label.name}
              aria-label="标签名称"
              onChange={(event) => patchLabel(label.id, { name: event.target.value })}
            />
            <input
              className="h-8 w-10 rounded border border-slate-700 bg-slate-950"
              type="color"
              value={label.color}
              aria-label={`${label.name} 颜色`}
              onChange={(event) => patchLabel(label.id, { color: event.target.value })}
            />
            <input
              className="w-12 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center text-sm text-slate-100"
              maxLength={1}
              placeholder="-"
              value={label.shortcut ?? ""}
              aria-label={`${label.name} 快捷键`}
              onChange={(event) => updateShortcut(label.id, event.target.value)}
            />
            <button
              className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-red-500 hover:text-white"
              type="button"
              onClick={() => deleteLabel(label)}
            >
              删除
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          placeholder="新标签名称"
          value={newLabelName}
          onChange={(event) => setNewLabelName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              addLabel();
            }
          }}
        />
        <button
          className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400"
          type="button"
          onClick={addLabel}
        >
          新增
        </button>
      </div>
    </section>
  );
}

function newLabelId(labels: LabelConfig[], name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const prefix = base || "label";
  let id = prefix;
  let suffix = 2;

  while (labels.some((label) => label.id === id)) {
    id = `${prefix}-${suffix}`;
    suffix += 1;
  }

  return id;
}
