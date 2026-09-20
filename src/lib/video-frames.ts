import type { VideoProject } from "../types/video";
import type { AnnotationShape } from "../types/annotation";
import type { ImageFile } from "./tauri-api";
import { isVideoKeyframe } from "./video-keyframes";
export interface FrameSummary {
  /** Ordinal in the available extracted-frame sequence, distinct from the decoded source frame. */
  index: number;
  frameIndex: number;
  timestampSeconds: number;
  name: string;
  path: string;
  annotated: boolean;
  keyframe: boolean;
}
type Annotations = Record<string, AnnotationShape[]>;
// Inputs are immutable snapshots. Weak keys let all views share one computation without retaining old projects.
const cache = new WeakMap<
  VideoProject,
  WeakMap<Annotations, WeakMap<ImageFile[], FrameSummary[]>>
>();
const EMPTY: FrameSummary[] = [];
export function frameSummaries(
  video: VideoProject | null,
  annotations: Annotations,
  framePaths: ImageFile[],
): FrameSummary[] {
  if (!video) return EMPTY;
  let byAnnotations = cache.get(video);
  if (!byAnnotations) {
    byAnnotations = new WeakMap();
    cache.set(video, byAnnotations);
  }
  let byPaths = byAnnotations.get(annotations);
  if (!byPaths) {
    byPaths = new WeakMap();
    byAnnotations.set(annotations, byPaths);
  }
  const existing = byPaths.get(framePaths);
  if (existing) return existing;
  const paths = new Map(framePaths.map((image) => [image.name, image.path]));
  const result: FrameSummary[] = [];
  for (const frame of video.frames) {
    const path = paths.get(frame.name);
    if (!path) continue;
    const shapes = annotations[path] ?? [];
    result.push({
      ...frame,
      index: result.length,
      path,
      annotated: shapes.length > 0,
      keyframe: shapes.some(isVideoKeyframe),
    });
  }
  byPaths.set(framePaths, result);
  return result;
}
export function frameNavigation(
  frames: FrameSummary[],
  selectedPath: string,
  onSelect: (path: string) => void,
) {
  const currentIndex = frames.findIndex((frame) => frame.path === selectedPath);
  const select = (target: number | string) => {
    const frame =
      typeof target === "number" ? frames[target] : frames.find((item) => item.path === target);
    if (!frame) return false;
    onSelect(frame.path);
    return true;
  };
  const canStep = (delta: number) =>
    Number.isInteger(delta) &&
    delta !== 0 &&
    currentIndex >= 0 &&
    currentIndex + delta >= 0 &&
    currentIndex + delta < frames.length;
  return {
    currentIndex,
    select,
    canStep,
    step: (delta: number) => canStep(delta) && select(currentIndex + delta),
  };
}
