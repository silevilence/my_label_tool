import { useEffect, useRef, useState } from "react";
import { mcpPoll, mcpResolve } from "../lib/tauri-api";
import type { McpCall, McpResult, McpStatus } from "../types/mcp";
import { MCP_ZH_CN as text } from "../i18n/mcp.zh-CN";

export function mcpResult(value: Record<string, unknown>, isError = false): McpResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError,
  };
}
export function useMcpConnection(
  handler?: (call: McpCall, status: McpStatus) => McpResult,
  onStatus?: (status: McpStatus) => void,
) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState("");
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await mcpPoll();
        if (stopped) return;
        setStatus(next.status);
        setError("");
        onStatusRef.current?.(next.status);
        for (const call of next.calls) {
          if (stopped) return;
          let result: McpResult;
          try {
            if (Date.now() >= call.deadline)
              result = mcpResult({ code: "TIMEOUT", message: text.timeout }, true);
            else if (handlerRef.current) result = handlerRef.current(call, next.status);
            else if (call.name === "app_state" && Object.keys(call.arguments).length === 0)
              result = mcpResult({ ready: true, control: "human", project: null });
            else result = mcpResult({ code: "INVALID_ARGUMENT", message: text.invalid }, true);
          } catch (error) {
            result = mcpResult(
              {
                code: "INTERNAL_ERROR",
                message: error instanceof Error ? error.message : text.error,
              },
              true,
            );
          }
          await mcpResolve(call.id, result);
        }
      } catch (error) {
        if (!stopped) setError(String(error));
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 200);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return { status, error };
}
