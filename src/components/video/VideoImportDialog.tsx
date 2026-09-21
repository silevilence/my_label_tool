import { Overlay } from "../overlay/Overlay";
import type { VideoExtractionSettings } from "../../types/project-settings";
import { validExtraction } from "../../lib/project-settings";
import { VideoExtractionFields } from "./VideoExtractionFields";
import { useState } from "react";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
import { DEFAULT_PROJECT_SETTINGS } from "../../lib/defaults/video";

export function VideoImportDialog({
  defaultSettings = DEFAULT_PROJECT_SETTINGS.videoExtraction,
  busy,
  sourcePath,
  onImport,
  onCancel,
  onClose,
}: {
  defaultSettings?: VideoExtractionSettings;
  busy: boolean;
  sourcePath?: string;
  onImport: (interval: VideoExtractionSettings) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [interval, setInterval] = useState(defaultSettings);
  return (
    <Overlay operationFeedback onClose={onClose} canDismiss={!busy} label={text.add}>
      <section
        aria-label={text.add}
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <h2 className="text-base font-semibold">{sourcePath ? text.prepare : text.add}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{text.importDescription}</p>
        {sourcePath && <p className="mt-3 break-all text-xs text-slate-300">{sourcePath}</p>}
        <div className="mt-4">
          <VideoExtractionFields value={interval} onChange={setInterval} disabled={busy} />
        </div>
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
            disabled={busy || !validExtraction(interval)}
            onClick={() => onImport(interval)}
          >
            {sourcePath ? text.prepare : text.add}
          </button>
        </div>
      </section>
    </Overlay>
  );
}
