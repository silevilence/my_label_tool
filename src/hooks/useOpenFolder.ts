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
import { tryBeginOperation } from "../store/useOperations";
import { MCP_ZH_CN as mcpText } from "../i18n/mcp.zh-CN";

export function useOpenFolder({
  beforeOpen,
  onOpenFinished,
  maybeLoadProjectConfig,
  setError,
  setFolderPath,
  setImages,
  setSelectedPath,
  setVideo,
  setProjectVideos,
  folderPath = "",
  projectVideos: previousVideos = [],
  video: previousVideo = null,
}: {
  beforeOpen?: (folder: string) => Promise<boolean>;
  onOpenFinished?: () => void;
  maybeLoadProjectConfig: (path: string, images: ImageFile[]) => Promise<void>;
  setError: (message: string) => void;
  setFolderPath: (path: string) => void;
  setImages: (images: ImageFile[]) => void;
  setSelectedPath: (path: string) => void;
  setVideo?: (video: VideoProject | null) => void;
  setProjectVideos?: (videos: ProjectVideo[]) => void;
  folderPath?: string;
  projectVideos?: ProjectVideo[];
  video?: VideoProject | null;
}) {
  async function openFolder(requestedPath?: string) {
    const path = requestedPath || (await selectImageFolder());
    if (!path || (beforeOpen && !(await beforeOpen(path)))) return false;
    const operation = tryBeginOperation({
      label: mcpText.openProject,
      resource: "project-annotations",
    });
    if (!operation) {
      onOpenFinished?.();
      setError(mcpText.busy);
      return false;
    }
    setError("");
    const previous = useAnnotationStore.getState();
    let replaced = false;

    try {
      const listedImages = await listImageFiles(path);
      if (setProjectVideos) {
        const entries = await listProjectVideos(path);
        const videos = projectVideos(path, entries);
        const nextImages = mergeProjectImages(listedImages, videos);
        replaced = true;
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
      replaced = true;
      useAnnotationStore.getState().setFrameIndices(videoFrameIndices(video, nextImages));
      setVideo?.(video);
      setFolderPath(path);
      setImages(nextImages);
      setSelectedPath(nextImages[0]?.path ?? "");
      await maybeLoadProjectConfig(path, nextImages);
      return true;
    } catch (caughtError: unknown) {
      if (replaced) {
        setFolderPath(folderPath);
        setProjectVideos?.(previousVideos);
        setVideo?.(previousVideo);
        setImages(previous.images);
        useAnnotationStore.setState(previous);
      }
      operation.fail(caughtError);
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      return false;
    } finally {
      onOpenFinished?.();
      operation.complete();
    }
  }

  return openFolder;
}
