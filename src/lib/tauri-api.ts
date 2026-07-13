import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "../types/annotation";

export interface ImageFile {
  path: string;
  name: string;
}

export interface AnnotationExportImage extends ImageFile {
  annotations: AnnotationShape[];
}

export interface AnnotationExport {
  labels: LabelConfig[];
  images: AnnotationExportImage[];
}

export async function selectImageFolder(): Promise<string | null> {
  const path = await open({ directory: true, multiple: false });
  return typeof path === "string" ? path : null;
}

export function listImageFiles(folderPath: string): Promise<ImageFile[]> {
  return invoke<ImageFile[]>("list_image_files", { folderPath });
}

export function imageFileSrc(path: string): string {
  return convertFileSrc(path);
}

export async function selectExportJsonPath(): Promise<string | null> {
  const path = await save({
    defaultPath: "annotations.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof path === "string" ? path : null;
}

export function exportAnnotationsJson(outputPath: string, data: AnnotationExport): Promise<void> {
  return invoke("export_annotations_json", { outputPath, data });
}

export function loadLabelConfigs(): Promise<LabelConfig[]> {
  return invoke<LabelConfig[]>("load_label_configs");
}

export function saveLabelConfigs(labels: LabelConfig[]): Promise<void> {
  return invoke("save_label_configs", { labels });
}

export function loadLabelTemplates(): Promise<LabelTemplate[]> {
  return invoke<LabelTemplate[]>("load_label_templates");
}

export function saveLabelTemplates(templates: LabelTemplate[]): Promise<void> {
  return invoke("save_label_templates", { templates });
}
