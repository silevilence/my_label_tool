import type { VideoExtractionSettings } from "../types/project-settings";
import { useRef, useState } from "react";
import {
  confirmAction,
  importVideo,
  selectVideoFile,
  selectExportFolder,
  cancelVideoImport,
} from "../lib/tauri-api";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";
import type { VideoImportResult } from "../types/video";
import { runVideoImportQueue, type VideoBatchProgress } from "../lib/video-import-queue";
import { validExtraction, extractionSettings } from "../lib/project-settings";

export function useVideoImport(
  onImported: (result: VideoImportResult) => Promise<void>,
  setError: (message: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const cancelled = useRef(false);
  const [batch, setBatch] = useState<VideoBatchProgress | null>(null);
  async function startBatch(
    interval: number | VideoExtractionSettings,
    folder: string,
    sources: string[],
  ) {
    if (
      pending.current ||
      !folder ||
      !sources.length ||
      !validExtraction(extractionSettings(interval))
    )
      return;
    pending.current = true;
    cancelled.current = false;
    setBusy(true);
    setError("");
    try {
      await runVideoImportQueue(
        sources,
        folder,
        interval,
        onImported,
        () => cancelled.current,
        setBatch,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function start(
    interval: number | VideoExtractionSettings,
    projectFolder?: string,
    sourcePath?: string,
  ) {
    if (pending.current || !validExtraction(extractionSettings(interval))) return;
    pending.current = true;
    try {
      if (!projectFolder && !(await confirmAction(text.replace))) return;
      const source = sourcePath || (await selectVideoFile());
      if (!source) return;
      const folder = projectFolder || (await selectExportFolder());
      if (!folder) return;
      setBusy(true);
      setError("");
      const result = await importVideo(source, folder, interval);
      await onImported(result);
    } catch (error) {
      setError(String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    start,
    batch,
    startBatch,
    closeBatch: () => {
      if (!pending.current) setBatch(null);
    },
    cancel: () => {
      cancelled.current = true;
      return cancelVideoImport().catch((error: unknown) => setError(String(error)));
    },
  };
}
