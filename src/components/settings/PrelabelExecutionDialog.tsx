import { useState } from "react";
import type { PrelabelExecutionControls } from "../../hooks/usePrelabelExecution";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";

export function PrelabelExecutionDialog({
  execution,
  hasSelectedImage,
  onClose,
}: {
  execution: PrelabelExecutionControls;
  hasSelectedImage: boolean;
  onClose: () => void;
}) {
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const { currentModel, progress } = execution;
  const progressPercent = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6">
      <section
        aria-label={text.executionTitle}
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-100">{text.executionTitle}</h2>
          <button
            className="rounded border border-slate-700 px-3 py-1 text-sm disabled:opacity-50"
            disabled={progress.isRunning}
            title={progress.isRunning ? text.batchRunning : undefined}
            type="button"
            onClick={onClose}
          >
            {text.close}
          </button>
        </header>

        <div className="space-y-3 p-5">
          <p className={`text-xs ${currentModel ? "text-slate-400" : "text-amber-300"}`}>
            {currentModel ? text.executionModel(currentModel.name) : text.executionNoModel}
          </p>
          {execution.unmatchedClassCount > 0 && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
              {text.executionUnmatched(execution.unmatchedClassCount)}
            </p>
          )}
          <button
            className="w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!currentModel || !hasSelectedImage || progress.isRunning}
            type="button"
            onClick={() => void execution.runSingle()}
          >
            {text.singleRun}
          </button>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              checked={forceOverwrite}
              disabled={progress.isRunning}
              type="checkbox"
              onChange={(event) => setForceOverwrite(event.target.checked)}
            />
            {text.forceOverwrite}
          </label>
          <p className="text-xs leading-5 text-slate-500">{text.batchDefaultHint}</p>
          {progress.isRunning ? (
            <button
              className="w-full rounded border border-amber-500/60 px-3 py-2 text-sm font-medium text-amber-200 disabled:opacity-50"
              disabled={progress.cancelRequested}
              type="button"
              onClick={execution.cancel}
            >
              {progress.operation === "batch" ? text.cancelBatch : text.cancelSingle}
            </button>
          ) : (
            <button
              className="w-full rounded border border-sky-500/60 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!currentModel}
              type="button"
              onClick={() => void execution.runBatch(forceOverwrite)}
            >
              {text.batchRun}
            </button>
          )}
          {(progress.total > 0 || progress.message) && (
            <div aria-live="polite">
              {progress.total > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-emerald-500 transition-[width]"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-slate-400">
                    {progress.processed}/{progress.total}
                  </span>
                </div>
              )}
              {progress.message && (
                <p className="mt-2 text-xs text-slate-300">{progress.message}</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
