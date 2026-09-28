import { useEffect, useRef, useSyncExternalStore } from "react";
import { McpController, type McpContext } from "../lib/mcp-controller";
import { useMcpConnection } from "./useMcpConnection";

export function useMcpWorkspace(context: McpContext) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const controllerRef = useRef<McpController>();
  if (!controllerRef.current) controllerRef.current = new McpController(() => contextRef.current);
  const controller = controllerRef.current;
  const control = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const connection = useMcpConnection(controller.handle, (status) => controller.observe(status));
  const gateRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tick = setInterval(() => controller.control.tick(), 200);
    function block(event: KeyboardEvent) {
      // Keep the control bar keyboard-accessible while rejecting application shortcuts.
      if (
        controller.control.state.mode === "mcp" &&
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
