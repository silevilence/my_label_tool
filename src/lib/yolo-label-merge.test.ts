import { describe, expect, it } from "vitest";
import type { LabelConfig } from "../types/annotation";
import { mergeImportedLabels, remapImportedAnnotationLabels } from "./yolo-label-merge";
import { parseExternalYoloImport } from "./importers";
import { exportYolo } from "./exporters/yolo";

function label(overrides: Partial<LabelConfig> & { id: string; name: string }): LabelConfig {
  return { color: "#38bdf8", shapeType: "rect", ...overrides };
}

describe("mergeImportedLabels", () => {
  it.each(["cat", "dog"])("继承 %s 的 YOLO ID 时不与未匹配类别合流", (name) => {
    const { imported } = parseExternalYoloImport(
      [
        { path: "classes.txt", name: "classes.txt", content: "cat\ndog" },
        { path: "a.txt", name: "a.txt", content: "0 0.5 0.5 0.2 0.2\n1 0.5 0.5 0.1 0.1" },
      ],
      new Map([["a", { name: "a.jpg", width: 100, height: 100 }]]),
    );
    const inheritedId = name === "cat" ? "yolo-1" : "yolo-0";
    const merged = mergeImportedLabels(imported.labels, [
      label({ id: inheritedId, name, shortcut: "1" }),
    ]);
    const images = remapImportedAnnotationLabels(imported.images, imported.labels, merged.labels);
    const exported = exportYolo({
      labels: merged.labels,
      images: images.map((image) => ({
        ...image,
        path: image.name,
        width: 100,
        height: 100,
      })),
    });

    expect(new Set(merged.labels.map((item) => item.id)).size).toBe(2);
    expect(merged.labels.find((item) => item.name === name)?.id).toBe(inheritedId);
    expect(images[0].annotations.map((item) => item.labelId)).toEqual(
      merged.labels.map((item) => item.id),
    );
    expect(
      exported[1].content
        .trim()
        .split("\n")
        .map((line) => line.split(" ")[0]),
    ).toEqual(["0", "1"]);
  });

  it("新 ID 避开既有和导入 ID，且不把未匹配类别绑定到旧模板", () => {
    const existing = [
      label({ id: "yolo-0", name: "old" }),
      label({ id: "yolo-0-imported-1", name: "reserved" }),
    ];
    const imported = [
      label({ id: "yolo-0", name: "new" }),
      label({ id: "yolo-0-imported-2", name: "another" }),
    ];
    const result = mergeImportedLabels(imported, existing);

    expect(new Set(result.labels.map((item) => item.id)).size).toBe(2);
    expect(existing.some((item) => item.id === result.labels[0].id)).toBe(false);
    expect(result.labels[1].id).toBe(imported[1].id);
    expect(result.matchedCount).toBe(0);
  });

  it("既有配置重复 ID 时也保持输出类别 ID 唯一", () => {
    const result = mergeImportedLabels(
      [label({ id: "yolo-0", name: "cat" }), label({ id: "yolo-1", name: "dog" })],
      [label({ id: "shared", name: "cat" }), label({ id: "shared", name: "dog" })],
    );

    expect(new Set(result.labels.map((item) => item.id)).size).toBe(2);
  });

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
    const imported = [label({ id: "yolo-0", name: "cat" }), label({ id: "yolo-1", name: "Cat" })];
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
    const existing = [label({ id: "tpl-any", name: "person", shapeType: "any", shortcut: "1" })];

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
        annotations: [{ id: "s1", type: "rect" as const, labelId: "yolo-0", points: [0, 0, 1, 1] }],
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
