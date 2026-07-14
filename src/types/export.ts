import type { AnnotationShape, LabelConfig } from "./annotation";

export type ExportFormatId = "json" | "coco" | "voc" | "yolo" | "custom";

export interface ExportTemplate {
  id: ExportFormatId;
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
