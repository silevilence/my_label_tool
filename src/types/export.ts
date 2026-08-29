import type { AnnotationShape, LabelConfig } from "./annotation";

export type BuiltInExportFormatId = "json" | "coco" | "voc" | "yolo" | "custom";
export type PluginExportFormatId = `plugin:${string}:${string}`;
export type ExportFormatId = BuiltInExportFormatId | PluginExportFormatId;

export interface ExportTemplate {
  id: BuiltInExportFormatId;
  name: string;
  description: string;
  output: "file" | "directory";
}

export interface ExportImage {
  path: string;
  name: string;
  width: number;
  height: number;
  annotations: AnnotationShape[];
}

export interface ExportData {
  labels: LabelConfig[];
  images: ExportImage[];
}

export interface TextExportFile {
  path: string;
  content: string;
}

export interface CustomExportMapping {
  imagePath?: string;
  imageName?: string;
  labelId?: string;
  labelName?: string;
  bbox?: string;
  attributes?: string;
}
