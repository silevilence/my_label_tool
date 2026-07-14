import { DEFAULT_LABEL_COLORS } from "./defaults/labels";
import type { TextFileEntry } from "./tauri-api";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ExportFormatId } from "../types/export";

export const PROJECT_CONFIG_NAME = "my-label-tool.project.json";

export type ImportFormatId = Exclude<ExportFormatId, "custom">;

export interface ProjectConfig {
  schemaVersion: 1;
  format: ImportFormatId;
  annotationPath: string;
  exportedAt: string;
  imageFolder: string;
  labels: LabelConfig[];
  template: {
    id: string;
    name: string;
  };
  exportOptions: {
    format: ExportFormatId;
  };
}

export interface ImportedImageAnnotations {
  path?: string;
  name: string;
  annotations: AnnotationShape[];
}

export interface ImportedAnnotations {
  labels: LabelConfig[];
  images: ImportedImageAnnotations[];
}

export interface TextImportFile extends TextFileEntry {
  content: string;
}

export interface ImageSize {
  name: string;
  width: number;
  height: number;
}

export function parseProjectConfig(text: string): ProjectConfig {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) {
    throw new Error("项目配置必须是 JSON 对象");
  }

  const schemaVersion = value.schemaVersion;
  const format = value.format;
  const annotationPath = value.annotationPath;
  const imageFolder = value.imageFolder;
  const exportedAt = value.exportedAt;

  if (schemaVersion !== 1) {
    throw new Error("不支持的项目配置版本");
  }
  if (!isImportFormat(format)) {
    throw new Error("项目配置中的导入格式无效");
  }
  if (typeof annotationPath !== "string" || annotationPath.trim() === "") {
    throw new Error("项目配置缺少标注文件路径");
  }
  if (typeof imageFolder !== "string") {
    throw new Error("项目配置缺少图片目录信息");
  }
  if (typeof exportedAt !== "string") {
    throw new Error("项目配置缺少导出时间");
  }

  return {
    schemaVersion,
    format,
    annotationPath,
    exportedAt,
    imageFolder,
    labels: parseLabels(value.labels),
    template: parseTemplate(value.template),
    exportOptions: parseExportOptions(value.exportOptions),
  };
}

export function parseNativeJsonImport(text: string): ImportedAnnotations {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) {
    throw new Error("原生 JSON 标注必须是对象");
  }

  const labels = parseLabels(value.labels);
  const images = asArray(value.images, "images").map((image, imageIndex) => {
    if (!isRecord(image)) {
      throw new Error(`images[${imageIndex}] 必须是对象`);
    }

    const name = typeof image.name === "string" ? image.name : fileName(String(image.path ?? ""));
    if (!name) {
      throw new Error(`images[${imageIndex}] 缺少图片名称`);
    }

    return {
      path: typeof image.path === "string" ? image.path : undefined,
      name,
      annotations: parseAnnotations(image.annotations, `images[${imageIndex}].annotations`),
    };
  });

  return { labels, images };
}

export function parseCocoImport(text: string): ImportedAnnotations {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) {
    throw new Error("COCO 标注必须是 JSON 对象");
  }

  const labels = asArray(value.categories, "categories").map((category, index) => {
    if (!isRecord(category)) {
      throw new Error(`categories[${index}] 必须是对象`);
    }
    const id = scalarId(category.id, `categories[${index}].id`);
    const name = typeof category.name === "string" && category.name ? category.name : id;
    return makeLabel(`coco-${id}`, name, index);
  });
  const labelByCategoryId = new Map(labels.map((label) => [label.id.replace(/^coco-/, ""), label]));
  const annotationsByImageId = new Map<string, AnnotationShape[]>();

  asArray(value.annotations, "annotations").forEach((annotation, index) => {
    if (!isRecord(annotation)) {
      throw new Error(`annotations[${index}] 必须是对象`);
    }
    const imageId = scalarId(annotation.image_id, `annotations[${index}].image_id`);
    const categoryId = scalarId(annotation.category_id, `annotations[${index}].category_id`);
    const label = labelByCategoryId.get(categoryId);
    if (!label) {
      throw new Error(`annotations[${index}] 引用了不存在的 category_id`);
    }

    const bbox = numberArray(annotation.bbox, `annotations[${index}].bbox`);
    if (bbox.length < 4) {
      throw new Error(`annotations[${index}].bbox 至少需要 4 个数字`);
    }

    const items = annotationsByImageId.get(imageId) ?? [];
    items.push({
      id: `coco-${scalarId(annotation.id, `annotations[${index}].id`, String(index + 1))}`,
      type: "rect",
      labelId: label.id,
      points: bbox.slice(0, 4),
      frameIndex: 0,
    });
    annotationsByImageId.set(imageId, items);
  });

  const images = asArray(value.images, "images").map((image, index) => {
    if (!isRecord(image)) {
      throw new Error(`images[${index}] 必须是对象`);
    }
    const id = scalarId(image.id, `images[${index}].id`);
    const name =
      typeof image.file_name === "string" && image.file_name ? fileName(image.file_name) : id;
    return {
      name,
      annotations: annotationsByImageId.get(id) ?? [],
    };
  });

  return { labels, images };
}

