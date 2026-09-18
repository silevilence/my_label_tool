import type { VideoExtractionSettings } from "../../types/project-settings";
import { MAX_EXTRACTION_FPS, MAX_FRAME_INTERVAL } from "../../lib/defaults/video";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function VideoExtractionFields({
  value,
  onChange,
  disabled = false,
}: {
  value: VideoExtractionSettings;
  onChange: (value: VideoExtractionSettings) => void;
  disabled?: boolean;
}) {
  const fps = value.mode === "fps";
  return (
    <div className="space-y-4">
      <label className="block text-sm text-slate-200">
        {text.extractionMode}
        <select
          aria-label={text.extractionMode}
          disabled={disabled}
          value={value.mode}
          onChange={(event) =>
            onChange({ ...value, mode: event.target.value as VideoExtractionSettings["mode"] })
          }
          className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        >
          <option value="fps">{text.fpsMode}</option>
          <option value="interval">{text.intervalMode}</option>
        </select>
      </label>
      <label className="block text-sm text-slate-200">
        {fps ? text.fps : text.interval}
        <input
          aria-label={fps ? text.fps : text.interval}
          type="number"
          disabled={disabled}
          min={fps ? 0.001 : 1}
          max={fps ? MAX_EXTRACTION_FPS : MAX_FRAME_INTERVAL}
          step={fps ? "any" : 1}
          value={fps ? value.fps : value.frameInterval}
          onChange={(event) =>
            onChange({ ...value, [fps ? "fps" : "frameInterval"]: Number(event.target.value) })
          }
          className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
      </label>
      <p className="text-xs leading-relaxed text-slate-400">
        {fps ? text.fpsHint : text.intervalHint}
      </p>
    </div>
  );
}
