import type { AnnotationShape, LabelConfig } from "../../types/annotation";
import type { VideoAnnotationExport, VideoProject } from "../../types/video";
import type { ImageFile } from "../tauri-api";
import { videoImages } from "../video-images";
import { validVideoShape } from "../video-interpolation";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function exportVideo(
  video: VideoProject,
  images: ImageFile[],
  labels: LabelConfig[],
  annotations: Record<string, AnnotationShape[]>,
): VideoAnnotationExport {
  const labelIds = new Set(labels.map((label) => label.id));
  const exportedImages = videoImages(video, images).map((image, index) => {
    const frame = video.frames[index];
    const shapes = (annotations[image.path] ?? []).map((shape) => {
      if (!labelIds.has(shape.labelId) || !validVideoShape(shape))
        throw new Error(text.invalidExport);
      return {
        ...shape,
        frameIndex: frame.frameIndex,
        points: [...shape.points],
        ...(shape.attributes ? { attributes: { ...shape.attributes } } : {}),
      };
    });
    return {
      path: frame.name,
      name: frame.name,
      width: video.width,
      height: video.height,
      annotations: shapes,
    };
  });
  return {
    schemaVersion: 1,
    kind: "my-label-tool.video",
    video: { ...video, frames: video.frames.map((frame) => ({ ...frame })) },
    labels: labels.map((label) => ({ ...label })),
    images: exportedImages,
  };
}
