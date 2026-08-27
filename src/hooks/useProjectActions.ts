import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  baseName,
  confirmReplaceCurrentAnnotations,
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
  type ProjectConfig,
  type TextImportFile,
} from "../lib/importers";
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

export interface PluginExportProgressState {
  exportId: string;
  percent: number | null;
  message: string;
  canCancel: boolean;
  cancelling: boolean;
}

interface UseProjectActionsParams {
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
  setProjectTemplateId: (templateId: string) => void;
  setSelectedExportFormatId: (format: ExportFormatId) => void;
}

export function useProjectActions({
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
  setProjectTemplateId,
  setSelectedExportFormatId,
}: UseProjectActionsParams) {
  const projectMigrationGenerationRef = useRef(0);
  const [pluginExportProgress, setPluginExportProgress] =
    useState<PluginExportProgressState | null>(null);

  function reportError(caughtError: unknown) {
    setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
  }

  async function exportSelectedFormat() {
    setError("");

    try {
      const savedPath = await exportSelectedFormatAs();
      if (savedPath && isBuiltInProjectFormat(selectedExportFormatId)) {
        await updateProjectConfig(selectedExportFormatId, savedPath);
      }
    } catch (caughtError: unknown) {
      reportError(caughtError);
    }
  }

  async function exportSelectedFormatAs(): Promise<string | null> {
    const exportData = await buildExportData();

    if (selectedExportFormatId === "json") {
      const outputPath = await selectExportJsonPath();
      if (!outputPath) {
        return null;
      }
      await exportAnnotationsJson(outputPath, exportData);
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
      ensureYoloCompatible(exportData);
      const outputDir = await selectExportFolder();
      if (!outputDir) {
        return null;
      }
      await exportTextFiles(outputDir, exportYolo(exportData));
      return outputDir;
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
      setPluginExportProgress({
        exportId,
        percent: null,
        message: pluginText.exportRunning,
        canCancel: pluginFormat.supportsCancel,
        cancelling: false,
      });
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
            setPluginExportProgress((current) =>
              current?.exportId === exportId
                ? {
                    ...current,
                    percent:
                      typeof event.payload.percent === "number"
                        ? Math.max(0, Math.min(100, event.payload.percent))
                        : current.percent,
                    message:
                      typeof event.payload.message === "string"
                        ? event.payload.message
                        : current.message,
                  }
                : current,
            );
          },
        );
        setError(pluginText.exportComplete(result.files.length));
      } finally {
        setPluginExportProgress((current) =>
          current?.exportId === exportId ? null : current,
        );
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

  async function saveProjectExport() {
    setError("");

    try {
      if (!activeProjectConfig) {
        throw new Error("当前没有可保存的项目配置，请先导入或另存为。");
      }
      if (selectedExportFormatId !== activeProjectConfig.format) {
        throw new Error("当前导出格式与项目配置不一致，请先另存为。");
      }

      await exportToProjectConfig(activeProjectConfig);
      await updateProjectConfig(activeProjectConfig.format, activeProjectConfig.annotationPath);
      return true;
    } catch (caughtError: unknown) {
      reportError(caughtError);
      return false;
    }
  }

  async function exportToProjectConfig(config: ProjectConfig) {
    const exportData = await buildExportData();

    if (config.format === "json") {
      await exportAnnotationsJson(config.annotationPath, exportData);
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
      ...(activeProjectConfig?.prelabelMappings
        ? { prelabelMappings: activeProjectConfig.prelabelMappings }
        : {}),
      ...(activeProjectConfig?.pluginConfigs
        ? { pluginConfigs: activeProjectConfig.pluginConfigs }
        : {}),
    };

    setActiveProjectConfig(nextConfig);
    setActiveProjectConfigPath(configPath);
    setProjectTemplateId(template.id);
    applyProjectTemplate(template, labels);
    await saveProjectConfig(configPath, nextConfig);
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

      const files = await readImportFiles(annotationPath, "txt");
      const { imported, summary } = parseExternalYoloImport(
        files,
        await imageSizesByBaseName(images),
      );
      const configPath = projectConfigPath(folderPath);
      const config: ProjectConfig = {
        schemaVersion: 1,
        format: "yolo",
        annotationPath,
        exportedAt: new Date().toISOString(),
        imageFolder: folderPath,
        labels: imported.labels,
        template: projectConfigTemplate(),
        exportOptions: { format: "yolo" },
      };

      applyImportedAnnotations(imported, images, config, configPath);
      await saveProjectConfig(configPath, config);
      window.alert(
        `YOLO 项目创建完成：${summary.missingAnnotationFileCount} 张图片缺少标注文件，${summary.orphanAnnotationFileCount} 个标注文件未匹配图片，${summary.invalidLineCount} 行非法标注已跳过。`,
      );
    } catch (caughtError: unknown) {
      reportError(caughtError);
    }
  }

  async function maybeLoadProjectConfig(imageFolder: string, currentImages: ImageFile[]) {
    const configs = await listTextFiles(imageFolder, "json");
    const config = configs.find((file) => file.name.toLowerCase() === PROJECT_CONFIG_NAME);
    if (!config) {
      clearProjectConfig();
      return;
    }

    await loadProjectConfigImport(config.path, currentImages, false);
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
    applyImportedAnnotations(
      { ...imported, labels: labelsFromConfig },
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

  async function cancelActivePluginExport(): Promise<void> {
    const current = pluginExportProgress;
    if (!current?.canCancel || current.cancelling) return;
    setPluginExportProgress({
      ...current,
      cancelling: true,
      message: pluginText.exportCancelling,
    });
    try {
      const result = await cancelPluginExport(current.exportId);
      if (!result.found) {
        setPluginExportProgress((latest) =>
          latest?.exportId === current.exportId ? { ...latest, cancelling: false } : latest,
        );
        setError(pluginText.exportCancelUnavailable);
      }
    } catch (caughtError: unknown) {
      reportError(caughtError);
      setPluginExportProgress((latest) =>
        latest?.exportId === current.exportId ? { ...latest, cancelling: false } : latest,
      );
    }
  }

  async function loadConfiguredStandardImport(
    config: ProjectConfig,
    currentImages: ImageFile[],
  ): Promise<ImportedAnnotations> {
    if (config.format === "coco") {
      return parseCocoImport(await readTextFile(config.annotationPath));
    }

    if (config.format === "voc") {
      return parseVocImport(await readImportFiles(config.annotationPath, "xml"));
    }

    const files = await readImportFiles(config.annotationPath, "txt");
    return parseYoloImport(files, await imageSizesByBaseName(currentImages), config.labels);
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
      window.alert(`有 ${missingCount} 个导入图片未匹配到当前图片目录，已跳过。`);
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
    const exportImages = await Promise.all(
      images.map(async (image) => ({
        ...image,
        ...(await loadImageSize(image.path)),
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
      throw new Error(
        `YOLO 只支持矩形标注，当前有 ${unsupportedCount} 个非矩形标注。请改用 JSON/COCO/Custom，或先删除这些标注。`,
      );
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
    cancelActivePluginExport,
    createProjectFromExternalYolo,
    exportSelectedFormat,
    importAnnotations,
    maybeLoadProjectConfig,
    pluginExportProgress,
    retryPluginConfigMigrations,
    saveProjectExport,
  };
}

function isBuiltInProjectFormat(
  format: ExportFormatId,
): format is ProjectConfig["format"] {
  return ["json", "coco", "voc", "yolo"].includes(format);
}
