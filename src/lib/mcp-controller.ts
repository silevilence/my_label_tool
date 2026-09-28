import Ajv from "ajv";
import catalog from "../../docs/mcp-tools.json";
import { McpControl, McpError } from "./mcp-control";
import { useOperations } from "../store/useOperations";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOverlayStore } from "../store/useOverlayStore";
import { MCP_ZH_CN as text } from "../i18n/mcp.zh-CN";
import type { McpCall, McpPermission, McpResult, McpStatus } from "../types/mcp";
import type { LabelConfig } from "../types/annotation";

const ajv = new Ajv({ strict: false, allErrors: false });
const validators = new Map(catalog.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
export interface McpContext {
  folderPath: string;
  labels: LabelConfig[];
  canGrant: () => boolean;
}
export function mcpResult(value: Record<string, unknown>, isError = false): McpResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError,
  };
}
export class McpController {
  readonly control: McpControl;
  projectId: string | null = null;
  revision = 0;
  private folder = "";
  private labels: LabelConfig[] | null = null;
  private listeners = new Set<() => void>();
  constructor(readonly context: () => McpContext) {
    this.control = new McpControl(() => {
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
      this.revision++;
    }
    if (context.labels !== this.labels) {
      this.labels = context.labels;
      this.revision++;
    }
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
    this.control.approve(permissions);
  }
  assertProject(id: unknown) {
    if (!this.projectId) throw new McpError("NOT_READY", text.noProject);
    if (id !== this.projectId) throw new McpError("CONFLICT", text.conflict);
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
          message: error instanceof Error ? error.message : text.error,
        },
        true,
      );
    }
  };
  dispose() {
    this.control.revoke();
  }
}
