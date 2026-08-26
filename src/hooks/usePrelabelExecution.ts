import { useMemo, useRef, useState } from "react";
import { cancelPrelabelInference, runPrelabelInference, type ImageFile } from "../lib/tauri-api";
import { executePrelabelBatch, selectPrelabelBatchImages } from "../lib/prelabel-execution";
import {
  isUnmatchedPrelabelMapping,
  mapPrelabelDetections,
  resolvePrelabelClassMappings,
} from "../lib/prelabel-mapping";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ProjectConfig } from "../lib/importers";
import type { PrelabelModelLibrary, PrelabelModelConfig } from "../types/prelabel";
import { PRELABEL_ZH_CN as text } from "../i18n/prelabel.zh-CN";
import { annotationShapesSnapshot } from "../lib/annotation-utils";

const BATCH_CHUNK_SIZE = 8;

export interface PrelabelExecutionProgress {
  operation: "idle" | "single" | "batch";
  isRunning: boolean;
  cancelRequested: boolean;
  processed: number;
  total: number;
  message: string;
}

export interface PrelabelExecutionControls {
  cancel: () => void;
  currentModel: PrelabelModelConfig | null;
  progress: PrelabelExecutionProgress;
  runBatch: (forceOverwrite: boolean) => Promise<void>;
  runSingle: () => Promise<void>;
  unmatchedClassCount: number;
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
  const taskIdRef = useRef<string | null>(null);
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
  const currentMappings = useMemo(
    () =>
      currentModel
        ? resolvePrelabelClassMappings(
            currentModel.id,
            currentModel.classNames,
            labels,
            activeProjectConfig?.prelabelMappings ?? {},
          )
        : [],
    [activeProjectConfig?.prelabelMappings, currentModel, labels],
  );
  const unmatchedClassCount = currentMappings.filter(isUnmatchedPrelabelMapping).length;

  async function runSingle() {
    if (!currentModel || !selectedPath || runningRef.current) {
      return;
    }
    const taskContext = { activeProjectConfig, images, labels, model: currentModel };
    const mappings = currentMappings;
    const taskId = crypto.randomUUID();
    runningRef.current = true;
    cancelRequestedRef.current = false;
    taskIdRef.current = taskId;
    setError("");
    setProgress({
      operation: "single",
      isRunning: true,
      cancelRequested: false,
      processed: 0,
      total: 1,
      message: text.loadingModel,
    });
    try {
      const outcome = await runPrelabelInference(taskId, currentModel, [selectedPath], (event) => {
        if (event.event === "modelLoading") {
          setProgress((current) => ({ ...current, message: text.loadingModel }));
        } else if (event.event === "started") {
          setProgress((current) => ({ ...current, message: text.singleProcessing }));
        }
      });
      if (!isContextCurrent(taskContext)) {
        throw new Error(text.executionContextChanged);
      }
      const result = outcome.results[0];
      const annotations = result ? mapPrelabelDetections(result.detections, mappings) : [];
      // Do not persist an empty annotation record for an aborted run.
      if (!outcome.cancelled && result) {
        insertAnnotationsBatch([{ imagePath: selectedPath, annotations }], "append");
      }
      setProgress({
        operation: "single",
        isRunning: false,
        cancelRequested: false,
        processed: outcome.cancelled ? 0 : 1,
        total: 1,
        message: outcome.cancelled
          ? text.inferenceCancelled
          : text.singleCompleted(annotations.length),
      });
    } catch (reason) {
      setError(text.inferenceFailed(reason));
      setProgress({ ...IDLE_PROGRESS, message: text.inferenceStopped });
    } finally {
      runningRef.current = false;
      taskIdRef.current = null;
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
    const mappings = currentMappings;
    const expectedAnnotations = new Map(
      targets.map((image) => [
        image.path,
        annotationShapesSnapshot(annotationsByImage[image.path] ?? []),
      ]),
    );
    const historyGroupId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    runningRef.current = true;
    cancelRequestedRef.current = false;
    taskIdRef.current = taskId;
    setError("");
    setProgress({
      operation: "batch",
      isRunning: true,
      cancelRequested: false,
      processed: 0,
      total: targets.length,
      message: text.loadingModel,
    });
    let processed = 0;
    try {
      const summary = await executePrelabelBatch({
        images: targets,
        chunkSize: BATCH_CHUNK_SIZE,
        infer: (imagePaths) =>
          runPrelabelInference(taskId, currentModel, imagePaths, (event) => {
            if (event.event === "modelLoading") {
              setProgress((current) => ({ ...current, message: text.loadingModel }));
            } else if (event.event === "started") {
              setProgress((current) => ({
                ...current,
                message: text.batchProcessingImage(event.index + 1, event.total),
              }));
            }
          }),
        toAnnotations: (result) => mapPrelabelDetections(result.detections, mappings),
        commit: (entries) =>
          insertAnnotationsBatch(entries, forceOverwrite ? "replace" : "append", historyGroupId),
        shouldCommit: (entry) =>
          annotationShapesSnapshot(annotationsByImageRef.current[entry.imagePath] ?? []) ===
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
      taskIdRef.current = null;
    }
  }

  function cancel() {
    if (!progress.isRunning) {
      return;
    }
    cancelRequestedRef.current = true;
    const taskId = taskIdRef.current;
    setProgress((current) => ({
      ...current,
      cancelRequested: true,
      message: text.cancellingInference,
    }));
    if (taskId) {
      cancelPrelabelInference(taskId).catch((reason) => setError(text.inferenceFailed(reason)));
    }
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

  return { cancel, currentModel, progress, runBatch, runSingle, unmatchedClassCount };
}
