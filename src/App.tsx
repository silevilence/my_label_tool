import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import type { Transformer as KonvaTransformer } from "konva/lib/shapes/Transformer";
import { ExportPanel } from "./components/settings/ExportPanel";
import { LabelSettings } from "./components/settings/LabelSettings";
import { DEFAULT_CUSTOM_EXPORT_MAPPING } from "./lib/defaults/exports";
import { exportCoco } from "./lib/exporters/coco";
import { exportCustom } from "./lib/exporters/custom";
import { exportVoc } from "./lib/exporters/voc";
import { exportYolo } from "./lib/exporters/yolo";
import {
  PROJECT_CONFIG_NAME,
  parseCocoImport,
  parseNativeJsonImport,
  parseProjectConfig,
  parseVocImport,
  parseYoloImport,
  type ImportedAnnotations,
  type ProjectConfig,
  type TextImportFile,
} from "./lib/importers";
import { DEFAULT_LABELS, DEFAULT_LABEL_TEMPLATES } from "./lib/defaults/labels";
import {
  exportAnnotationsJson,
  exportTextFiles,
  imageFileSrc,
  type ImageFile,
  listImageFiles,
  loadLabelConfigs,
  loadLabelTemplates,
  listTextFiles,
  readTextFile,
  saveLabelConfigs,
  saveLabelTemplates,
  selectExportFolder,
  selectExportJsonPath,
  selectExportPath,
  selectImageFolder,
  selectJsonFile,
} from "./lib/tauri-api";
import { useAnnotationStore } from "./store/useAnnotationStore";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "./types/annotation";
import type { CustomExportMapping, ExportData, ExportFormatId } from "./types/export";
import "./App.css";

interface ImageLayout {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
}

