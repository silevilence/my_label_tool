import type { VideoProject } from "../types/video";
import type { ImageFile } from "./tauri-api";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";

export function videoImages(video: VideoProject | null, images: ImageFile[]): ImageFile[] {
  if (!video) return images;
  const byName = new Map(images.map((image) => [image.name, image]));
  return video.frames.map((frame) => {
    const image = byName.get(frame.name);
    if (!image) throw new Error(text.invalid);
    return image;
  });
}
