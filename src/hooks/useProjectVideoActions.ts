import { useRef, useState } from "react";
import type { ProjectVideo } from "../types/video";
import { selectExportFolder, selectVideoFile, type ImageFile } from "../lib/tauri-api";
import { mergeProjectImages, projectVideos, projectFrameIndices } from "../lib/project-media";
import { normalizePath } from "../lib/app-utils";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useVideoImport } from "./useVideoImport";

export function useProjectVideoActions({
  folderPath,
  entries,
  images,
  setEntries,
  setImages,
  setSelectedPath,
  setError,
  openFolder,
}: {
  folderPath: string;
  entries: ProjectVideo[];
  images: ImageFile[];
  setEntries: (entries: ProjectVideo[]) => void;
  setImages: (images: ImageFile[]) => void;
  setSelectedPath: (path: string) => void;
  setError: (message: string) => void;
  openFolder: (folder?: string) => Promise<boolean>;
}) {
  const [source, setSource] = useState<string | null>(null);
  // The batch callback must see results committed by earlier iterations, even before React renders.
  const latest = useRef({ folderPath, entries, images });
  latest.current = { folderPath, entries, images };
  const importer = useVideoImport(async (result) => {
    const current = latest.current;
    const entry = {
      sourcePath: result.video.sourcePath,
      folderPath: result.folderPath,
      video: result.video,
    };
    const nextEntries = [
      ...current.entries.filter(
        (asset) => normalizePath(asset.sourcePath) !== normalizePath(entry.sourcePath),
      ),
      entry,
    ];
    const nextVideos = projectVideos(current.folderPath, nextEntries);
    const nextImages = mergeProjectImages(current.images, nextVideos);
    latest.current = { ...current, entries: nextEntries, images: nextImages };
    useAnnotationStore.getState().setFrameIndices(projectFrameIndices(nextVideos));
    setEntries(nextEntries);
    setImages(nextImages);
    setSelectedPath(nextVideos[nextVideos.length - 1].images[0]?.path ?? "");
    setSource(null);
  }, setError);
  async function addVideo(requested?: string) {
    if (importer.busy) return;
    try {
      const path = requested || (await selectVideoFile());
      if (!path) return;
      const existing = projectVideos(folderPath, entries).find(
        (asset) => normalizePath(asset.sourcePath) === normalizePath(path),
      );
      if (existing?.images.length) {
        setSelectedPath(existing.images[0].path);
        return;
      }
      if (!folderPath) {
        const folder = await selectExportFolder();
        if (!folder || !(await openFolder(folder))) return;
      }
      setSource(path);
    } catch (error) {
      setError(String(error));
    }
  }
  return { ...importer, source, setSource, addVideo };
}
