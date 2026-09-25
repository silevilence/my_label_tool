/** Host-only ACP channel; independent of plugin and Lua protocol versions. */
export interface AcpConfig {
  executable: string;
  args: string[];
  timeoutSeconds: number;
}
export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}
export type AcpEvent =
  | { event: "session"; sessionId: string; agentInfo: unknown; capabilities: unknown }
  | { event: "update"; sessionId: string; update: unknown }
  | {
      event: "permission";
      requestId: string;
      title: string;
      options: AcpPermissionOption[];
      details?: unknown;
    };
export interface AcpResult {
  sessionId: string;
  stopReason: string;
}
