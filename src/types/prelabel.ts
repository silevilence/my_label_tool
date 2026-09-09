export type YoloModelFormat = "yolov5" | "yolov8" | "yolo11";

export interface OnnxModelSummary {
  format: YoloModelFormat;
  classCount: number;
  inputWidth: number;
  inputHeight: number;
  classNames: string[];
}

export type PrelabelDevice = "auto" | "cpu" | "gpu";

export interface PrelabelModelConfig extends OnnxModelSummary {
  id: string;
  name: string;
  path: string;
  inputSizeOverride: [number, number] | null;
  confidenceThreshold: number;
  iouThreshold: number;
  addedAt: string;
  device: PrelabelDevice;
  /** 更新地址（http/https）；未配置为 undefined。用于手动「更新模型」流程。 */
  sourceUrl?: string;
  /** 最近一次从 sourceUrl 成功更新的 ISO 时间。 */
  updatedAt?: string;
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
  /** Whether the installed runtime build carries the DirectML (GPU) backend. `null` when no runtime
   * is installed yet. Reflects capability, not whether a usable GPU is present. */
  gpuAvailable: boolean | null;
}

export type RuntimeDownloadEvent =
  | { event: "started"; fileName: string }
  | { event: "progress"; fileName: string; downloaded: number; total: number | null }
  | { event: "completed"; fileName: string };

export interface RuntimeDownloadOutcome {
  cancelled: boolean;
}

export type ModelDownloadEvent =
  | { event: "started"; fileName: string }
  | { event: "progress"; fileName: string; downloaded: number; total: number | null }
  | { event: "completed"; fileName: string };

/** 下载成功返回的模型信息；null 表示下载被取消。 */
export type ModelDownloadResult = OnnxModelSummary & {
  path: string;
};

export interface CancellationResult {
  status: "accepted" | "already-completed";
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

export type PtCancellationResult = CancellationResult;

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

export type PrelabelProgressEvent =
  | { event: "modelLoading" }
  | { event: "started"; index: number; total: number; imagePath: string }
  | { event: "completed"; index: number; total: number };

export interface PrelabelInferenceOutcome {
  results: PrelabelImageInference[];
  cancelled: boolean;
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
