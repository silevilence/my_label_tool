import {
  listImageFiles,
  loadVideoProject,
  listProjectVideos,
  selectImageFolder,
  type ImageFile,
} from "../lib/tauri-api";
import type { VideoProject } from "../types/video";
import type { ProjectVideo } from "../types/video";
import { mergeProjectImages, projectVideos, projectFrameIndices } from "../lib/project-media";
import { videoFrameIndices, videoImages } from "../lib/video-images";
import { useAnnotationStore } from "../store/useAnnotationStore";

export function useOpenFolder({
  maybeLoadProjectConfig,
  setError,
  setFolderPath,
  setImages,
  setSelectedPath,
  setVideo,
  setProjectVideos,
}: {
  maybeLoadProjectConfig: (path: string, images: ImageFile[]) => Promise<void>;
  setError: (message: string) => void;
  setFolderPath: (path: string) => void;
  setImages: (images: ImageFile[]) => void;
  setSelectedPath: (path: string) => void;
  setVideo?: (video: VideoProject | null) => void;
  setProjectVideos?: (videos: ProjectVideo[]) => void;
}) {
  async function openFolder(requestedPath?: string) {
    setError("");

    try {
      const path = requestedPath || (await selectImageFolder());
      if (!path) {
        return false;
      }

      const listedImages = await listImageFiles(path);
      if (setProjectVideos) {
        const entries = await listProjectVideos(path);
        const videos = projectVideos(path, entries);
        const nextImages = mergeProjectImages(listedImages, videos);
        useAnnotationStore.getState().replaceAnnotations({}, []);
        useAnnotationStore.getState().setFrameIndices(projectFrameIndices(videos));
        setProjectVideos(entries);
        setFolderPath(path);
        setImages(nextImages);
        setSelectedPath(nextImages[0]?.path ?? "");
        await maybeLoadProjectConfig(path, nextImages);
        return true;
      }
      const video = setVideo ? await loadVideoProject(path) : null;
      const nextImages = videoImages(video, listedImages);
      useAnnotationStore.getState().setFrameIndices(videoFrameIndices(video, nextImages));
      setVideo?.(video);
      setFolderPath(path);
      setImages(nextImages);
      setSelectedPath(nextImages[0]?.path ?? "");
      await maybeLoadProjectConfig(path, nextImages);
      return true;
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      return false;
    }
  }

  return openFolder;
}
