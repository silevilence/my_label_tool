import type { AnnotationShape, LabelConfig } from "../types/annotation";

export interface LabelTemplateChange {
  added: LabelConfig[];
  ambiguousNames: string[];
  deleted: Array<{ label: LabelConfig; count: number }>;
  remapped: Array<{ from: LabelConfig; to: LabelConfig; count: number }>;
  renamed: Array<{ from: LabelConfig; to: LabelConfig; count: number }>;
  reordered: boolean;
}

export function analyzeLabelTemplateChange(
  before: LabelConfig[],
  after: LabelConfig[],
  annotationsByImage: Record<string, AnnotationShape[]>,
): LabelTemplateChange {
  const usage = labelUsage(annotationsByImage);
  const afterById = new Map(after.map((label) => [label.id, label]));
  const usedAfterIds = new Set<string>();
  const nameCounts = countNames(after);
  const ambiguousNames = new Set<string>();
  const deleted: LabelTemplateChange["deleted"] = [];
  const remapped: LabelTemplateChange["remapped"] = [];
  const renamed: LabelTemplateChange["renamed"] = [];
  const indexByAfterId = new Map(after.map((label, index) => [label.id, index]));
  let reordered = false;

  before.forEach((oldLabel, oldIndex) => {
    const sameId = afterById.get(oldLabel.id);
    if (sameId) {
      usedAfterIds.add(sameId.id);
      if (oldLabel.name !== sameId.name) {
        renamed.push({ from: oldLabel, to: sameId, count: usage.get(oldLabel.id) ?? 0 });
      }
      if (indexByAfterId.get(sameId.id) !== oldIndex) {
        reordered = true;
      }
      return;
    }

    const nameKey = labelNameKey(oldLabel.name);
    const sameName = after.filter((label) => labelNameKey(label.name) === nameKey);
    if (sameName.length === 1 && nameCounts.get(nameKey) === 1) {
      const nextLabel = sameName[0];
      usedAfterIds.add(nextLabel.id);
      remapped.push({
        from: oldLabel,
        to: nextLabel,
        count: usage.get(oldLabel.id) ?? 0,
      });
      if (indexByAfterId.get(nextLabel.id) !== oldIndex) {
        reordered = true;
      }
      return;
    }

    if (sameName.length > 1) {
      ambiguousNames.add(oldLabel.name);
      return;
    }

    deleted.push({ label: oldLabel, count: usage.get(oldLabel.id) ?? 0 });
  });

  return {
    added: after.filter((label) => !usedAfterIds.has(label.id) && !before.some((old) => old.id === label.id)),
    ambiguousNames: [...ambiguousNames],
    deleted,
    remapped,
    renamed,
    reordered,
  };
}

export function applyLabelTemplateChange(
  annotationsByImage: Record<string, AnnotationShape[]>,
  change: LabelTemplateChange,
): Record<string, AnnotationShape[]> {
  const remap = new Map(change.remapped.map((item) => [item.from.id, item.to.id]));
  const deleted = new Set(change.deleted.map((item) => item.label.id));

  return Object.fromEntries(
    Object.entries(annotationsByImage).map(([imagePath, annotations]) => [
      imagePath,
      annotations
        .filter((annotation) => !deleted.has(annotation.labelId))
        .map((annotation) => {
          const nextLabelId = remap.get(annotation.labelId);
          return nextLabelId ? { ...annotation, labelId: nextLabelId } : annotation;
        }),
    ]),
  );
}

export function formatLabelTemplateChange(change: LabelTemplateChange): string {
  const lines: string[] = [];
  if (change.added.length > 0) {
    lines.push(`新增标签：${change.added.map((label) => label.name).join("、")}`);
  }
  if (change.deleted.length > 0) {
    lines.push(
      `删除标签：${change.deleted
        .map((item) => `${item.label.name}${item.count > 0 ? `（${item.count} 个标注）` : ""}`)
        .join("、")}`,
    );
  }
  if (change.remapped.length > 0) {
    lines.push(
      `同名新标签映射：${change.remapped
        .map((item) => `${item.from.name} ${item.from.id} → ${item.to.id}（${item.count} 个标注）`)
        .join("、")}`,
    );
  }
  if (change.renamed.length > 0) {
    lines.push(
      `重命名：${change.renamed
        .map((item) => `${item.from.name} → ${item.to.name}`)
        .join("、")}`,
    );
  }
  if (change.reordered) {
    lines.push("标签顺序变化：导出类别索引将按新顺序生成");
  }
  return lines.join("\n");
}

export function hasDanglingLabels(
  annotationsByImage: Record<string, AnnotationShape[]>,
  labels: LabelConfig[],
): boolean {
  const labelIds = new Set(labels.map((label) => label.id));
  return Object.values(annotationsByImage)
    .flat()
    .some((annotation) => !labelIds.has(annotation.labelId));
}

function labelUsage(annotationsByImage: Record<string, AnnotationShape[]>): Map<string, number> {
  const usage = new Map<string, number>();
  for (const annotation of Object.values(annotationsByImage).flat()) {
    usage.set(annotation.labelId, (usage.get(annotation.labelId) ?? 0) + 1);
  }
  return usage;
}

function countNames(labels: LabelConfig[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const key = labelNameKey(label.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function labelNameKey(name: string): string {
  return name.trim().toLowerCase();
}
