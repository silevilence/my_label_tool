import type { AnnotationShape } from "../../types/annotation";
import type { ImageLayout } from "../canvas/types";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

/** Read-only overlay in the same original-pixel coordinate system as the canvas. */
export function VideoInterpolationPreview({
  shape,
  layout,
}: {
  shape: AnnotationShape;
  layout: ImageLayout;
}) {
  const points = shape.points;
  return (
    <>
      <svg
        aria-label={text.previewOverlay}
        role="img"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden text-amber-300"
      >
        <g
          transform={`translate(${layout.x} ${layout.y}) scale(${layout.scale})`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2 / layout.scale}
          strokeDasharray={`${7 / layout.scale} ${4 / layout.scale}`}
        >
          {shape.type === "rect" && (
            <rect
              x={points[0]}
              y={points[1]}
              width={points[2]}
              height={points[3]}
              fill="currentColor"
              fillOpacity={0.1}
            />
          )}
          {shape.type === "polygon" && (
            <polygon
              points={Array.from(
                { length: points.length / 2 },
                (_, index) => `${points[index * 2]},${points[index * 2 + 1]}`,
              ).join(" ")}
              fill="currentColor"
              fillOpacity={0.1}
            />
          )}
          {shape.type === "point" && (
            <circle
              cx={points[0]}
              cy={points[1]}
              r={6 / layout.scale}
              fill="currentColor"
              fillOpacity={0.25}
            />
          )}
        </g>
      </svg>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-amber-400/50 bg-slate-950/90 px-3 py-1.5 text-xs text-amber-200">
        {text.previewOverlay}
      </div>
    </>
  );
}
