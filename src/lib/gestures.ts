import type { AnnotationShapeType } from "../types/annotation";
import type { InteractionMode } from "../components/canvas/types";
export type GestureIntent =
  "draw-rect" | "draw-polygon" | "draw-point" | "select" | "pan" | "context";
export function resolveGesture(
  event: {
    button: number;
    buttons?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    phase?: "drag";
  },
  ctx: { mode: InteractionMode; shapeType: AnnotationShapeType; hit: boolean; spacePan?: boolean },
): GestureIntent | null {
  // 按住空格：左键/中键一律平移（拖拽阶段除外，由图形拖拽守卫自行处理）。
  if (ctx.spacePan && event.phase !== "drag" && (event.button === 0 || event.button === 1))
    return "pan";
  const mode = event.ctrlKey ? "annotate" : event.shiftKey ? "select" : ctx.mode;
  if (event.phase === "drag")
    return event.button === 0 &&
      (event.buttons === undefined || event.buttons === 0 || event.buttons === 1) &&
      mode === "default" &&
      ctx.hit
      ? "select"
      : null;
  // 中键按下即进入平移：拖拽平移画布；无位移的单击经 pan 开始/结束路径等效取消草稿。
  if (event.button === 1) return "pan";
  if (event.button === 2) return mode === "annotate" ? "pan" : "context";
  if (event.button !== 0) return null;
  if (mode === "select" || (mode === "default" && ctx.hit)) return "select";
  return `draw-${ctx.shapeType}`;
}

// 空格平移门禁：与快捷键/草稿键盘一致的三重裁决（遮罩栈、可编辑焦点、操作互斥）。
export function shouldPanWithSpace(
  event: { key: string; repeat: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  ctx: { editableTarget: boolean; overlayDepth: number; operationAvailable: boolean },
): boolean {
  return (
    event.key === " " &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !ctx.editableTarget &&
    ctx.overlayDepth === 0 &&
    ctx.operationAvailable
  );
}
