import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "../types/annotation";
import type { ExportData, TextExportFile } from "../types/export";
import type { ShortcutMap } from "./defaults/shortcuts";
import type {
  ModelValidationReport,
  OnnxModelSummary,
  OnnxRuntimeStatus,
  PrelabelInferenceOutcome,
  PrelabelModelConfig,
  PrelabelModelLibrary,
  PrelabelProgressEvent,
  CancellationResult,
  RuntimeDownloadEvent,
  RuntimeDownloadOutcome,
  PtCancellationResult,
  PtConversionEnvironment,
  PtConversionEvent,
  PtConversionParameters,
  PtConversionPlan,
  PtConversionResult,
} from "../types/prelabel";
import { PRELABEL_ZH_CN } from "../i18n/prelabel.zh-CN";
import type {
  PluginInstallPreview,
  PluginExportFormatSnapshot,
  PluginExportResult,
  PluginExportEvent,
  PluginExportCancellationResult,
  PluginLabelPresetSnapshot,
  PluginConfig,
  PluginConfigMigrationReport,
  PluginPermissionGrant,
  PluginRegistryEntry,
  PluginRegistrySnapshot,
  PluginRuntimeSettings,
  PluginPrelabelCancellationResult,
  PluginPrelabelClassMapping,
  PluginPrelabelEvent,
  PluginPrelabelResult,
  PluginPrelabelSourceSnapshot,
} from "../types/plugin";

export interface ImageFile {
  path: string;
  name: string;
  size?: number;
}

export interface TextFileEntry {
  path: string;
  name: string;
}

export interface AnnotationExportImage extends ImageFile {
  width: number;
  height: number;
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

export async function selectPluginPackage(): Promise<string | null> {
  const path = await open({ directory: false, multiple: false });
  return typeof path === "string" ? path : null;
}

export function confirmAction(message: string): Promise<boolean> {
  return confirm(message, { title: "请确认", kind: "warning" });
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

export async function selectPrelabelModelFile(): Promise<string | null> {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: PRELABEL_ZH_CN.modelFileFilter, extensions: ["onnx", "pt"] }],
  });
  return typeof path === "string" ? path : null;
}

export async function selectOnnxRuntimeDll(): Promise<string | null> {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: PRELABEL_ZH_CN.runtimeFileFilter, extensions: ["dll"] }],
  });
  return typeof path === "string" ? path : null;
}

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

export function loadShortcuts(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("load_shortcuts");
}

export function saveShortcuts(shortcuts: ShortcutMap): Promise<void> {
  return invoke("save_shortcuts", { shortcuts });
}

export function inspectOnnxModel(path: string): Promise<OnnxModelSummary> {
  return invoke<OnnxModelSummary>("inspect_onnx_model", { path });
}

export function findConvertedOnnx(ptPath: string): Promise<string | null> {
  return invoke<string | null>("find_converted_onnx", { ptPath });
}

export function detectPtConversionEnvironment(): Promise<PtConversionEnvironment> {
  return invoke<PtConversionEnvironment>("detect_pt_conversion_environment");
}

export function convertPtToOnnx(
  ptPath: string,
  plan: PtConversionPlan,
  conversionId: string,
  onEvent: (event: PtConversionEvent) => void,
): Promise<PtConversionResult> {
  const eventChannel = new Channel<PtConversionEvent>();
  eventChannel.onmessage = onEvent;
  return invoke<PtConversionResult>("convert_pt_to_onnx", {
    ptPath,
    plan,
    conversionId,
    onEvent: eventChannel,
  });
}

export function previewPtConversionCommand(
  ptPath: string,
  parameters: PtConversionParameters,
  conversionId: string,
  environment: PtConversionEnvironment,
): Promise<PtConversionPlan> {
  return invoke<PtConversionPlan>("preview_pt_conversion_command", {
    ptPath,
    parameters,
    conversionId,
    environment,
  });
}

export function cancelPtConversion(conversionId: string): Promise<PtCancellationResult> {
  return invoke<PtCancellationResult>("cancel_pt_conversion", { conversionId });
}

export function loadPrelabelModelLibrary(): Promise<PrelabelModelLibrary> {
  return invoke<PrelabelModelLibrary>("load_prelabel_model_library");
}

export function savePrelabelModelLibrary(library: PrelabelModelLibrary): Promise<void> {
  return invoke("save_prelabel_model_library", { library });
}

export function getOnnxRuntimeStatus(): Promise<OnnxRuntimeStatus> {
  return invoke<OnnxRuntimeStatus>("get_onnx_runtime_status");
}

export function installOnnxRuntimeFromFile(sourcePath: string): Promise<OnnxRuntimeStatus> {
  return invoke<OnnxRuntimeStatus>("install_onnx_runtime_from_file", { sourcePath });
}

export function downloadOnnxRuntime(
  downloadId: string,
  onProgress: (event: RuntimeDownloadEvent) => void,
): Promise<RuntimeDownloadOutcome> {
  const progressChannel = new Channel<RuntimeDownloadEvent>();
  progressChannel.onmessage = onProgress;
  return invoke<RuntimeDownloadOutcome>("download_onnx_runtime", {
    downloadId,
    onProgress: progressChannel,
  });
}

