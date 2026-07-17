import { describe, expect, it } from "vitest";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import {
  analyzeLabelTemplateChange,
  applyLabelTemplateChange,
  formatLabelTemplateChange,
  hasDanglingLabels,
} from "./label-template-sync";

function label(id: string, name: string): LabelConfig {
  return { id, name, color: "#fff", shapeType: "any" };
}

const annotationsByImage: Record<string, AnnotationShape[]> = {
  "a.jpg": [
    { id: "a1", type: "rect", labelId: "person", points: [1, 2, 3, 4] },
    { id: "a2", type: "point", labelId: "deleted", points: [1, 2] },
  ],
};

describe("label template sync", () => {
  it("analyzes added, deleted, remapped, renamed and reordered labels", () => {
    const before = [label("person", "Person"), label("deleted", "Deleted"), label("old-car", "Car")];
    const after = [label("new-car", "Car"), label("person", "Human"), label("new", "New")];

    const change = analyzeLabelTemplateChange(before, after, annotationsByImage);

    expect(change.added.map((item) => item.id)).toEqual(["new"]);
    expect(change.deleted).toEqual([{ label: before[1], count: 1 }]);
    expect(change.remapped).toEqual([{ from: before[2], to: after[0], count: 0 }]);
    expect(change.renamed).toEqual([{ from: before[0], to: after[1], count: 1 }]);
    expect(change.reordered).toBe(true);
  });

  it("applies remaps once and removes deleted label annotations", () => {
    const change = analyzeLabelTemplateChange(
      [label("person", "Person"), label("deleted", "Deleted")],
      [label("new-person", "Person")],
      annotationsByImage,
    );

    expect(applyLabelTemplateChange(annotationsByImage, change)).toEqual({
      "a.jpg": [{ id: "a1", type: "rect", labelId: "new-person", points: [1, 2, 3, 4] }],
    });
  });

  it("formats empty and dangerous changes for confirmation UI", () => {
    expect(formatLabelTemplateChange({ added: [], ambiguousNames: [], deleted: [], remapped: [], renamed: [], reordered: false })).toBe("");

    const change = analyzeLabelTemplateChange([label("a", "A")], [label("b", "B")], {
      "a.jpg": [{ id: "1", type: "rect", labelId: "a", points: [0, 0, 1, 1] }],
    });
    expect(formatLabelTemplateChange(change)).toContain("删除标签：A（1 个标注）");
  });

  it("detects ambiguous same-name remaps and dangling labels", () => {
    const change = analyzeLabelTemplateChange(
      [label("old", "Thing")],
      [label("new-1", "Thing"), label("new-2", "thing")],
      {},
    );

    expect(change.ambiguousNames).toEqual(["Thing"]);
    expect(hasDanglingLabels(annotationsByImage, [label("person", "Person")])).toBe(true);
    expect(hasDanglingLabels(annotationsByImage, [label("person", "Person"), label("deleted", "Deleted")])).toBe(false);
  });
});
