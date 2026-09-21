import { tryBeginOperation, useOperations, type OperationHandle } from "../store/useOperations";
import { OPERATION_ZH_CN as operationText } from "../i18n/operations.zh-CN";
import type { VideoExtractionSettings } from "../types/project-settings";
import { useRef, useState } from "react";
import { confirmAction } from "../lib/prompts";
import {
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
  const operation = useRef<OperationHandle | null>(null);
  const operations = useOperations((state) => state.operations);
  const busy = operations.some((op) => op.id === operation.current?.id && op.status === "running");
  function begin() {
    operation.current = tryBeginOperation({
      label: operationText.video,
      resource: ["video-frames", "project-annotations", "export-dir"],
      cancel: async () => {
        cancelled.current = true;
        try {
          await cancelVideoImport();
        } catch (error) {
          cancelled.current = false;
          throw error;
        }
      },
    });
    if (!operation.current) setError(operationText.busy);
    return operation.current;
  }
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
    const handle = begin();
    if (!handle) return;
    pending.current = true;
    cancelled.current = false;
    setError("");
    try {
      await runVideoImportQueue(
        sources,
        folder,
        interval,
        onImported,
        () => cancelled.current,
        (progress) => {
          setBatch(progress);
          handle.progress(
            progress.total
              ? ((progress.completed + progress.failures.length) / progress.total) * 100
              : null,
            text.batchProgress(progress.completed, progress.total, progress.failures.length),
          );
          if (progress.finished)
            handle.complete(
              progress.cancelled ? text.batchCancelled : text.batchFinished,
              progress.cancelled || progress.failures.length ? "warning" : "success",
            );
        },
      );
    } catch (error) {
      if (cancelled.current) handle.complete(operationText.cancelled, "warning");
      else {
        handle.fail(error);
      }
    } finally {
      pending.current = false;
      handle.complete(
        cancelled.current ? operationText.cancelled : operationText.completed,
        cancelled.current ? "warning" : "success",
      );
    }
  }
  async function start(
    interval: number | VideoExtractionSettings,
    projectFolder?: string,
    sourcePath?: string,
  ) {
    if (pending.current || !validExtraction(extractionSettings(interval))) return;
    const handle = begin();
    if (!handle) return;
    pending.current = true;
    cancelled.current = false;
    try {
      if (!projectFolder && !(await confirmAction(text.replace))) {
        cancelled.current = true;
        return;
      }
      const source = sourcePath || (await selectVideoFile());
      if (!source || cancelled.current) {
        cancelled.current = true;
        return;
      }
      const folder = projectFolder || (await selectExportFolder());
      if (!folder || cancelled.current) {
        cancelled.current = true;
        return;
      }
      setError("");
      const result = await importVideo(source, folder, interval);
      await onImported(result);
    } catch (error) {
      if (cancelled.current) handle.complete(operationText.cancelled, "warning");
      else {
        handle.fail(error);
      }
    } finally {
      pending.current = false;
      handle.complete(
        cancelled.current ? operationText.cancelled : operationText.completed,
        cancelled.current ? "warning" : "success",
      );
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
    cancel: () =>
      operation.current ? useOperations.getState().cancel(operation.current.id) : Promise.resolve(),
  };
}
