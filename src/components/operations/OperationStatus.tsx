import { useEffect } from "react";
import { useOperations } from "../../store/useOperations";
import { OPERATION_ZH_CN as text } from "../../i18n/operations.zh-CN";

export function OperationStatus() {
  const { operations, cancel, dismiss } = useOperations();
  useEffect(() => {
    const timers = operations
      .filter((op) => op.status === "completed")
      .map((op) =>
        window.setTimeout(
          () => dismiss(op.id),
          Math.max(0, (op.finishedAt ?? Date.now()) + 5000 - Date.now()),
        ),
      );
    return () => timers.forEach(window.clearTimeout);
  }, [operations, dismiss]);
  return (
    <div className="fixed top-24 right-4 z-50 flex max-h-[40vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto">
      {[...operations]
        .reverse()
        .sort((a, b) => Number(b.status === "running") - Number(a.status === "running"))
        .map((op) => (
          <section
            key={op.id}
            role="status"
            className={`rounded border bg-slate-950 p-3 text-sm shadow-xl ${op.kind === "error" ? "border-red-600 text-red-200" : op.kind === "success" ? "border-emerald-600 text-emerald-200" : "border-amber-600 text-amber-200"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <strong>{op.label}</strong>
              {op.status === "running" ? (
                op.canCancel && (
                  <button
                    type="button"
                    disabled={op.cancelRequested}
                    onClick={() => void cancel(op.id)}
                  >
                    {op.cancelRequested ? text.cancelling : text.cancel}
                  </button>
                )
              ) : (
                <button type="button" aria-label={text.dismiss} onClick={() => dismiss(op.id)}>
                  ×
                </button>
              )}
            </div>
            {op.message && <p className="mt-1 break-words">{op.message}</p>}
            {op.status === "running" && (
              <progress className="mt-2 w-full" max={100} value={op.percent ?? undefined} />
            )}
          </section>
        ))}
    </div>
  );
}
