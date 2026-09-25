import { useEffect, useRef, useState } from "react";
import { cancelAcpAgent, respondAcpPermission, runAcpAgent } from "../lib/tauri-api";
import type { AcpConfig, AcpEvent } from "../types/acp";
import { useOperations, type OperationHandle } from "../store/useOperations";
import { ACP_ZH_CN as text } from "../i18n/acp.zh-CN";

export type AcpPermission = Extract<AcpEvent, { event: "permission" }>;
export function useAcpSession() {
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [permissions, setPermissions] = useState<AcpPermission[]>([]);
  const active = useRef<OperationHandle | null>(null);
  const mounted = useRef(true);
  const rejected = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const operation = active.current;
      if (operation) void useOperations.getState().cancel(operation.id);
    };
  }, []);
  async function run(config: AcpConfig, prompt: string): Promise<string | null> {
    if (active.current) return null;
    let operation: OperationHandle;
    try {
      operation = useOperations.getState().begin({ label: text.title, resource: "acp-agent" });
    } catch (error) {
      useOperations.getState().pushError(text.title, String(error));
      return null;
    }
    active.current = operation;
    rejected.current = false;
    cancelled.current = false;
    operation.setCancel(() => {
      // Cancellation intent survives an IPC failure and a later successful reply.
      cancelled.current = true;
      return cancelAcpAgent(operation.id);
    });
    operation.progress(null, text.connecting);
    setBusy(true);
    setReply("");
    setSessionId("");
    setPermissions([]);
    let response = "";
    try {
      const result = await runAcpAgent(operation.id, config, prompt, (event) => {
        if (!mounted.current || cancelled.current || active.current !== operation) return;
        if (event.event === "session") {
          setSessionId(event.sessionId);
          operation.progress(null, text.streaming);
        }
        if (event.event === "permission") {
          setPermissions((pending) => [...pending, event]);
          operation.progress(null, text.pendingPermission);
        }
        if (event.event === "update" && event.update && typeof event.update === "object") {
          const update = event.update as Record<string, unknown>;
          if (
            update.sessionUpdate === "agent_message_chunk" &&
            update.content &&
            typeof update.content === "object"
          ) {
            const content = update.content as Record<string, unknown>;
            if (content.type === "text" && typeof content.text === "string") {
              response += content.text;
              setReply(response);
            }
          }
        }
      });
      if (cancelled.current || !mounted.current) {
        operation.complete(text.cancelled, "warning");
        return null;
      }
      if (rejected.current) {
        operation.complete(text.rejected, "warning");
        return null;
      }
      if (result.stopReason !== "end_turn") throw new Error(text.incomplete);
      operation.complete(text.completed);
      return response;
    } catch (error) {
      if (cancelled.current || !mounted.current) operation.complete(text.cancelled, "warning");
      else if (rejected.current) operation.complete(text.rejected, "warning");
      else operation.fail(error);
      return null;
    } finally {
      if (active.current === operation) active.current = null;
      if (mounted.current) {
        setBusy(false);
        setPermissions([]);
      }
    }
  }
  async function respond(requestId: string, optionId: string | null) {
    const operation = active.current;
    const permission = permissions.find((pending) => pending.requestId === requestId);
    if (!operation || !permission || cancelled.current) return;
    const option = permission.options.find(
      (option) => option.optionId === optionId && option.kind === "allow_once",
    );
    if (!option) rejected.current = true;
    try {
      await respondAcpPermission(operation.id, requestId, option?.optionId ?? null);
      if (mounted.current)
        setPermissions((pending) => pending.filter((entry) => entry.requestId !== requestId));
    } catch (error) {
      rejected.current = true;
      // Retain the operation's resource until the running request settles.
      operation.progress(null, String(error));
      if (mounted.current)
        setPermissions((pending) => pending.filter((entry) => entry.requestId !== requestId));
      try {
        await cancelAcpAgent(operation.id);
      } catch (cancelError) {
        operation.progress(null, String(cancelError));
      }
    }
  }
  return {
    busy,
    reply,
    sessionId,
    permissions,
    run,
    respond,
    cancel: async () => {
      if (active.current) await useOperations.getState().cancel(active.current.id);
    },
  };
}
