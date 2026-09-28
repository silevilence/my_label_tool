import type { McpContext } from "./mcp-controller";
import type { JobContext } from "./mcp-jobs";
import type { McpCall } from "../types/mcp";
import type { BuiltInExportFormatId, ExportData, TextExportFile } from "../types/export";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { withMcpMutation } from "../store/useOperations";
import { McpError } from "./mcp-control";
import { MCP_ZH_CN as text } from "../i18n/mcp.zh-CN";
import { loadImageSize, parseCustomMapping, portablePath } from "./app-utils";
import { exportCoco } from "./exporters/coco";
import { exportCustom } from "./exporters/custom";
import { exportVoc } from "./exporters/voc";
import { exportYolo } from "./exporters/yolo";
import { withProjectMedia } from "./project-media";
import {
  mcpPrepareOutput,
  mcpCommitOutput,
  mcpDiscardOutput,
  runPrelabelInference,
  cancelPrelabelInference,
} from "./tauri-api";
import {
  isUnmatchedPrelabelMapping,
  mapPrelabelDetections,
  resolvePrelabelClassMappings,
} from "./prelabel-mapping";
import { validateAnnotationCore } from "./annotation-validation";
import { usePromptStore } from "./prompts";

function interruptible<T>(promise: Promise<T>, job: JobContext): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      try {
        job.check();
      } catch (e) {
        reject(e);
      }
    };
    job.signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => job.signal.removeEventListener("abort", abort));
    if (job.signal.aborted) abort();
  });
}
async function buildData(context: McpContext, job: JobContext): Promise<ExportData> {
  const state = useAnnotationStore.getState();
  const images: ExportData["images"] = [];
  for (const image of state.images) {
    job.check();
    const video = context.videos?.find((v) => v.images.some((i) => i.path === image.path))?.video;
    const size = video
      ? { width: video.width, height: video.height }
      : await interruptible(loadImageSize(image.path), job);
    job.check();
    images.push({
      ...image,
      ...size,
      annotations: (state.annotationsByImage[image.path] ?? []).map((a) => ({
        ...a,
        points: [...a.points],
        ...(a.attributes ? { attributes: { ...a.attributes } } : {}),
        frameIndex: state.frameIndices[image.path] ?? 0,
      })),
    });
    job.progress(Math.round((images.length / state.images.length) * 70));
  }
  return { labels: context.labels.map((l) => ({ ...l })), images };
}
export function serializeMcpExport(
  format: BuiltInExportFormatId,
  data: ExportData,
  context: McpContext,
): TextExportFile[] {
  if (format === "voc") return exportVoc(data);
  if (format === "yolo") {
    if (data.images.some((i) => i.annotations.some((a) => a.type !== "rect")))
      throw new McpError("INVALID_ARGUMENT", text.yoloRectOnly);
    return exportYolo(data);
  }
  const value =
    format === "json"
      ? withProjectMedia(data, context.videos ?? [])
      : format === "coco"
        ? exportCoco(data)
        : exportCustom(data, parseCustomMapping(context.customMappingText ?? "{}"));
  return [
    {
      path: `annotations${format === "json" ? "" : `.${format}`}.json`,
      content: JSON.stringify(value, null, 2),
    },
  ];
}
function splitFile(path: string) {
  const normal = portablePath(path),
    index = normal.lastIndexOf("/");
  if (index < 0) throw new McpError("INVALID_ARGUMENT", text.saveRequired);
  return { root: normal.slice(0, index + 1), name: normal.slice(index + 1) };
}
async function confirmOverwrite(count: number, job: JobContext) {
  const store = usePromptStore.getState();
  const pending = store.requestConfirm({
    title: text.permissions.export,
    message: text.overwrite(count),
    danger: true,
  });
  const queue = usePromptStore.getState().confirmQueue;
  const request = queue[queue.length - 1];
  const abort = () => {
    usePromptStore.setState((s) => ({ confirmQueue: s.confirmQueue.filter((r) => r !== request) }));
    request.resolve(false);
  };
  job.signal.addEventListener("abort", abort, { once: true });
  try {
    if (job.signal.aborted) abort();
    return await pending;
  } finally {
    job.signal.removeEventListener("abort", abort);
  }
}
export async function runMcpOutput(
  context: McpContext,
  call: McpCall,
  exportDirectory: string,
  job: JobContext,
) {
  const save = call.name === "project_save";
  const config = context.activeProjectConfig;
  if (save && (!config || !context.activeProjectConfigPath))
    throw new McpError("NOT_READY", text.saveRequired);
  if (!save && !exportDirectory) throw new McpError("NOT_READY", text.exportRequired);
  const format = (save ? config!.format : call.arguments.format) as BuiltInExportFormatId;
  const data = await buildData(context, job);
  const files = serializeMcpExport(format, data, context);
  const groups = [{ root: exportDirectory, files }];
  const nextConfig = config
    ? { ...config, labels: data.labels, exportedAt: new Date().toISOString() }
    : null;
  if (save) {
    if (format === "json" || format === "coco") {
      const target = splitFile(config!.annotationPath);
      groups[0] = { root: target.root, files: [{ ...files[0], path: target.name }] };
    } else groups[0].root = config!.annotationPath;
    const target = splitFile(context.activeProjectConfigPath!);
    groups.push({
      root: target.root,
      files: [{ path: target.name, content: JSON.stringify(nextConfig, null, 2) }],
    });
  }
  const discard = () => {
    void mcpDiscardOutput(job.id).catch(() => {});
  };
  job.signal.addEventListener("abort", discard, { once: true });
  try {
    job.check();
    const preview = await mcpPrepareOutput(
      job.id,
      call.sessionId,
      call.arguments.leaseId as string,
      groups,
    );
    job.check();
    job.progress(85);
    if (!save && preview.overwrites) {
      const confirmed = await confirmOverwrite(preview.overwrites, job);
      job.check();
      if (!confirmed) throw new McpError("CANCELLED", text.cancelled);
    }
    job.check();
    const written = await mcpCommitOutput(job.id, save || preview.overwrites > 0);
    // Commit is linearized by the native authority mutex. A later revoke cannot undo a completed save.
    if (save && nextConfig) {
      // Do not update a newly opened project's React configuration after a completed native commit.
      let current = true;
      try {
        job.check();
      } catch {
        current = false;
      }
      if (current) context.onSaved?.(nextConfig);
    }
    return { files: written, format };
  } finally {
    job.signal.removeEventListener("abort", discard);
    await mcpDiscardOutput(job.id);
  }
}
export async function runMcpPrelabel(
  context: McpContext,
  call: McpCall,
  paths: string[],
  job: JobContext,
) {
  const model = context.library?.models.find((m) => m.id === call.arguments.modelId);
  if (!model) throw new McpError("NOT_FOUND", text.modelMissing);
  const mappings = resolvePrelabelClassMappings(
    model.id,
    model.classNames,
    context.labels,
    context.activeProjectConfig?.prelabelMappings ?? {},
  );
  if (mappings.some(isUnmatchedPrelabelMapping))
    throw new McpError("INVALID_ARGUMENT", text.modelMissing);
  const cancel = () => {
    void cancelPrelabelInference(job.id).catch(() => {});
  };
  job.signal.addEventListener("abort", cancel, { once: true });
  try {
    job.check();
    const result = await runPrelabelInference(job.id, model, paths, (e) => {
      if (e.event === "completed") job.progress(Math.round((e.index / e.total) * 95));
    });
    job.check();
    if (result.cancelled) throw new McpError("CANCELLED", text.cancelled);
    const state = useAnnotationStore.getState(),
      requested = new Set(paths),
      seen = new Set<string>();
    const entries = result.results.map((image) => {
      if (!requested.has(image.imagePath) || seen.has(image.imagePath))
        throw new McpError("INVALID_ARGUMENT");
      seen.add(image.imagePath);
      const added = mapPrelabelDetections(image.detections, mappings).map((shape) => {
        validateAnnotationCore(shape, context.labels, true);
        return { ...shape, frameIndex: state.frameIndices[image.imagePath] ?? 0 };
      });
      return {
        imagePath: image.imagePath,
        annotations: [...(state.annotationsByImage[image.imagePath] ?? []), ...added],
      };
    });
    if (seen.size !== requested.size) throw new McpError("INVALID_ARGUMENT");
    job.check();
    const transactionId = crypto.randomUUID();
    withMcpMutation(() => state.applyScriptTransaction(entries, transactionId));
    return { transactionId, images: entries.length };
  } finally {
    job.signal.removeEventListener("abort", cancel);
  }
}
