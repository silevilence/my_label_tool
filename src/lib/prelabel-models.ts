import type {
  OnnxModelSummary,
  PrelabelModelConfig,
  PrelabelModelLibrary,
} from "../types/prelabel";
import { PRELABEL_ZH_CN } from "../i18n/prelabel.zh-CN";

export function modelNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return fileName.replace(/\.onnx$/i, "") || PRELABEL_ZH_CN.defaultModelName;
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
    inputSizeOverride: null,
    confidenceThreshold: 0.25,
    iouThreshold: 0.45,
    addedAt,
  };
}

export function ptConversionCommand(path: string): string {
  return `yolo export model="${path.replace(/"/g, '\\"')}" format=onnx imgsz=640`;
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
    models: library.models.map((candidate) => (candidate.id === model.id ? model : candidate)),
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
    model.inputWidth,
    model.inputHeight,
  ];
  current[index] = raw ? Number(raw) : index === 0 ? model.inputWidth : model.inputHeight;
  return current;
}
