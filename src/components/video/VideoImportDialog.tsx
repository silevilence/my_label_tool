import { useState } from "react";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function VideoImportDialog({
  busy,
  sourcePath,
  onImport,
  onCancel,
  onClose,
}: {
  busy: boolean;
  sourcePath?: string;
  onImport: (interval: number) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [interval, setInterval] = useState(30);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busy) onClose();
        if (event.key === "Tab") {
          const elements = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled)",
            ),
          ];
          const first = elements[0];
          const last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={text.add}
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <h2 className="text-base font-semibold">{sourcePath ? text.prepare : text.add}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{text.importDescription}</p>
        {sourcePath && <p className="mt-3 break-all text-xs text-slate-300">{sourcePath}</p>}
        <label className="mt-4 block text-sm text-slate-300">
          {text.interval}
          <input
            autoFocus
            aria-label={text.interval}
            type="number"
            min={1}
            max={1_000_000}
            step={1}
            disabled={busy}
            value={interval}
            onChange={(event) => setInterval(Number(event.target.value))}
            className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        {busy && (
          <p role="status" className="mt-4 text-sm text-sky-300">
            {text.importing}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
            onClick={busy ? onCancel : onClose}
          >
            {busy ? text.cancel : text.close}
          </button>
          <button
            className="rounded bg-sky-500 px-3 py-2 text-sm font-medium hover:bg-sky-400 disabled:opacity-40"
            disabled={
              busy || !Number.isSafeInteger(interval) || interval < 1 || interval > 1_000_000
            }
            onClick={() => onImport(interval)}
          >
            {sourcePath ? text.prepare : text.add}
          </button>
        </div>
      </section>
    </div>
  );
}
