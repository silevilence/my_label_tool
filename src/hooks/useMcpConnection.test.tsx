import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useMcpConnection } from "./useMcpConnection";
const api = vi.hoisted(() => ({ mcpPoll: vi.fn(), mcpResolve: vi.fn() }));
vi.mock("../lib/tauri-api", () => api);
it("answers through the desktop bridge and rejects expired calls without invoking handlers", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const status = { running: true, sessions: [] };
  api.mcpPoll.mockResolvedValue({
    status,
    calls: [
      { id: "old", name: "app_state", arguments: {}, deadline: 0 },
      { id: "new", name: "app_state", arguments: {}, deadline: Date.now() + 10000 },
    ],
  });
  api.mcpResolve.mockResolvedValue(undefined);
  function Fixture() {
    useMcpConnection();
    return null;
  }
  const element = document.createElement("div");
  const root = createRoot(element);
  await act(async () => root.render(<Fixture />));
  expect(api.mcpResolve).toHaveBeenCalledWith("old", expect.objectContaining({ isError: true }));
  expect(api.mcpResolve).toHaveBeenCalledWith(
    "new",
    expect.objectContaining({ structuredContent: expect.objectContaining({ ready: true }) }),
  );
  act(() => root.unmount());
});
