import { tryBeginOperation, useOperations, type OperationHandle } from "../store/useOperations";
import { OPERATION_ZH_CN as operationText } from "../i18n/operations.zh-CN";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  baseName,
  joinPath,
  confirmReplaceCurrentAnnotations,
  detectYoloAnnotationFolder,
  loadImageSize,
  matchImportedImages,
  parseCustomMapping,
  projectConfigPath,
  saveProjectConfig,
} from "../lib/app-utils";
import { exportCoco } from "../lib/exporters/coco";
import { exportCustom } from "../lib/exporters/custom";
import { exportVoc } from "../lib/exporters/voc";
import { exportYolo } from "../lib/exporters/yolo";
import {
  PROJECT_CONFIG_NAME,
  parseCocoImport,
  parseExternalYoloImport,
  parseNativeJsonImport,
  parseProjectConfig,
  parseVocImport,
  parseYoloImport,
  projectConfigTemplate,
  type ImageSize,
  type ImportedAnnotations,
  type ImportSummary,
  type ProjectConfig,
  type TextImportFile,
} from "../lib/importers";
import { confirmAction } from "../lib/prompts";
import {
  cancelPluginExport,
  exportAnnotationsJson,
  exportTextFiles,
  runPluginExport,
  listTextFiles,
  migratePluginConfigs,
  readTextFile,
  selectExportFolder,
  selectExportJsonPath,
  selectExportPath,
  selectJsonFile,
  type ImageFile,
} from "../lib/tauri-api";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ExportData, ExportFormatId } from "../types/export";
import type { PluginExportFormatDescriptor } from "../types/plugin";
import { mergePluginConfigMigration } from "../lib/plugin-config-migration";
import { PLUGIN_ZH_CN as pluginText } from "../i18n/plugin.zh-CN";
import { PROJECT_ZH_CN as projectText } from "../i18n/project.zh-CN";
import { mergeImportedLabels, remapImportedAnnotationLabels } from "../lib/yolo-label-merge";
import type { VideoProject } from "../types/video";
import { withProjectMedia, type LoadedProjectVideo } from "../lib/project-media";
import { VIDEO_ZH_CN as videoText } from "../i18n/video.zh-CN";

export interface PluginExportProgressState {
  percent: number | null;
  message: string;
  canCancel: boolean;
  cancelling: boolean;
}

interface UseProjectActionsParams {
  video?: VideoProject | null;
  videos?: LoadedProjectVideo[];
  activeProjectConfig: ProjectConfig | null;
  activeProjectConfigPath: string;
  annotationsByImage: Record<string, AnnotationShape[]>;
  customMappingText: string;
  folderPath: string;
  images: ImageFile[];
  labels: LabelConfig[];
  selectedExportFormatId: ExportFormatId;
  pluginExportFormats: PluginExportFormatDescriptor[];
  refreshPluginExtensions: () => Promise<void>;
  applyProjectTemplate: (template: ProjectConfig["template"], labels: LabelConfig[]) => void;
  clearProjectTemplate: () => void;
  replaceAnnotations: (annotationsByImage: Record<string, AnnotationShape[]>) => void;
  setActiveProjectConfig: Dispatch<SetStateAction<ProjectConfig | null>>;
  setActiveProjectConfigPath: (path: string) => void;
  setError: (message: string) => void;
  showMessage: (message: string) => void;
  setProjectTemplateId: (templateId: string) => void;
  setSelectedExportFormatId: (format: ExportFormatId) => void;
}

