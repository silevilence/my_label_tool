import type { AnnotationShapeType } from "../types/annotation";
export interface GesturePoint {
  x: number;
  y: number;
}
export type Draft =
  | { kind: "idle" }
  | { kind: "rect" | "point"; start: GesturePoint; current: GesturePoint }
  | {
      kind: "pan";
      start: GesturePoint;
      current: GesturePoint;
      previous: Exclude<Draft, { kind: "pan" }>;
    }
  | { kind: "polygon"; points: number[]; cursor: GesturePoint | null };
export type DraftEvent =
  | {
      type: "start";
      intent: "draw-rect" | "draw-polygon" | "draw-point" | "pan";
      point: GesturePoint;
    }
  | { type: "update"; point: GesturePoint }
  | { type: "interrupt" }
  | { type: "cancel" }
  | { type: "end-pan"; cancelDraft: boolean }
  | { type: "undo" };
export function reduceDraft(draft: Draft, event: DraftEvent): Draft {
  if (event.type === "end-pan")
    return draft.kind === "pan" ? (event.cancelDraft ? { kind: "idle" } : draft.previous) : draft;
  if (event.type === "interrupt")
    return draft.kind === "rect"
      ? { kind: "idle" }
      : draft.kind === "polygon"
        ? { ...draft, cursor: null }
        : draft;
  if (event.type === "cancel") return { kind: "idle" };
  if (event.type === "undo") {
    if (draft.kind !== "polygon") return draft;
    const points = draft.points.slice(0, -2);
    return points.length ? { kind: "polygon", points, cursor: null } : { kind: "idle" };
  }
  if (event.type === "start") {
    const { point, intent } = event;
    if (intent === "pan")
      return {
        kind: "pan",
        start: point,
        current: point,
        previous: draft.kind === "pan" ? draft.previous : draft,
      };
    if (intent === "draw-polygon")
      return {
        kind: "polygon",
        points: [...(draft.kind === "polygon" ? draft.points : []), point.x, point.y],
        cursor: point,
      };
    return {
      kind: intent === "draw-rect" ? "rect" : "point",
      start: point,
      current: point,
    };
  }
  if (draft.kind === "idle") return draft;
  return draft.kind === "polygon"
    ? { ...draft, cursor: event.point }
    : { ...draft, current: event.point };
}
export function finishDraft(draft: Draft): { type: AnnotationShapeType; points: number[] } | null {
  if (draft.kind === "idle" || draft.kind === "pan") return null;
  if (draft.kind === "polygon")
    return draft.points.length >= 6 ? { type: "polygon", points: draft.points } : null;
  if (draft.kind === "point") return { type: "point", points: [draft.start.x, draft.start.y] };
  const { start, current } = draft;
  const width = Math.abs(current.x - start.x),
    height = Math.abs(current.y - start.y);
  return width < 3 || height < 3
    ? null
    : {
        type: "rect",
        points: [Math.min(start.x, current.x), Math.min(start.y, current.y), width, height],
      };
}
