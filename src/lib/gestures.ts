import type { AnnotationShapeType } from "../types/annotation";
import type { InteractionMode } from "../components/canvas/types";
export type GestureIntent =
  "draw-rect" | "draw-polygon" | "draw-point" | "select" | "pan" | "context" | "cancel";
export function resolveGesture(
  event: {
    button: number;
    buttons?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    phase?: "drag";
  },
  ctx: { mode: InteractionMode; shapeType: AnnotationShapeType; hit: boolean },
): GestureIntent | null {
  const mode = event.ctrlKey ? "annotate" : event.shiftKey ? "select" : ctx.mode;
  if (event.phase === "drag")
    return event.button === 0 &&
      (event.buttons === undefined || event.buttons === 0 || event.buttons === 1) &&
      mode === "default" &&
      ctx.hit
      ? "select"
      : null;
  if (event.button === 1) return "cancel";
  if (event.button === 2) return mode === "annotate" ? "pan" : "context";
  if (event.button !== 0) return null;
  if (mode === "select" || (mode === "default" && ctx.hit)) return "select";
  return `draw-${ctx.shapeType}`;
}
