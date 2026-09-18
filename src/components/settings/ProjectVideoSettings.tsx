import { useEffect, useState } from "react";
import type { useProjectSettings } from "../../hooks/useProjectSettings";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
import { VideoExtractionFields } from "../video/VideoExtractionFields";
import type { VideoExtractionSettings } from "../../types/project-settings";
import { validExtraction } from "../../lib/project-settings";

export function ProjectVideoSettings({
  folder,
  model,
}: {
  folder: string;
  model: ReturnType<typeof useProjectSettings>;
}) {
  const savedInterval = model.settings.videoExtraction;
  const [interval, setInterval] = useState(savedInterval);
  const [saved, setSaved] = useState<{ folder: string; interval: VideoExtractionSettings } | null>(
    null,
  );
  useEffect(() => {
    setInterval(savedInterval);
  }, [folder, savedInterval]);
  useEffect(() => setSaved(null), [folder]);
  return (
    <section className="mt-4 rounded border border-slate-800 p-3">
      <h3 className="text-sm font-medium text-slate-100">{text.extractionDefaults}</h3>
      <p className="mt-2 text-xs text-slate-400">
        {folder ? text.defaultExtractionHint : text.settingsNeedProject}
      </p>
      <div className="mt-4">
        <VideoExtractionFields
          value={interval}
          disabled={!folder || model.loading || model.saving}
          onChange={(value) => {
            setInterval(value);
            setSaved(null);
          }}
        />
      </div>
      {model.error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {model.error}
        </p>
      )}
      <button
        type="button"
        disabled={!folder || model.loading || model.saving || !validExtraction(interval)}
        onClick={() => {
          setSaved(null);
          void model.save(interval).then((success) => {
            if (success) setSaved({ folder, interval });
          });
        }}
        className="mt-3 rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
      >
        {model.saving ? text.savingSettings : text.saveSettings}
      </button>
      {saved?.folder === folder && saved.interval === interval && !model.saving && !model.error && (
        <span role="status" className="ml-3 text-xs text-emerald-300">
          {text.settingsSaved}
        </span>
      )}
    </section>
  );
}
