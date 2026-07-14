import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "../types/annotation";
import type { TextExportFile } from "../types/export";

export interface ImageFile {
  path: string;
  name: string;
}

export interface TextFileEntry {
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

export async function selectExportPath(defaultPath: string): Promise<string | null> {
  const path = await save({
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof path === "string" ? path : null;
}

export async function selectJsonFile(): Promise<string | null> {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof path === "string" ? path : null;
}

export async function selectExportFolder(): Promise<string | null> {
  const path = await open({ directory: true, multiple: false });
  return typeof path === "string" ? path : null;
}

export const selectFolder = selectExportFolder;

export function exportAnnotationsJson(outputPath: string, data: unknown): Promise<void> {
  return invoke("export_annotations_json", { outputPath, data });
}

export function exportTextFiles(outputDir: string, files: TextExportFile[]): Promise<void> {
  return invoke("export_text_files", { outputDir, files });
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function listTextFiles(folderPath: string, extension: string): Promise<TextFileEntry[]> {
  return invoke<TextFileEntry[]>("list_text_files", { folderPath, extension });
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
