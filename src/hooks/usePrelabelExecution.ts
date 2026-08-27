import { useMemo, useRef, useState } from "react";
import {
  cancelPluginPrelabel,
  runPluginPrelabel,
  runPrelabelInference,
  type ImageFile,
} from "../lib/tauri-api";
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
import {
  mapPluginPrelabelResults,
  toPluginPrelabelClassMappings,
  toProjectRelativeImagePath,
} from "../lib/prelabel-sources";
import type { PluginPrelabelSourceDescriptor } from "../types/plugin";

const BATCH_CHUNK_SIZE = 8;

export interface PrelabelExecutionProgress {
  operation: "idle" | "single" | "batch";
  isRunning: boolean;
  cancelRequested: boolean;
  processed: number;
  total: number;
  message: string;
  percent: number | null;
}

export interface PrelabelExecutionSource {
  selectionId: string;
  kind: "builtin" | "plugin";
  name: string;
  classNames: string[];
  enabled: boolean;
  disabledReason: string | null;
  supportsCancel: boolean;
}

export interface PrelabelExecutionControls {
  cancel: () => void;
  currentSource: PrelabelExecutionSource | null;
  currentSourceId: string;
  currentModel: PrelabelModelConfig | null;
  progress: PrelabelExecutionProgress;
  runBatch: (forceOverwrite: boolean) => Promise<void>;
  runSingle: () => Promise<void>;
  selectSource: (sourceId: string) => void;
  sources: PrelabelExecutionSource[];
  unmatchedClassCount: number;
}

interface UsePrelabelExecutionOptions {
  activeProjectConfig: ProjectConfig | null;
  annotationsByImage: Record<string, AnnotationShape[]>;
  images: ImageFile[];
  labels: LabelConfig[];
  library: PrelabelModelLibrary;
  pluginSources: PluginPrelabelSourceDescriptor[];
  projectFolder: string;
  refreshPluginSources: () => Promise<void>;
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
  percent: null,
};

