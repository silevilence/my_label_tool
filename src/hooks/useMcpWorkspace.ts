import { useEffect, useRef, useSyncExternalStore } from "react";
import { McpController, type McpContext } from "../lib/mcp-controller";
import { useMcpConnection } from "./useMcpConnection";
import { mcpSetAuthority } from "../lib/tauri-api";
import { useOverlayStore } from "../store/useOverlayStore";

let authorityEpoch = 0;

export function useMcpWorkspace(context: McpContext) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const controllerRef = useRef<McpController>();
  if (!controllerRef.current)
    controllerRef.current = new McpController(
      () => contextRef.current,
      (state) => {
        authorityEpoch = Math.max(authorityEpoch + 1, Date.now() * 1000);
        return mcpSetAuthority({
          epoch: authorityEpoch,
          sessionId: state.mode === "mcp" ? state.sessionId : null,
          leaseId: state.mode === "mcp" ? state.leaseId : null,
          expiresAt: state.expiresAt,
        });
      },
    );
  const controller = controllerRef.current;
  const control = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const connection = useMcpConnection(
    controller.handle,
    (status) => controller.observe(status),
    () => controller.control.revoke(),
  );
  const gateRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tick = setInterval(() => controller.control.tick(), 200);
    function block(event: KeyboardEvent) {
      // Keep the control bar keyboard-accessible while rejecting application shortcuts.
      if (
        controller.control.state.mode === "mcp" &&
        useOverlayStore.getState().depth() === 0 &&
        !(event.target instanceof Element && event.target.closest("[data-mcp-control]"))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    window.addEventListener("keydown", block, true);
    return () => {
      clearInterval(tick);
      window.removeEventListener("keydown", block, true);
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (gateRef.current) gateRef.current.inert = control.mode === "mcp";
  }, [control.mode]);
  return { ...connection, controller, control, gateRef };
}
