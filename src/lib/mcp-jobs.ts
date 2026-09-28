import { useOperations, type OperationResource } from "../store/useOperations";
import { McpError } from "./mcp-control";
import { MCP_LIMITS } from "./defaults/mcp";
import { MCP_ZH_CN as text } from "../i18n/mcp.zh-CN";

export interface JobContext {
  id: string;
  signal: AbortSignal;
  check(): void;
  progress(percent: number): void;
}
interface Job {
  taskId: string;
  sessionId: string;
  status: "running" | "completed" | "cancelled" | "failed";
  percent: number;
  result?: Record<string, unknown>;
  code?: string;
  message?: string;
  abort: AbortController;
}
/** Owns cancellation and bounded task history; detailed errors stay in the desktop UI. */
export class McpJobs {
  private jobs = new Map<string, Job>();
  start(
    sessionId: string,
    label: string,
    resource: OperationResource[],
    guard: () => void,
    run: (context: JobContext) => Promise<Record<string, unknown>>,
  ) {
    if (!useOperations.getState().canStart(resource, "operation", "mcp"))
      throw new McpError("BUSY", text.busy);
    const abort = new AbortController();
    const job: Job = {
      taskId: crypto.randomUUID(),
      sessionId,
      status: "running",
      percent: 0,
      abort,
    };
    const operation = useOperations
      .getState()
      .begin({ owner: "mcp", label, resource, cancel: () => abort.abort() });
    this.jobs.set(job.taskId, job);
    while (this.jobs.size > 100) {
      const done = [...this.jobs.values()].find((j) => j.status !== "running");
      if (!done) break;
      this.jobs.delete(done.taskId);
    }
    const deadline = Date.now() + MCP_LIMITS.taskMs;
    const timeout = setTimeout(
      () => abort.abort(new McpError("TIMEOUT", text.timeout)),
      MCP_LIMITS.taskMs,
    );
    const context: JobContext = {
      id: job.taskId,
      signal: abort.signal,
      check: () => {
        if (Date.now() >= deadline) throw new McpError("TIMEOUT", text.timeout);
        if (abort.signal.aborted)
          throw abort.signal.reason instanceof McpError
            ? abort.signal.reason
            : new McpError("CANCELLED", text.cancelled);
        guard();
      },
      progress: (percent) => {
        if (!abort.signal.aborted) {
          job.percent = percent;
          operation.progress(percent);
        }
      },
    };
    // Return the task ID before starting expensive work. All results are committed by run after check().
    void Promise.resolve()
      .then(() => {
        context.check();
        return run(context);
      })
      .then((result) => {
        job.status = "completed";
        job.percent = 100;
        job.result = result;
        operation.complete(text.completed);
      })
      .catch((error: unknown) => {
        const reason =
          abort.signal.aborted && abort.signal.reason instanceof McpError
            ? abort.signal.reason
            : error;
        job.code =
          reason instanceof McpError
            ? reason.code
            : abort.signal.aborted
              ? "CANCELLED"
              : "TASK_FAILED";
        job.message =
          reason instanceof McpError
            ? reason.message
            : abort.signal.aborted
              ? text.cancelled
              : text.taskFailed;
        job.status = abort.signal.aborted || job.code === "CANCELLED" ? "cancelled" : "failed";
        if (job.status === "cancelled") operation.complete(job.message, "warning");
        else operation.fail(error);
      })
      .finally(() => clearTimeout(timeout));
    return { taskId: job.taskId, status: job.status };
  }
  status(sessionId: string, taskId: unknown) {
    const job = typeof taskId === "string" ? this.jobs.get(taskId) : undefined;
    if (!job || job.sessionId !== sessionId) throw new McpError("NOT_FOUND", text.taskMissing);
    return {
      taskId: job.taskId,
      status: job.status,
      percent: job.percent,
      ...(job.result ? { result: job.result } : {}),
      ...(job.code ? { code: job.code, message: job.message } : {}),
    };
  }
  cancel(sessionId: string, taskId: unknown) {
    this.status(sessionId, taskId);
    const job = this.jobs.get(taskId as string)!;
    if (job.status === "running") job.abort.abort();
    return { taskId, accepted: job.status === "running" };
  }
  revoke() {
    for (const job of this.jobs.values())
      if (job.status === "running") job.abort.abort(new McpError("CONTROL_REVOKED", text.revoked));
  }
}
