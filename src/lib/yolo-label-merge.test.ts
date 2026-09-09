import { describe, expect, it } from "vitest";
import type { LabelConfig } from "../types/annotation";
import { mergeImportedLabels, remapImportedAnnotationLabels } from "./yolo-label-merge";

function label(overrides: Partial<LabelConfig> & { id: string; name: string }): LabelConfig {
  return { color: "#38bdf8", shapeType: "rect", ...overrides };
}

describe("mergeImportedLabels", () => {
  it("按名称命中时继承既有标签的 id、shortcut、color，并保持导入顺序", () => {
    const imported = [
      label({ id: "yolo-0", name: "Person" }),
      label({ id: "yolo-1", name: "car" }),
    ];
    const existing = [
      label({ id: "tpl-person", name: " person ", color: "#f97316", shortcut: "1" }),
      label({ id: "tpl-car", name: "CAR", color: "#22c55e", shortcut: "2" }),
    ];

    const result = mergeImportedLabels(imported, existing);

    expect(result.labels.map((item) => item.id)).toEqual(["tpl-person", "tpl-car"]);
    expect(result.labels.map((item) => item.shortcut)).toEqual(["1", "2"]);
    expect(result.labels.map((item) => item.color)).toEqual(["#f97316", "#22c55e"]);
    expect(result.labels.map((item) => item.name)).toEqual(["Person", "car"]);
    expect(result.matchedCount).toBe(2);
    expect(result.createdCount).toBe(0);
    expect(result.ambiguousNames).toEqual([]);
  });

  it("未命中的标签保持原样且计数正确", () => {
    const imported = [
      label({ id: "yolo-0", name: "person" }),
      label({ id: "yolo-1", name: "dog" }),
    ];
    const existing = [label({ id: "tpl-person", name: "person", shortcut: "1" })];

    const result = mergeImportedLabels(imported, existing);

    expect(result.labels[0]).toMatchObject({ id: "tpl-person", shortcut: "1" });
    expect(result.labels[1]).toMatchObject({ id: "yolo-1" });
    expect(result.labels[1].shortcut).toBeUndefined();
    expect(result.matchedCount).toBe(1);
    expect(result.createdCount).toBe(1);
  });

  it("空既有标签时全部新建", () => {
    const imported = [label({ id: "yolo-0", name: "person" })];

    const result = mergeImportedLabels(imported, []);

    expect(result.labels[0]).toMatchObject({ id: "yolo-0", name: "person" });
    expect(result.matchedCount).toBe(0);
    expect(result.createdCount).toBe(1);
  });

  it("导入内部重名时不继承，避免 id 冲突", () => {
    const imported = [
      label({ id: "yolo-0", name: "cat" }),
      label({ id: "yolo-1", name: "Cat" }),
    ];
    const existing = [label({ id: "tpl-cat", name: "cat", shortcut: "1" })];

    const result = mergeImportedLabels(imported, existing);

    expect(result.labels.map((item) => item.id)).toEqual(["yolo-0", "yolo-1"]);
    expect(result.labels[0].shortcut).toBeUndefined();
    expect(result.ambiguousNames).toEqual(["cat", "Cat"]);
    expect(result.matchedCount).toBe(0);
  });

  it("既有标签重名同键时视为歧义不继承", () => {
    const imported = [label({ id: "yolo-0", name: "cat" })];
    const existing = [
      label({ id: "tpl-cat-1", name: "cat", shortcut: "1" }),
      label({ id: "tpl-cat-2", name: "Cat", shortcut: "2" }),
    ];

    const result = mergeImportedLabels(imported, existing);

    expect(result.labels[0]).toMatchObject({ id: "yolo-0" });
    expect(result.ambiguousNames).toEqual(["cat"]);
    expect(result.matchedCount).toBe(0);
  });

  it("既有标签 shapeType 与矩形不兼容时只继承 shortcut/color，shapeType 保持 rect", () => {
    const imported = [label({ id: "yolo-0", name: "person" })];
    const existing = [
      label({ id: "tpl-point", name: "person", shapeType: "point", shortcut: "1", color: "#f00" }),
    ];

    const result = mergeImportedLabels(imported, existing);

    expect(result.labels[0]).toMatchObject({
      id: "tpl-point",
      shortcut: "1",
      color: "#f00",
      shapeType: "rect",
    });
  });

  it("既有标签 shapeType 为 any 时照常继承", () => {
    const imported = [label({ id: "yolo-0", name: "person" })];
    const existing = [
      label({ id: "tpl-any", name: "person", shapeType: "any", shortcut: "1" }),
    ];

    const result = mergeImportedLabels(imported, existing);

    expect(result.labels[0]).toMatchObject({ id: "tpl-any", shapeType: "any", shortcut: "1" });
  });
});

describe("remapImportedAnnotationLabels", () => {
  it("按导入顺序把标注 labelId 重写为合并后标签 id", () => {
    const importedLabels = [label({ id: "yolo-0", name: "person" })];
    const mergedLabels = [label({ id: "tpl-person", name: "person" })];
    const images = [
      {
        name: "a.jpg",
        annotations: [
          { id: "s1", type: "rect" as const, labelId: "yolo-0", points: [0, 0, 1, 1] },
        ],
      },
    ];

    const result = remapImportedAnnotationLabels(images, importedLabels, mergedLabels);

    expect(result[0].annotations[0].labelId).toBe("tpl-person");
    expect(images[0].annotations[0].labelId).toBe("yolo-0");
  });

  it("id 未变化时返回原数组、长度不一致时原样返回", () => {
    const importedLabels = [label({ id: "yolo-0", name: "person" })];
    const images = [{ name: "a.jpg", annotations: [] }];

    expect(remapImportedAnnotationLabels(images, importedLabels, importedLabels)).toBe(images);
    expect(
      remapImportedAnnotationLabels(images, importedLabels, [
        ...importedLabels,
        label({ id: "extra", name: "x" }),
      ]),
    ).toBe(images);
  });
});
