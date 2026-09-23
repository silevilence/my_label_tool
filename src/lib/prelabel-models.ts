import type {
  ModelDownloadResult,
  OnnxModelSummary,
  PrelabelModelConfig,
  PrelabelModelLibrary,
} from "../types/prelabel";
import { PRELABEL_ZH_CN } from "../i18n/prelabel.zh-CN";
import {
  DEFAULT_PRELABEL_CONFIDENCE_THRESHOLD,
  DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE,
  DEFAULT_PRELABEL_IOU_THRESHOLD,
} from "./defaults/prelabel";

export function modelNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return fileName.replace(/\.onnx$/i, "") || PRELABEL_ZH_CN.defaultModelName;
}

export function prelabelFormatLabel(format: PrelabelModelConfig["format"]): string {
  return format === "yolo11" ? "YOLO11" : format === "yolov8" ? "YOLOv8" : "YOLOv5";
}

export function createPrelabelModelConfig(
  path: string,
  summary: OnnxModelSummary,
  id: string = crypto.randomUUID(),
  addedAt: string = new Date().toISOString(),
): PrelabelModelConfig {
  return {
    ...summary,
    id,
    name: modelNameFromPath(path),
    path,
    inputSizeOverride:
      summary.inputWidth === 0 || summary.inputHeight === 0
        ? [
            summary.inputWidth || DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE,
            summary.inputHeight || DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE,
          ]
        : null,
    confidenceThreshold: DEFAULT_PRELABEL_CONFIDENCE_THRESHOLD,
    iouThreshold: DEFAULT_PRELABEL_IOU_THRESHOLD,
    addedAt,
    device: "auto",
  };
}

export function addModelToLibrary(
  library: PrelabelModelLibrary,
  model: PrelabelModelConfig,
): PrelabelModelLibrary {
  return {
    ...library,
    models: [...library.models, model],
    currentModelId: library.currentModelId ?? model.id,
  };
}

export function updateModelInLibrary(
  library: PrelabelModelLibrary,
  model: PrelabelModelConfig,
): PrelabelModelLibrary {
  return {
    ...library,
    models: library.models.map((candidate) =>
      candidate.id === model.id
        ? { ...model, sourceUrl: model.sourceUrl?.trim() || undefined }
        : candidate,
    ),
  };
}

export function deleteModelFromLibrary(
  library: PrelabelModelLibrary,
  modelId: string,
): PrelabelModelLibrary {
  const models = library.models.filter((model) => model.id !== modelId);
  return {
    ...library,
    models,
    currentModelId:
      library.currentModelId === modelId ? (models[0]?.id ?? null) : library.currentModelId,
  };
}

export function selectModelInLibrary(
  library: PrelabelModelLibrary,
  modelId: string,
): PrelabelModelLibrary {
  if (!library.models.some((model) => model.id === modelId)) {
    throw new Error(PRELABEL_ZH_CN.missingModel);
  }
  return { ...library, currentModelId: modelId };
}

export function updateInputSizeOverride(
  model: PrelabelModelConfig,
  index: 0 | 1,
  raw: string,
): [number, number] | null {
  if (!raw && !model.inputSizeOverride) {
    return null;
  }
  const current: [number, number] = model.inputSizeOverride ?? [
    model.inputWidth || DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE,
    model.inputHeight || DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE,
  ];
  current[index] = raw
    ? Number(raw)
    : index === 0
      ? model.inputWidth || DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE
      : model.inputHeight || DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE;
  if (
    model.inputWidth > 0 &&
    model.inputHeight > 0 &&
    current[0] === model.inputWidth &&
    current[1] === model.inputHeight
  ) {
    return null;
  }
  return current;
}

export function isValidModelSourceUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    const fileName = parsed.pathname.split("/").pop() ?? "";
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0 &&
      fileName.length > 5 &&
      fileName.toLowerCase().endsWith(".onnx")
    );
  } catch {
    return false;
  }
}

/** 用下载结果更新模型配置：替换模型元数据与路径，记录更新时间；更新地址保持不变。 */
export function applyModelDownloadResult(
  model: PrelabelModelConfig,
  result: ModelDownloadResult,
  updatedAt: string = new Date().toISOString(),
): PrelabelModelConfig {
  return {
    ...model,
    path: result.path,
    inputSizeOverride:
      result.inputWidth === 0 || result.inputHeight === 0
        ? [
            result.inputWidth ||
              model.inputSizeOverride?.[0] ||
              model.inputWidth ||
              DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE,
            result.inputHeight ||
              model.inputSizeOverride?.[1] ||
              model.inputHeight ||
              DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE,
          ]
        : null,
    format: result.format,
    classCount: result.classCount,
    inputWidth: result.inputWidth,
    inputHeight: result.inputHeight,
    classNames: result.classNames,
    updatedAt,
  };
}

export function prelabelModelFieldErrors(model: PrelabelModelConfig) {
  return {
    name: !model.name.trim() ? PRELABEL_ZH_CN.fieldNameRequired : "",
    classNames: model.classNames.some((name) => !name.trim())
      ? PRELABEL_ZH_CN.fieldClassNamesBlank
      : "",
    confidence:
      !Number.isFinite(model.confidenceThreshold) ||
      model.confidenceThreshold < 0 ||
      model.confidenceThreshold > 1
        ? PRELABEL_ZH_CN.fieldThresholdRange
        : "",
    iou:
      !Number.isFinite(model.iouThreshold) || model.iouThreshold < 0 || model.iouThreshold > 1
        ? PRELABEL_ZH_CN.fieldThresholdRange
        : "",
    inputWidth:
      Number.isSafeInteger(model.inputSizeOverride?.[0] ?? model.inputWidth) &&
      (model.inputSizeOverride?.[0] ?? model.inputWidth) > 0
        ? ""
        : PRELABEL_ZH_CN.fieldSizePositive,
    inputHeight:
      Number.isSafeInteger(model.inputSizeOverride?.[1] ?? model.inputHeight) &&
      (model.inputSizeOverride?.[1] ?? model.inputHeight) > 0
        ? ""
        : PRELABEL_ZH_CN.fieldSizePositive,
    sourceUrl:
      Boolean(model.sourceUrl?.trim()) && !isValidModelSourceUrl(model.sourceUrl ?? "")
        ? PRELABEL_ZH_CN.fieldSourceUrlInvalid
        : "",
  };
}

/** The original editing target no longer exists; retrying cannot repair this context. */
export class PrelabelModelContextChangedError extends Error {
  constructor() {
    super(PRELABEL_ZH_CN.retryModelChanged);
    this.name = "PrelabelModelContextChangedError";
  }
}

export function requireValidPrelabelModel(
  model: PrelabelModelConfig | null,
  expectedId: string,
): PrelabelModelConfig {
  if (!model || model.id !== expectedId) throw new PrelabelModelContextChangedError();
  const error = Object.values(prelabelModelFieldErrors(model)).find(Boolean);
  if (error) throw new Error(error);
  return model;
}
