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
  parseNativeJsonImport,
  parseProjectConfig,
  parseVocImport,
  parseYoloImport,
  projectConfigTemplate,
  type ImportedAnnotations,
  type ProjectConfig,
  type TextImportFile,
} from "../lib/importers";
import {
  exportAnnotationsJson,
  exportTextFiles,
  listTextFiles,
  readTextFile,
  selectExportFolder,
  selectExportJsonPath,
  selectExportPath,
  selectJsonFile,
  type ImageFile,
} from "../lib/tauri-api";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ExportData, ExportFormatId } from "../types/export";

interface UseProjectActionsParams {
  activeProjectConfig: ProjectConfig | null;
  activeProjectConfigPath: string;
  annotationsByImage: Record<string, AnnotationShape[]>;
  customMappingText: string;
  folderPath: string;
  images: ImageFile[];
  labels: LabelConfig[];
  selectedExportFormatId: ExportFormatId;
  applyProjectTemplate: (template: ProjectConfig["template"], labels: LabelConfig[]) => void;
  replaceAnnotations: (annotationsByImage: Record<string, AnnotationShape[]>) => void;
  setActiveProjectConfig: (config: ProjectConfig) => void;
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
  applyProjectTemplate,
  replaceAnnotations,
  setActiveProjectConfig,
  setActiveProjectConfigPath,
  setError,
  setProjectTemplateId,
  setSelectedExportFormatId,
}: UseProjectActionsParams) {
  function reportError(caughtError: unknown) {
    setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
  }

  async function exportSelectedFormat() {
    setError("");

    try {
      const savedPath = await exportSelectedFormatAs();
      if (savedPath && selectedExportFormatId !== "custom") {
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
      const outputDir = await selectExportFolder();
      if (!outputDir) {
        return null;
      }
      await exportTextFiles(outputDir, exportYolo(exportData));
      return outputDir;
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
    } catch (caughtError: unknown) {
      reportError(caughtError);
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
      await exportTextFiles(config.annotationPath, exportYolo(exportData));
    }
  }

  async function updateProjectConfig(format: ProjectConfig["format"], annotationPath: string) {
    const configPath = activeProjectConfigPath || projectConfigPath(folderPath);
    const nextConfig: ProjectConfig = {
      schemaVersion: 1,
      format,
      annotationPath,
      exportedAt: new Date().toISOString(),
      imageFolder: folderPath,
      labels,
      template: projectConfigTemplate(),
      exportOptions: { format },
    };

    setActiveProjectConfig(nextConfig);
    setActiveProjectConfigPath(configPath);
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

  async function maybeLoadProjectConfig(imageFolder: string, currentImages: ImageFile[]) {
    const configs = await listTextFiles(imageFolder, "json");
    const config = configs.find((file) => file.name.toLowerCase() === PROJECT_CONFIG_NAME);
    if (!config) {
      return;
    }

    await loadProjectConfigImport(config.path, currentImages, false);
  }

  async function loadProjectConfigImport(
    configPath: string,
    currentImages: ImageFile[],
    confirmReplace: boolean,
  ): Promise<ProjectConfig | null> {
    if (confirmReplace && !(await confirmReplaceCurrentAnnotations(currentImages))) {
      return null;
    }

    const config = withProjectTemplate(parseProjectConfig(await readTextFile(configPath)));
    const imported =
      config.format === "json"
        ? parseNativeJsonImport(await readTextFile(config.annotationPath))
        : await loadConfiguredStandardImport(config, currentImages);
    const labelsFromConfig = config.labels.length > 0 ? config.labels : imported.labels;

    applyImportedAnnotations(
      { ...imported, labels: labelsFromConfig },
      currentImages,
      config,
      configPath,
    );
    return config;
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
    const sizes = new Map(
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
    return parseYoloImport(files, sizes);
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

  function withProjectTemplate(config: ProjectConfig): ProjectConfig {
    return { ...config, template: projectConfigTemplate() };
  }

  return {
    exportSelectedFormat,
    importAnnotations,
    maybeLoadProjectConfig,
    saveProjectExport,
  };
}
