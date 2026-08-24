import { useEffect, useRef } from "react";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import {
  validatePtConversionParameters,
  type PtConversionSession,
} from "../../lib/prelabel-conversion";
import type { PtConversionEnvironment, PtConversionParameters } from "../../types/prelabel";

interface PtConversionDialogProps {
  environment: PtConversionEnvironment;
  path: string;
  session: PtConversionSession;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onParametersChange: (parameters: PtConversionParameters) => void;
}

export function PtConversionDialog({
  environment,
  path,
  session,
  onBack,
  onCancel,
  onConfirm,
  onParametersChange,
}: PtConversionDialogProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  const validationError = validatePtConversionParameters(session.parameters);
  const isActive = session.status === "running" || session.status === "cancelling";
  const command = session.plan?.command ?? text.ptPreparingCommand;

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [session.output]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 px-4 py-6">
      <section
        aria-modal="true"
        className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-slate-600 bg-slate-900 shadow-2xl"
        role="dialog"
      >
        <header className="border-b border-slate-800 px-5 py-4">
          <h3 className="font-semibold text-slate-100">{text.ptDialogTitle}</h3>
          <p className="mt-1 break-all text-xs text-slate-500">{path}</p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {session.status === "confirming" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-slate-300">
                  <span className="mb-1 block">{text.ptImgSize}</span>
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
                    min="32"
                    step="32"
                    type="number"
                    value={session.parameters.imgsz}
                    onChange={(event) =>
                      onParametersChange({
                        ...session.parameters,
                        imgsz: event.target.valueAsNumber,
                      })
                    }
                  />
                  {validationError && (
                    <span className="mt-1 block text-xs text-red-300">{validationError}</span>
                  )}
                </label>
                <label className="flex items-center gap-3 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 sm:self-start sm:mt-6">
                  <input
                    checked={session.parameters.simplify}
                    type="checkbox"
                    onChange={(event) =>
                      onParametersChange({
                        ...session.parameters,
                        simplify: event.target.checked,
                      })
                    }
                  />
                  {text.ptSimplify}
                </label>
              </div>
              {(session.plan?.method ?? environment.method) === "uvx-yolo" && (
                <p className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                  {text.ptUvxFirstRunNotice}
                </p>
              )}
              {session.error && (
                <p className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">
                  {text.ptConversionFailed(session.error)}
                </p>
              )}
            </>
          ) : (
            <div
              className={`rounded border p-3 text-sm ${
                session.status === "failed"
                  ? "border-red-500/40 bg-red-500/10 text-red-100"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-100"
              }`}
            >
              {session.status === "cancelling"
                ? text.ptCancelling
                : session.status === "failed"
                  ? text.ptConversionFailed(session.error)
                  : text.ptConversionRunning(session.plan?.timeoutSeconds ?? null)}
            </div>
          )}

          <h4 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">
            {text.ptCommandPreview}
          </h4>
          <code className="mt-2 block overflow-x-auto rounded bg-slate-950 p-3 text-xs leading-5 text-slate-200">
            {command}
          </code>

          {session.status !== "confirming" && (
            <>
              <h4 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-500">
                {text.ptLiveOutput}
              </h4>
              <pre
                aria-live="polite"
                className="mt-2 h-64 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-black p-3 font-mono text-xs leading-5 text-emerald-200"
                ref={outputRef}
              >
                {session.output.length > 0 ? session.output.join("\n") : text.ptWaitingForOutput}
              </pre>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
          {isActive ? (
            <button
              className="rounded border border-red-500/60 px-4 py-2 text-sm text-red-200 disabled:opacity-50"
              disabled={session.status === "cancelling"}
              type="button"
              onClick={onCancel}
            >
              {session.status === "cancelling" ? text.ptCancelling : text.ptCancelConversion}
            </button>
          ) : (
            <>
              <button
                className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200"
                type="button"
                onClick={onBack}
              >
                {text.back}
              </button>
              {session.status === "confirming" && (
                <button
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={Boolean(validationError) || !session.plan}
                  type="button"
                  onClick={onConfirm}
                >
                  {text.ptStartConversion}
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
