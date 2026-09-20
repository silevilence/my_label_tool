import type { CSSProperties } from "react";
import type { FrameSummary } from "../../lib/video-frames";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
export function VideoTimeline({
  frames,
  currentIndex,
  totalFrames,
  disabled = false,
  onSelectFrame,
}: {
  frames: FrameSummary[];
  currentIndex: number;
  totalFrames: number;
  disabled?: boolean;
  onSelectFrame: (index: number) => void;
}) {
  const current = frames[currentIndex];
  if (!current) return null;
  return (
    <section
      aria-label={text.timeline}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800 bg-slate-900 px-4 py-3 text-xs"
    >
      <span className="shrink-0 tabular-nums">
        {text.position(current.frameIndex + 1, totalFrames)}
      </span>
      <div className="relative min-w-16 flex-1 pt-3">
        <div
          aria-label={text.distribution}
          className="absolute inset-x-0 top-0 flex h-2 overflow-hidden rounded bg-slate-700"
        >
          {frames.map((frame) => (
            <span
              key={frame.path}
              title={text.frameStatus(frame.frameIndex + 1, frame.annotated, frame.keyframe)}
              data-frame-path={frame.path}
              data-annotated={frame.annotated}
              data-keyframe={frame.keyframe}
              className={`relative min-w-0 flex-1 ${frame.annotated ? "bg-sky-500" : "bg-slate-700"}`}
            >
              {frame.keyframe && <span className="absolute inset-y-0 left-1/2 w-1 bg-amber-300" />}
            </span>
          ))}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 bg-white"
            style={
              {
                "--playhead-position": `${((currentIndex + 0.5) / frames.length) * 100}%`,
                left: "clamp(0px, calc(var(--playhead-position) - 1px), calc(100% - 2px))",
              } as CSSProperties
            }
          />
        </div>
        <input
          type="range"
          aria-label={text.timeline}
          min={0}
          max={frames.length - 1}
          step={1}
          value={currentIndex}
          disabled={disabled || frames.length < 2}
          aria-valuetext={text.position(current.frameIndex + 1, totalFrames)}
          className="block w-full accent-sky-400"
          onChange={(event) => {
            const index = Number(event.target.value);
            if (frames[index] && !disabled) onSelectFrame(index);
          }}
        />
      </div>
      <span className="shrink-0 tabular-nums">{text.time(current.timestampSeconds)}</span>
      <span className="shrink-0 text-slate-400">
        {text.frames(frames.length)} · {text.distributionLegend}
      </span>
    </section>
  );
}