interface DrawingRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function App() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const selectedRectRef = useRef<KonvaRect | null>(null);
  const transformerRef = useRef<KonvaTransformer | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [images, setImages] = useState<ImageFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [imageLoadError, setImageLoadError] = useState("");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [drawingRect, setDrawingRect] = useState<DrawingRect | null>(null);
  const [labels, setLabels] = useState<LabelConfig[]>(DEFAULT_LABELS);
  const [savedLabels, setSavedLabels] = useState<LabelConfig[]>(DEFAULT_LABELS);
  const [templates, setTemplates] = useState<LabelTemplate[]>(DEFAULT_LABEL_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_LABEL_TEMPLATES[0].id);
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [activeProjectConfigPath, setActiveProjectConfigPath] = useState("");
  const [activeProjectConfig, setActiveProjectConfig] = useState<ProjectConfig | null>(null);
  const [currentLabelId, setCurrentLabelId] = useState(DEFAULT_LABELS[0].id);
  const [isLabelDirty, setIsLabelDirty] = useState(false);
  const [selectedExportFormatId, setSelectedExportFormatId] = useState<ExportFormatId>("json");
  const [customMappingText, setCustomMappingText] = useState(
    JSON.stringify(DEFAULT_CUSTOM_EXPORT_MAPPING, null, 2),
  );
  const [error, setError] = useState("");

  const annotationsByImage = useAnnotationStore((state) => state.annotationsByImage);
  const selectedShapeId = useAnnotationStore((state) => state.selectedShapeId);
  const addAnnotation = useAnnotationStore((state) => state.addAnnotation);
  const updateAnnotation = useAnnotationStore((state) => state.updateAnnotation);
  const replaceAnnotations = useAnnotationStore((state) => state.replaceAnnotations);
  const replaceLabel = useAnnotationStore((state) => state.replaceLabel);
  const selectShape = useAnnotationStore((state) => state.selectShape);
  const annotations = annotationsByImage[selectedPath] ?? [];
  const selectedShape = annotations.find((annotation) => annotation.id === selectedShapeId) ?? null;

  const labelById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const usedLabelIds = useMemo(
    () =>
      new Set(
        Object.values(annotationsByImage)
          .flat()
          .map((annotation) => annotation.labelId),
      ),
    [annotationsByImage],
  );
  const currentLabel = labelById.get(currentLabelId) ?? labels[0];

  const selectedImage = useMemo(
    () => images.find((image) => image.path === selectedPath) ?? null,
    [images, selectedPath],
  );

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    const updateSize = () => {
      setCanvasSize({
        width: host.clientWidth,
        height: host.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([loadLabelConfigs(), loadLabelTemplates()])
      .then(([savedLabels, savedTemplates]) => {
        const nextTemplates = [
          ...DEFAULT_LABEL_TEMPLATES,
          ...savedTemplates.filter(
            (template) => !DEFAULT_LABEL_TEMPLATES.some((item) => item.id === template.id),
          ),
        ];
        const nextLabels = savedLabels.length > 0 ? savedLabels : DEFAULT_LABELS;

        if (!cancelled && savedLabels.length > 0) {
          setLabels(nextLabels);
          setSavedLabels(nextLabels);
          setCurrentLabelId(nextLabels[0].id);
        }
        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!labelById.has(currentLabelId)) {
      setCurrentLabelId(labels[0].id);
    }
  }, [currentLabelId, labelById, labels]);

  useEffect(() => {
    if (!selectedImage) {
      setLoadedImage(null);
      setImageLoadError("");
      return;
    }

    let cancelled = false;
    const image = new Image();
    setLoadedImage(null);
    setImageLoadError("");

    image.onload = () => {
      if (!cancelled) {
        setLoadedImage(image);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setImageLoadError(`图片加载失败：${selectedImage.name}`);
      }
    };
    image.src = imageFileSrc(selectedImage.path);

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [selectedImage]);

  useEffect(() => {
    selectShape(null);
    setDrawingRect(null);
  }, [selectShape, selectedPath]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    transformer.nodes(selectedShape && selectedRectRef.current ? [selectedRectRef.current] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedShape]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableTarget(event.target)) {
        return;
      }

      const label = labels.find((item) => item.shortcut === event.key.toLowerCase());
      if (!label) {
        return;
      }

      event.preventDefault();
      selectCurrentLabel(label.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [labels, selectCurrentLabel]);

  const imageLayout = useMemo<ImageLayout | null>(() => {
    if (!loadedImage || canvasSize.width === 0 || canvasSize.height === 0) {
      return null;
    }

    const scale = Math.min(
      canvasSize.width / loadedImage.naturalWidth,
      canvasSize.height / loadedImage.naturalHeight,
    );
    const width = loadedImage.naturalWidth * scale;
    const height = loadedImage.naturalHeight * scale;

    return {
      width,
      height,
      scale,
      x: (canvasSize.width - width) / 2,
      y: (canvasSize.height - height) / 2,
    };
  }, [canvasSize, loadedImage]);

  async function openFolder() {
    setError("");

    try {
      const path = await selectImageFolder();
      if (!path) {
        return;
      }

      const nextImages = await listImageFiles(path);
      setFolderPath(path);
      setImages(nextImages);
      setSelectedPath(nextImages[0]?.path ?? "");
      await maybeLoadProjectConfig(path, nextImages);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  }

  async function exportSelectedFormat() {
    setError("");

    try {
      const savedPath = await exportSelectedFormatAs();
      if (savedPath && selectedExportFormatId !== "custom") {
        await updateProjectConfig(selectedExportFormatId, savedPath);
      }
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
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
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
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
      template: currentTemplateSnapshot(),
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

      if (!confirmReplaceCurrentAnnotations(images)) {
        return;
      }

      const annotationPath = await selectJsonFile();
      if (!annotationPath) {
        return;
      }
      await loadProjectConfigImport(annotationPath, images, false);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
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
    if (confirmReplace && !confirmReplaceCurrentAnnotations(currentImages)) {
      return null;
    }

    const config = parseProjectConfig(await readTextFile(configPath));
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

    const { annotationsByImage, missingCount } = matchImportedImages(imported, currentImages);
    replaceAnnotations(annotationsByImage);
    applyProjectTemplate(config.template, imported.labels);
    setActiveProjectConfig({ ...config, labels: imported.labels });
    setActiveProjectConfigPath(configPath);
    setProjectTemplateId(config.template.id);
    setSelectedExportFormatId(config.format);
    if (missingCount > 0) {
      window.alert(`有 ${missingCount} 个导入图片未匹配到当前图片目录，已跳过。`);
    }
  }

  function applyProjectTemplate(template: ProjectConfig["template"], nextLabels: LabelConfig[]) {
    const projectTemplate: LabelTemplate = { ...template, labels: nextLabels };
    setTemplates((items) => [
      ...items.filter((item) => item.id !== projectTemplate.id),
      projectTemplate,
    ]);
    setSelectedTemplateId(projectTemplate.id);
    setLabels(nextLabels);
    setSavedLabels(nextLabels);
    setCurrentLabelId(nextLabels[0].id);
    setIsLabelDirty(false);
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

  function handleStageMouseDown(event: KonvaEventObject<MouseEvent>) {
    if (event.evt.button !== 0) {
      return;
    }

    if (!imageLayout || !loadedImage || !selectedPath) {
      return;
    }

    const isBackground =
      event.target === event.target.getStage() || event.target.name() === "image";
    if (!isBackground) {
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      selectShape(null);
      return;
    }

    selectShape(null);
    setDrawingRect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  }

  function handleStageMouseMove(event: KonvaEventObject<MouseEvent>) {
    if (!drawingRect || !imageLayout || !loadedImage) {
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      return;
    }

    setDrawingRect({ ...drawingRect, currentX: point.x, currentY: point.y });
  }

  function handleStageMouseUp() {
    if (!drawingRect || !selectedPath) {
      return;
    }

    const points = normalizeRectPoints(drawingRect);
    setDrawingRect(null);

    if (points[2] < 3 || points[3] < 3) {
      return;
    }

    addAnnotation(selectedPath, {
      id: newAnnotationId(),
      type: "rect",
      labelId: currentLabel.id,
      points,
      frameIndex: 0,
    });
  }

  function selectCurrentLabel(labelId: string) {
    setCurrentLabelId(labelId);
    if (selectedShape) {
      updateAnnotation(selectedPath, selectedShape.id, { labelId });
    }
  }

  function handleDragEnd(annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) {
    if (!imageLayout || !loadedImage) {
      return;
    }

    const node = event.target;
    const [, , width, height] = annotation.points;
    const nextRect = clampRect(
      {
        x: (node.x() - imageLayout.x) / imageLayout.scale,
        y: (node.y() - imageLayout.y) / imageLayout.scale,
        width,
        height,
      },
      loadedImage,
    );

    updateAnnotation(selectedPath, annotation.id, {
      points: [nextRect.x, nextRect.y, nextRect.width, nextRect.height],
    });
  }

  function handleTransformEnd(annotation: AnnotationShape) {
    const node = selectedRectRef.current;
    if (!node || !imageLayout || !loadedImage) {
      return;
    }

    const nextRect = clampRect(
      {
        x: (node.x() - imageLayout.x) / imageLayout.scale,
        y: (node.y() - imageLayout.y) / imageLayout.scale,
        width: (node.width() * node.scaleX()) / imageLayout.scale,
        height: (node.height() * node.scaleY()) / imageLayout.scale,
      },
      loadedImage,
    );

    node.scaleX(1);
    node.scaleY(1);
    updateAnnotation(selectedPath, annotation.id, {
      points: [nextRect.x, nextRect.y, nextRect.width, nextRect.height],
    });
  }

  function updateLabels(nextLabels: LabelConfig[]) {
    const safeLabels = nextLabels.length > 0 ? nextLabels : DEFAULT_LABELS;
    setLabels(safeLabels);
    if (!safeLabels.some((label) => label.id === currentLabelId)) {
      setCurrentLabelId(safeLabels[0].id);
    }
    setIsLabelDirty(true);
  }

  function selectTemplate(templateId: string) {
    if (isLabelDirty && !window.confirm("放弃当前未保存的标签修改？")) {
      return;
    }

    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    if (template.id === projectTemplateId) {
      applyProjectTemplate(template, template.labels);
      return;
    }

    applySavedLabels(template.labels);
    setSelectedTemplateId(template.id);
  }

  function currentTemplateSnapshot(): ProjectConfig["template"] {
    const template = templates.find((item) => item.id === selectedTemplateId);
    return {
      id: template?.id ?? selectedTemplateId,
      name: template?.name ?? "当前模板",
    };
  }

  function newTemplate() {
    const name = window.prompt("新模板名称");
    if (!name?.trim()) {
      return;
    }

    const template: LabelTemplate = {
      id: newTemplateId(templates, name),
      name: name.trim(),
      labels,
    };

    const nextTemplates = [...templates, template];
    setTemplates(nextTemplates);
    setSelectedTemplateId(template.id);
    persistUserTemplates(nextTemplates);
    applySavedLabels(template.labels);
  }

  function saveTemplate() {
    if (selectedTemplateId === projectTemplateId) {
      saveProjectLabels(labels);
      return;
    }

    if (!isUserTemplate(selectedTemplateId)) {
      saveTemplateAs();
      return;
    }

    const nextTemplates = templates.map((template) =>
      template.id === selectedTemplateId ? { ...template, labels } : template,
    );
    setTemplates(nextTemplates);
    persistUserTemplates(nextTemplates);
    applySavedLabels(labels);
  }

  function cancelLabelChanges() {
    if (selectedTemplateId === projectTemplateId && activeProjectConfig) {
      applyProjectTemplate(activeProjectConfig.template, savedLabels);
      return;
    }

    applySavedLabels(savedLabels);
  }

  function saveTemplateAs() {
    const name = window.prompt("另存为模板名称");
    if (!name?.trim()) {
      return;
    }

    const template: LabelTemplate = {
      id: newTemplateId(templates, name),
      name: name.trim(),
      labels,
    };
    const nextTemplates = [...templates, template];

    setTemplates(nextTemplates);
    setSelectedTemplateId(template.id);
    persistUserTemplates(nextTemplates);
    applySavedLabels(labels);
  }

  function deleteTemplate() {
    if (!isUserTemplate(selectedTemplateId) || selectedTemplateId === projectTemplateId) {
      return;
    }

    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template || !window.confirm(`删除模板「${template.name}」？`)) {
      return;
    }

    const nextTemplates = templates.filter((item) => item.id !== selectedTemplateId);
    const nextTemplate = nextTemplates[0] ?? DEFAULT_LABEL_TEMPLATES[0];
    setTemplates(nextTemplates);
    setSelectedTemplateId(nextTemplate.id);
    persistUserTemplates(nextTemplates);
    applySavedLabels(nextTemplate.labels);
  }

  function applySavedLabels(nextLabels: LabelConfig[]) {
    replaceMissingAnnotationLabels(nextLabels);
    setLabels(nextLabels);
    setSavedLabels(nextLabels);
    setCurrentLabelId(nextLabels[0]?.id ?? DEFAULT_LABELS[0].id);
    setIsLabelDirty(false);
    saveLabelConfigs(nextLabels).catch(reportError);
  }

  function saveProjectLabels(nextLabels: LabelConfig[]) {
    if (!activeProjectConfig || !activeProjectConfigPath) {
      applySavedLabels(nextLabels);
      return;
    }

    const nextConfig = { ...activeProjectConfig, labels: nextLabels };
    replaceMissingAnnotationLabels(nextLabels);
    setActiveProjectConfig(nextConfig);
    applyProjectTemplate(activeProjectConfig.template, nextLabels);
    saveProjectConfig(activeProjectConfigPath, nextConfig).catch(reportError);
  }

  function replaceMissingAnnotationLabels(nextLabels: LabelConfig[]) {
    const safeIds = new Set(nextLabels.map((label) => label.id));
    const fallbackLabelId = nextLabels[0]?.id ?? DEFAULT_LABELS[0].id;

    for (const labelId of usedLabelIds) {
      if (!safeIds.has(labelId)) {
        replaceLabel(labelId, fallbackLabelId);
      }
    }
  }

  function persistUserTemplates(nextTemplates: LabelTemplate[]) {
    saveLabelTemplates(
      nextTemplates.filter(
        (template) => isUserTemplate(template.id) && template.id !== projectTemplateId,
      ),
    ).catch(reportError);
  }

  function reportError(caughtError: unknown) {
    setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
  }

  const draftRect =
    drawingRect && imageLayout ? toCanvasRect(normalizeRectPoints(drawingRect), imageLayout) : null;

  return (
    <main className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="shrink-0 border-b border-slate-800 p-4">
          <h1 className="text-lg font-semibold">my_label_tool</h1>
          <button
            className="mt-4 w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
            type="button"
            onClick={openFolder}
          >
            打开图片文件夹
          </button>
          <button
            className="mt-2 w-full rounded border border-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={images.length === 0}
            type="button"
            onClick={importAnnotations}
          >
            导入标注
          </button>
          {folderPath && (
            <p className="mt-3 truncate text-xs text-slate-400" title={folderPath}>
              {folderPath}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </div>

        <ExportPanel
          canSaveProject={
            activeProjectConfig !== null && selectedExportFormatId === activeProjectConfig.format
          }
          customMappingText={customMappingText}
          disabled={images.length === 0}
          selectedFormatId={selectedExportFormatId}
          onChangeCustomMappingText={setCustomMappingText}
          onChangeFormat={setSelectedExportFormatId}
          onExport={exportSelectedFormat}
          onSaveProject={saveProjectExport}
        />

        <div className="scrollbar-dark min-h-0 flex-1 overflow-y-auto">
          <LabelSettings
            canSaveTemplate={
              isUserTemplate(selectedTemplateId) || selectedTemplateId === projectTemplateId
            }
            canDeleteTemplate={
              isUserTemplate(selectedTemplateId) && selectedTemplateId !== projectTemplateId
            }
            isDirty={isLabelDirty}
            labels={labels}
            selectedTemplateId={selectedTemplateId}
            templates={templates}
            usedLabelIds={usedLabelIds}
            onCancelChanges={cancelLabelChanges}
            onChangeLabels={updateLabels}
            onDeleteTemplate={deleteTemplate}
            onNewTemplate={newTemplate}
            onSaveTemplate={saveTemplate}
            onSaveTemplateAs={saveTemplateAs}
            onSelectTemplate={selectTemplate}
          />

          <section className="border-b border-slate-800 p-4">
            <label className="block text-sm text-slate-300">
              当前标签（新框使用）
              <select
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={currentLabel.id}
                onChange={(event) => selectCurrentLabel(event.target.value)}
              >
                {labels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.shortcut ? `${label.name} (${label.shortcut})` : label.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: currentLabel.color }}
              />
              <span>{currentLabel.name}</span>
              {currentLabel.shortcut && (
                <span className="text-xs text-slate-500">快捷键 {currentLabel.shortcut}</span>
              )}
            </div>
          </section>
        </div>

        <section className="flex max-h-64 min-h-36 shrink-0 flex-col border-t border-slate-800 bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
            <h2 className="text-sm font-semibold text-slate-200">图片列表</h2>
            <span className="text-xs text-slate-500">{images.length}</span>
          </div>
          <div className="scrollbar-dark min-h-0 flex-1 overflow-auto p-2">
            {images.length === 0 ? (
              <p className="p-2 text-sm text-slate-400">
                {folderPath
                  ? "没有找到可加载的 jpg/png/bmp 图片；空文件或损坏图片会被跳过。"
                  : "请选择包含 jpg/png/bmp 的文件夹。"}
              </p>
            ) : (
              images.map((image) => (
                <button
                  className={`block w-full truncate rounded px-3 py-2 text-left text-sm ${
                    image.path === selectedPath
                      ? "bg-sky-500 text-white"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                  key={image.path}
                  title={image.path}
                  type="button"
                  onClick={() => setSelectedPath(image.path)}
                >
                  {image.name}
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <div ref={canvasHostRef} className="h-full min-w-0 flex-1 overflow-hidden bg-slate-950">
        {selectedImage && loadedImage && imageLayout ? (
          <Stage
            width={canvasSize.width}
            height={canvasSize.height}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onContextMenu={(event) => event.evt.preventDefault()}
          >
            <Layer>
              <KonvaImage
                height={imageLayout.height}
                image={loadedImage}
                name="image"
                width={imageLayout.width}
                x={imageLayout.x}
                y={imageLayout.y}
              />
              {annotations.map((annotation) => (
                <AnnotationRect
                  annotation={annotation}
                  imageLayout={imageLayout}
                  isSelected={annotation.id === selectedShapeId}
                  key={annotation.id}
                  label={labelById.get(annotation.labelId) ?? labels[0]}
                  rectRef={selectedRectRef}
                  onDragEnd={handleDragEnd}
                  onSelect={selectShape}
                  onTransformEnd={handleTransformEnd}
                />
              ))}
              {draftRect && (
                <Rect {...draftRect} dash={[6, 4]} stroke={currentLabel.color} strokeWidth={2} />
              )}
              <Transformer ref={transformerRef} rotateEnabled={false} />
            </Layer>
          </Stage>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            {selectedImage
              ? imageLoadError ||
                (loadedImage ? "画布区域尺寸异常，无法显示图片。" : "正在加载图片...")
              : "选择文件夹后，在这里预览图片。"}
          </div>
        )}
      </div>
    </main>
  );
}

interface AnnotationRectProps {
  annotation: AnnotationShape;
  imageLayout: ImageLayout;
  isSelected: boolean;
  label: LabelConfig;
  rectRef: MutableRefObject<KonvaRect | null>;
  onDragEnd: (annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) => void;
  onSelect: (annotationId: string) => void;
  onTransformEnd: (annotation: AnnotationShape) => void;
}

function AnnotationRect({
  annotation,
  imageLayout,
  isSelected,
  label,
  rectRef,
  onDragEnd,
  onSelect,
  onTransformEnd,
}: AnnotationRectProps) {
  const rect = toCanvasRect(annotation.points, imageLayout);

  return (
    <Rect
      {...rect}
      ref={(node) => {
        if (isSelected) {
          rectRef.current = node;
        }
      }}
      draggable
      fill={`${label.color}22`}
      stroke={label.color}
      strokeWidth={isSelected ? 3 : 2}
      onClick={() => onSelect(annotation.id)}
      onDragEnd={(event) => onDragEnd(annotation, event)}
      onMouseDown={(event) => {
        event.cancelBubble = true;
        onSelect(annotation.id);
      }}
      onTransformEnd={() => onTransformEnd(annotation)}
    />
  );
}

function getImagePoint(
  event: KonvaEventObject<MouseEvent>,
  layout: ImageLayout,
  image: HTMLImageElement,
): { x: number; y: number } | null {
  const pointer = event.target.getStage()?.getPointerPosition();
  if (!pointer) {
    return null;
  }

  const x = (pointer.x - layout.x) / layout.scale;
  const y = (pointer.y - layout.y) / layout.scale;
  if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) {
    return null;
  }

  return { x, y };
}

function normalizeRectPoints(rect: DrawingRect): number[] {
  const x = Math.min(rect.startX, rect.currentX);
  const y = Math.min(rect.startY, rect.currentY);
  return [x, y, Math.abs(rect.currentX - rect.startX), Math.abs(rect.currentY - rect.startY)];
}

function toCanvasRect(points: number[], layout: ImageLayout) {
  const [x, y, width, height] = points;
  return {
    x: layout.x + x * layout.scale,
    y: layout.y + y * layout.scale,
    width: width * layout.scale,
    height: height * layout.scale,
  };
}

function clampRect(
  rect: { x: number; y: number; width: number; height: number },
  image: HTMLImageElement,
) {
  const width = Math.max(1, Math.min(rect.width, image.naturalWidth));
  const height = Math.max(1, Math.min(rect.height, image.naturalHeight));
  return {
    x: Math.min(Math.max(0, rect.x), image.naturalWidth - width),
    y: Math.min(Math.max(0, rect.y), image.naturalHeight - height),
    width,
    height,
  };
}

function loadImageSize(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`图片尺寸读取失败：${path}`));
    image.src = imageFileSrc(path);
  });
}

function confirmReplaceCurrentAnnotations(images: ImageFile[]): boolean {
  const annotationsByImage = useAnnotationStore.getState().annotationsByImage;
  const count = images.reduce(
    (total, image) => total + (annotationsByImage[image.path]?.length ?? 0),
    0,
  );
  return count === 0 || window.confirm("当前图片目录已有标注，导入后会覆盖，是否继续？");
}

function matchImportedImages(imported: ImportedAnnotations, currentImages: ImageFile[]) {
  const byPath = new Map(currentImages.map((image) => [normalizePath(image.path), image]));
  const byName = new Map(currentImages.map((image) => [image.name.toLowerCase(), image]));
  const annotationsByImage: Record<string, AnnotationShape[]> = {};
  let missingCount = 0;

  for (const image of imported.images) {
    const matched =
      (image.path ? byPath.get(normalizePath(image.path)) : undefined) ??
      byName.get(image.name.toLowerCase());
    if (!matched) {
      missingCount += 1;
      continue;
    }
    annotationsByImage[matched.path] = image.annotations;
  }

  return { annotationsByImage, missingCount };
}

function projectConfigPath(folderPath: string): string {
  return joinPath(folderPath, PROJECT_CONFIG_NAME);
}

function joinPath(folderPath: string, name: string): string {
  const separator = folderPath.includes("\\") ? "\\" : "/";
  return `${folderPath.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function baseName(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? path
  );
}

function saveProjectConfig(path: string, config: ProjectConfig): Promise<void> {
  return exportAnnotationsJson(path, config);
}

function parseCustomMapping(text: string): Required<CustomExportMapping> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error("自定义导出字段映射必须是 JSON 对象");
  }

  const mapping = { ...DEFAULT_CUSTOM_EXPORT_MAPPING };
  for (const key of Object.keys(mapping) as Array<keyof Required<CustomExportMapping>>) {
    const value = parsed[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`自定义导出字段 ${key} 必须是非空字符串`);
    }
    mapping[key] = value;
  }

  return mapping;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isUserTemplate(templateId: string): boolean {
  return !DEFAULT_LABEL_TEMPLATES.some((template) => template.id === templateId);
}

function newTemplateId(templates: LabelTemplate[], name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const prefix = base || "template";
  let id = prefix;
  let suffix = 2;

  while (templates.some((template) => template.id === id)) {
    id = `${prefix}-${suffix}`;
    suffix += 1;
  }

  return id;
}

function newAnnotationId(): string {
  return crypto.randomUUID();
}

export default App;
