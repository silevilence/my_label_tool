import type { VideoExtractionSettings } from "../types/project-settings";
import { importVideo } from "./tauri-api";
import type { VideoImportResult } from "../types/video";

export interface VideoBatchProgress {
  total: number;
  completed: number;
  source: string;
  failures: { source: string; message: string }[];
  finished: boolean;
  cancelled: boolean;
}

/** Serial extraction bounds process/disk load; committed results survive cancellation. */
export async function runVideoImportQueue(
  sources: string[],
  folder: string,
  interval: number | VideoExtractionSettings,
  onImported: (result: VideoImportResult) => Promise<void>,
  cancelled: () => boolean,
  onProgress: (progress: VideoBatchProgress) => void,
): Promise<VideoBatchProgress> {
  let progress: VideoBatchProgress = {
    total: sources.length,
    completed: 0,
    source: "",
    failures: [],
    finished: false,
    cancelled: false,
  };
  for (const source of sources) {
    if (cancelled()) break;
    progress = { ...progress, source };
    onProgress(progress);
    try {
      const result = await importVideo(source, folder, interval);
      await onImported(result);
      progress = { ...progress, completed: progress.completed + 1 };
    } catch (error) {
      if (!cancelled())
        progress = {
          ...progress,
          failures: [
            ...progress.failures,
            { source, message: error instanceof Error ? error.message : String(error) },
          ],
        };
    }
    onProgress(progress);
  }
  progress = { ...progress, finished: true, cancelled: cancelled() };
  onProgress(progress);
  return progress;
}
