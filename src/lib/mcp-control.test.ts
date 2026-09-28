import { beforeEach, expect, it, vi } from "vitest";
import { McpControl, McpError } from "./mcp-control";
import type { McpStatus } from "../types/mcp";

let time: number;
let control: McpControl;
let status: McpStatus;
beforeEach(() => {
  time = 1000;
  control = new McpControl(vi.fn(), () => time);
  status = {
    running: true,
    enabled: true,
    address: "127.0.0.1",
    port: 1421,
    generation: 1,
    error: null,
    sessions: [
      { id: "a", client: "client-a", version: "2025-11-25", lastSeen: time },
      { id: "b", client: "client-b", version: "2025-11-25", lastSeen: time },
    ],
    audit: [],
  };
  control.observe(status);
});
function granted() {
  control.request("a", ["annotations", "save"]);
  control.approve(["annotations"]);
  return control.state.leaseId!;
}
it("requires manual approval, scopes permissions and hides the lease from other clients", () => {
  expect(control.view("a").mode).toBe("human");
  const lease = granted();
  expect(control.view("a").leaseId).toBe(lease);
  expect(control.view("b").leaseId).toBeNull();
  expect(() => control.assert("b", lease)).toThrow(McpError);
  expect(() => control.assert("a", lease, "save")).toThrow(
    expect.objectContaining({ code: "PERMISSION_DENIED" }),
  );
  expect(() => control.assert("a", lease, "annotations")).not.toThrow();
  expect(() => control.request("b", ["annotations"])).toThrow(
    expect.objectContaining({ code: "BUSY" }),
  );
  expect(() => control.approve(["annotations"])).toThrow();
  time += 100;
  const before = control.state.expiresAt;
  expect(control.renew("a", lease).expiresAt).toBe(before + 100);
  expect(control.release("a", lease).mode).toBe("human");
  expect(() => control.assert("a", lease)).toThrow();
});
it("rejects invalid approvals, unknown sessions and unanswered requests", () => {
  expect(() => control.request("missing", ["save"])).toThrow();
  control.request("a", ["annotations"]);
  expect(() => control.approve(["save"])).toThrow();
  expect(() => control.approve([])).toThrow();
  time += 60_000;
  control.tick();
  expect(control.state).toMatchObject({ mode: "human", reason: "CONTROL_DENIED" });
});
it("revokes on reclaim, timed global lock, session close, idle timeout, restart and stop", () => {
  const lease = granted();
  control.lock(1);
  expect(() => control.assert("a", lease)).toThrow(
    expect.objectContaining({ code: "CONTROL_LOCKED" }),
  );
  expect(() => control.request("b", ["save"])).toThrow(
    expect.objectContaining({ code: "CONTROL_LOCKED" }),
  );
  expect(() => control.lock(0)).toThrow();
  expect(() => control.lock(1441)).toThrow();
  time += 60_000;
  control.tick();
  expect(control.state.mode).toBe("human");
  status.sessions.forEach((s) => {
    s.lastSeen = time;
  });
  control.observe(status);
  granted();
  control.observe({ ...status, sessions: [] });
  expect(control.state.mode).toBe("human");
  control.observe(status);
  granted();
  time += 60_000;
  control.tick();
  expect(control.state.mode).toBe("human");
  status.sessions.forEach((s) => {
    s.lastSeen = time;
  });
  control.observe(status);
  granted();
  control.observe({ ...status, generation: 2 });
  expect(control.state.mode).toBe("human");
  control.observe(status);
  granted();
  control.observe({ ...status, running: false });
  expect(control.state.mode).toBe("human");
});
it("expires a lease even when the session remains active", () => {
  granted();
  time += 300_000;
  status.sessions.forEach((s) => {
    s.lastSeen = time;
  });
  control.observe(status);
  expect(control.state.mode).toBe("human");
});
