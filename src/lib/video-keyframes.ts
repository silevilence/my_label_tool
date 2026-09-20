import type { AnnotationShape } from "../types/annotation";
/** Tracking stays within the existing extensible attributes contract. */
export function videoTrackId(shape: AnnotationShape | null): string {
  return typeof shape?.attributes?.videoTrackId === "string" ? shape.attributes.videoTrackId : "";
}
export function isVideoKeyframe(shape: AnnotationShape): boolean {
  return Boolean(videoTrackId(shape)) && shape.attributes?.videoKeyframe === true;
}
