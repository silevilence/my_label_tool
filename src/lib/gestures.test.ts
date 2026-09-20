import { describe, expect, it } from "vitest";
import { resolveGesture, shouldPanWithSpace } from "./gestures";
import { reduceDraft, finishDraft, type Draft } from "./draft-gesture";
import { createTransform } from "../components/canvas/transform";
describe("canvas gesture seam", () => {
  it("classifies every mode, shape, button and hit combination", () => {
    for (const mode of ["default", "select", "annotate"] as const)
      for (const shapeType of ["rect", "polygon", "point"] as const)
        for (const hit of [false, true]) {
          const ctx = { mode, shapeType, hit };
          expect(resolveGesture({ button: 0 }, ctx)).toBe(
            mode === "select" || (mode === "default" && hit) ? "select" : `draw-${shapeType}`,
          );
          expect(resolveGesture({ button: 1 }, ctx)).toBe("pan");
          expect(resolveGesture({ button: 2 }, ctx)).toBe(mode === "annotate" ? "pan" : "context");
          expect(resolveGesture({ button: 3 }, ctx)).toBeNull();
          expect(resolveGesture({ button: 0, phase: "drag" }, ctx)).toBe(
            mode === "default" && hit ? "select" : null,
          );
        }
    const ctx = { mode: "default", shapeType: "rect", hit: true } as const;
    expect(resolveGesture({ button: 0, ctrlKey: true, shiftKey: true }, ctx)).toBe("draw-rect");
    expect(resolveGesture({ button: 0, shiftKey: true }, ctx)).toBe("select");
    expect(resolveGesture({ button: 0, buttons: 4, phase: "drag" }, ctx)).toBeNull();
    expect(resolveGesture({ button: 2, phase: "drag" }, ctx)).toBeNull();
    expect(resolveGesture({ button: 0, buttons: 1, phase: "drag" }, ctx)).toBe("select");
  });
  it("resolves space-held left and middle buttons to pan without touching the drag phase", () => {
    for (const mode of ["default", "select", "annotate"] as const) {
      const ctx = { mode, shapeType: "rect" as const, hit: false, spacePan: true };
      expect(resolveGesture({ button: 0 }, ctx)).toBe("pan");
      expect(resolveGesture({ button: 1 }, ctx)).toBe("pan");
      expect(resolveGesture({ button: 0, phase: "drag" }, ctx)).toBeNull();
    }
  });
  it("gates space panning on modifiers, overlays, editable targets and busy operations", () => {
    const base = { key: " ", repeat: false, ctrlKey: false, altKey: false, metaKey: false };
    const ctx = { editableTarget: false, overlayDepth: 0, operationAvailable: true };
    expect(shouldPanWithSpace(base, ctx)).toBe(true);
    expect(shouldPanWithSpace({ ...base, repeat: true }, ctx)).toBe(false);
    expect(shouldPanWithSpace({ ...base, key: "a" }, ctx)).toBe(false);
    expect(shouldPanWithSpace({ ...base, ctrlKey: true }, ctx)).toBe(false);
    expect(shouldPanWithSpace({ ...base, altKey: true }, ctx)).toBe(false);
    expect(shouldPanWithSpace(base, { ...ctx, editableTarget: true })).toBe(false);
    expect(shouldPanWithSpace(base, { ...ctx, overlayDepth: 1 })).toBe(false);
    expect(shouldPanWithSpace(base, { ...ctx, operationAvailable: false })).toBe(false);
  });
  it("commits original-pixel drafts, rejects tiny shapes, and cancels every state", () => {
    const idle: Draft = { kind: "idle" };
    expect(reduceDraft(idle, { type: "update", point: { x: 1, y: 2 } })).toBe(idle);
    expect(reduceDraft(idle, { type: "undo" })).toBe(idle);
    expect(finishDraft(idle)).toBeNull();
    expect(reduceDraft(idle, { type: "interrupt" })).toBe(idle);
    for (const intent of ["draw-rect", "draw-polygon", "draw-point", "pan"] as const) {
      const draft = reduceDraft(idle, { type: "start", intent, point: { x: 10, y: 20 } });
      expect(reduceDraft(draft, { type: "cancel" })).toEqual(idle);
      expect(reduceDraft(draft, { type: "interrupt" }).kind).toBe(
        intent === "draw-rect" ? "idle" : draft.kind,
      );
      if (intent === "draw-point")
        expect(finishDraft(draft)).toEqual({ type: "point", points: [10, 20] });
      else expect(finishDraft(draft)).toBeNull();
    }
    let rect = reduceDraft(idle, { type: "start", intent: "draw-rect", point: { x: 10, y: 20 } });
    rect = reduceDraft(rect, { type: "update", point: { x: 2, y: 3 } });
    expect(finishDraft(rect)).toEqual({ type: "rect", points: [2, 3, 8, 17] });
    let polygon = reduceDraft(idle, {
      type: "start",
      intent: "draw-polygon",
      point: { x: 0, y: 0 },
    });
    expect(reduceDraft(polygon, { type: "undo" })).toEqual(idle);
    polygon = reduceDraft(polygon, {
      type: "start",
      intent: "draw-polygon",
      point: { x: 10, y: 0 },
    });
    polygon = reduceDraft(polygon, {
      type: "start",
      intent: "draw-polygon",
      point: { x: 0, y: 10 },
    });
    polygon = reduceDraft(polygon, { type: "update", point: { x: 8, y: 8 } });
    expect(finishDraft(polygon)).toEqual({ type: "polygon", points: [0, 0, 10, 0, 0, 10] });
    expect(finishDraft(reduceDraft(polygon, { type: "undo" }))).toBeNull();
  });
  it("round-trips coordinates and preserves the zoom anchor", () => {
    for (const scale of [0.1, 1, 8]) {
      const transform = createTransform({
        x: -37,
        y: 21,
        width: 100 * scale,
        height: 50 * scale,
        scale,
      });
      const point = { x: 32, y: 18 };
      const screen = transform.toScreen(point);
      expect(transform.toImage(screen).x).toBeCloseTo(point.x);
      expect(transform.toImage(screen).y).toBeCloseTo(point.y);
      const zoomed = createTransform(transform.zoomAt(screen, scale * 2));
      expect(zoomed.toScreen(point).x).toBeCloseTo(screen.x);
      expect(zoomed.toScreen(point).y).toBeCloseTo(screen.y);
      expect(transform.toImageLength(transform.toScreenLength(42))).toBeCloseTo(42);
      expect(transform.svgTransform).toContain(`scale(${scale})`);
    }
  });
});
