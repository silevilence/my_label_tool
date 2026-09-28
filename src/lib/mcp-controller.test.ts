import { beforeEach, expect, it, vi } from "vitest";
import { McpController, type McpContext } from "./mcp-controller";
import type { McpStatus } from "../types/mcp";
import { useOperations, withMcpMutation } from "../store/useOperations";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOverlayStore } from "../store/useOverlayStore";

let controller: McpController;
let context: McpContext;
let status: McpStatus;
beforeEach(() => {
  useOperations.setState({ operations: [], mcpControlled: false });
  useOverlayStore.setState({ stack: [] });
  context = { folderPath: "C:/project", labels: [], canGrant: () => true };
  controller = new McpController(() => context);
  status = {
    running: true,
    enabled: true,
    address: "127.0.0.1",
    port: 1421,
    generation: 1,
    error: null,
    sessions: [{ id: "a", client: "a", version: "2025-11-25", lastSeen: Date.now() }],
    audit: [],
  };
  controller.observe(status);
});
function call(name: string, args = {}, deadline = Date.now() + 10000) {
  return controller.handle({ id: "call", sessionId: "a", name, arguments: args, deadline }, status);
}
it("dispatches strict control tools and rejects unauthorized, unknown or expired input", () => {
  expect(call("app_state").structuredContent.projectId).toBe(controller.projectId);
  expect(call("app_state", { arbitraryPath: "C:/secret" }).isError).toBe(true);
  expect(call("missing").isError).toBe(true);
  expect(call("app_state", {}, 0).structuredContent.code).toBe("TIMEOUT");
  expect(
    call("control_request", { projectId: "wrong", permissions: ["annotations"] }).structuredContent
      .code,
  ).toBe("CONFLICT");
  expect(
    call("control_request", { projectId: controller.projectId, permissions: ["annotations"] })
      .structuredContent.mode,
  ).toBe("pending");
  controller.approve(["annotations"]);
  expect(controller.control.view("other")).toMatchObject({ sessionId: null, leaseId: null });
  const leaseId = call("control_status").structuredContent.leaseId;
  expect(call("control_renew", { leaseId }).isError).toBe(false);
  expect(call("control_release", { leaseId }).structuredContent.mode).toBe("human");
  status.sessions = [];
  expect(call("app_state").structuredContent.code).toBe("CONTROL_REVOKED");
});
it("blocks manual state and operation writes while allowing validated MCP transactions", () => {
  call("control_request", { projectId: controller.projectId, permissions: ["annotations"] });
  controller.approve(["annotations"]);
  expect(useOperations.getState().canEditAnnotations()).toBe(false);
  expect(() => useAnnotationStore.getState().clearImageAnnotations("image")).toThrow();
  expect(() =>
    useOperations.getState().begin({ label: "manual", resource: "project-annotations" }),
  ).toThrow();
  const operation = useOperations
    .getState()
    .begin({ label: "remote", resource: "project-annotations", owner: "mcp" });
  expect(() =>
    withMcpMutation(() => useAnnotationStore.getState().applyScriptTransaction([], "tx")),
  ).not.toThrow();
  operation.complete();
  controller.dispose();
  expect(useOperations.getState().canEditAnnotations()).toBe(true);
});
it("does not grant during overlays, existing operations, gestures or unready initialization", () => {
  call("control_request", { projectId: controller.projectId, permissions: ["annotations"] });
  context.canGrant = () => false;
  expect(() => controller.approve(["annotations"])).toThrow();
  context.canGrant = () => true;
  useOverlayStore.getState().register({ id: "modal", parentId: null, kind: "blocking" });
  expect(() => controller.approve(["annotations"])).toThrow();
  useOverlayStore.getState().unregister("modal");
  const operation = useOperations
    .getState()
    .begin({ label: "busy", resource: "project-annotations" });
  expect(() => controller.approve(["annotations"])).toThrow();
  operation.complete();
  expect(() => controller.approve(["annotations"])).not.toThrow();
  controller.dispose();
});
it("invalidates project identity and revokes control when projects change", () => {
  const notify = vi.fn();
  const unsubscribe = controller.subscribe(notify);
  call("control_request", { projectId: controller.projectId, permissions: ["annotations"] });
  controller.approve(["annotations"]);
  const before = controller.revision;
  context = { ...context, folderPath: "" };
  controller.sync();
  expect(controller.snapshot().mode).toBe("human");
  expect(controller.projectId).toBeNull();
  expect(controller.revision).toBeGreaterThan(before);
  expect(
    call("control_request", { projectId: "old", permissions: ["save"] }).structuredContent.code,
  ).toBe("NOT_READY");
  expect(notify).toHaveBeenCalled();
  unsubscribe();
  controller.changed();
  expect(controller.revision).toBeGreaterThan(before + 1);
});
