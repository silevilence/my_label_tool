import { MCP_LIMITS } from "./defaults/mcp";
import { MCP_ZH_CN as text } from "../i18n/mcp.zh-CN";
import type { McpPermission, McpControlState, McpStatus } from "../types/mcp";

export class McpError extends Error {
  constructor(
    public code: string,
    message: string = text.invalid,
  ) {
    super(message);
  }
}
export class McpControl {
  state: McpControlState = {
    mode: "human",
    permissions: [],
    expiresAt: 0,
    sessionId: null,
    client: "",
    leaseId: null,
    reason: null,
  };
  private generation: number | null = null;
  private sessions = new Map<string, { client: string; lastSeen: number }>();
  constructor(
    private changed: () => void = () => {},
    private clock = Date.now,
  ) {}
  private update(next: McpControlState) {
    this.state = next;
    this.changed();
  }
  revoke(reason = "CONTROL_REVOKED") {
    if (this.state.mode === "human") return;
    this.update({
      mode: "human",
      permissions: [],
      expiresAt: 0,
      sessionId: null,
      client: "",
      leaseId: null,
      reason,
    });
  }
  observe(status: McpStatus) {
    if ((this.generation !== null && this.generation !== status.generation) || !status.running)
      this.revoke();
    this.generation = status.generation;
    this.sessions = new Map(status.sessions.map((s) => [s.id, s]));
    this.tick();
  }
  tick() {
    const s = this.state;
    if (s.mode === "human") return;
    if (s.expiresAt <= this.clock()) {
      this.revoke(s.mode === "pending" ? "CONTROL_DENIED" : "CONTROL_REVOKED");
      return;
    }
    if (s.sessionId) {
      const session = this.sessions.get(s.sessionId);
      if (!session || this.clock() - session.lastSeen >= MCP_LIMITS.idleMs) this.revoke();
    }
  }
  request(sessionId: string, permissions: McpPermission[]) {
    this.tick();
    const session = this.sessions.get(sessionId);
    if (!session) throw new McpError("CONTROL_REVOKED", text.sessionExpired);
    if (this.state.mode === "locked") throw new McpError("CONTROL_LOCKED", text.locked);
    if (this.state.mode !== "human") throw new McpError("BUSY", text.controlBusy);
    this.update({
      mode: "pending",
      permissions,
      expiresAt: this.clock() + MCP_LIMITS.requestMs,
      sessionId,
      client: session.client,
      leaseId: null,
      reason: "CONTROL_PENDING",
    });
    return this.view(sessionId);
  }
  approve(permissions: McpPermission[]) {
    this.tick();
    if (this.state.mode !== "pending") throw new McpError("CONTROL_REVOKED", text.requestGone);
    if (!permissions.length || permissions.some((p) => !this.state.permissions.includes(p)))
      throw new McpError("INVALID_ARGUMENT");
    this.update({
      ...this.state,
      mode: "mcp",
      permissions: [...permissions],
      expiresAt: this.clock() + MCP_LIMITS.leaseMs,
      leaseId: crypto.randomUUID(),
      reason: null,
    });
  }
  lock(minutes: number) {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)
      throw new McpError("INVALID_ARGUMENT");
    this.update({
      mode: "locked",
      permissions: [],
      expiresAt: this.clock() + minutes * 60_000,
      sessionId: null,
      client: "",
      leaseId: null,
      reason: "CONTROL_LOCKED",
    });
  }
  assert(session: string, lease: unknown, permission?: McpPermission) {
    this.tick();
    if (this.state.mode === "locked") throw new McpError("CONTROL_LOCKED", text.locked);
    if (
      this.state.mode !== "mcp" ||
      this.state.sessionId !== session ||
      this.state.leaseId !== lease
    )
      throw new McpError("CONTROL_REVOKED", text.revoked);
    if (permission && !this.state.permissions.includes(permission))
      throw new McpError("PERMISSION_DENIED", text.denied);
  }
  renew(session: string, lease: unknown) {
    this.assert(session, lease);
    this.update({ ...this.state, expiresAt: this.clock() + MCP_LIMITS.leaseMs });
    return this.view(session);
  }
  release(session: string, lease: unknown) {
    this.assert(session, lease);
    this.revoke();
    return this.view(session);
  }
  view(session: string): Record<string, unknown> {
    this.tick();
    const owner = this.state.sessionId === session;
    return {
      ...this.state,
      sessionId: owner ? this.state.sessionId : null,
      leaseId: owner ? this.state.leaseId : null,
    };
  }
}
