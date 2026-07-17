import { beforeEach, describe, expect, it } from "vitest";
import { useAnnotationStore } from "./useAnnotationStore";

const rect = { id: "r1", type: "rect" as const, labelId: "person", points: [1, 2, 3, 4] };

describe("annotation store", () => {
  beforeEach(() => {
    useAnnotationStore.setState({
      annotationsByImage: {},
      selectedShapeId: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    });
  });

  it("adds, updates, deletes and clears annotations with selection changes", () => {
    const store = useAnnotationStore.getState();
    store.addAnnotation("a.jpg", rect);
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([rect]);
    expect(useAnnotationStore.getState().selectedShapeId).toBeNull();

    useAnnotationStore.getState().selectShape("r1");
    useAnnotationStore.getState().updateAnnotation("a.jpg", "r1", { points: [5, 6, 7, 8] });
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"][0].points).toEqual([5, 6, 7, 8]);

    useAnnotationStore.getState().deleteAnnotation("a.jpg", "r1");
    expect(useAnnotationStore.getState().selectedShapeId).toBeNull();
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([]);

    useAnnotationStore.getState().addAnnotation("a.jpg", rect);
    useAnnotationStore.getState().clearImageAnnotations("a.jpg");
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([]);
  });

  it("undoes and redoes the latest image history entry", () => {
    useAnnotationStore.getState().addAnnotation("a.jpg", rect);
    expect(useAnnotationStore.getState().canUndo).toBe(true);

    useAnnotationStore.getState().undo();
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([]);
    expect(useAnnotationStore.getState().canRedo).toBe(true);

    useAnnotationStore.getState().redo();
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([rect]);
    expect(useAnnotationStore.getState().canRedo).toBe(false);
  });

  it("does not add history entries for no-op updates", () => {
    useAnnotationStore.getState().addAnnotation("a.jpg", rect);
    const historyLength = useAnnotationStore.getState().undoStack.length;

    useAnnotationStore.getState().updateAnnotation("a.jpg", "missing", { labelId: "person" });

    expect(useAnnotationStore.getState().undoStack).toHaveLength(historyLength);
  });

  it("replaces all annotations and label ids without preserving undo history", () => {
    useAnnotationStore.getState().addAnnotation("a.jpg", rect);
    useAnnotationStore.getState().replaceAnnotations({
      "b.jpg": [{ ...rect, id: "r2", labelId: "old" }],
    });

    expect(useAnnotationStore.getState().canUndo).toBe(false);
    useAnnotationStore.getState().replaceLabel("old", "new");
    expect(useAnnotationStore.getState().annotationsByImage["b.jpg"][0].labelId).toBe("new");
  });
});
