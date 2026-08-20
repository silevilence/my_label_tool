import { useState } from "react";
import type { usePrelabelExecution } from "../../hooks/usePrelabelExecution";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";

export function PrelabelExecutionPanel({
  execution,
  hasSelectedImage,
}: {
  execution: ReturnType<typeof usePrelabelExecution>;
  hasSelectedImage: boolean;
}) {
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const { currentModel, progress } = execution;
  const progressPercent = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;

  return (
    <section className="border-b border-slate-800 p-4">
      <h2 className="text-sm font-semibold text-slate-200">{text.executionTitle}</h2>
      <p className={`mt-1 text-xs ${currentModel ? "text-slate-400" : "text-amber-300"}`}>
        {currentModel ? text.executionModel(currentModel.name) : text.executionNoModel}
      </p>
      {execution.unmatchedClassCount > 0 && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
          {text.executionUnmatched(execution.unmatchedClassCount)}
        </p>
      )}
      <button
        className="mt-3 w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!currentModel || !hasSelectedImage || progress.isRunning}
        type="button"
        onClick={() => void execution.runSingle()}
      >
        {text.singleRun}
      </button>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
        <input
          checked={forceOverwrite}
          disabled={progress.isRunning}
          type="checkbox"
          onChange={(event) => setForceOverwrite(event.target.checked)}
        />
        {text.forceOverwrite}
      </label>
      <p className="mt-1 text-xs leading-5 text-slate-500">{text.batchDefaultHint}</p>
      {progress.isRunning && progress.operation === "batch" ? (
        <button
          className="mt-3 w-full rounded border border-amber-500/60 px-3 py-2 text-sm font-medium text-amber-200 disabled:opacity-50"
          disabled={progress.cancelRequested}
          type="button"
          onClick={execution.cancel}
        >
          {text.cancelBatch}
        </button>
      ) : (
        <button
          className="mt-3 w-full rounded border border-sky-500/60 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!currentModel || progress.isRunning}
          type="button"
          onClick={() => void execution.runBatch(forceOverwrite)}
        >
          {text.batchRun}
        </button>
      )}
      {(progress.total > 0 || progress.message) && (
        <div className="mt-3" aria-live="polite">
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
          {progress.message && <p className="mt-2 text-xs text-slate-300">{progress.message}</p>}
        </div>
      )}
    </section>
  );
}
