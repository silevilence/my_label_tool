import { tryBeginOperation, useOperations, type OperationHandle } from "../store/useOperations";
import { OPERATION_ZH_CN as operationText } from "../i18n/operations.zh-CN";
import type { VideoExtractionSettings } from "../types/project-settings";
import { useRef, useState } from "react";
import type { ProjectVideo, VideoImportResult } from "../types/video";
import { selectExportFolder, selectVideoFile, type ImageFile } from "../lib/tauri-api";
import { mergeProjectImages, projectVideos, projectFrameIndices } from "../lib/project-media";
import { normalizePath } from "../lib/app-utils";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useVideoImport } from "./useVideoImport";
import { reextractVideo, cancelVideoImport } from "../lib/tauri-api";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";
import type { LoadedProjectVideo } from "../lib/project-media";

export interface VideoReextractTarget {
  asset: LoadedProjectVideo;
  readyAt: number;
  folderPath: string;
  interval: number | VideoExtractionSettings;
}

export function useProjectVideoActions({
  folderPath,
  entries,
  images,
  setEntries,
  setImages,
  setSelectedPath,
  setError,
  openFolder,
  blocked = false,
}: {
  folderPath: string;
  entries: ProjectVideo[];
  images: ImageFile[];
  setEntries: (entries: ProjectVideo[]) => void;
  setImages: (images: ImageFile[]) => void;
  setSelectedPath: (path: string) => void;
  setError: (message: string) => void;
  openFolder: (folder?: string) => Promise<boolean>;
  blocked?: boolean;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<VideoReextractTarget | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replacementError, setReplacementError] = useState("");
  const replacingRef = useRef(false);
  const replacementOperation = useRef<OperationHandle | null>(null);
  // The batch callback must see results committed by earlier iterations, even before React renders.
  const latest = useRef({ folderPath, entries, images });
  latest.current = { folderPath, entries, images };
  async function applyImported(result: VideoImportResult, retiredPaths: string[] = []) {
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
    const retired = new Set(retiredPaths);
    const nextImages = mergeProjectImages(
      current.images.filter((image) => !retired.has(image.path)),
      nextVideos,
    );
    latest.current = { ...current, entries: nextEntries, images: nextImages };
    useAnnotationStore.getState().setFrameIndices(projectFrameIndices(nextVideos));
    if (retiredPaths.length) useAnnotationStore.getState().removeImages(retiredPaths);
    setEntries(nextEntries);
    setImages(nextImages);
    setSelectedPath(nextVideos[nextVideos.length - 1].images[0]?.path ?? "");
    setSource(null);
  }
  const importer = useVideoImport(applyImported, setError);
  function requestReextract(path: string, interval: number | VideoExtractionSettings) {
    if (
      blocked ||
      !useOperations.getState().canStart(["video-frames", "project-annotations", "export-dir"])
    ) {
      setError(text.reextractBusy);
      return;
    }
    const asset = projectVideos(folderPath, entries).find((entry) => entry.sourcePath === path);
    if (!asset?.video || !asset.folderPath) return;
    setReplacementError("");
    setReplacement({ asset, interval, folderPath, readyAt: Date.now() + 3000 });
  }
  async function confirmReextract() {
    if (!replacement || replacingRef.current || Date.now() < replacement.readyAt) return;
    if (
      blocked ||
      !useOperations.getState().canStart(["video-frames", "project-annotations", "export-dir"])
    ) {
      setReplacementError(text.reextractBusy);
      return;
    }
    const current = latest.current;
    if (
      current.folderPath !== replacement.folderPath ||
      !current.entries.some((entry) => entry.video === replacement.asset.video)
    ) {
      setReplacementError(text.reextractStale);
      return;
    }
    const operation = tryBeginOperation({
      label: operationText.video,
      resource: ["video-frames", "project-annotations", "export-dir"],
      cancel: async () => {
        await cancelVideoImport();
      },
    });
    if (!operation) {
      setReplacementError(operationText.busy);
      return;
    }
    replacementOperation.current = operation;
    replacingRef.current = true;
    setReplacing(true);
    setReplacementError("");
    try {
      const result = await reextractVideo(
        replacement.asset.sourcePath,
        replacement.folderPath,
        replacement.asset.folderPath!,
        replacement.interval,
      );
      await applyImported(
        result,
        replacement.asset.images.map((image) => image.path),
      );
      operation.complete();
      setReplacement(null);
    } catch (error) {
      operation.fail(error);
      setReplacementError(error instanceof Error ? error.message : String(error));
    } finally {
      replacingRef.current = false;
      setReplacing(false);
    }
  }
  function cancelReextract() {
    if (replacingRef.current)
      void (
        replacementOperation.current &&
        useOperations.getState().cancel(replacementOperation.current.id)
      );
    else setReplacement(null);
  }
  async function addVideo(requested?: string) {
    if (importer.busy || replacingRef.current || replacement) return;
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
  return {
    ...importer,
    busy: importer.busy || replacing,
    source,
    setSource,
    addVideo,
    replacement,
    replacing,
    replacementError,
    requestReextract,
    confirmReextract,
    cancelReextract,
  };
}
