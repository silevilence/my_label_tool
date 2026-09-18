import type { VideoProject } from "../../types/video";
import type { ReactNode } from "react";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function VideoTimeline({
  video,
  selectedName,
  disabled = false,
  onSelect,
  children,
}: {
  video: VideoProject;
  selectedName: string;
  disabled?: boolean;
  onSelect: (name: string) => void;
  children?: ReactNode;
}) {
  const index = video.frames.findIndex((frame) => frame.name === selectedName);
  const current = video.frames[index];
  if (!current) return null;
  return (
    <section
      aria-label={text.timeline}
      className="flex items-center gap-4 border-b border-slate-700 bg-slate-900 px-4 py-2 text-sm"
    >
      <span className="shrink-0 tabular-nums">
        {text.position(current.frameIndex + 1, video.totalFrames)}
      </span>
      <input
        type="range"
        aria-label={text.timeline}
        min={0}
        max={video.frames.length - 1}
        step={1}
        value={index}
        disabled={disabled || video.frames.length < 2}
        aria-valuetext={text.position(current.frameIndex + 1, video.totalFrames)}
        className="min-w-16 flex-1 accent-sky-400"
        onChange={(event) => {
          const frame = video.frames[Number(event.target.value)];
          if (frame && !disabled) onSelect(frame.name);
        }}
      />
      <span className="shrink-0 tabular-nums">{text.time(current.timestampSeconds)}</span>
      <span className="shrink-0 text-slate-400">{text.frames(video.frames.length)}</span>
      {children}
    </section>
  );
}
