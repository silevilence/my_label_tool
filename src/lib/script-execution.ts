import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ScriptResult, ScriptSnapshot } from "../types/script";
import { validateAnnotationCore } from "./annotation-validation";
import { annotationShapeFingerprint } from "./annotation-utils";
import { scopePaths, useAnnotationStore } from "../store/useAnnotationStore";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";

export interface ScriptReport {
  images: number;
  submitted: number;
  added: number;
  removed: number;
  changed: number;
  skipped: number;
}
export interface ScriptPreview {
  entries: Array<{ imagePath: string; annotations: AnnotationShape[] }>;
  report: ScriptReport;
  snapshot: ScriptSnapshot;
}

export function createScriptSnapshot(labels: LabelConfig[]): ScriptSnapshot {
  const state = useAnnotationStore.getState();
  const images = new Map(state.images.map((image) => [image.path, image]));
  return structuredClone({
    labels,
    images: scopePaths(state).map((path) => ({
      path,
      name: images.get(path)?.name ?? path,
      annotations: state.annotationsByImage[path] ?? [],
    })),
  });
}

/** Validate all submissions before returning any writeable result. */
export function prepareScriptResults(
  snapshot: ScriptSnapshot,
  results: ScriptResult[],
  newId: () => string = () => crypto.randomUUID(),
): ScriptPreview {
  const originals = new Map(snapshot.images.map((image) => [image.path, image.annotations]));
  const seen = new Set<string>();
  const errors: string[] = [];
  const report: ScriptReport = {
    images: snapshot.images.length,
    submitted: results.length,
    added: 0,
    removed: 0,
    changed: 0,
    skipped: snapshot.images.length - results.length,
  };
  const entries: ScriptPreview["entries"] = [];
  for (const result of results) {
    try {
      if (!originals.has(result.imagePath) || seen.has(result.imagePath))
        throw new Error(text.invalidImage);
      seen.add(result.imagePath);
      const ids = new Set<string>();
      const annotations = result.annotations.map((value) => {
        validateAnnotationCore(value, snapshot.labels);
        if (value.id !== undefined && (typeof value.id !== "string" || !value.id.trim()))
          throw new Error(text.invalidId);
        const id = value.id ?? newId();
        if (ids.has(id)) throw new Error(text.invalidId);
        ids.add(id);
        if (
          value.attributes !== undefined &&
          (!value.attributes ||
            Array.isArray(value.attributes) ||
            typeof value.attributes !== "object" ||
            !Object.values(value.attributes).every(
              (v) =>
                typeof v === "string" ||
                typeof v === "boolean" ||
                (typeof v === "number" && Number.isFinite(v)),
            ))
        )
          throw new Error(text.invalidAttributes);
        if (
          value.frameIndex !== undefined &&
          (!Number.isSafeInteger(value.frameIndex) || value.frameIndex < 0)
        )
          throw new Error(text.invalidFrame);
        return {
          id,
          type: value.type,
          labelId: value.labelId,
          points: [...value.points],
          ...(value.attributes ? { attributes: { ...value.attributes } } : {}),
          frameIndex: value.frameIndex ?? 0,
        };
      });
      const before = new Map(
        (originals.get(result.imagePath) ?? []).map((shape) => [shape.id, shape]),
      );
      report.removed += [...before.keys()].filter((id) => !ids.has(id)).length;
      for (const shape of annotations) {
        const old = before.get(shape.id);
        if (!old) report.added++;
        else if (annotationShapeFingerprint(old) !== annotationShapeFingerprint(shape))
          report.changed++;
      }
      entries.push({ imagePath: result.imagePath, annotations });
    } catch (error) {
      errors.push(`${result.imagePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(`${text.invalidResults}\n${errors.join("\n")}`);
  return { entries, report, snapshot };
}

export function applyScriptPreview(
  preview: ScriptPreview,
  labels: LabelConfig[],
  transactionId: string,
): void {
  const state = useAnnotationStore.getState();
  // Detect any changes during execution or while a preview is open. Never overwrite stale state.
  if (
    JSON.stringify(labels) !== JSON.stringify(preview.snapshot.labels) ||
    JSON.stringify(scopePaths(state)) !==
      JSON.stringify(preview.snapshot.images.map((i) => i.path)) ||
    preview.snapshot.images.some(
      (image) =>
        JSON.stringify(state.annotationsByImage[image.path] ?? []) !==
        JSON.stringify(image.annotations),
    )
  )
    throw new Error(text.staleSnapshot);
  state.applyScriptTransaction(preview.entries, transactionId);
}

export function formatScriptReport(report: ScriptReport): string {
  return text.report(report.images, report.added, report.removed, report.changed, report.skipped);
}
