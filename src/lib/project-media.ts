import type { ProjectVideo, VideoProject } from "../types/video";
import type { ImageFile } from "./tauri-api";
import { joinPath, normalizePath } from "./app-utils";
import type { ExportData } from "../types/export";

export interface LoadedProjectVideo extends ProjectVideo {
  images: ImageFile[];
  scopedVideo: VideoProject | null;
}

export function projectVideos(folder: string, videos: ProjectVideo[]): LoadedProjectVideo[] {
  return videos.map((asset) => {
    if (!asset.video || !asset.folderPath) return { ...asset, images: [], scopedVideo: null };
    const directory = asset.folderPath.replace(/\\/g, "/");
    const root = folder.replace(/\\/g, "/").replace(/\/+$/, "");
    const prefix =
      normalizePath(directory) === normalizePath(root)
        ? ""
        : `${directory.slice(root.length + 1)}/`;
    const images = asset.video.frames.map((frame) => ({
      path: joinPath(asset.folderPath!, frame.name),
      name: `${prefix}${frame.name}`,
    }));
    return {
      ...asset,
      images,
      scopedVideo: {
        ...asset.video,
        frames: asset.video.frames.map((frame, index) => ({ ...frame, name: images[index].name })),
      },
    };
  });
}

export function mergeProjectImages(images: ImageFile[], videos: LoadedProjectVideo[]): ImageFile[] {
  const frames = videos.flatMap((video) => video.images);
  const framePaths = new Set(frames.map((frame) => normalizePath(frame.path)));
  return [...images.filter((image) => !framePaths.has(normalizePath(image.path))), ...frames];
}

export function projectFrameIndices(videos: LoadedProjectVideo[]): Record<string, number> {
  return Object.fromEntries(
    videos.flatMap((asset) =>
      asset.images.map((image, index) => [image.path, asset.video!.frames[index].frameIndex]),
    ),
  );
}

export function videoForImage(videos: LoadedProjectVideo[], path: string) {
  return videos.find((video) => video.images.some((image) => image.path === path));
}

/** Native project JSON extension only; plugin exportData remains unchanged. */
export function withProjectMedia(data: ExportData, videos: LoadedProjectVideo[]) {
  if (!videos.length) return data;
  return {
    ...data,
    projectMedia: {
      schemaVersion: 1,
      videos: videos.map((asset) => ({
        sourcePath: asset.sourcePath,
        frameFolder: asset.images[0]?.name.includes("/")
          ? asset.images[0].name.slice(0, asset.images[0].name.lastIndexOf("/"))
          : asset.video
            ? "."
            : null,
        video: asset.video,
      })),
    },
  };
}
