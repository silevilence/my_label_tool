import { useState } from "react";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function VideoImportBar({
  busy,
  disabled,
  onImport,
  onCancel,
}: {
  busy: boolean;
  disabled: boolean;
  onImport: (interval: number) => void;
  onCancel: () => void;
}) {
  const [interval, setInterval] = useState(30);
  return (
    <div className="flex items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-sm">
      <label className="flex items-center gap-2">
        {text.interval}
        <input
          aria-label={text.interval}
          type="number"
          min={1}
          max={1_000_000}
          step={1}
          value={interval}
          disabled={busy || disabled}
          onChange={(event) => setInterval(Number(event.target.value))}
          className="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1"
        />
      </label>
      <button
        disabled={
          busy ||
          disabled ||
          !Number.isSafeInteger(interval) ||
          interval < 1 ||
          interval > 1_000_000
        }
        onClick={() => onImport(interval)}
        className="rounded bg-sky-700 px-3 py-1 disabled:opacity-40"
      >
        {text.open}
      </button>
      {busy && (
        <>
          <span role="status">{text.importing}</span>
          <button onClick={onCancel}>{text.cancel}</button>
        </>
      )}
    </div>
  );
}
