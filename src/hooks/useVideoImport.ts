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

export function useVideoImport(
  onImported: (result: VideoImportResult) => Promise<void>,
  setError: (message: string) => void,
) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function start(interval: number, projectFolder?: string, sourcePath?: string) {
    if (pending.current || !Number.isSafeInteger(interval) || interval < 1 || interval > 1_000_000)
      return;
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
    cancel: () => cancelVideoImport().catch((error: unknown) => setError(String(error))),
  };
}
