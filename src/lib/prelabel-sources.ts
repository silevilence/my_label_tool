import { newAnnotationId } from "./app-utils";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ResolvedPrelabelClassMapping } from "../types/prelabel";
import type {
  PluginPrelabelClassMapping,
  PluginPrelabelImageResult,
} from "../types/plugin";
import { PLUGIN_ZH_CN as text } from "../i18n/plugin.zh-CN";

export function toProjectRelativeImagePath(imagePath: string, projectFolder: string): string {
  const normalizedImage = imagePath.replace(/\\/g, "/");
  const normalizedFolder = projectFolder.replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = `${normalizedFolder}/`;
  if (
    !normalizedFolder ||
    !normalizedImage.toLowerCase().startsWith(prefix.toLowerCase()) ||
    normalizedImage.length <= prefix.length
  ) {
    throw new Error(text.prelabelImageOutsideProject);
  }
  const relative = normalizedImage.slice(prefix.length);
  if (
    relative.includes(":") ||
    relative.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(text.prelabelRelativePathInvalid);
  }
  return relative;
}

export function toPluginPrelabelClassMappings(
  mappings: ResolvedPrelabelClassMapping[],
  labels: LabelConfig[],
): PluginPrelabelClassMapping[] {
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  return mappings.flatMap((mapping) => {
    if (mapping.excluded || !mapping.labelId) return [];
    const label = labelsById.get(mapping.labelId);
    return label
      ? [{ modelClass: mapping.className, labelId: label.id, labelName: label.name }]
      : [];
  });
}

export function mapPluginPrelabelResults(
  results: PluginPrelabelImageResult[],
  absoluteByRelativePath: ReadonlyMap<string, string>,
  createId: () => string = newAnnotationId,
): Array<{ imagePath: string; annotations: AnnotationShape[] }> {
  return results.map((result) => {
    const imagePath = absoluteByRelativePath.get(result.imagePath.toLowerCase());
    if (!imagePath) throw new Error(text.prelabelUnknownImagePath);
    return {
      imagePath,
      annotations: result.shapes.map((shape) => ({
        ...shape,
        id: createId(),
        points: [...shape.points],
        attributes: shape.attributes ? { ...shape.attributes } : undefined,
        frameIndex: shape.frameIndex ?? 0,
      })),
    };
  });
}
