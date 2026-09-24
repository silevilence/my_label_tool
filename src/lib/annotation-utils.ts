import type { AnnotationShape } from "../types/annotation";

export function annotationShapesSnapshot(annotations: AnnotationShape[]): string {
  return JSON.stringify(annotations);
}

/** Exact representation equality for native history and stale-snapshot detection. */
export function annotationSnapshotsEqual(
  left: AnnotationShape[],
  right: AnnotationShape[],
): boolean {
  return annotationShapesSnapshot(left) === annotationShapesSnapshot(right);
}

/** Script results may reorder JSON object keys and explicitly supply default frame 0. */
export function annotationShapeFingerprint(shape: AnnotationShape): string {
  return JSON.stringify([
    shape.id,
    shape.type,
    shape.labelId,
    shape.points,
    Object.entries(shape.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    shape.frameIndex ?? 0,
  ]);
}

/** Semantic equality ignores object key order and omitted default frame/attributes. */
export function annotationValuesEqual(left: AnnotationShape[], right: AnnotationShape[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (shape, index) =>
        annotationShapeFingerprint(shape) === annotationShapeFingerprint(right[index]),
    )
  );
}
