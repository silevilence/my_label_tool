import { Overlay } from "../overlay/Overlay";
import type { VideoBatchProgress } from "../../lib/video-import-queue";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function VideoBatchDialog({
  progress,
  onCancel,
  onClose,
}: {
  progress: VideoBatchProgress;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay
      operationFeedback
      onClose={onClose}
      canDismiss={progress.finished}
      label={text.batchPrepare}
    >
      <section
        aria-label={text.batchPrepare}
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <h2 className="font-semibold">{text.batchPrepare}</h2>
        <p role="status" className="mt-3 text-sm text-sky-300">
          {text.batchProgress(progress.completed, progress.total, progress.failures.length)}
        </p>
        {progress.total > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div
              aria-label={text.batchProgressLabel}
              aria-valuetext={text.batchProgress(
                progress.completed,
                progress.total,
                progress.failures.length,
              )}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.min(
                100,
                Math.round(
                  ((progress.completed + progress.failures.length) / progress.total) * 100,
                ),
              )}
              className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
              role="progressbar"
            >
              <div
                className="h-full bg-sky-500 transition-[width]"
                style={{
                  width: `${Math.min(100, ((progress.completed + progress.failures.length) / progress.total) * 100)}%`,
                }}
              />
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              {text.batchRemaining(progress.completed, progress.failures.length, progress.total)}
            </span>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          {progress.finished
            ? progress.cancelled
              ? text.batchCancelled
              : text.batchFinished
            : progress.source}
        </p>
        {progress.failures.length > 0 && (
          <ul className="mt-3 max-h-48 overflow-auto text-xs text-red-300">
            {progress.failures.map((failure) => (
              <li key={failure.source} className="mb-2 break-all">
                {failure.source}: {failure.message}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex justify-end">
          <button
            autoFocus
            type="button"
            onClick={progress.finished ? onClose : onCancel}
            className="rounded border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
          >
            {progress.finished ? text.close : text.cancel}
          </button>
        </div>
      </section>
    </Overlay>
  );
}
