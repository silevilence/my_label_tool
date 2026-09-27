import { beforeEach, expect, it, vi } from "vitest";
import { readTextFile, readTextFiles } from "./tauri-api";
import { useOperations } from "../store/useOperations";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
beforeEach(() => {
  vi.resetAllMocks();
  useOperations.setState({ operations: [] });
});
it("routes single and batch reads through one batch command", async () => {
  invoke.mockResolvedValueOnce(["中文"]).mockResolvedValueOnce(["一", "二"]);
  expect(await readTextFile("/file.txt")).toBe("中文");
  expect(await readTextFiles(["/a", "/b"], "batch")).toEqual(["一", "二"]);
  expect(invoke).toHaveBeenLastCalledWith("read_text_files", {
    paths: ["/a", "/b"],
    requestId: "batch",
  });
  expect(invoke).toHaveBeenCalledTimes(2);
});
it("reports failures under the read operation and never falls back", async () => {
  invoke.mockRejectedValue("invalid UTF-8");
  await expect(readTextFile("/file.txt")).rejects.toBe("invalid UTF-8");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(useOperations.getState().operations[0]).toMatchObject({
    status: "failed",
    message: "invalid UTF-8",
  });
});
it("cancels the request via the operation registry", async () => {
  let finish!: (values: string[]) => void;
  invoke.mockImplementation((command) =>
    command === "read_text_files"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(true),
  );
  const pending = readTextFiles(["/a"], "cancel-me");
  await useOperations.getState().cancel(useOperations.getState().operations[0].id);
  expect(invoke).toHaveBeenLastCalledWith("cancel_text_read", { requestId: "cancel-me" });
  finish(["ok"]);
  await expect(pending).rejects.toThrow("文本读取已取消");
});
