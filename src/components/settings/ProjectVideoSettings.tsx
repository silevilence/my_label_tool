import { useEffect, useState } from "react";
import type { useProjectSettings } from "../../hooks/useProjectSettings";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
import { VideoExtractionFields } from "../video/VideoExtractionFields";
import type { VideoExtractionSettings } from "../../types/project-settings";
import { validExtraction } from "../../lib/project-settings";

export function ProjectVideoSettings({
  folder,
  model,
  onUnsavedChange,
}: {
  folder: string;
  model: ReturnType<typeof useProjectSettings>;
  onUnsavedChange?: (dirty: boolean) => void;
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
  const unsaved =
    folder !== "" && !model.loading && JSON.stringify(interval) !== JSON.stringify(savedInterval);
  useEffect(() => {
    onUnsavedChange?.(unsaved);
  }, [onUnsavedChange, unsaved]);

  function saveCurrent() {
    setSaved(null);
    void model.save(interval).then((success) => {
      if (success) setSaved({ folder, interval });
    });
  }
  return (
    <section className="mt-4 rounded border border-slate-800 p-3">
      <h3 className="text-sm font-medium text-slate-100">{text.extractionDefaults}</h3>
      <p className="mt-2 text-xs text-slate-400">
        {folder ? text.defaultExtractionHint : text.settingsNeedProject}
      </p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          saveCurrent();
        }}
        onKeyDown={(event) => {
          // 设置表单 Enter 提交：输入框内回车等效点击主提交按钮。
          if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
            event.preventDefault();
            saveCurrent();
          }
        }}
      >
        <VideoExtractionFields
          value={interval}
          disabled={!folder || model.loading || model.saving}
          onChange={(value) => {
            setInterval(value);
            setSaved(null);
          }}
        />
        {model.error && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {model.error}
          </p>
        )}
        {unsaved && <p className="mt-2 text-xs text-amber-300">{text.unsavedExtractionSettings}</p>}
        <button
          type="button"
          disabled={!folder || model.loading || model.saving || !validExtraction(interval)}
          onClick={saveCurrent}
          className="mt-3 rounded bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-40"
        >
          {model.saving ? text.savingSettings : text.saveSettings}
        </button>
        {saved?.folder === folder &&
          saved.interval === interval &&
          !model.saving &&
          !model.error && (
            <span role="status" className="ml-3 text-xs text-emerald-300">
              {text.settingsSaved}
            </span>
          )}
      </form>
    </section>
  );
}
