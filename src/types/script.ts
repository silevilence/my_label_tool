import type { AnnotationShape, LabelConfig } from "./annotation";

export interface ScriptImage {
  path: string;
  name: string;
  annotations: AnnotationShape[];
  size?: { width: number; height: number };
}
export interface ScriptSnapshot {
  labels: LabelConfig[];
  images: ScriptImage[];
}
export interface ScriptLimits { maxMemoryMiB: number; timeoutSeconds: number }
export interface ScriptOptions { includeDimensions: boolean }
export interface ScriptResult { imagePath: string; annotations: unknown[] }
export interface ScriptFailure { code: string; message: string; imagePath?: string }
export type ScriptEvent =
  | { event: "progress"; completed: number; total: number }
  | { event: "log"; message: string };
