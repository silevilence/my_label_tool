import { DEFAULT_CUSTOM_EXPORT_MAPPING } from "./defaults/exports";
import { DEFAULT_LABEL_TEMPLATES } from "./defaults/labels";
import { DEFAULT_SHORTCUTS, type ShortcutMap } from "./defaults/shortcuts";
import { confirmAction, exportAnnotationsJson, imageFileSrc, type ImageFile } from "./tauri-api";
import { useAnnotationStore } from "../store/useAnnotationStore";
import type { AnnotationShape, LabelTemplate } from "../types/annotation";
import type { CustomExportMapping } from "../types/export";
import { PROJECT_CONFIG_NAME, type ImportedAnnotations, type ProjectConfig } from "./importers";

export function mergeShortcuts(savedShortcuts: Record<string, string>): ShortcutMap {
  const nextShortcuts = { ...DEFAULT_SHORTCUTS };
  for (const action of Object.keys(nextShortcuts) as Array<keyof ShortcutMap>) {
    if (typeof savedShortcuts[action] === "string") {
      nextShortcuts[action] = savedShortcuts[action];
    }
  }
  return nextShortcuts;
}

export function loadImageSize(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`无法读取图片尺寸：${path}`));
    image.src = imageFileSrc(path);
  });
}

export async function confirmReplaceCurrentAnnotations(images: ImageFile[]): Promise<boolean> {
  const annotationsByImage = useAnnotationStore.getState().annotationsByImage;
  const count = images.reduce(
    (total, image) => total + (annotationsByImage[image.path]?.length ?? 0),
    0,
  );
  return count === 0 || confirmAction("当前图片目录已有标注，导入后会覆盖，是否继续？");
}

export function matchImportedImages(
  imported: ImportedAnnotations,
  currentImages: ImageFile[],
): { annotationsByImage: Record<string, AnnotationShape[]>; missingCount: number } {
  const byPath = new Map(currentImages.map((image) => [normalizePath(image.path), image]));
  const byName = new Map(currentImages.map((image) => [image.name.toLowerCase(), image]));
  const annotationsByImage: Record<string, AnnotationShape[]> = {};
  let missingCount = 0;

  for (const image of imported.images) {
    const currentImage =
      (image.path ? byPath.get(normalizePath(image.path)) : undefined) ??
      byName.get(image.name.toLowerCase());
    if (!currentImage) {
      missingCount += 1;
      continue;
    }
    annotationsByImage[currentImage.path] = image.annotations;
  }

  return { annotationsByImage, missingCount };
}

export function projectConfigPath(folderPath: string): string {
  return joinPath(folderPath, PROJECT_CONFIG_NAME);
}

export function joinPath(folderPath: string, name: string): string {
  const separator = folderPath.includes("\\") ? "\\" : "/";
  return `${folderPath.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function baseName(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? path
  );
}

export function saveProjectConfig(path: string, config: ProjectConfig): Promise<void> {
  return exportAnnotationsJson(path, config);
}

export function parseCustomMapping(text: string): Required<CustomExportMapping> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error("自定义导出映射必须是 JSON 对象");
  }

  const mapping = { ...DEFAULT_CUSTOM_EXPORT_MAPPING };
  for (const key of Object.keys(mapping) as Array<keyof Required<CustomExportMapping>>) {
    const value = parsed[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`自定义导出映射字段 ${key} 必须是非空字符串`);
    }
    mapping[key] = value;
  }

  return mapping;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function isUserTemplate(templateId: string): boolean {
  return !DEFAULT_LABEL_TEMPLATES.some((template) => template.id === templateId);
}

export function newTemplateId(templates: LabelTemplate[], name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = base || "template";
  const ids = new Set(templates.map((template) => template.id));
  let id = `user-${prefix}`;
  let index = 2;
  while (ids.has(id)) {
    id = `user-${prefix}-${index}`;
    index += 1;
  }
  return id;
}

export function newAnnotationId(): string {
  return crypto.randomUUID();
}
