import { useMemo, useRef, useState } from "react";
import { runPrelabelInference, type ImageFile } from "../lib/tauri-api";
import { executePrelabelBatch, selectPrelabelBatchImages } from "../lib/prelabel-execution";
import { mapPrelabelDetections, resolvePrelabelClassMappings } from "../lib/prelabel-mapping";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ProjectConfig } from "../lib/importers";
import type { PrelabelModelLibrary } from "../types/prelabel";
import { PRELABEL_ZH_CN as text } from "../i18n/prelabel.zh-CN";

const BATCH_CHUNK_SIZE = 8;

export interface PrelabelExecutionProgress {
  operation: "idle" | "single" | "batch";
  isRunning: boolean;
  cancelRequested: boolean;
  processed: number;
  total: number;
  message: string;
}

interface UsePrelabelExecutionOptions {
  activeProjectConfig: ProjectConfig | null;
  annotationsByImage: Record<string, AnnotationShape[]>;
  images: ImageFile[];
  labels: LabelConfig[];
  library: PrelabelModelLibrary;
  selectedPath: string;
  insertAnnotationsBatch: (
    entries: Array<{ imagePath: string; annotations: AnnotationShape[] }>,
    mode: "append" | "replace",
    groupId?: string,
  ) => void;
  setError: (message: string) => void;
}

const IDLE_PROGRESS: PrelabelExecutionProgress = {
  operation: "idle",
  isRunning: false,
  cancelRequested: false,
  processed: 0,
  total: 0,
  message: "",
};

export function usePrelabelExecution({
  activeProjectConfig,
  annotationsByImage,
  images,
  labels,
  library,
  selectedPath,
  insertAnnotationsBatch,
  setError,
}: UsePrelabelExecutionOptions) {
  const [progress, setProgress] = useState<PrelabelExecutionProgress>(IDLE_PROGRESS);
  const cancelRequestedRef = useRef(false);
  const runningRef = useRef(false);
  const activeProjectConfigRef = useRef(activeProjectConfig);
  const annotationsByImageRef = useRef(annotationsByImage);
  const imagesRef = useRef(images);
  const labelsRef = useRef(labels);
  activeProjectConfigRef.current = activeProjectConfig;
  annotationsByImageRef.current = annotationsByImage;
  imagesRef.current = images;
  labelsRef.current = labels;
  const currentModel = useMemo(
    () => library.models.find((model) => model.id === library.currentModelId) ?? null,
    [library],
  );
  const currentModelRef = useRef(currentModel);
  currentModelRef.current = currentModel;

  async function runSingle() {
    if (!currentModel || !selectedPath || runningRef.current) {
      return;
    }
    const taskContext = { activeProjectConfig, images, labels, model: currentModel };
    const mappings = resolvePrelabelClassMappings(
      currentModel.id,
      currentModel.classNames,
      labels,
      activeProjectConfig?.prelabelMappings ?? {},
    );
    runningRef.current = true;
    cancelRequestedRef.current = false;
    setError("");
    setProgress({
      operation: "single",
      isRunning: true,
      cancelRequested: false,
      processed: 0,
      total: 1,
      message: text.singleRunning,
    });
    try {
      const [result] = await runPrelabelInference(currentModel, [selectedPath]);
      if (!isContextCurrent(taskContext)) {
        throw new Error(text.executionContextChanged);
      }
      const annotations = result ? mapPrelabelDetections(result.detections, mappings) : [];
      insertAnnotationsBatch([{ imagePath: selectedPath, annotations }], "append");
      setProgress({
        operation: "single",
        isRunning: false,
        cancelRequested: false,
        processed: 1,
        total: 1,
        message: text.singleCompleted(annotations.length),
      });
    } catch (reason) {
      setError(text.inferenceFailed(reason));
      setProgress({ ...IDLE_PROGRESS, message: text.inferenceStopped });
    } finally {
      runningRef.current = false;
    }
  }

  async function runBatch(forceOverwrite: boolean) {
    if (!currentModel || runningRef.current) {
      return;
    }
    const targets = selectPrelabelBatchImages(images, annotationsByImage, forceOverwrite);
    if (targets.length === 0) {
      setProgress({ ...IDLE_PROGRESS, message: text.batchNothingToRun });
      return;
    }

    const taskContext = { activeProjectConfig, images, labels, model: currentModel };
    const mappings = resolvePrelabelClassMappings(
      currentModel.id,
      currentModel.classNames,
      labels,
      activeProjectConfig?.prelabelMappings ?? {},
    );
    const expectedAnnotations = new Map(
      targets.map((image) => [
        image.path,
        JSON.stringify(annotationsByImage[image.path] ?? []),
      ]),
    );
    const historyGroupId = crypto.randomUUID();
    runningRef.current = true;
    cancelRequestedRef.current = false;
    setError("");
    setProgress({
      operation: "batch",
      isRunning: true,
      cancelRequested: false,
      processed: 0,
      total: targets.length,
      message: text.batchRunning,
    });
    let processed = 0;
    try {
      const summary = await executePrelabelBatch({
        images: targets,
        chunkSize: BATCH_CHUNK_SIZE,
        infer: (imagePaths) => runPrelabelInference(currentModel, imagePaths),
        toAnnotations: (result) => mapPrelabelDetections(result.detections, mappings),
        commit: (entries) =>
          insertAnnotationsBatch(
            entries,
            forceOverwrite ? "replace" : "append",
            historyGroupId,
          ),
        shouldCommit: (entry) =>
          JSON.stringify(annotationsByImageRef.current[entry.imagePath] ?? []) ===
          expectedAnnotations.get(entry.imagePath),
        isContextCurrent: () => isContextCurrent(taskContext),
        isCancelled: () => cancelRequestedRef.current,
        onProgress: (nextProcessed) => {
          processed = nextProcessed;
          setProgress({
            operation: "batch",
            isRunning: true,
            cancelRequested: cancelRequestedRef.current,
            processed,
            total: targets.length,
            message: text.batchRunning,
          });
        },
      });
      processed = summary.processed;
      if (summary.cancelled) {
        setProgress({
          operation: "batch",
          isRunning: false,
          cancelRequested: true,
          processed,
          total: targets.length,
          message: text.batchCancelled(processed, targets.length),
        });
        return;
      }
      setProgress({
        operation: "batch",
        isRunning: false,
        cancelRequested: false,
        processed,
        total: targets.length,
        message: text.batchCompleted(
          processed,
          summary.annotationCount,
          summary.skippedConflictCount,
        ),
      });
    } catch (reason) {
      setError(text.inferenceFailed(reason));
      setProgress({
        operation: "batch",
        isRunning: false,
        cancelRequested: false,
        processed,
        total: targets.length,
        message: text.batchFailed(processed, targets.length),
      });
    } finally {
      runningRef.current = false;
    }
  }

  function cancel() {
    if (!progress.isRunning) {
      return;
    }
    cancelRequestedRef.current = true;
    setProgress((current) => ({
      ...current,
      cancelRequested: true,
      message: text.batchCancelling,
    }));
  }

  function isContextCurrent(taskContext: {
    activeProjectConfig: ProjectConfig | null;
    images: ImageFile[];
    labels: LabelConfig[];
    model: NonNullable<typeof currentModel>;
  }): boolean {
    return (
      activeProjectConfigRef.current === taskContext.activeProjectConfig &&
      imagesRef.current === taskContext.images &&
      labelsRef.current === taskContext.labels &&
      currentModelRef.current === taskContext.model
    );
  }

  return { cancel, currentModel, progress, runBatch, runSingle };
}