export function cancelOnnxRuntimeDownload(downloadId: string): Promise<CancellationResult> {
  return invoke<CancellationResult>("cancel_onnx_runtime_download", {
    downloadId,
  });
}

export function validatePrelabelModel(path: string): Promise<ModelValidationReport> {
  return invoke<ModelValidationReport>("validate_prelabel_model", { path });
}

export function runPrelabelInference(
  taskId: string,
  model: PrelabelModelConfig,
  imagePaths: string[],
  onProgress: (event: PrelabelProgressEvent) => void,
): Promise<PrelabelInferenceOutcome> {
  const progressChannel = new Channel<PrelabelProgressEvent>();
  progressChannel.onmessage = onProgress;
  return invoke<PrelabelInferenceOutcome>("run_prelabel_inference", {
    taskId,
    model,
    imagePaths,
    onProgress: progressChannel,
  });
}

export function cancelPrelabelInference(taskId: string): Promise<CancellationResult> {
  return invoke<CancellationResult>("cancel_prelabel_inference", { taskId });
}

export function installPlugin(
  path: string,
  projectDir: string | null,
): Promise<PluginInstallPreview> {
  return invoke<PluginInstallPreview>("install_plugin", { path, projectDir });
}

export function authorizePlugin(
  installToken: string,
  grants: PluginPermissionGrant[] | null,
  projectDir: string | null,
): Promise<PluginRegistryEntry | null> {
  return invoke<PluginRegistryEntry | null>("authorize_plugin", {
    installToken,
    grants,
    projectDir,
  });
}

export function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke("uninstall_plugin", { pluginId });
}

export function listPlugins(): Promise<PluginRegistrySnapshot> {
  return invoke<PluginRegistrySnapshot>("list_plugins");
}

export function loadPluginLabelPresets(): Promise<PluginLabelPresetSnapshot> {
  return invoke<PluginLabelPresetSnapshot>("load_plugin_label_presets");
}

export function loadPluginExportFormats(): Promise<PluginExportFormatSnapshot> {
  return invoke<PluginExportFormatSnapshot>("load_plugin_export_formats");
}

export function runPluginExport(
  pluginId: string,
  formatId: string,
  exportData: ExportData,
  options: Record<string, unknown>,
  outputBaseName: string,
  outputDir: string,
  exportId: string,
  onEvent: (event: PluginExportEvent) => void,
): Promise<PluginExportResult> {
  const eventChannel = new Channel<PluginExportEvent>();
  eventChannel.onmessage = onEvent;
  return invoke<PluginExportResult>("run_plugin_export", {
    request: {
      pluginId,
      formatId,
      exportData,
      options,
      outputBaseName,
      outputDir,
      exportId,
    },
    onEvent: eventChannel,
  });
}

export function cancelPluginExport(
  exportId: string,
): Promise<PluginExportCancellationResult> {
  return invoke<PluginExportCancellationResult>("cancel_plugin_export", { exportId });
}

export function loadPluginPrelabelSources(
  projectFolder: string | null,
): Promise<PluginPrelabelSourceSnapshot> {
  return invoke<PluginPrelabelSourceSnapshot>("load_plugin_prelabel_sources", { projectFolder });
}

export function runPluginPrelabel(
  pluginId: string,
  projectFolder: string,
  imagePaths: string[],
  classMappings: PluginPrelabelClassMapping[],
  params: Record<string, unknown>,
  operationId: string,
  onEvent: (event: PluginPrelabelEvent) => void,
): Promise<PluginPrelabelResult> {
  const eventChannel = new Channel<PluginPrelabelEvent>();
  eventChannel.onmessage = onEvent;
  return invoke<PluginPrelabelResult>("run_plugin_prelabel", {
    request: { pluginId, projectFolder, imagePaths, classMappings, params, operationId },
    onEvent: eventChannel,
  });
}

export function cancelPluginPrelabel(
  operationId: string,
): Promise<PluginPrelabelCancellationResult> {
  return invoke<PluginPrelabelCancellationResult>("cancel_plugin_prelabel", { operationId });
}

export function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<PluginRegistryEntry> {
  return invoke<PluginRegistryEntry>("set_plugin_enabled", { pluginId, enabled });
}

export function getPluginStatus(pluginId: string): Promise<PluginRegistryEntry> {
  return invoke<PluginRegistryEntry>("get_plugin_status", { pluginId });
}

export function clearPluginFailures(pluginId: string): Promise<PluginRegistryEntry> {
  return invoke<PluginRegistryEntry>("clear_plugin_failures", { pluginId });
}

export function getPluginRuntimeSettings(): Promise<PluginRuntimeSettings> {
  return invoke<PluginRuntimeSettings>("get_plugin_runtime_settings");
}

export function setPluginSafeMode(safeMode: boolean): Promise<PluginRuntimeSettings> {
  return invoke<PluginRuntimeSettings>("set_plugin_safe_mode", { safeMode });
}

export function getPluginRuntimeLogs(pluginId: string): Promise<string[]> {
  return invoke<string[]>("get_plugin_runtime_logs", { pluginId });
}

export function migratePluginConfigs(
  configs: PluginConfig[],
): Promise<PluginConfigMigrationReport> {
  return invoke<PluginConfigMigrationReport>("migrate_plugin_configs", { configs });
}
