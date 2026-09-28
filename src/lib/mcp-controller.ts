import Ajv from "ajv";
import catalog from "../../docs/mcp-tools.json";
import { McpControl, McpError } from "./mcp-control";
import { useOperations } from "../store/useOperations";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOverlayStore } from "../store/useOverlayStore";
import { MCP_ZH_CN as text } from "../i18n/mcp.zh-CN";
import type { McpCall, McpControlState, McpPermission, McpResult, McpStatus } from "../types/mcp";
import type { LabelConfig } from "../types/annotation";
import type { PrelabelModelLibrary } from "../types/prelabel";
import { McpAnnotations } from "./mcp-annotations";
import { McpJobs } from "./mcp-jobs";
import { runMcpOutput, runMcpPrelabel } from "./mcp-project";
import type { ProjectConfig } from "./importers";
import type { LoadedProjectVideo } from "./project-media";

const ajv = new Ajv({ strict: false, allErrors: false });
const validators = new Map(catalog.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
export interface McpContext {
  folderPath: string;
  labels: LabelConfig[];
  canGrant: () => boolean;
  library?: PrelabelModelLibrary;
  videos?: LoadedProjectVideo[];
  activeProjectConfig?: ProjectConfig | null;
  activeProjectConfigPath?: string;
  customMappingText?: string;
  onSaved?: (config: ProjectConfig) => void;
}
export function mcpResult(value: Record<string, unknown>, isError = false): McpResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError,
  };
}
export class McpController {
  readonly jobs = new McpJobs();
  exportDirectory = "";
  private authorityReady: Promise<void> = Promise.resolve();
  readonly annotations = new McpAnnotations();
  private storeSnapshot = useAnnotationStore.getState();
  readonly control: McpControl;
  projectId: string | null = null;
  revision = 0;
  private folder = "";
  private labels: LabelConfig[] | null = null;
  private configuration: unknown[] = [];
  private listeners = new Set<() => void>();
  constructor(
    readonly context: () => McpContext,
    authority?: (state: McpControlState) => Promise<void>,
  ) {
    this.control = new McpControl(() => {
      if (this.control.state.mode !== "mcp") this.jobs.revoke();
      if (authority)
        this.authorityReady = authority(this.control.state).catch((error) => {
          this.jobs.revoke();
          if (this.control.state.mode === "mcp") this.control.revoke();
          useOperations.getState().pushError(text.title, text.authorityFailed);
          throw error;
        });
      // The rejection is also consumed here when no task is waiting for authority.
      void this.authorityReady.catch(() => {});
      useOperations.setState({ mcpControlled: this.control.state.mode === "mcp" });
      this.listeners.forEach((listener) => listener());
    });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.control.state;
  sync() {
    const context = this.context();
    if (context.folderPath !== this.folder) {
      this.control.revoke();
      this.folder = context.folderPath;
      this.projectId = context.folderPath ? crypto.randomUUID() : null;
      this.annotations.reset();
      this.exportDirectory = "";
      this.revision++;
    }
    if (context.labels !== this.labels) {
      this.labels = context.labels;
      this.revision++;
    }
    const configuration = [
      context.library,
      context.videos,
      context.customMappingText,
      context.activeProjectConfigPath,
      context.activeProjectConfig?.annotationPath,
      context.activeProjectConfig?.format,
      context.activeProjectConfig?.prelabelMappings,
    ];
    if (configuration.some((value, index) => value !== this.configuration[index])) this.revision++;
    this.configuration = configuration;
    const state = useAnnotationStore.getState();
    if (
      state.images !== this.storeSnapshot.images ||
      state.annotationsByImage !== this.storeSnapshot.annotationsByImage ||
      state.frameIndices !== this.storeSnapshot.frameIndices
    )
      this.revision++;
    this.storeSnapshot = state;
    return context;
  }
  changed() {
    this.revision++;
  }
  observe(status: McpStatus) {
    this.sync();
    this.control.observe(status);
  }
  approve(permissions: McpPermission[]) {
    this.sync();
    if (
      !this.context().canGrant() ||
      useOverlayStore.getState().depth() > 0 ||
      useOperations.getState().operations.some((op) => op.status === "running")
    )
      throw new McpError("BUSY", text.busy);
    if (
      permissions.includes("save") &&
      (!this.context().activeProjectConfig || !this.context().activeProjectConfigPath)
    )
      throw new McpError("NOT_READY", text.saveRequired);
    if (permissions.includes("export") && !this.exportDirectory)
      throw new McpError("NOT_READY", text.exportRequired);
    this.control.approve(permissions);
  }
  assertProject(id: unknown) {
    if (!this.projectId) throw new McpError("NOT_READY", text.noProject);
    if (id !== this.projectId) throw new McpError("CONFLICT", text.conflict);
  }
  assertWrite(call: McpCall, permission: McpPermission) {
    this.sync();
    this.assertProject(call.arguments.projectId);
    this.control.assert(call.sessionId, call.arguments.leaseId, permission);
    if (call.arguments.expectedRevision !== this.revision)
      throw new McpError("CONFLICT", text.conflict);
    if (!useOperations.getState().canStart("project-annotations", "operation", "mcp"))
      throw new McpError("BUSY", text.busy);
  }
  handle = (call: McpCall, status: McpStatus): McpResult => {
    try {
      this.observe(status);
      if (!status.running || !status.sessions.some((s) => s.id === call.sessionId))
        throw new McpError("CONTROL_REVOKED", text.sessionExpired);
      if (Date.now() >= call.deadline) throw new McpError("TIMEOUT", text.timeout);
      const validate = validators.get(call.name);
      if (!validate || !validate(call.arguments)) throw new McpError("INVALID_ARGUMENT");
      const a = call.arguments;
      switch (call.name) {
        case "task_status":
          return mcpResult(this.jobs.status(call.sessionId, a.taskId));
        case "task_cancel":
          return mcpResult(this.jobs.cancel(call.sessionId, a.taskId));
        case "project_save":
        case "project_export":
        case "prelabel_start": {
          const permission =
            call.name === "project_save"
              ? "save"
              : call.name === "project_export"
                ? "export"
                : "prelabel";
          this.assertWrite(call, permission);
          const context = this.context();
          const paths =
            call.name === "prelabel_start"
              ? (a.imageIds as string[]).map((id) => this.annotations.path(id))
              : [];
          if (new Set(paths).size !== paths.length) throw new McpError("INVALID_ARGUMENT");
          const target = this.exportDirectory;
          const authority = this.authorityReady;
          return mcpResult(
            this.jobs.start(
              call.sessionId,
              `MCP · ${text.permissions[permission]}`,
              ["project-annotations", permission === "prelabel" ? "onnx-runtime" : "export-dir"],
              () => {
                this.sync();
                this.assertProject(a.projectId);
                this.control.assert(call.sessionId, a.leaseId, permission);
                if (this.revision !== a.expectedRevision)
                  throw new McpError("CONFLICT", text.conflict);
              },
              async (job) => {
                await authority;
                job.check();
                const result =
                  permission === "prelabel"
                    ? await runMcpPrelabel(context, call, paths, job)
                    : await runMcpOutput(context, call, target, job);
                this.sync();
                return { ...result, revision: this.revision };
              },
            ),
          );
        }
        case "project_read": {
          this.assertProject(this.projectId);
          return mcpResult({
            projectId: this.projectId,
            revision: this.revision,
            labels: this.context().labels.map((label) => ({ ...label })),
            images: this.annotations.images(),
            models: (this.context().library?.models ?? []).map((model) => ({
              id: model.id,
              name: model.name,
              format: model.format,
              classNames: model.classNames,
            })),
          });
        }
        case "annotations_read":
          this.assertProject(a.projectId);
          return mcpResult({
            projectId: this.projectId,
            revision: this.revision,
            imageId: a.imageId,
            annotations: this.annotations.read(a.imageId),
          });
        case "annotations_apply": {
          this.assertWrite(call, "annotations");
          const result = this.annotations.apply(
            a.changes as Parameters<McpAnnotations["apply"]>[0],
            this.context().labels,
          );
          this.sync();
          return mcpResult({ ...result, projectId: this.projectId, revision: this.revision });
        }
        case "app_state":
          return mcpResult({
            ready: true,
            projectId: this.projectId,
            revision: this.revision,
            control: this.control.view(call.sessionId),
            imageCount: useAnnotationStore.getState().images.length,
          });
        case "control_status":
          return mcpResult(this.control.view(call.sessionId));
        case "control_request":
          this.assertProject(a.projectId);
          return mcpResult(this.control.request(call.sessionId, a.permissions as McpPermission[]));
        case "control_renew":
          return mcpResult(this.control.renew(call.sessionId, a.leaseId));
        case "control_release":
          return mcpResult(this.control.release(call.sessionId, a.leaseId));
        default:
          throw new McpError("INVALID_ARGUMENT", text.unknown);
      }
    } catch (error) {
      return mcpResult(
        {
          code: error instanceof McpError ? error.code : "INTERNAL_ERROR",
          message: error instanceof McpError ? error.message : text.error,
        },
        true,
      );
    }
  };
  dispose() {
    this.control.revoke();
  }
}
