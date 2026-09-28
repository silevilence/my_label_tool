/** Host-only MCP bridge. Independent of plugin and project file contracts. */
export type McpPermission = "annotations" | "save" | "export" | "prelabel";
export interface McpControlState {
  mode: "human" | "pending" | "mcp" | "locked";
  permissions: McpPermission[];
  expiresAt: number;
  sessionId: string | null;
  client: string;
  leaseId: string | null;
  reason: string | null;
}
export interface McpSession {
  id: string;
  client: string;
  version: string;
  lastSeen: number;
}
export interface McpAudit {
  time: number;
  session: string;
  tool: string;
  result: string;
}
export interface McpStatus {
  running: boolean;
  enabled: boolean;
  address: string;
  port: number;
  generation: number;
  error: string | null;
  sessions: McpSession[];
  audit: McpAudit[];
}
export interface McpCall {
  id: string;
  sessionId: string;
  name: string;
  arguments: Record<string, unknown>;
  deadline: number;
}
export interface McpResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}
export interface McpPoll {
  status: McpStatus;
  calls: McpCall[];
}
