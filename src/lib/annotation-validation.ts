import type { AnnotationShape, LabelConfig } from "../types/annotation";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";

/** Common constraints only. Format-specific normalization belongs to importers. */
export function validateAnnotationCore(value: unknown, labels?: readonly LabelConfig[]): asserts value is Omit<AnnotationShape, "id"> & { id?: string } {
  if (!value || typeof value !== "object") throw new Error(text.invalidAnnotation);
  const shape = value as Record<string, unknown>;
  if (typeof shape.labelId !== "string" || !shape.labelId.trim()) throw new Error(text.invalidLabel);
  const label = labels?.find((item) => item.id === shape.labelId);
  if (labels && !label) throw new Error(text.invalidLabel);
  const minimum = shape.type === "rect" ? 4 : shape.type === "polygon" ? 6 : shape.type === "point" ? 2 : 0;
  if (!minimum || (label && label.shapeType !== "any" && label.shapeType !== shape.type)) throw new Error(text.invalidShape);
  if (!Array.isArray(shape.points) || shape.points.length < minimum || !shape.points.every((point: unknown) => typeof point === "number" && Number.isFinite(point))) throw new Error(text.invalidCoordinates);
}

export function resolveLabel(labels: readonly LabelConfig[], query: { name: string } | { id: string }): LabelConfig {
  const matches = labels.filter((label) => "name" in query ? label.name === query.name : label.id === query.id);
  if (!matches.length) throw new Error(`LABEL_NOT_FOUND: ${text.labelMissing}`);
  if (matches.length !== 1) throw new Error(`LABEL_AMBIGUOUS: ${text.labelAmbiguous}`);
  return matches[0];
}
