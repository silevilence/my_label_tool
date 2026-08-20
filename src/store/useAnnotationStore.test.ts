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

  it("inserts batch results as one undo transaction per image", () => {
    useAnnotationStore.getState().replaceAnnotations({ "a.jpg": [rect] });
    const a2 = { ...rect, id: "a2" };
    const b1 = { ...rect, id: "b1" };

    useAnnotationStore.getState().insertAnnotationsBatch(
      [
        { imagePath: "a.jpg", annotations: [a2] },
        { imagePath: "b.jpg", annotations: [b1] },
      ],
      "append",
    );

    expect(useAnnotationStore.getState().annotationsByImage).toMatchObject({
      "a.jpg": [rect, a2],
      "b.jpg": [b1],
    });
    useAnnotationStore.getState().undo();
    expect(useAnnotationStore.getState().annotationsByImage["b.jpg"]).toEqual([]);
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([rect, a2]);
    useAnnotationStore.getState().undo();
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([rect]);
  });

  it("replaces existing annotations in batch overwrite mode", () => {
    useAnnotationStore.getState().replaceAnnotations({ "a.jpg": [rect] });
    const generated = { ...rect, id: "generated" };

    useAnnotationStore
      .getState()
      .insertAnnotationsBatch([{ imagePath: "a.jpg", annotations: [generated] }], "replace");

    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([generated]);
    useAnnotationStore.getState().undo();
    expect(useAnnotationStore.getState().annotationsByImage["a.jpg"]).toEqual([rect]);
  });

  it("preserves unrelated selection and restores removed selection on undo", () => {
    const selected = { ...rect, id: "selected" };
    useAnnotationStore.getState().replaceAnnotations({ "a.jpg": [selected], "b.jpg": [] });
    useAnnotationStore.getState().selectShape(selected.id);

    useAnnotationStore.getState().insertAnnotationsBatch(
      [{ imagePath: "b.jpg", annotations: [{ ...rect, id: "b" }] }],
      "append",
    );
    expect(useAnnotationStore.getState().selectedShapeId).toBe(selected.id);

    useAnnotationStore
      .getState()
      .insertAnnotationsBatch([{ imagePath: "a.jpg", annotations: [] }], "replace");
    expect(useAnnotationStore.getState().selectedShapeId).toBeNull();
    useAnnotationStore.getState().undo();
    expect(useAnnotationStore.getState().selectedShapeId).toBe(selected.id);
  });

  it("keeps a batch larger than the normal history limit fully undoable", () => {
    const entries = Array.from({ length: 105 }, (_, index) => ({
      imagePath: `${index}.jpg`,
      annotations: [{ ...rect, id: `generated-${index}` }],
    }));

    useAnnotationStore.getState().insertAnnotationsBatch(entries, "append");
    expect(useAnnotationStore.getState().undoStack).toHaveLength(105);

    for (let index = 0; index < entries.length; index += 1) {
      useAnnotationStore.getState().undo();
    }
    expect(
      Object.values(useAnnotationStore.getState().annotationsByImage).every(
        (annotations) => annotations.length === 0,
      ),
    ).toBe(true);
    expect(useAnnotationStore.getState().canUndo).toBe(false);
  });

  it("keeps repeated chunks from one large inference task in the same history group", () => {
    const entries = Array.from({ length: 112 }, (_, index) => ({
      imagePath: `chunked-${index}.jpg`,
      annotations: [{ ...rect, id: `chunked-${index}` }],
    }));
    const taskGroupId = "inference-task";

    for (let index = 0; index < entries.length; index += 8) {
      useAnnotationStore
        .getState()
        .insertAnnotationsBatch(entries.slice(index, index + 8), "append", taskGroupId);
    }
    expect(useAnnotationStore.getState().undoStack).toHaveLength(112);

    for (let index = 0; index < entries.length; index += 1) {
      useAnnotationStore.getState().undo();
    }
    expect(useAnnotationStore.getState().canUndo).toBe(false);
  });
});