export function useProjectActions({
  video = null,
  videos = [],
  activeProjectConfig,
  activeProjectConfigPath,
  annotationsByImage,
  customMappingText,
  folderPath,
  images,
  labels,
  selectedExportFormatId,
  pluginExportFormats,
  refreshPluginExtensions,
  applyProjectTemplate,
  clearProjectTemplate,
  replaceAnnotations,
  setActiveProjectConfig,
  setActiveProjectConfigPath,
  setError,
  showMessage,
  setProjectTemplateId,
  setSelectedExportFormatId,
}: UseProjectActionsParams) {
  const projectMigrationGenerationRef = useRef(0);
  const exportOperation = useRef<OperationHandle | null>(null);
  const [activePluginExportId, setActivePluginExportId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportView = useOperations((state) =>
    state.operations.find((op) => op.id === exportOperation.current?.id),
  );
  const pluginExportProgress: PluginExportProgressState | null =
    activePluginExportId && exportView?.status === "running"
      ? {
          percent: exportView.percent,
          message: exportView.message,
          canCancel: exportView.canCancel,
          cancelling: exportView.cancelRequested,
        }
      : null;

  function reportError(caughtError: unknown) {
    setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
  }

  async function runExport(save: boolean) {
    const handle = tryBeginOperation({
      label: save ? operationText.save : operationText.export,
      resource: selectedExportFormatId.startsWith("plugin:")
        ? "export-dir"
        : ["export-dir", "project-annotations"],
    });
    if (!handle) {
      setError(operationText.busy);
      return false;
    }
    exportOperation.current = handle;
    setExportError(null);
    try {
      const saved = await (save ? saveProjectExportInternal() : exportSelectedFormatInternal());
      handle.complete(
        saved ? operationText.completed : operationText.cancelled,
        saved ? "success" : "warning",
      );
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Plugin commands preserve the protocol code as a bracketed prefix.
      if (message.startsWith("[CANCELLED] ")) {
        handle.complete(operationText.cancelled, "warning");
        return false;
      }
      handle.fail(error);
      setExportError(message);
      return false;
    } finally {
      exportOperation.current = null;
    }
  }
  const exportSelectedFormat = () => runExport(false);
  const saveProjectExport = () => runExport(true);

  async function exportSelectedFormatInternal() {
    setError("");

    const savedPath = await exportSelectedFormatAs();
    if (!savedPath) return false;
    if (isBuiltInProjectFormat(selectedExportFormatId)) {
      await updateProjectConfig(selectedExportFormatId, savedPath);
    }
    return true;
  }

  async function exportSelectedFormatAs(): Promise<string | null> {
    const exportData = await buildExportData();

    if (selectedExportFormatId === "json") {
      const outputPath = await selectExportJsonPath();
      if (!outputPath) {
        return null;
      }
      await exportAnnotationsJson(outputPath, withProjectMedia(exportData, videos));
      return outputPath;
    }

    if (selectedExportFormatId === "coco") {
      const outputPath = await selectExportPath("annotations.coco.json");
      if (!outputPath) {
        return null;
      }
      await exportAnnotationsJson(outputPath, exportCoco(exportData));
      return outputPath;
    }

    if (selectedExportFormatId === "voc") {
      const outputDir = await selectExportFolder();
      if (!outputDir) {
        return null;
      }
      await exportTextFiles(outputDir, exportVoc(exportData));
      return outputDir;
    }

    if (selectedExportFormatId === "yolo") {
      return writeYoloAnnotations(exportData);
    }

    const pluginFormat = pluginExportFormats.find(
      (format) => format.selectionId === selectedExportFormatId,
    );
    if (pluginFormat) {
      if (!pluginFormat.enabled) {
        throw new Error(pluginFormat.disabledReason ?? pluginText.exportFormatUnavailable);
      }
      const outputDir = await selectExportFolder();
      if (!outputDir) return null;
      const exportId = crypto.randomUUID();
      exportOperation.current?.setCancel(
        pluginFormat.supportsCancel
          ? async () => {
              const result = await cancelPluginExport(exportId);
              if (!result.found) throw new Error(pluginText.exportCancelUnavailable);
            }
          : undefined,
      );
      setActivePluginExportId(exportId);
      exportOperation.current?.progress(null, pluginText.exportRunning);
      try {
        const result = await runPluginExport(
          pluginFormat.pluginId,
          pluginFormat.format.id,
          toPluginExportData(exportData, folderPath),
          {},
          "annotations",
          outputDir,
          exportId,
          (event) => {
            if (!pluginFormat.supportsProgress || event.event !== "progress") return;
            exportOperation.current?.progress(
              typeof event.payload.percent === "number" ? event.payload.percent : null,
              typeof event.payload.message === "string" ? event.payload.message : undefined,
            );
          },
        );
        exportOperation.current?.complete(pluginText.exportComplete(result.files.length));
      } finally {
        setActivePluginExportId(null);
        void refreshPluginExtensions().catch(reportError);
      }
      return outputDir;
    }

    if (selectedExportFormatId.startsWith("plugin:")) {
      throw new Error(pluginText.exportFormatUnavailable);
    }

    const mapping = parseCustomMapping(customMappingText);
    const outputPath = await selectExportPath("annotations.custom.json");
    if (!outputPath) {
      return null;
    }
    await exportAnnotationsJson(outputPath, exportCustom(exportData, mapping));
    return outputPath;
  }

  async function writeYoloAnnotations(data: ExportData): Promise<string | null> {
    ensureYoloCompatible(data);
    const files = exportYolo(data);
    const outputDir = await selectExportFolder();
    if (!outputDir) return null;
    await exportTextFiles(outputDir, files);
    return outputDir;
  }

  async function saveProjectExportInternal() {
    setError("");

    if (!activeProjectConfig || selectedExportFormatId !== activeProjectConfig.format) {
      return await exportSelectedFormatInternal();
    }
    await exportToProjectConfig(activeProjectConfig);
    await updateProjectConfig(activeProjectConfig.format, activeProjectConfig.annotationPath);
    return true;
  }

  async function exportToProjectConfig(config: ProjectConfig) {
    const exportData = await buildExportData();

    if (config.format === "json") {
      await exportAnnotationsJson(config.annotationPath, withProjectMedia(exportData, videos));
    } else if (config.format === "coco") {
      await exportAnnotationsJson(config.annotationPath, exportCoco(exportData));
    } else if (config.format === "voc") {
      await exportTextFiles(config.annotationPath, exportVoc(exportData));
    } else {
      ensureYoloCompatible(exportData);
      await exportTextFiles(config.annotationPath, exportYolo(exportData));
    }
  }

  async function updateProjectConfig(format: ProjectConfig["format"], annotationPath: string) {
    const configPath = activeProjectConfigPath || projectConfigPath(folderPath);
    const template = projectConfigTemplate();
    const nextConfig: ProjectConfig = {
      schemaVersion: 1,
      format,
      annotationPath,
      exportedAt: new Date().toISOString(),
      imageFolder: folderPath,
      labels,
      template,
      exportOptions: { format },
      ...(activeProjectConfig?.settings ? { settings: activeProjectConfig.settings } : {}),
      ...(activeProjectConfig?.prelabelMappings
        ? { prelabelMappings: activeProjectConfig.prelabelMappings }
        : {}),
      ...(activeProjectConfig?.pluginConfigs
        ? { pluginConfigs: activeProjectConfig.pluginConfigs }
        : {}),
    };

    await saveProjectConfig(configPath, nextConfig);
    setActiveProjectConfig(nextConfig);
    setActiveProjectConfigPath(configPath);
    setProjectTemplateId(template.id);
    applyProjectTemplate(template, labels);
  }

  async function importAnnotations() {
    setError("");

    try {
      if (images.length === 0 || !folderPath) {
        throw new Error("请先打开图片文件夹");
      }

      if (!(await confirmReplaceCurrentAnnotations(images))) {
        return;
      }

      const annotationPath = await selectJsonFile();
      if (!annotationPath) {
        return;
      }
      await loadProjectConfigImport(annotationPath, images, false);
    } catch (caughtError: unknown) {
      reportError(caughtError);
    }
  }

  async function createProjectFromExternalYolo() {
    setError("");

    try {
      if (images.length === 0 || !folderPath) {
        throw new Error("请先打开图片文件夹");
      }

      if (!(await confirmReplaceCurrentAnnotations(images))) {
        return;
      }

      const annotationPath = await selectExportFolder();
      if (!annotationPath) {
        return;
      }

      await createProjectFromYoloFolder(annotationPath, folderPath, images, {
        showSummary: true,
      });
    } catch (caughtError: unknown) {
      reportError(caughtError);
    }
  }

  async function createProjectFromYoloFolder(
    annotationPath: string,
    imageFolder: string,
    currentImages: ImageFile[],
    options: { showSummary: boolean },
  ) {
    const files = await readImportFiles(annotationPath, "txt");
    const { imported, summary } = parseExternalYoloImport(
      files,
      await imageSizesByBaseName(currentImages),
    );
    const merged = mergeImportedLabels(imported.labels, labels);
    const importedWithMergedLabels: ImportedAnnotations = {
      labels: merged.labels,
      images: remapImportedAnnotationLabels(imported.images, imported.labels, merged.labels),
    };
    const configPath = projectConfigPath(imageFolder);
    const config: ProjectConfig = {
      schemaVersion: 1,
      format: "yolo",
      annotationPath,
      exportedAt: new Date().toISOString(),
      imageFolder,
      labels: merged.labels,
      template: projectConfigTemplate(),
      exportOptions: { format: "yolo" },
    };

    await saveProjectConfig(configPath, config);
    applyImportedAnnotations(importedWithMergedLabels, currentImages, config, configPath);
    if (options.showSummary || hasImportSummaryIssues(summary)) {
      showMessage(
        projectText.yoloImportSummary(
          summary.missingAnnotationFileCount,
          summary.orphanAnnotationFileCount,
          summary.invalidLineCount,
        ),
      );
    }
  }

  async function maybeLoadProjectConfig(imageFolder: string, currentImages: ImageFile[]) {
    const configs = await listTextFiles(imageFolder, "json");
    const config = configs.find((file) => file.name.toLowerCase() === PROJECT_CONFIG_NAME);
    if (config) {
      try {
        await loadProjectConfigImport(config.path, currentImages, false);
      } catch (caughtError: unknown) {
        clearProjectConfig();
        reportError(caughtError);
      }
      return;
    }

    await maybeLoadYoloProject(imageFolder, currentImages);
  }

  async function maybeLoadYoloProject(imageFolder: string, currentImages: ImageFile[]) {
    try {
      const txtFiles = await listTextFiles(imageFolder, "txt");
      const imageBaseNames = new Set(
        currentImages.map((image) => baseName(image.name).toLowerCase()),
      );
      if (!detectYoloAnnotationFolder(txtFiles, imageBaseNames)) {
        clearProjectConfig();
        return;
      }

      const annotationFileCount = txtFiles.filter(
        (file) => file.name.toLowerCase() !== "classes.txt",
      ).length;
      const confirmed = await confirmAction(
        projectText.confirmYoloImport(annotationFileCount, PROJECT_CONFIG_NAME),
      );
      if (!confirmed) {
        clearProjectConfig();
        return;
      }

      await createProjectFromYoloFolder(imageFolder, imageFolder, currentImages, {
        showSummary: false,
      });
    } catch (caughtError: unknown) {
      clearProjectConfig();
      reportError(caughtError);
    }
  }

  function clearProjectConfig() {
    projectMigrationGenerationRef.current += 1;
    setActiveProjectConfig(null);
    setActiveProjectConfigPath("");
    setProjectTemplateId("");
    clearProjectTemplate();
  }

  async function loadProjectConfigImport(
    configPath: string,
    currentImages: ImageFile[],
    confirmReplace: boolean,
  ): Promise<ProjectConfig | null> {
    if (confirmReplace && !(await confirmReplaceCurrentAnnotations(currentImages))) {
      return null;
    }
    const migrationGeneration = projectMigrationGenerationRef.current + 1;
    projectMigrationGenerationRef.current = migrationGeneration;

    const config = withProjectTemplate(parseProjectConfig(await readTextFile(configPath)));
    const imported =
      config.format === "json"
        ? parseNativeJsonImport(await readTextFile(config.annotationPath))
        : await loadConfiguredStandardImport(config, currentImages);
    const labelsFromConfig = config.labels.length > 0 ? config.labels : imported.labels;

    const openedConfig = { ...config, labels: labelsFromConfig };
    const importedImages =
      config.format === "coco" || config.format === "voc"
        ? remapImportedAnnotationLabels(
            imported.images,
            imported.labels,
            imported.labels.map(
              (label) => labelsFromConfig.find((saved) => saved.name === label.name) ?? label,
            ),
          )
        : imported.images;
    applyImportedAnnotations(
      { ...imported, images: importedImages, labels: labelsFromConfig },
      currentImages,
      openedConfig,
      configPath,
    );
    void migrateProjectPluginConfigs(openedConfig, migrationGeneration);
    return openedConfig;
  }

  async function migrateProjectPluginConfigs(
    config: ProjectConfig,
    migrationGeneration: number,
  ): Promise<ProjectConfig> {
    try {
      const report = await migratePluginConfigs(config.pluginConfigs ?? []);
      if (projectMigrationGenerationRef.current !== migrationGeneration) {
        return config;
      }
      const nextConfig = config.pluginConfigs
        ? { ...config, pluginConfigs: report.configs }
        : config;
      if (config.pluginConfigs) {
        setActiveProjectConfig((current) => mergePluginConfigMigration(current, config, report));
      }
      if (report.issues.length > 0) {
        setError(report.issues.map((issue) => `${issue.pluginId}：${issue.message}`).join("；"));
      }
      try {
        await refreshPluginExtensions();
      } catch (caughtError: unknown) {
        if (projectMigrationGenerationRef.current === migrationGeneration) {
          reportError(caughtError);
        }
      }
      return nextConfig;
    } catch (caughtError: unknown) {
      if (projectMigrationGenerationRef.current === migrationGeneration) {
        reportError(caughtError);
      }
      return config;
    }
  }

  async function retryPluginConfigMigrations(): Promise<void> {
    if (!activeProjectConfig) {
      return;
    }
    setError("");
    const migrationGeneration = projectMigrationGenerationRef.current + 1;
    projectMigrationGenerationRef.current = migrationGeneration;
    await migrateProjectPluginConfigs(activeProjectConfig, migrationGeneration);
  }

  async function loadConfiguredStandardImport(
    config: ProjectConfig,
    currentImages: ImageFile[],
  ): Promise<ImportedAnnotations> {
    if (config.format === "coco") {
      return parseCocoImport(
        await readTextFile(config.annotationPath),
        currentImages.some((image) => /[\\/]/.test(image.name)),
      );
    }

    const groups = new Map<string, ImageFile[]>();
    for (const image of currentImages) {
      const name = image.name.replace(/\\/g, "/");
      const directory = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
      const group = groups.get(directory) ?? [];
      group.push(image);
      groups.set(directory, group);
    }
    if (config.format === "voc") {
      const files: TextImportFile[] = [];
      for (const directory of groups.keys())
        files.push(...(await readImportFiles(joinPath(config.annotationPath, directory), "xml")));
      return parseVocImport(
        files,
        currentImages.some((image) => /[\\/]/.test(image.name)),
      );
    }
    const imported: ImportedAnnotations = { labels: config.labels, images: [] };
    for (const [directory, group] of groups) {
      const files = await readImportFiles(joinPath(config.annotationPath, directory), "txt");
      const parsed = parseYoloImport(files, await imageSizesByBaseName(group), config.labels);
      imported.images.push(...parsed.images);
      imported.labels = parsed.labels;
    }
    return imported;
  }

  function applyImportedAnnotations(
    imported: ImportedAnnotations,
    currentImages: ImageFile[],
    config: ProjectConfig,
    configPath: string,
  ) {
    if (imported.labels.length === 0) {
      throw new Error("导入文件没有标签");
    }

    const { annotationsByImage: nextAnnotationsByImage, missingCount } = matchImportedImages(
      imported,
      currentImages,
    );
    replaceAnnotations(nextAnnotationsByImage);
    applyProjectTemplate(config.template, imported.labels);
    setActiveProjectConfig({ ...config, labels: imported.labels });
    setActiveProjectConfigPath(configPath);
    setProjectTemplateId(config.template.id);
    setSelectedExportFormatId(config.format);
    if (missingCount > 0) {
      showMessage(`有 ${missingCount} 个导入图片未匹配到当前图片目录，已跳过。`);
    }
  }

  async function readImportFiles(folderPath: string, extension: string): Promise<TextImportFile[]> {
    const files = await listTextFiles(folderPath, extension);
    if (files.length === 0) {
      throw new Error(`目录中没有 .${extension} 文件`);
    }

    return Promise.all(
      files.map(async (file) => ({
        ...file,
        content: await readTextFile(file.path),
      })),
    );
  }

  async function imageSizesByBaseName(currentImages: ImageFile[]): Promise<Map<string, ImageSize>> {
    return new Map(
      await Promise.all(
        currentImages.map(
          async (image) =>
            [
              baseName(image.name).toLowerCase(),
              { name: image.name, ...(await loadImageSize(image.path)) },
            ] as const,
        ),
      ),
    );
  }

  async function buildExportData(): Promise<ExportData> {
    if (video) {
      return {
        labels,
        images: images.map((image) => ({
          ...image,
          width: video.width,
          height: video.height,
          annotations: annotationsByImage[image.path] ?? [],
        })),
      };
    }
    const videoSizes = new Map(
      videos.flatMap((asset) =>
        asset.images.map(
          (image) =>
            [image.path, { width: asset.video!.width, height: asset.video!.height }] as const,
        ),
      ),
    );
    const exportImages = await Promise.all(
      images.map(async (image) => ({
        ...image,
        ...(videoSizes.get(image.path) ?? (await loadImageSize(image.path))),
        annotations: annotationsByImage[image.path] ?? [],
      })),
    );

    return { labels, images: exportImages };
  }

  function ensureYoloCompatible(data: ExportData) {
    const unsupportedCount = data.images.reduce(
      (total, image) =>
        total + image.annotations.filter((annotation) => annotation.type !== "rect").length,
      0,
    );
    if (unsupportedCount > 0) {
      throw new Error(videoText.yoloUnsupported(unsupportedCount));
    }
  }

  function toPluginExportData(data: ExportData, projectFolder: string): ExportData {
    const normalizedFolder = projectFolder.replace(/\\/g, "/").replace(/\/$/, "");
    return {
      ...data,
      images: data.images.map((image) => {
        const normalizedPath = image.path.replace(/\\/g, "/");
        const prefix = `${normalizedFolder}/`;
        return {
          ...image,
          path: normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())
            ? normalizedPath.slice(prefix.length)
            : image.name,
        };
      }),
    };
  }

  function withProjectTemplate(config: ProjectConfig): ProjectConfig {
    return { ...config, template: projectConfigTemplate() };
  }

  return {
    cancelActivePluginExport: async () => {
      if (exportOperation.current)
        await useOperations.getState().cancel(exportOperation.current.id);
    },
    createProjectFromExternalYolo,
    exportError,
    exportSelectedFormat,
    importAnnotations,
    maybeLoadProjectConfig,
    pluginExportProgress,
    retryPluginConfigMigrations,
    saveProjectExport,
  };
}

function isBuiltInProjectFormat(format: ExportFormatId): format is ProjectConfig["format"] {
  return ["json", "coco", "voc", "yolo"].includes(format);
}

function hasImportSummaryIssues(summary: ImportSummary): boolean {
  return (
    summary.invalidLineCount > 0 ||
    summary.missingAnnotationFileCount > 0 ||
    summary.orphanAnnotationFileCount > 0
  );
}
