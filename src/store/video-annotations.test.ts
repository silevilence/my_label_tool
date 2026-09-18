import { beforeEach, expect, it } from "vitest";
import { useAnnotationStore } from "./useAnnotationStore";
import type { AnnotationShape } from "../types/annotation";
import { parseNativeJsonImport } from "../lib/importers";
const shape = (id: string, type: AnnotationShape["type"] = "rect"): AnnotationShape => ({
  id,
  type,
  labelId: "person",
  points: type === "rect" ? [1, 2, 3, 4] : type === "point" ? [1, 2] : [0, 0, 10, 0, 0, 10],
  frameIndex: 0,
});
beforeEach(() => {
  useAnnotationStore.getState().setFrameIndices({});
  useAnnotationStore.getState().replaceAnnotations({});
});
it("binds rect, polygon and point edits to the selected source frame and keeps frames isolated", () => {
  const store = useAnnotationStore.getState();
  store.setFrameIndices({ "first.png": 0, "later.png": 30 });
  store.addAnnotation("first.png", shape("first"));
  for (const type of ["rect", "polygon", "point"] as const)
    store.addAnnotation("later.png", shape(type, type));
  store.updateAnnotation("later.png", "rect", { points: [20, 20, 40, 40], frameIndex: 99 });
  expect(useAnnotationStore.getState().annotationsByImage["first.png"][0].points).toEqual([
    1, 2, 3, 4,
  ]);
  expect(
    useAnnotationStore.getState().annotationsByImage["later.png"].map((item) => item.frameIndex),
  ).toEqual([30, 30, 30]);
  store.undo();
  expect(useAnnotationStore.getState().annotationsByImage["later.png"][0].points).toEqual([
    1, 2, 3, 4,
  ]);
  store.redo();
  expect(useAnnotationStore.getState().annotationsByImage["later.png"][0].frameIndex).toBe(30);
});
it("normalizes imported and prelabel annotations and restores deleted shapes on their original frame", () => {
  const store = useAnnotationStore.getState();
  store.setFrameIndices({ "later.png": 30 });
  store.insertAnnotationsBatch(
    [{ imagePath: "later.png", annotations: [shape("prediction")] }],
    "append",
  );
  store.deleteAnnotation("later.png", "prediction");
  store.undo();
  expect(useAnnotationStore.getState().annotationsByImage["later.png"][0].frameIndex).toBe(30);
  store.replaceAnnotations({ "later.png": [shape("imported")] });
  expect(useAnnotationStore.getState().annotationsByImage["later.png"][0].frameIndex).toBe(30);
  store.setFrameIndices({ "later.png": 40 });
  expect(useAnnotationStore.getState().annotationsByImage["later.png"][0].frameIndex).toBe(40);
});
it("round-trips native JSON without losing source frame or original pixel coordinates", () => {
  const store = useAnnotationStore.getState();
  store.setFrameIndices({ "later.png": 30 });
  store.addAnnotation("later.png", shape("saved"));
  const payload = {
    labels: [{ id: "person", name: "person", color: "#123456", shapeType: "any" }],
    images: [
      {
        path: "later.png",
        name: "later.png",
        width: 64,
        height: 48,
        annotations: useAnnotationStore.getState().annotationsByImage["later.png"],
      },
    ],
  };
  const parsed = parseNativeJsonImport(JSON.stringify(payload));
  expect(parsed.images[0].annotations[0]).toMatchObject({ points: [1, 2, 3, 4], frameIndex: 30 });
  store.replaceAnnotations(
    Object.fromEntries(parsed.images.map((image) => [image.name, image.annotations])),
  );
  expect(useAnnotationStore.getState().annotationsByImage["later.png"][0].frameIndex).toBe(30);
});
it("leaves the existing image-only annotation contract unchanged", () => {
  useAnnotationStore.getState().addAnnotation("photo.png", shape("still"));
  expect(useAnnotationStore.getState().annotationsByImage["photo.png"]).toEqual([shape("still")]);
});
