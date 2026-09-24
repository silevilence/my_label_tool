import { beforeEach, describe, expect, it } from "vitest";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import { useAnnotationStore } from "../store/useAnnotationStore";
import {
  applyScriptPreview,
  createScriptSnapshot,
  formatScriptReport,
  prepareScriptResults,
} from "./script-execution";
import { parseNativeJsonImport } from "./importers";

const labels: LabelConfig[] = [{ id: "car", name: "车辆", shapeType: "rect", color: "#fff" }];
const shape: AnnotationShape = {
  id: "box",
  type: "rect",
  labelId: "car",
  points: [1, 2, 3, 4],
  frameIndex: 0,
};
beforeEach(() => {
  useAnnotationStore.setState({
    images: [
      { path: "a", name: "a.png" },
      { path: "b", name: "b.png" },
      { path: "c", name: "c.png" },
    ],
    selectedPath: "a",
    scopeStack: [{ kind: "project" }],
    frameIndices: {},
    annotationsByImage: { a: [structuredClone(shape)], b: [structuredClone(shape)] },
    selectedShapeId: "box",
    undoStack: [],
    redoStack: [],
    canUndo: false,
    canRedo: false,
  });
});

describe("script transaction", () => {
  it("does not create history for reordered attributes or an explicit default frame", () => {
    const original: AnnotationShape = {
      id: "box",
      type: "rect",
      labelId: "car",
      points: [1, 2, 3, 4],
      attributes: { z: 1, a: 2 },
    };
    useAnnotationStore.setState({ annotationsByImage: { a: [original] } });
    const snapshot = createScriptSnapshot(labels);
    const preview = prepareScriptResults(snapshot, [
      { imagePath: "a", annotations: [{ ...original, attributes: { a: 2, z: 1 }, frameIndex: 0 }] },
    ]);
    expect(preview.report.changed).toBe(0);
    applyScriptPreview(preview, labels, "noop");
    expect(useAnnotationStore.getState().undoStack).toEqual([]);
    expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([original]);
  });
  it("snapshots the scope top without dimensions and does not alias the store", () => {
    useAnnotationStore.getState().pushScope({ kind: "search", ids: ["b", "a"], label: "搜索" });
    const snapshot = createScriptSnapshot(labels);
    expect(snapshot.images.map((i) => i.path)).toEqual(["b", "a"]);
    expect(snapshot.images[0].size).toBeUndefined();
    snapshot.images[0].annotations[0].points[0] = 99;
    expect(useAnnotationStore.getState().annotationsByImage.b[0].points[0]).toBe(1);
  });
  it("validates all results before writing and reports adds/removes/changes/skips", () => {
    const snapshot = createScriptSnapshot(labels);
    const preview = prepareScriptResults(
      snapshot,
      [
        {
          imagePath: "a",
          annotations: [
            { ...shape, points: [4, 3, 2, 1] },
            { type: "rect", labelId: "car", points: [0, 0, 1, 1] },
          ],
        },
        { imagePath: "b", annotations: [] },
      ],
      () => "new",
    );
    expect(preview.report).toEqual({
      images: 3,
      submitted: 2,
      added: 1,
      removed: 1,
      changed: 1,
      skipped: 1,
    });
    expect(formatScriptReport(preview.report)).toContain("跳过 1 张");
    expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([shape]);
    applyScriptPreview(preview, labels, "run1");
    expect(useAnnotationStore.getState().undoStack).toHaveLength(1);
    expect(useAnnotationStore.getState().annotationsByImage.b).toEqual([]);
    useAnnotationStore.getState().undo();
    expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([shape]);
    expect(useAnnotationStore.getState().annotationsByImage.b).toEqual([shape]);
    useAnnotationStore.getState().redo();
    expect(useAnnotationStore.getState().annotationsByImage.a).toHaveLength(2);
    expect(useAnnotationStore.getState().annotationsByImage.b).toHaveLength(0);
    // Existing native save payload and reload preserve the script result.
    const saved = JSON.stringify({ labels, images: createScriptSnapshot(labels).images });
    expect(parseNativeJsonImport(saved).images[0].annotations).toEqual(
      useAnnotationStore.getState().annotationsByImage.a,
    );
  });
  it("keeps existing batch undo per-image and prunes deleted images from script history", () => {
    const store = useAnnotationStore.getState();
    store.insertAnnotationsBatch(
      [
        { imagePath: "a", annotations: [] },
        { imagePath: "b", annotations: [] },
      ],
      "replace",
    );
    store.undo();
    expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([]);
    expect(useAnnotationStore.getState().annotationsByImage.b).toEqual([shape]);
    const preview = prepareScriptResults(createScriptSnapshot(labels), [
      { imagePath: "a", annotations: [shape] },
      { imagePath: "b", annotations: [] },
    ]);
    applyScriptPreview(preview, labels, "script");
    store.removeImage("a");
    store.undo();
    expect(useAnnotationStore.getState().annotationsByImage.a).toBeUndefined();
    expect(useAnnotationStore.getState().annotationsByImage.b).toEqual([shape]);
    store.redo();
    expect(useAnnotationStore.getState().annotationsByImage.b).toEqual([]);
  });
  it("rejects stale annotations, scope and labels before applying", () => {
    const preview = prepareScriptResults(createScriptSnapshot(labels), [
      { imagePath: "a", annotations: [] },
    ]);
    expect(() => applyScriptPreview(preview, [], "run")).toThrow("已变化");
    useAnnotationStore.getState().pushScope({ kind: "search", ids: ["a"], label: "a" });
    expect(() => applyScriptPreview(preview, labels, "run")).toThrow("已变化");
    useAnnotationStore.getState().popScope();
    useAnnotationStore.getState().clearImageAnnotations("b");
    expect(() => applyScriptPreview(preview, labels, "run")).toThrow("已变化");
  });
  it("does not treat object property ordering as a change", () => {
    const reordered = {
      points: [1, 2, 3, 4],
      labelId: "car",
      type: "rect",
      frameIndex: 0,
      id: "box",
    };
    const preview = prepareScriptResults(createScriptSnapshot(labels), [
      { imagePath: "a", annotations: [reordered] },
    ]);
    expect(preview.report.changed).toBe(0);
    applyScriptPreview(preview, labels, "noop");
    expect(useAnnotationStore.getState().undoStack).toHaveLength(0);
  });
  it("aggregates failures and agrees with native core constraints", () => {
    const snapshot = createScriptSnapshot(labels);
    for (const invalid of [
      { ...shape, labelId: "missing" },
      { ...shape, points: [] },
      { ...shape, points: [NaN, 2, 3, 4] },
      { ...shape, type: "point" },
    ]) {
      expect(() =>
        prepareScriptResults(snapshot, [{ imagePath: "a", annotations: [invalid] }]),
      ).toThrow();
      expect(() =>
        parseNativeJsonImport(
          JSON.stringify({ labels, images: [{ name: "a.png", annotations: [invalid] }] }),
        ),
      ).toThrow();
    }
    for (const invalid of [
      { ...shape, id: "" },
      { ...shape, attributes: { x: null } },
      { ...shape, frameIndex: -1 },
    ])
      expect(() =>
        prepareScriptResults(snapshot, [{ imagePath: "a", annotations: [invalid] }]),
      ).toThrow();
    expect(() =>
      prepareScriptResults(snapshot, [{ imagePath: "outside", annotations: [] }]),
    ).toThrow("outside");
    expect(() =>
      prepareScriptResults(snapshot, [{ imagePath: "a", annotations: [shape, shape] }]),
    ).toThrow();
    expect(() =>
      prepareScriptResults(snapshot, [
        { imagePath: "a", annotations: [] },
        { imagePath: "a", annotations: [] },
      ]),
    ).toThrow();
    expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([shape]);
  });
});