export function parseVocImport(files: TextImportFile[]): ImportedAnnotations {
  const parsedImages = files.map((file) => parseVocFile(file));
  const labelNames = unique(
    parsedImages.flatMap((image) => image.annotations.map((item) => item.labelName)),
  );
  const labels = labelNames.map((name, index) =>
    makeLabel(`voc-${index}-${slug(name) || "label"}`, name, index),
  );
  const labelByName = new Map(labels.map((label) => [label.name, label]));

  return {
    labels,
    images: parsedImages.map((image) => ({
      name: image.name,
      annotations: image.annotations.map((annotation, index) => ({
        id: `voc-${baseName(image.name)}-${index + 1}`,
        type: "rect",
        labelId: labelByName.get(annotation.labelName)?.id ?? labels[0]?.id ?? "unknown",
        points: annotation.points,
        frameIndex: 0,
      })),
    })),
  };
}

export function parseYoloImport(
  files: TextImportFile[],
  imageSizesByBaseName: Map<string, ImageSize>,
): ImportedAnnotations {
  const classesFile = files.find((file) => file.name.toLowerCase() === "classes.txt");
  if (!classesFile) {
    throw new Error("YOLO 导入目录缺少 classes.txt");
  }

  const classNames = classesFile.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (classNames.length === 0) {
    throw new Error("classes.txt 中没有标签");
  }

  const labels = classNames.map((name, index) => makeLabel(`yolo-${index}`, name, index));
  const images = files
    .filter((file) => file.name.toLowerCase() !== "classes.txt")
    .map((file) => {
      const image = imageSizesByBaseName.get(baseName(file.name).toLowerCase());
      if (!image) {
        return null;
      }

      return {
        name: image.name,
        annotations: file.content
          .split(/\r?\n/)
          .map((line, lineIndex) => parseYoloLine(line, lineIndex, image, labels))
          .filter((annotation): annotation is AnnotationShape => annotation !== null),
      };
    })
    .filter((image): image is ImportedImageAnnotations => image !== null);

  return { labels, images };
}

function parseVocFile(file: TextImportFile): {
  name: string;
  annotations: Array<{ labelName: string; points: number[] }>;
} {
  const document = new window.DOMParser().parseFromString(file.content, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`VOC XML 解析失败：${file.name}`);
  }

  const name = firstText(document, "filename") || `${baseName(file.name)}.jpg`;
  const objects = Array.from(document.getElementsByTagName("object"));
  return {
    name: fileName(name),
    annotations: objects.map((object, index) => {
      const labelName = firstText(object, "name");
      if (!labelName) {
        throw new Error(`${file.name} object[${index}] 缺少 name`);
      }

      const box = object.getElementsByTagName("bndbox")[0];
      if (!box) {
        throw new Error(`${file.name} object[${index}] 缺少 bndbox`);
      }

      const xmin = numberText(box, "xmin", file.name);
      const ymin = numberText(box, "ymin", file.name);
      const xmax = numberText(box, "xmax", file.name);
      const ymax = numberText(box, "ymax", file.name);

      return {
        labelName,
        points: [xmin, ymin, Math.max(1, xmax - xmin), Math.max(1, ymax - ymin)],
      };
    }),
  };
}

