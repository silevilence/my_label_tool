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
        ...state.operations,
        {
          id,
          label: input.label,
          resources: asResources(input.resource),
          status: "running",
          kind: "warning",
          message: "",
          percent: null,
          canCancel: !!input.cancel,
          cancelRequested: false,
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
        update({ status: "completed", message, kind, canCancel: false });
        cancellations.delete(id);
      },
      fail: (error) => {
        update({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
          kind: "error",
          canCancel: false,
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
            ? { ...item, cancelRequested: false, kind: "error", message: String(error) }
            : item,
        ),
      }));
    }
  },
  dismiss: (id) =>
    set((state) => ({
      operations: state.operations.filter((op) => op.id !== id || op.status === "running"),
    })),
}));

export function tryBeginOperation(input: OperationInput): OperationHandle | null {
  return useOperations.getState().canStart(input.resource)
    ? useOperations.getState().begin(input)
    : null;
}
