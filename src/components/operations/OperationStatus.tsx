import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOperations } from "../../store/useOperations";
import { useOverlayStore } from "../../store/useOverlayStore";
import { OPERATION_ZH_CN as text } from "../../i18n/operations.zh-CN";

export function OperationStatus({ children }: { children?: ReactNode }) {
  const { operations, cancel, dismiss } = useOperations();
  const stack = useOverlayStore((state) => state.stack);
  const [feedbackSlot, setFeedbackSlot] = useState<HTMLElement | null>(null);
  const [errorSlots, setErrorSlots] = useState<Record<string, HTMLElement>>({});
  useLayoutEffect(() => {
    const slots = [...document.querySelectorAll<HTMLElement>("[data-operation-feedback]")];
    const target = [...stack]
      .reverse()
      .flatMap((entry) => slots.filter((slot) => slot.dataset.operationFeedback === entry.id))[0];
    setFeedbackSlot(target ?? null);
    const errorTargets = [
      ...document.querySelectorAll<HTMLElement>("[data-operation-error-feedback]"),
    ];
    const nextErrorSlots: Record<string, HTMLElement> = {};
    for (const op of operations) {
      const slot = errorTargets.find(
        (element) => element.dataset.operationErrorFeedback === op.label,
      );
      if (op.status === "failed" && slot) nextErrorSlots[op.id] = slot;
    }
    setErrorSlots((previous) =>
      Object.keys(previous).length === Object.keys(nextErrorSlots).length &&
      Object.entries(nextErrorSlots).every(([id, slot]) => previous[id] === slot)
        ? previous
        : nextErrorSlots,
    );
  });
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
  if (!operations.length && !children) return null;
  const hasLocalContent = operations.some((op) => !errorSlots[op.id]) || children;
  const content = (
    <div
      role="region"
      aria-label={text.statusArea}
      className={
        hasLocalContent
          ? "flex max-h-[40vh] shrink-0 items-start gap-3 overflow-auto border-t border-slate-800 bg-slate-900 p-3"
          : "contents"
      }
    >
      {children}
      {[...operations]
        .reverse()
        .sort((a, b) => Number(b.status === "running") - Number(a.status === "running"))
        .map((op) => {
          const card = (
            <section
              key={op.id}
              role={op.status === "failed" ? "alert" : "status"}
              className={`w-80 max-w-full shrink-0 rounded border bg-slate-950 p-3 text-sm shadow-xl ${op.kind === "error" ? "border-red-600 text-red-200" : op.kind === "success" ? "border-emerald-600 text-emerald-200" : "border-amber-600 text-amber-200"}`}
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
              {op.message && (
                <p className="mt-1 break-words">
                  {op.message}
                  {op.status === "failed" && op.failCount && op.failCount > 1
                    ? text.failureCount(op.failCount)
                    : ""}
                </p>
              )}
              {op.status === "running" && (
                <progress className="mt-2 w-full" max={100} value={op.percent ?? undefined} />
              )}
            </section>
          );
          return errorSlots[op.id] ? createPortal(card, errorSlots[op.id], op.id) : card;
        })}
    </div>
  );
  return feedbackSlot ? createPortal(content, feedbackSlot) : content;
}