function parseYoloLine(
  line: string,
  lineIndex: number,
  image: ImageSize,
  labels: LabelConfig[],
): AnnotationShape | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) {
    throw new Error(`${image.name} 第 ${lineIndex + 1} 行 YOLO 标注字段不足`);
  }

  const classIndex = Number(parts[0]);
  const label = Number.isInteger(classIndex) ? labels[classIndex] : undefined;
  if (!label) {
    throw new Error(`${image.name} 第 ${lineIndex + 1} 行标签索引无效`);
  }

  const [cx, cy, width, height] = parts.slice(1, 5).map((part) => Number(part));
  if (![cx, cy, width, height].every(Number.isFinite)) {
    throw new Error(`${image.name} 第 ${lineIndex + 1} 行坐标无效`);
  }

  const pixelWidth = width * image.width;
  const pixelHeight = height * image.height;
  return {
    id: `yolo-${baseName(image.name)}-${lineIndex + 1}`,
    type: "rect",
    labelId: label.id,
    points: [
      cx * image.width - pixelWidth / 2,
      cy * image.height - pixelHeight / 2,
      pixelWidth,
      pixelHeight,
    ],
    frameIndex: 0,
  };
}

function parseLabels(value: unknown): LabelConfig[] {
  return asArray(value, "labels").map((label, index) => {
    if (!isRecord(label)) {
      throw new Error(`labels[${index}] 必须是对象`);
    }

    const id = typeof label.id === "string" && label.id ? label.id : `label-${index + 1}`;
    const name = typeof label.name === "string" && label.name ? label.name : id;
    const color =
      typeof label.color === "string" && label.color
        ? label.color
        : DEFAULT_LABEL_COLORS[index % DEFAULT_LABEL_COLORS.length];
    const shortcut = typeof label.shortcut === "string" ? label.shortcut : undefined;

    return { id, name, color, shortcut, shapeType: "rect" };
  });
}

function parseAnnotations(value: unknown, field: string): AnnotationShape[] {
  return asArray(value, field).map((annotation, index) => {
    if (!isRecord(annotation)) {
      throw new Error(`${field}[${index}] 必须是对象`);
    }

    const labelId = annotation.labelId;
    if (typeof labelId !== "string" || !labelId) {
      throw new Error(`${field}[${index}] 缺少 labelId`);
    }

    const points = numberArray(annotation.points, `${field}[${index}].points`);
    if (points.length < 4) {
      throw new Error(`${field}[${index}].points 至少需要 4 个数字`);
    }

    return {
      id:
        typeof annotation.id === "string" && annotation.id
          ? annotation.id
          : `${field}-${index + 1}`,
      type: "rect",
      labelId,
      points: points.slice(0, 4),
      attributes: parseAttributes(annotation.attributes),
      frameIndex: typeof annotation.frameIndex === "number" ? annotation.frameIndex : 0,
    };
  });
}

function parseAttributes(value: unknown): AnnotationShape["attributes"] {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
}

function parseTemplate(value: unknown): ProjectConfig["template"] {
  if (!isRecord(value)) {
    return { id: "project-import", name: "导入项目模板" };
  }

  return {
    id: typeof value.id === "string" && value.id ? value.id : "project-import",
    name: typeof value.name === "string" && value.name ? value.name : "导入项目模板",
  };
}

function parseExportOptions(value: unknown): ProjectConfig["exportOptions"] {
  if (!isRecord(value)) {
    return { format: "json" };
  }

  return { format: isExportFormat(value.format) ? value.format : "json" };
}

function makeLabel(id: string, name: string, index: number): LabelConfig {
  return {
    id,
    name,
    color: DEFAULT_LABEL_COLORS[index % DEFAULT_LABEL_COLORS.length],
    shapeType: "rect",
  };
}

function firstText(parent: Document | Element, tagName: string): string {
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? "";
}

function numberText(parent: Element, tagName: string, fileName: string): number {
  const value = Number(firstText(parent, tagName));
  if (!Number.isFinite(value)) {
    throw new Error(`${fileName} 中 ${tagName} 不是有效数字`);
  }
  return value;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} 必须是数组`);
  }
  return value;
}

function numberArray(value: unknown, field: string): number[] {
  const values = asArray(value, field);
  if (!values.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new Error(`${field} 必须全部是数字`);
  }
  return values.map((item) => Number(item));
}

function scalarId(value: unknown, field: string, fallback?: string): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${field} 缺少有效 id`);
}

function isImportFormat(value: unknown): value is ImportFormatId {
  return value === "json" || value === "coco" || value === "voc" || value === "yolo";
}

function isExportFormat(value: unknown): value is ExportFormatId {
  return isImportFormat(value) || value === "custom";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function baseName(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, "");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
