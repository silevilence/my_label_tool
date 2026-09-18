import type { AnnotationShape } from "../types/annotation";
import type { VideoProject } from "../types/video";
import type { ImageFile } from "./tauri-api";
import { videoImages } from "./video-images";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";

/** Tracking stays within the existing extensible attributes contract. */
export function videoTrackId(shape: AnnotationShape | null): string {
  return typeof shape?.attributes?.videoTrackId === "string" ? shape.attributes.videoTrackId : "";
}

export function markVideoKeyframe(
  shape: AnnotationShape,
  trackId: string,
): Partial<AnnotationShape> {
  if (!trackId.trim()) throw new Error(text.invalidTrack);
  return {
    attributes: {
      ...shape.attributes,
      videoTrackId: trackId,
      videoKeyframe: true,
      videoInterpolated: false,
    },
  };
}

export interface VideoInterpolationPlan {
  trackId: string;
  entries: Array<{
    imagePath: string;
    frameIndex: number;
    annotations: AnnotationShape[];
    generated: AnnotationShape;
  }>;
}

export function interpolateVideoTrack(
  video: VideoProject,
  images: ImageFile[],
  annotations: Record<string, AnnotationShape[]>,
  trackId: string,
): VideoInterpolationPlan {
  if (!trackId) throw new Error(text.invalidTrack);
  const frames = videoImages(video, images).map((image, index) => ({
    ...video.frames[index],
    imagePath: image.path,
  }));
  const keys = frames.flatMap((frame, index) => {
    const shapes = (annotations[frame.imagePath] ?? []).filter(
      (shape) => videoTrackId(shape) === trackId,
    );
    if (shapes.length > 1) throw new Error(text.duplicateTrack);
    return shapes
      .filter((shape) => shape.attributes?.videoKeyframe === true)
      .map((shape) => ({ frame, index, shape }));
  });
  if (keys.length < 2) throw new Error(text.needKeyframes);
  const entries: VideoInterpolationPlan["entries"] = [];
  for (let key = 0; key < keys.length - 1; key++) {
    const start = keys[key];
    const end = keys[key + 1];
    const a = start.shape;
    const b = end.shape;
    if (
      a.type !== b.type ||
      a.labelId !== b.labelId ||
      a.points.length !== b.points.length ||
      !validVideoShape(a) ||
      !validVideoShape(b)
    )
      throw new Error(text.incompatibleKeyframes);
    for (let index = start.index + 1; index < end.index; index++) {
      const frame = frames[index];
      const before = annotations[frame.imagePath] ?? [];
      if (
        before.some(
          (shape) =>
            videoTrackId(shape) === trackId && shape.attributes?.videoInterpolated !== true,
        )
      )
        throw new Error(text.manualConflict);
      const ratio =
        (frame.frameIndex - start.frame.frameIndex) /
        (end.frame.frameIndex - start.frame.frameIndex);
      const generated: AnnotationShape = {
        ...a,
        id: crypto.randomUUID(),
        frameIndex: frame.frameIndex,
        points: a.points.map(
          (coordinate, point) => coordinate + (b.points[point] - coordinate) * ratio,
        ),
        attributes: {
          ...a.attributes,
          videoTrackId: trackId,
          videoKeyframe: false,
          videoInterpolated: true,
        },
      };
      entries.push({
        imagePath: frame.imagePath,
        frameIndex: frame.frameIndex,
        generated,
        annotations: [...before.filter((shape) => videoTrackId(shape) !== trackId), generated],
      });
    }
  }
  return { trackId, entries };
}

export function validVideoShape(shape: AnnotationShape): boolean {
  return (
    shape.points.every(Number.isFinite) &&
    (shape.type === "rect"
      ? shape.points.length === 4 && shape.points[2] > 0 && shape.points[3] > 0
      : shape.type === "point"
        ? shape.points.length === 2
        : shape.type === "polygon" && shape.points.length >= 6 && shape.points.length % 2 === 0)
  );
}
