export type YoloModelFormat = "yolov5" | "yolov8" | "yolo11";

export interface OnnxModelSummary {
  format: YoloModelFormat;
  classCount: number;
  inputWidth: number;
  inputHeight: number;
  classNames: string[];
}

export interface PrelabelModelConfig extends OnnxModelSummary {
  id: string;
  name: string;
  path: string;
  inputSizeOverride: [number, number] | null;
  confidenceThreshold: number;
  iouThreshold: number;
  addedAt: string;
}

export interface PrelabelModelLibrary {
  schemaVersion: 1;
  currentModelId: string | null;
  models: PrelabelModelConfig[];
}

export const EMPTY_PRELABEL_MODEL_LIBRARY: PrelabelModelLibrary = {
  schemaVersion: 1,
  currentModelId: null,
  models: [],
};

export type OnnxRuntimeState = "missing" | "available" | "invalid";

export interface OnnxRuntimeStatus {
  state: OnnxRuntimeState;
  version: string;
  dllPath: string;
  runtimeDirectory: string;
  downloadAvailable: boolean;
  message: string;
}

export interface ModelValidationReport {
  format: YoloModelFormat;
  classCount: number;
  inputWidth: number;
  inputHeight: number;
  inputName: string;
  outputNames: string[];
  classNames: string[];
}
