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

export type PtConversionMethod = "yolo-cli" | "python-ultralytics" | "uvx-yolo";

export interface PtConversionParameters {
  imgsz: number;
  simplify: boolean;
}

export interface PtConversionPlan {
  parameters: PtConversionParameters;
  method: PtConversionMethod;
  executable: string;
  command: string;
  timeoutSeconds: number;
}

export interface PtConversionEnvironment {
  available: boolean;
  method: PtConversionMethod | null;
  executable: string | null;
  message: string;
}

export interface PtConversionResult extends OnnxModelSummary {
  path: string;
  method: PtConversionMethod;
}

export interface PtConversionCommandError {
  code: "cancelled" | "failed";
  message: string;
}

export interface PtCancellationResult {
  status: "accepted" | "already-completed";
}

export type PtConversionEvent =
  | {
      event: "started";
      conversionId: string;
      command: string;
      timeoutSeconds: number;
    }
  | {
      event: "output";
      conversionId: string;
      line: string;
    };

export interface PrelabelDetection {
  classIndex: number;
  confidence: number;
  points: [number, number, number, number];
}

export interface PrelabelImageInference {
  imagePath: string;
  detections: PrelabelDetection[];
}

export type PrelabelClassMappingAction = "bind" | "create" | "exclude";

export interface PrelabelClassMapping {
  classIndex: number;
  className: string;
  action: PrelabelClassMappingAction;
  labelId?: string;
}

export type PrelabelMappingsByModel = Record<string, PrelabelClassMapping[]>;

export type ResolvedPrelabelMappingSource =
  "explicit" | "explicit-exclude" | "auto-exact" | "auto-ascii-case-insensitive" | "unmatched";

export interface ResolvedPrelabelClassMapping {
  classIndex: number;
  className: string;
  labelId?: string;
  excluded: boolean;
  source: ResolvedPrelabelMappingSource;
}
