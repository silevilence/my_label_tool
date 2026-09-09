import type { AnnotationShape, LabelShapeType, LabelConfig } from "../types/annotation";
import type { ImportedImageAnnotations } from "./importers";
import { labelNameKey } from "./label-template-sync";

export interface LabelMergeResult {
  labels: LabelConfig[];
  matchedCount: number;
  createdCount: number;
  ambiguousNames: string[];
}

/**
 * 将导入的标签与当前标签按名称合并：命中时继承既有标签的
 * id/shortcut/color/shapeType（保持导入顺序，YOLO 类别索引依赖顺序），
 * 未命中时保留导入标签属性，ID 冲突时生成新 ID。同名歧义不继承；
 * 为未匹配标签避开全部既有 ID，防止切回模板时引用另一类别。
 */
export function mergeImportedLabels(
  imported: LabelConfig[],
  existing: LabelConfig[],
): LabelMergeResult {
  const importedKeyCounts = new Map<string, number>();
  for (const label of imported) {
    const key = labelNameKey(label.name);
    importedKeyCounts.set(key, (importedKeyCounts.get(key) ?? 0) + 1);
  }

  const existingByKey = new Map<string, LabelConfig[]>();
  for (const label of existing) {
    const key = labelNameKey(label.name);
    existingByKey.set(key, [...(existingByKey.get(key) ?? []), label]);
  }

  const ambiguousNames = new Set<string>();
  const existingIds = new Set(existing.map((label) => label.id));
  const reservedIds = new Set([...existingIds, ...imported.map((label) => label.id)]);
  const usedIds = new Set<string>();
  let matchedCount = 0;
  const matches = imported.map((label) => {
    const key = labelNameKey(label.name);
    if ((importedKeyCounts.get(key) ?? 0) > 1) {
      ambiguousNames.add(label.name);
      return undefined;
    }

    const candidates = existingByKey.get(key) ?? [];
    if (candidates.length > 1) {
      ambiguousNames.add(label.name);
      return undefined;
    }
    if (candidates.length === 0) {
      return undefined;
    }

    return candidates[0];
  });
  const labels = imported.map((label, index) => {
    const match = matches[index];
    let id = match?.id ?? label.id;
    if (usedIds.has(id) || (!match && existingIds.has(id))) {
      let suffix = 1;
      do {
        id = `${label.id}-imported-${suffix++}`;
      } while (reservedIds.has(id));
    }
    usedIds.add(id);
    reservedIds.add(id);
    if (!match) {
      return id === label.id ? label : { ...label, id };
    }
    matchedCount += 1;
    return {
      ...label,
      id,
      color: match.color,
      shortcut: match.shortcut,
      shapeType: isRectCompatibleShapeType(match.shapeType) ? match.shapeType : label.shapeType,
    };
  });

  return {
    labels,
    matchedCount,
    createdCount: imported.length - matchedCount,
    ambiguousNames: [...ambiguousNames],
  };
}

/**
 * 合并可能改写标签 id（继承既有 id），而导入标注的 labelId 仍指向导入标签 id；
 * 按导入顺序建立 id 映射并重写标注，保证标注与合并后模板引用一致。
 */
export function remapImportedAnnotationLabels(
  images: ImportedImageAnnotations[],
  importedLabels: LabelConfig[],
  mergedLabels: LabelConfig[],
): ImportedImageAnnotations[] {
  if (importedLabels.length !== mergedLabels.length) {
    return images;
  }

  const idByImportedId = new Map<string, string>();
  importedLabels.forEach((label, index) => {
    const merged = mergedLabels[index];
    if (merged && merged.id !== label.id) {
      idByImportedId.set(label.id, merged.id);
    }
  });
  if (idByImportedId.size === 0) {
    return images;
  }

  return images.map((image) => ({
    ...image,
    annotations: image.annotations.map((annotation): AnnotationShape => {
      const nextLabelId = idByImportedId.get(annotation.labelId);
      return nextLabelId ? { ...annotation, labelId: nextLabelId } : annotation;
    }),
  }));
}

function isRectCompatibleShapeType(shapeType: LabelShapeType): boolean {
  return shapeType === "rect" || shapeType === "any";
}
