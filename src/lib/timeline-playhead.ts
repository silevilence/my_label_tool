import type { CSSProperties } from "react";

const MARKER_WIDTH = 2;

export function timelinePlayheadStyle(
  index: number,
  count: number,
): CSSProperties & {
  "--playhead-left": string;
} {
  const percent = ((index + 0.5) / count) * 100;
  return {
    width: MARKER_WIDTH,
    "--playhead-left": `clamp(0px, calc(${percent}% - ${MARKER_WIDTH / 2}px), calc(100% - ${MARKER_WIDTH}px))`,
    left: "var(--playhead-left)",
  };
}
