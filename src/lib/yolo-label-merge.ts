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
 * 未命中时保留导入标签原样。同名歧义（导入内部重名或既有重名）不继承，
 * 避免多个类别映射到同一标签造成 id 冲突。
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
  let matchedCount = 0;
  const labels = imported.map((label) => {
    const key = labelNameKey(label.name);
    if ((importedKeyCounts.get(key) ?? 0) > 1) {
      ambiguousNames.add(label.name);
      return label;
    }

    const candidates = existingByKey.get(key) ?? [];
    if (candidates.length > 1) {
      ambiguousNames.add(label.name);
      return label;
    }
    if (candidates.length === 0) {
      return label;
    }

    const match = candidates[0];
    matchedCount += 1;
    return {
      ...label,
      id: match.id,
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
