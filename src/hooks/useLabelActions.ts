import { DEFAULT_LABELS, DEFAULT_LABEL_TEMPLATES } from "../lib/defaults/labels";
import { newTemplateId, isUserTemplate, saveProjectConfig } from "../lib/app-utils";
import { confirmAction, saveLabelConfigs, saveLabelTemplates } from "../lib/tauri-api";
import type { AnnotationShape, LabelConfig, LabelTemplate } from "../types/annotation";
import type { ProjectConfig } from "../lib/importers";

interface UseLabelActionsParams {
  activeProjectConfig: ProjectConfig | null;
  activeProjectConfigPath: string;
  currentLabelId: string;
  isLabelDirty: boolean;
  labels: LabelConfig[];
  projectTemplateId: string;
  savedLabels: LabelConfig[];
  selectedPath: string;
  selectedShapeId: string | null;
  selectedTemplateId: string;
  templates: LabelTemplate[];
  usedLabelIds: Set<string>;
  replaceLabel: (oldLabelId: string, nextLabelId: string) => void;
  setActiveProjectConfig: (config: ProjectConfig) => void;
  setCurrentLabelId: (labelId: string) => void;
  setError: (message: string) => void;
  setIsLabelDirty: (isDirty: boolean) => void;
  setLabels: (labels: LabelConfig[]) => void;
  setSavedLabels: (labels: LabelConfig[]) => void;
  setSelectedTemplateId: (templateId: string) => void;
  setTemplates: (
    templates: LabelTemplate[] | ((items: LabelTemplate[]) => LabelTemplate[]),
  ) => void;
  updateAnnotation: (
    imagePath: string,
    annotationId: string,
    patch: Partial<AnnotationShape>,
  ) => void;
}

export function useLabelActions({
  activeProjectConfig,
  activeProjectConfigPath,
  currentLabelId,
  isLabelDirty,
  labels,
  projectTemplateId,
  savedLabels,
  selectedPath,
  selectedShapeId,
  selectedTemplateId,
  templates,
  usedLabelIds,
  replaceLabel,
  setActiveProjectConfig,
  setCurrentLabelId,
  setError,
  setIsLabelDirty,
  setLabels,
  setSavedLabels,
  setSelectedTemplateId,
  setTemplates,
  updateAnnotation,
}: UseLabelActionsParams) {
  function reportError(caughtError: unknown) {
    setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
  }

  function selectCurrentLabel(labelId: string) {
    setCurrentLabelId(labelId);
    if (selectedShapeId) {
      updateAnnotation(selectedPath, selectedShapeId, { labelId });
    }
  }

  function updateLabels(nextLabels: LabelConfig[]) {
    const safeLabels = nextLabels.length > 0 ? nextLabels : DEFAULT_LABELS;
    setLabels(safeLabels);
    if (!safeLabels.some((label) => label.id === currentLabelId)) {
      setCurrentLabelId(safeLabels[0].id);
    }
    setIsLabelDirty(true);
  }

  async function selectTemplate(templateId: string) {
    if (isLabelDirty && !(await confirmAction("放弃当前未保存的标签修改？"))) {
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

  async function deleteTemplate() {
    if (!isUserTemplate(selectedTemplateId) || selectedTemplateId === projectTemplateId) {
      return;
    }

    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template || !(await confirmAction(`删除模板「${template.name}」？`))) {
      return;
    }

    const nextTemplates = templates.filter((item) => item.id !== selectedTemplateId);
    const nextTemplate = nextTemplates[0] ?? DEFAULT_LABEL_TEMPLATES[0];
    setTemplates(nextTemplates);
    setSelectedTemplateId(nextTemplate.id);
    persistUserTemplates(nextTemplates);
    applySavedLabels(nextTemplate.labels);
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

  return {
    applyProjectTemplate,
    cancelLabelChanges,
    currentTemplateSnapshot,
    deleteTemplate,
    newTemplate,
    saveTemplate,
    saveTemplateAs,
    selectCurrentLabel,
    selectTemplate,
    updateLabels,
  };
}
