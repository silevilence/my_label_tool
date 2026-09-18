import { useEffect, useRef } from "react";
import { ProjectVideoSettings } from "./ProjectVideoSettings";
import type { useProjectSettings } from "../../hooks/useProjectSettings";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function ProjectSettingsDialog({
  folder,
  model,
  pendingCount,
  onBatch,
  onClose,
}: {
  folder: string;
  model: ReturnType<typeof useProjectSettings>;
  pendingCount: number;
  onBatch?: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-6"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !model.saving) onClose();
        if (event.key === "Tab") {
          const elements = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              ":is(button, input, select):not(:disabled)",
            ),
          ];
          const index = elements.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          const next =
            index < 0
              ? event.shiftKey
                ? elements.length - 1
                : 0
              : (index + (event.shiftKey ? elements.length - 1 : 1)) % elements.length;
          elements[next]?.focus();
        }
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={text.projectSettings}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{text.projectSettings}</h2>
          <button
            type="button"
            disabled={model.saving}
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
          >
            {text.close}
          </button>
        </header>
        <p className="mt-2 break-all text-xs text-slate-400">{folder}</p>
        <ProjectVideoSettings folder={folder} model={model} />
        <section className="mt-4 rounded border border-slate-800 p-3">
          <p className="text-sm text-slate-200">{text.pendingVideos(pendingCount)}</p>
          <p className="mt-2 text-xs text-slate-400">{text.batchSettingsHint}</p>
          <button
            type="button"
            disabled={!onBatch || model.saving || model.loading || !!model.error}
            onClick={onBatch}
            className="mt-3 rounded bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {text.batchPrepare}
          </button>
        </section>
      </section>
    </div>
  );
}
