import type { LabelTemplate } from "../types/annotation";
import type { PluginLabelPreset } from "../types/plugin";

export interface MergedPluginLabelPresets {
  templates: LabelTemplate[];
  pluginTemplateIds: Set<string>;
  sourceByTemplateId: ReadonlyMap<string, string>;
  collisions: string[];
}

export type SelectedPluginPresetRefreshImpact = "none" | "updated" | "removed";

export function getSelectedPluginPresetRefreshImpact(
  previousPresets: PluginLabelPreset[],
  nextPresets: PluginLabelPreset[],
  selectedTemplateId: string,
): SelectedPluginPresetRefreshImpact {
  const previous = previousPresets.find((preset) => preset.template.id === selectedTemplateId);
  if (!previous) return "none";
  const next = nextPresets.find((preset) => preset.template.id === selectedTemplateId);
  if (!next) return "removed";
  return JSON.stringify(previous.template) === JSON.stringify(next.template) ? "none" : "updated";
}

/** Replaces only templates known to have come from the previous plugin snapshot. */
export function mergePluginLabelPresets(
  templates: LabelTemplate[],
  previousPluginTemplateIds: ReadonlySet<string>,
  presets: PluginLabelPreset[],
): MergedPluginLabelPresets {
  const nextTemplates = templates.filter((template) => !previousPluginTemplateIds.has(template.id));
  const occupiedIds = new Set(nextTemplates.map((template) => template.id));
  const pluginTemplateIds = new Set<string>();
  const sourceByTemplateId = new Map<string, string>();
  const collisions: string[] = [];

  for (const preset of [...presets].sort((left, right) => left.pluginId.localeCompare(right.pluginId))) {
    if (occupiedIds.has(preset.template.id)) {
      collisions.push(preset.template.id);
      continue;
    }
    nextTemplates.push(preset.template);
    occupiedIds.add(preset.template.id);
    pluginTemplateIds.add(preset.template.id);
    sourceByTemplateId.set(preset.template.id, preset.pluginName);
  }

  return { templates: nextTemplates, pluginTemplateIds, sourceByTemplateId, collisions };
}
