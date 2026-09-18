import { useEffect, useState } from "react";
import type { useProjectSettings } from "../../hooks/useProjectSettings";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
import { MAX_FRAME_INTERVAL } from "../../lib/defaults/video";
import { validFrameInterval } from "../../lib/project-settings";

export function ProjectVideoSettings({
  folder,
  model,
}: {
  folder: string;
  model: ReturnType<typeof useProjectSettings>;
}) {
  const savedInterval = model.settings.videoExtraction.frameInterval;
  const [interval, setInterval] = useState(savedInterval);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setInterval(savedInterval);
    setSaved(false);
  }, [folder, savedInterval]);
  return (
    <section className="mt-4 rounded border border-slate-800 p-3">
      <h3 className="text-sm font-medium text-slate-100">{text.projectSettings}</h3>
      <p className="mt-2 text-xs text-slate-400">
        {folder ? text.defaultExtractionHint : text.settingsNeedProject}
      </p>
      <label className="mt-3 block text-sm text-slate-200">
        {text.defaultInterval}
        <input
          aria-label={text.defaultInterval}
          type="number"
          min={1}
          max={MAX_FRAME_INTERVAL}
          step={1}
          value={interval}
          disabled={!folder || model.loading || model.saving}
          onChange={(event) => {
            setInterval(Number(event.target.value));
            setSaved(false);
          }}
          className="ml-3 w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1"
        />
      </label>
      {model.error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {model.error}
        </p>
      )}
      <button
        type="button"
        disabled={!folder || model.loading || model.saving || !validFrameInterval(interval)}
        onClick={() => void model.save(interval).then(setSaved)}
        className="mt-3 rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
      >
        {model.saving ? text.savingSettings : text.saveSettings}
      </button>
      {saved && (
        <span role="status" className="ml-3 text-xs text-emerald-300">
          {text.settingsSaved}
        </span>
      )}
    </section>
  );
}
