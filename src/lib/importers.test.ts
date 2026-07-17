import { describe, expect, it } from "vitest";
import type { LabelConfig } from "../types/annotation";
import {
  parseCocoImport,
  parseExternalYoloImport,
  parseNativeJsonImport,
  parseProjectConfig,
  parseVocImport,
  parseYoloImport,
  projectConfigTemplate,
  type ImageSize,
  type TextImportFile,
} from "./importers";

function file(name: string, content: string): TextImportFile {
  return { path: name, name, content };
}

const imageSizes = new Map<string, ImageSize>([
  ["a", { name: "a.jpg", width: 100, height: 50 }],
  ["b", { name: "b.jpg", width: 200, height: 100 }],
]);

describe("importers", () => {
  it("parses project configs with defaults for missing optional parts", () => {
    const config = parseProjectConfig(
      JSON.stringify({
        schemaVersion: 1,
        format: "json",
        annotationPath: "annotations.json",
        imageFolder: "C:/images",
        exportedAt: "2026-01-01T00:00:00.000Z",
        labels: [{ id: "person", name: "人", color: "#fff", shapeType: "any" }],
      }),
    );

    expect(config.template).toEqual(projectConfigTemplate());
    expect(config.exportOptions).toEqual({ format: "json" });
    expect(config.labels[0].shapeType).toBe("any");
  });

  it("rejects invalid project configs", () => {
    expect(() => parseProjectConfig("[]")).toThrow("项目配置必须是 JSON 对象");
    expect(() =>
      parseProjectConfig(
        JSON.stringify({
          schemaVersion: 2,
          format: "json",
          annotationPath: "a.json",
          imageFolder: "",
          exportedAt: "",
          labels: [],
        }),
      ),
    ).toThrow("不支持的项目配置版本");
    expect(() =>
      parseProjectConfig(
        JSON.stringify({
          schemaVersion: 1,
          format: "custom",
          annotationPath: "a.json",
          imageFolder: "",
          exportedAt: "",
          labels: [],
        }),
      ),
    ).toThrow("导入格式无效");
  });

  it("parses native JSON annotations and filters invalid attributes", () => {
    const imported = parseNativeJsonImport(
      JSON.stringify({
        labels: [{ id: "person", name: "人", color: "#fff", shortcut: 1 }],
        images: [
          {
            path: "C:/images/a.jpg",
            annotations: [
              {
                id: "r1",
                type: "rect",
                labelId: "person",
                points: [1, 2, 3, 4, 5],
                attributes: { ok: true, nope: ["x"] },
              },
            ],
          },
        ],
      }),
    );

    expect(imported.images[0].name).toBe("a.jpg");
    expect(imported.images[0].annotations[0]).toMatchObject({
      points: [1, 2, 3, 4],
      attributes: { ok: true },
      frameIndex: 0,
    });
  });

  it("defaults missing native label and annotation fields safely", () => {
    const imported = parseNativeJsonImport(
      JSON.stringify({
        labels: [{}],
        images: [{ name: "a.jpg", annotations: [{ labelId: "label-1", points: [1, 2, 3, 4] }] }],
      }),
    );

    expect(imported.labels[0]).toMatchObject({ id: "label-1", name: "label-1", shapeType: "any" });
    expect(imported.images[0].annotations[0]).toMatchObject({
      id: "images[0].annotations-1",
      type: "rect",
      frameIndex: 0,
    });
  });

  it("rejects native annotations with too few points", () => {
    expect(() =>
      parseNativeJsonImport(
        JSON.stringify({
          labels: [],
          images: [{ name: "a.jpg", annotations: [{ type: "polygon", labelId: "x", points: [1, 2] }] }],
        }),
      ),
    ).toThrow("至少需要 6 个数字");
    expect(() =>
      parseNativeJsonImport(JSON.stringify({ labels: [], images: [{ name: "a.jpg", annotations: [{}] }] })),
    ).toThrow("缺少 labelId");
  });

  it("parses COCO categories, images and bboxes", () => {
    const imported = parseCocoImport(
      JSON.stringify({
        categories: [{ id: 7, name: "person" }],
        images: [{ id: "img-1", file_name: "nested/a.jpg" }],
        annotations: [{ id: 9, image_id: "img-1", category_id: 7, bbox: [1, 2, 3, 4] }],
      }),
    );

    expect(imported.labels[0]).toMatchObject({ id: "coco-7", name: "person" });
    expect(imported.images[0].name).toBe("a.jpg");
    expect(imported.images[0].annotations[0]).toMatchObject({
      id: "coco-9",
      labelId: "coco-7",
      points: [1, 2, 3, 4],
    });
  });

  it("rejects COCO annotations that reference missing categories", () => {
    expect(() =>
      parseCocoImport(
        JSON.stringify({
          categories: [],
          images: [],
          annotations: [{ image_id: 1, category_id: 404, bbox: [1, 2, 3, 4] }],
        }),
      ),
    ).toThrow("引用了不存在的 category_id");
    expect(() =>
      parseCocoImport(
        JSON.stringify({
          categories: [{}],
          images: [],
          annotations: [],
        }),
      ),
    ).toThrow("缺少有效 id");
  });

  it("parses VOC XML and clamps zero-size boxes to one pixel", () => {
    const imported = parseVocImport([
      file(
        "a.xml",
        `<annotation>
          <filename>C:\\images\\a.jpg</filename>
          <object>
            <name>person</name>
            <bndbox><xmin>5</xmin><ymin>6</ymin><xmax>5</xmax><ymax>8</ymax></bndbox>
          </object>
        </annotation>`,
      ),
    ]);

    expect(imported.labels[0].name).toBe("person");
    expect(imported.images[0].annotations[0].points).toEqual([5, 6, 1, 2]);
  });

  it("rejects invalid VOC XML objects", () => {
    expect(() =>
      parseVocImport([file("a.xml", "<annotation><object><name>person</name></object></annotation>")]),
    ).toThrow("缺少 bndbox");
    expect(() =>
      parseVocImport([
        file(
          "a.xml",
          "<annotation><object><name>person</name><bndbox><xmin>x</xmin><ymin>0</ymin><xmax>1</xmax><ymax>1</ymax></bndbox></object></annotation>",
        ),
      ]),
    ).toThrow("xmin 不是有效数字");
  });

  it("parses YOLO classes and normalized boxes", () => {
    const imported = parseYoloImport(
      [file("classes.txt", "person\ncar\n"), file("a.txt", "1 0.5 0.5 0.2 0.4\n")],
      imageSizes,
    );

    expect(imported.labels.map((label) => label.name)).toEqual(["person", "car"]);
    expect(imported.images[0].annotations[0]).toMatchObject({
      labelId: "yolo-1",
      points: [40, 15, 20, 20],
    });
  });

  it("rejects invalid YOLO class files and lines", () => {
    expect(() => parseYoloImport([file("classes.txt", "\n")], imageSizes)).toThrow("classes.txt 中没有标签");
    expect(() => parseYoloImport([file("a.txt", "0 0.5 0.5 1 1")], imageSizes)).toThrow("缺少 classes.txt");
    expect(() => parseYoloImport([file("classes.txt", "person\n"), file("a.txt", "1 0.5 0.5 1 1")], imageSizes)).toThrow("标签索引无效");
    expect(() => parseYoloImport([file("classes.txt", "person\n"), file("a.txt", "0 x 0.5 1 1")], imageSizes)).toThrow("坐标无效");
  });

  it("uses fallback YOLO labels when classes.txt is missing", () => {
    const fallback: LabelConfig[] = [{ id: "fallback-0", name: "fallback", color: "#fff", shapeType: "rect" }];
    const imported = parseYoloImport([file("a.txt", "0 0.5 0.5 1 1")], imageSizes, fallback);

    expect(imported.labels).toBe(fallback);
    expect(imported.images[0].annotations[0].labelId).toBe("fallback-0");
  });

  it("summarizes external YOLO missing, orphan and invalid files", () => {
    const { imported, summary } = parseExternalYoloImport(
      [file("classes.txt", "person\n"), file("a.txt", "0 0.5 0.5 1 1\nbad\n"), file("orphan.txt", "0 0.1 0.1 0.1 0.1")],
      imageSizes,
    );

    expect(imported.images).toHaveLength(1);
    expect(summary).toEqual({
      invalidLineCount: 1,
      missingAnnotationFileCount: 1,
      orphanAnnotationFileCount: 1,
    });
  });

  it("creates external YOLO fallback labels from max class index", () => {
    const { imported } = parseExternalYoloImport([file("a.txt", "2 0.5 0.5 1 1")], imageSizes);

    expect(imported.labels.map((label) => label.name)).toEqual(["class_0", "class_1", "class_2"]);
    expect(imported.images[0].annotations[0].labelId).toBe("yolo-2");
  });
});
