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
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-6"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Tab") event.preventDefault();
        if (event.key === "Escape" && progress.finished) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={text.batchPrepare}
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <h2 className="font-semibold">{text.batchPrepare}</h2>
        <p role="status" className="mt-3 text-sm text-sky-300">
          {text.batchProgress(progress.completed, progress.total, progress.failures.length)}
        </p>
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
    </div>
  );
}