export function usePrelabelExecution({
  activeProjectConfig,
  annotationsByImage,
  images,
  labels,
  library,
  pluginSources,
  projectFolder,
  refreshPluginSources,
  selectedPath,
  insertAnnotationsBatch,
  setError,
}: UsePrelabelExecutionOptions) {
  const [progress, setProgress] = useState<PrelabelExecutionProgress>(IDLE_PROGRESS);
  const cancelRequestedRef = useRef(false);
  const activePluginOperationIdRef = useRef<string | null>(null);
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
  const sources = useMemo<PrelabelExecutionSource[]>(
    () => [
      ...(currentModel
        ? [
            {
              selectionId: "builtin",
              kind: "builtin" as const,
              name: text.builtinSourceName(currentModel.name),
              classNames: currentModel.classNames,
              enabled: true,
              disabledReason: null,
              supportsCancel: true,
            },
          ]
        : []),
      ...pluginSources.map((source) => ({
        selectionId: source.selectionId,
        kind: "plugin" as const,
        name: source.pluginName,
        classNames: source.classNames.length > 0 ? source.classNames : labels.map((label) => label.name),
        enabled: source.enabled,
        disabledReason: source.disabledReason,
        supportsCancel: source.supportsCancel,
      })),
    ],
    [currentModel, labels, pluginSources],
  );
  const [currentSourceId, setCurrentSourceId] = useState("builtin");
  const currentSource =
    sources.find((source) => source.selectionId === currentSourceId) ?? sources[0] ?? null;
  const currentSourceRef = useRef(currentSource);
  currentSourceRef.current = currentSource;
  const currentMappings = useMemo(
    () =>
      currentSource
        ? resolvePrelabelClassMappings(
            mappingKey(currentSource, currentModel),
            currentSource.classNames,
            labels,
            activeProjectConfig?.prelabelMappings ?? {},
          )
        : [],
    [activeProjectConfig?.prelabelMappings, currentModel, currentSource, labels],
  );
  const unmatchedClassCount = currentMappings.filter(isUnmatchedPrelabelMapping).length;

  async function runSingle() {
    if (!currentSource?.enabled || !selectedPath || runningRef.current) {
      return;
    }
    const taskContext = { activeProjectConfig, images, labels, model: currentModel, source: currentSource };
    const mappings = currentMappings;
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
      percent: null,
    });
    try {
      const [result] = await inferWithSource(currentSource, [selectedPath], mappings, 0, 1);
      if (!isContextCurrent(taskContext)) {
        throw new Error(text.executionContextChanged);
      }
      const annotations = result?.annotations ?? [];
      insertAnnotationsBatch([{ imagePath: selectedPath, annotations }], "append");
      setProgress({
        operation: "single",
        isRunning: false,
        cancelRequested: false,
        processed: 1,
        total: 1,
        message: text.singleCompleted(annotations.length),
        percent: 100,
      });
    } catch (reason) {
      setError(text.inferenceFailed(reason));
      setProgress({ ...IDLE_PROGRESS, message: text.inferenceStopped });
    } finally {
      runningRef.current = false;
      if (currentSource.kind === "plugin") {
        void refreshPluginSources().catch((reason: unknown) => setError(text.pluginRefreshFailed(reason)));
      }
    }
  }

  async function runBatch(forceOverwrite: boolean) {
    if (!currentSource?.enabled || runningRef.current) {
      return;
    }
    const targets = selectPrelabelBatchImages(images, annotationsByImage, forceOverwrite);
    if (targets.length === 0) {
      setProgress({ ...IDLE_PROGRESS, message: text.batchNothingToRun });
      return;
    }

    const taskContext = { activeProjectConfig, images, labels, model: currentModel, source: currentSource };
    const mappings = currentMappings;
    const expectedAnnotations = new Map(
      targets.map((image) => [
        image.path,
        annotationShapesSnapshot(annotationsByImage[image.path] ?? []),
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
      percent: 0,
    });
    let processed = 0;
    try {
      const summary = await executePrelabelBatch({
        images: targets,
        chunkSize: sourceChunkSize(currentSource, pluginSources),
        infer: (imagePaths) =>
          inferWithSource(currentSource, imagePaths, mappings, processed, targets.length),
        toEntry: (result) => result,
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
            percent: (processed / targets.length) * 100,
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
          percent: (processed / targets.length) * 100,
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
        percent: 100,
      });
    } catch (reason) {
      if (cancelRequestedRef.current) {
        setProgress({
          operation: "batch",
          isRunning: false,
          cancelRequested: true,
          processed,
          total: targets.length,
          message: text.batchCancelled(processed, targets.length),
          percent: (processed / targets.length) * 100,
        });
        return;
      }
      setError(text.inferenceFailed(reason));
      setProgress({
        operation: "batch",
        isRunning: false,
        cancelRequested: false,
        processed,
        total: targets.length,
        message: text.batchFailed(processed, targets.length),
        percent: (processed / targets.length) * 100,
      });
    } finally {
      runningRef.current = false;
      if (currentSource.kind === "plugin") {
        void refreshPluginSources().catch((reason: unknown) => setError(text.pluginRefreshFailed(reason)));
      }
    }
  }

  async function inferWithSource(
    source: PrelabelExecutionSource,
    imagePaths: string[],
    mappings: ReturnType<typeof resolvePrelabelClassMappings>,
    alreadyProcessed: number,
    total: number,
  ): Promise<Array<{ imagePath: string; annotations: AnnotationShape[] }>> {
    if (source.kind === "builtin") {
      if (!currentModel) throw new Error(text.executionNoModel);
      const results = await runPrelabelInference(currentModel, imagePaths);
      return results.map((result) => ({
        imagePath: result.imagePath,
        annotations: mapPrelabelDetections(result.detections, mappings),
      }));
    }
    const descriptor = pluginSources.find((plugin) => plugin.selectionId === source.selectionId);
    if (!descriptor?.enabled) {
      throw new Error(descriptor?.disabledReason ?? text.pluginSourceUnavailable);
    }
    const absoluteByRelative = new Map<string, string>();
    const relativePaths = imagePaths.map((imagePath) => {
      const relative = toProjectRelativeImagePath(imagePath, projectFolder);
      absoluteByRelative.set(relative.toLowerCase(), imagePath);
      return relative;
    });
    const invokePaths = async (paths: string[], progressOffset: number) => {
      const operationId = crypto.randomUUID();
      activePluginOperationIdRef.current = operationId;
      try {
        return await runPluginPrelabel(
        descriptor.pluginId,
        projectFolder,
        paths,
        toPluginPrelabelClassMappings(mappings, labels),
        {},
        operationId,
        (event) => {
          if (!descriptor.supportsProgress || event.event !== "progress") return;
          const chunkPercent =
            typeof event.payload.percent === "number"
              ? Math.max(0, Math.min(100, event.payload.percent))
              : null;
          setProgress((current) => ({
            ...current,
            message:
              typeof event.payload.message === "string"
                ? event.payload.message
                : current.message,
            percent:
              chunkPercent == null || total === 0
                ? current.percent
                : ((alreadyProcessed + progressOffset + (paths.length * chunkPercent) / 100) /
                    total) *
                  100,
          }));
        },
      );
      } finally {
        if (activePluginOperationIdRef.current === operationId) {
          activePluginOperationIdRef.current = null;
        }
      }
    };
    try {
      const result = await invokePaths(relativePaths, 0);
      return mapPluginPrelabelResults(result.images, absoluteByRelative);
    } catch (reason) {
      if (relativePaths.length === 1 || !isMethodUnavailable(reason)) throw reason;
      // The manifest is an upper-bound declaration. If hello does not actually
      // negotiate batch, honor the handshake by degrading this chunk to single
      // image calls instead of treating the manifest flag as runtime truth.
      const completed = [];
      for (const [index, path] of relativePaths.entries()) {
        if (cancelRequestedRef.current) break;
        try {
          const result = await invokePaths([path], index);
          completed.push(...mapPluginPrelabelResults(result.images, absoluteByRelative));
        } catch (fallbackReason) {
          if (cancelRequestedRef.current) break;
          throw fallbackReason;
        }
      }
      return completed;
    }
  }

  function cancel() {
    if (!progress.isRunning) {
      return;
    }
    cancelRequestedRef.current = true;
    const operationId = activePluginOperationIdRef.current;
    if (operationId) {
      void cancelPluginPrelabel(operationId).catch((reason: unknown) => {
        setError(text.pluginCancelFailed(reason));
      });
    }
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
    model: PrelabelModelConfig | null;
    source: PrelabelExecutionSource;
  }): boolean {
    return (
      activeProjectConfigRef.current === taskContext.activeProjectConfig &&
      imagesRef.current === taskContext.images &&
      labelsRef.current === taskContext.labels &&
      currentModelRef.current === taskContext.model &&
      currentSourceRef.current === taskContext.source
    );
  }

  return {
    cancel,
    currentModel,
    currentSource,
    currentSourceId: currentSource?.selectionId ?? "",
    progress,
    runBatch,
    runSingle,
    selectSource: setCurrentSourceId,
    sources,
    unmatchedClassCount,
  };
}

function isMethodUnavailable(reason: unknown): boolean {
  return String(reason).includes("[METHOD_NOT_FOUND]");
}

function mappingKey(
  source: PrelabelExecutionSource,
  currentModel: PrelabelModelConfig | null,
): string {
  return source.kind === "builtin" ? (currentModel?.id ?? "builtin") : source.selectionId;
}

function sourceChunkSize(
  source: PrelabelExecutionSource,
  pluginSources: PluginPrelabelSourceDescriptor[],
): number {
  if (source.kind === "builtin") return BATCH_CHUNK_SIZE;
  return pluginSources.find((plugin) => plugin.selectionId === source.selectionId)?.supportsBatch
    ? BATCH_CHUNK_SIZE
    : 1;
}
