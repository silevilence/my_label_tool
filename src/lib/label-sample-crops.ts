import type { AnnotationShape } from "../types/annotation";
import type { LabelSampleBounds, LabelSampleCandidate } from "../types/label-sample";
import type { ImageFile } from "./tauri-api";

/** Points have no area; show enough surrounding pixels to identify the feature. */
export const POINT_SAMPLE_SIZE = 64;
export const SAMPLE_CANDIDATES_PER_PAGE = 12;

export function sampleCropBounds(shape: AnnotationShape): LabelSampleBounds | null {
  const p = shape.points;
  if (!p.every(Number.isFinite)) return null;
  if (shape.type === "rect") {
    if (p.length !== 4 || p[2] <= 0 || p[3] <= 0) return null;
    return { x: p[0], y: p[1], width: p[2], height: p[3] };
  }
  if (shape.type === "point") {
    if (p.length !== 2) return null;
    return {
      x: p[0] - POINT_SAMPLE_SIZE / 2,
      y: p[1] - POINT_SAMPLE_SIZE / 2,
      width: POINT_SAMPLE_SIZE,
      height: POINT_SAMPLE_SIZE,
    };
  }
  if (p.length < 6 || p.length % 2 !== 0) return null;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    left = Math.min(left, p[i]);
    right = Math.max(right, p[i]);
    top = Math.min(top, p[i + 1]);
    bottom = Math.max(bottom, p[i + 1]);
  }
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function labelSampleCandidates(
  images: readonly ImageFile[],
  annotations: Record<string, AnnotationShape[]>,
  labelId: string,
  selectedPath: string,
): LabelSampleCandidate[] {
  const ordered = [
    ...images.filter((image) => image.path === selectedPath),
    ...images.filter((image) => image.path !== selectedPath),
  ];
  return ordered.flatMap((image) =>
    (annotations[image.path] ?? []).flatMap((shape) => {
      if (shape.labelId !== labelId) return [];
      const bounds = sampleCropBounds(shape);
      return bounds
        ? [{ imagePath: image.path, imageName: image.name, annotationId: shape.id, bounds }]
        : [];
    }),
  );
}
