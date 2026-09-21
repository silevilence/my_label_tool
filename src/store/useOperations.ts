import { create } from "zustand";
import { OPERATION_ZH_CN as text } from "../i18n/operations.zh-CN";

export type OperationResource =
  | "project-annotations"
  | "export-dir"
  | "video-frames"
  | "model-download"
  | "onnx-runtime"
  | "app-update";
type Resources = OperationResource | readonly OperationResource[];
export type OperationKind = "success" | "warning" | "error";
export interface OperationView {
  id: string;
  label: string;
  resources: readonly OperationResource[];
  status: "running" | "completed" | "failed";
  kind: OperationKind;
  message: string;
  percent: number | null;
  canCancel: boolean;
  cancelRequested: boolean;
  startedAt: number;
  finishedAt?: number;
  /** 同名操作失败的累计次数。 */
  failCount?: number;
}
export interface OperationHandle {
  id: string;
  readonly cancelRequested: boolean;
  progress(percent: number | null, message?: string): void;
  complete(message?: string, kind?: OperationKind): void;
  fail(error: unknown): void;
  setCancel(cancel?: () => void | Promise<void>): void;
}
interface OperationInput {
  label: string;
  resource: Resources;
  cancel?: () => void | Promise<void>;
}
interface Operations {
  operations: OperationView[];
  begin(input: OperationInput): OperationHandle;
  canStart(resources: Resources): boolean;
  cancel(id: string): Promise<void>;
  dismiss(id: string): void;
  /** 与具体操作句柄无关的错误统一入口：常驻可关闭卡片，同名聚合计数。 */
  pushError(label: string, message: string): void;
}
const asResources = (resources: Resources): readonly OperationResource[] =>
  typeof resources === "string" ? [resources] : resources;
const cancellations = new Map<string, () => void | Promise<void>>();
export const useOperations = create<Operations>((set, get) => ({
  operations: [],
  canStart: (resources) =>
    !get().operations.some(
      (op) =>
        op.status === "running" &&
        op.resources.some((resource) => asResources(resources).includes(resource)),
    ),
  begin: (input) => {
    if (!get().canStart(input.resource)) throw new Error(text.busy);
    const id = crypto.randomUUID();
    const update = (patch: Partial<OperationView>) =>
      set((state) => ({
        operations: state.operations.map((op) =>
          op.id === id && op.status === "running" ? { ...op, ...patch } : op,
        ),
      }));
    if (input.cancel) cancellations.set(id, input.cancel);
    set((state) => ({
      operations: [
        ...state.operations.filter((op) => op.label !== input.label || op.status !== "failed"),
        {
          failCount: state.operations
            .filter((op) => op.label === input.label && op.status === "failed")
            .reduce((total, op) => total + (op.failCount ?? 1), 0),
          id,
          label: input.label,
          resources: asResources(input.resource),
          status: "running",
          kind: "warning",
          message: "",
          percent: null,
          canCancel: !!input.cancel,
          cancelRequested: false,
          startedAt: Date.now(),
        },
      ],
    }));
    return {
      id,
      get cancelRequested() {
        return get().operations.find((op) => op.id === id)?.cancelRequested ?? false;
      },
      progress: (percent, message) =>
        update({
          percent:
            percent === null || !Number.isFinite(percent)
              ? null
              : Math.max(0, Math.min(100, percent)),
          ...(message === undefined ? {} : { message }),
        }),
      complete: (message = text.completed, kind = "success") => {
        update({ status: "completed", message, kind, canCancel: false, finishedAt: Date.now() });
        cancellations.delete(id);
      },
      fail: (error) => {
        set((state) => {
          const current = state.operations.find((op) => op.id === id);
          if (!current || current.status !== "running") return state;
          const previousFailures = state.operations.filter(
            (op) => op.label === current.label && op.status === "failed",
          );
          const failedIds = new Set(previousFailures.map((op) => op.id));
          const failCount =
            1 +
            (current.failCount ?? 0) +
            previousFailures.reduce((count, op) => count + (op.failCount ?? 1), 0);
          return {
            operations: state.operations
              .filter((op) => !failedIds.has(op.id))
              .map((op) =>
                op.id === id
                  ? {
                      ...op,
                      status: "failed",
                      finishedAt: Date.now(),
                      message: error instanceof Error ? error.message : String(error),
                      kind: "error",
                      canCancel: false,
                      failCount,
                    }
                  : op,
              ),
          };
        });
        cancellations.delete(id);
      },
      setCancel: (cancel) => {
        if (!get().operations.some((op) => op.id === id && op.status === "running")) return;
        if (cancel) cancellations.set(id, cancel);
        else cancellations.delete(id);
        update({ canCancel: !!cancel });
      },
    };
  },
  cancel: async (id) => {
    const op = get().operations.find((item) => item.id === id);
    const cancel = cancellations.get(id);
    if (!op || op.status !== "running" || op.cancelRequested || !cancel) return;
    set((state) => ({
      operations: state.operations.map((item) =>
        item.id === id ? { ...item, cancelRequested: true } : item,
      ),
    }));
    try {
      await cancel();
    } catch (error) {
      set((state) => ({
        operations: state.operations.map((item) =>
          item.id === id && item.status === "running"
            ? {
                ...item,
                cancelRequested: false,
                kind: "error",
                message: error instanceof Error ? error.message : String(error),
              }
            : item,
        ),
      }));
    }
  },
  dismiss: (id) =>
    set((state) => ({
      operations: state.operations.filter((op) => op.id !== id || op.status === "running"),
    })),
  pushError: (label, message) => {
    if (!message) return;
    const existing = get().operations.find((op) => op.label === label && op.status === "failed");
    if (existing) {
      const failCount = (existing.failCount ?? 1) + 1;
      set((state) => ({
        operations: state.operations.map((op) =>
          op.id === existing.id ? { ...op, message, failCount, startedAt: Date.now() } : op,
        ),
      }));
      return;
    }
    set((state) => ({
      operations: [
        ...state.operations,
        {
          id: crypto.randomUUID(),
          label,
          resources: [],
          status: "failed",
          kind: "error",
          message,
          percent: null,
          canCancel: false,
          cancelRequested: false,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          failCount: 1,
        },
      ],
    }));
  },
}));

export function tryBeginOperation(input: OperationInput): OperationHandle | null {
  return useOperations.getState().canStart(input.resource)
    ? useOperations.getState().begin(input)
    : null;
}
