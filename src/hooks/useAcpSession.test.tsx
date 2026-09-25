import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAcpSession } from "./useAcpSession";
import { useOperations } from "../store/useOperations";
import type { AcpEvent, AcpResult } from "../types/acp";
import { AcpPermissionDialog } from "../components/settings/AcpPermissionDialog";
import { ACP_ZH_CN as text } from "../i18n/acp.zh-CN";
const api = vi.hoisted(() => ({
  runAcpAgent: vi.fn(),
  cancelAcpAgent: vi.fn().mockResolvedValue(undefined),
  respondAcpPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/tauri-api", () => api);
let session: ReturnType<typeof useAcpSession>;
let root: Root;
let host: HTMLDivElement;
let resolve: (value: AcpResult) => void;
let emit: (event: AcpEvent) => void;
const config = { executable: "agent", args: [], timeoutSeconds: 30 };
function Harness() {
  session = useAcpSession();
  const permission = session.permissions[0];
  return permission ? (
    <AcpPermissionDialog permission={permission} respond={session.respond} />
  ) : null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useOperations.setState({ operations: [] });
  api.runAcpAgent.mockImplementation((_id, _config, _prompt, callback) => {
    emit = callback;
    return new Promise((done) => {
      resolve = done;
    });
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});
function chunk(text: string): AcpEvent {
  return {
    event: "update",
    sessionId: "s",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  };
}
it("streams only assistant text and returns it on normal completion", async () => {
  let result!: Promise<string | null>;
  await act(async () => {
    result = session.run(config, "only script context");
  });
  await act(async () => {
    emit({ event: "session", sessionId: "s", agentInfo: {}, capabilities: {} });
    emit(chunk("local "));
    emit(chunk("x = 1"));
  });
  expect(session.reply).toBe("local x = 1");
  expect(session.sessionId).toBe("s");
  await act(async () => {
    resolve({ sessionId: "s", stopReason: "end_turn" });
    await result;
  });
  expect(await result).toBe("local x = 1");
  expect(session.busy).toBe(false);
});
it("discards late successful replies after cancellation", async () => {
  let result!: Promise<string | null>;
  await act(async () => {
    result = session.run(config, "test");
  });
  await act(async () => session.cancel());
  await act(async () => {
    emit(chunk("late"));
    resolve({ sessionId: "s", stopReason: "end_turn" });
    await result;
  });
  expect(await result).toBeNull();
  expect(session.reply).toBe("");
  expect(api.cancelAcpAgent).toHaveBeenCalledOnce();
});
it("does not answer permissions until confirmation and discards refused replies", async () => {
  let result!: Promise<string | null>;
  await act(async () => {
    result = session.run(config, "test");
  });
  await act(async () =>
    emit({
      event: "permission",
      requestId: "p",
      title: "tool",
      details: {
        rawInput: { command: "read private-file" },
        locations: [{ path: "private-file" }],
      },
      options: [{ optionId: "yes", name: "allow", kind: "allow_once" }],
    }),
  );
  expect(api.respondAcpPermission).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(text.permission);
  expect(
    document.querySelector(`pre[aria-label="${text.permissionDetails}"]`)?.textContent,
  ).toContain("read private-file");
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === text.deny)!
      .click();
  });
  expect(api.respondAcpPermission).toHaveBeenCalledWith(expect.any(String), "p", null);
  await act(async () => {
    emit(chunk("must not apply"));
    resolve({ sessionId: "s", stopReason: "end_turn" });
    await result;
  });
  expect(await result).toBeNull();
});
it("marks non-success stop reasons as failures", async () => {
  let result!: Promise<string | null>;
  await act(async () => {
    result = session.run(config, "test");
  });
  await act(async () => {
    resolve({ sessionId: "s", stopReason: "max_tokens" });
    await result;
  });
  expect(await result).toBeNull();
  expect(useOperations.getState().operations[0].status).toBe("failed");
});

it("discards a late success even when the cancellation IPC fails", async () => {
  api.cancelAcpAgent.mockRejectedValueOnce(new Error("cancel IPC failed"));
  let result!: Promise<string | null>;
  await act(async () => {
    result = session.run(config, "test");
  });
  await act(async () => session.cancel());
  expect(useOperations.getState().canStart("acp-agent")).toBe(false);
  await act(async () => {
    emit(chunk("late"));
    resolve({ sessionId: "s", stopReason: "end_turn" });
    await result;
  });
  expect(await result).toBeNull();
  expect(session.reply).toBe("");
});

it("keeps the resource and rejects output when both permission and cancel IPC fail", async () => {
  api.respondAcpPermission.mockRejectedValueOnce(new Error("permission IPC failed"));
  api.cancelAcpAgent.mockRejectedValueOnce(new Error("cancel IPC failed"));
  let result!: Promise<string | null>;
  await act(async () => {
    result = session.run(config, "test");
  });
  await act(async () =>
    emit({
      event: "permission",
      requestId: "p",
      title: "tool",
      options: [{ optionId: "yes", name: "allow", kind: "allow_once" }],
    }),
  );
  await act(async () => {
    await expect(session.respond("p", "yes")).resolves.toBeUndefined();
  });
  expect(useOperations.getState().canStart("acp-agent")).toBe(false);
  expect(session.permissions).toEqual([]);
  await act(async () => {
    resolve({ sessionId: "s", stopReason: "end_turn" });
    await result;
  });
  expect(await result).toBeNull();
  expect(useOperations.getState().canStart("acp-agent")).toBe(true);
});
