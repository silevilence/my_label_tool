import type { AnnotationShape, LabelConfig } from "./annotation";
import type { ProjectConfig } from "../lib/importers";

export type AutosaveMode = "off" | "interval" | "switch";
export interface AutosaveSettings {
  mode: AutosaveMode;
  intervalSeconds: number;
}
/** Host-only working copy; does not change export or plugin contracts. */
export interface RecoveryMetadata {
  labels: LabelConfig[];
  projectConfig: ProjectConfig | null;
  configPath: string;
  selectedPath: string;
  savedAt: string;
}
export interface RecoverySnapshot {
  revision: number;
  metadata: RecoveryMetadata;
  annotations: Record<string, AnnotationShape[]>;
}
export interface RecoveryWrite {
  expectedRevision: number;
  reset: boolean;
  metadata: RecoveryMetadata;
  changes: Record<string, AnnotationShape[] | null>;
}
