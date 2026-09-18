import {
  listImageFiles,
  loadVideoProject,
  selectImageFolder,
  type ImageFile,
} from "../lib/tauri-api";
import type { VideoProject } from "../types/video";
import { videoImages } from "../lib/video-images";

export function useOpenFolder({
  maybeLoadProjectConfig,
  setError,
  setFolderPath,
  setImages,
  setSelectedPath,
  setVideo,
}: {
  maybeLoadProjectConfig: (path: string, images: ImageFile[]) => Promise<void>;
  setError: (message: string) => void;
  setFolderPath: (path: string) => void;
  setImages: (images: ImageFile[]) => void;
  setSelectedPath: (path: string) => void;
  setVideo?: (video: VideoProject | null) => void;
}) {
  async function openFolder() {
    setError("");

    try {
      const path = await selectImageFolder();
      if (!path) {
        return;
      }

      const listedImages = await listImageFiles(path);
      const video = setVideo ? await loadVideoProject(path) : null;
      const nextImages = videoImages(video, listedImages);
      setVideo?.(video);
      setFolderPath(path);
      setImages(nextImages);
      setSelectedPath(nextImages[0]?.path ?? "");
      await maybeLoadProjectConfig(path, nextImages);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  }

  return openFolder;
}
