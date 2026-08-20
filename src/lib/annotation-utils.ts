import type { AnnotationShape } from "../types/annotation";

export function annotationShapesSnapshot(annotations: AnnotationShape[]): string {
  return JSON.stringify(annotations);
}

export function annotationShapesEqual(left: AnnotationShape[], right: AnnotationShape[]): boolean {
  return annotationShapesSnapshot(left) === annotationShapesSnapshot(right);
}
