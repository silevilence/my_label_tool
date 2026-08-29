import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import exporterSchema from "../../docs/plugin-exporter.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateParams = ajv.compile({
  $ref: `${exporterSchema.$id}#/$defs/params`,
  $defs: exporterSchema.$defs,
  $id: exporterSchema.$id,
});
const validateResult = new Ajv2020({ allErrors: true, strict: true }).compile({
  $ref: `${exporterSchema.$id}#/$defs/result`,
  $defs: exporterSchema.$defs,
  $id: exporterSchema.$id,
});

const params = {
  formatId: "labelme",
  outputBaseName: "annotations",
  options: {},
  exportData: {
    labels: [{ id: "car", name: "汽车", color: "#38bdf8", shapeType: "rect" }],
    images: [
      {
        path: "images/a.jpg",
        name: "a.jpg",
        width: 640,
        height: 480,
        annotations: [{ id: "one", type: "rect", labelId: "car", points: [1, 2, 3, 4] }],
      },
    ],
  },
};

describe("plugin-exporter.schema.json", () => {
  it("accepts exporter params with project-relative image paths", () => {
    expect(validateParams(params)).toBe(true);
  });

  it.each([
    ["absolute host-only field", { ...params, outputDir: "C:/out" }],
    ["missing options", { ...params, options: undefined }],
    ["unsafe output base name", { ...params, outputBaseName: "../escape" }],
    ["invalid annotation", { ...params, exportData: { ...params.exportData, images: [{ ...params.exportData.images[0], annotations: [{ type: "line" }] }] } }],
  ])("rejects invalid params: %s", (_name, candidate) => {
    expect(validateParams(candidate)).toBe(false);
  });

  it("requires exactly one content representation per result file", () => {
    expect(validateResult({ files: [{ relativePath: "a.json", contentUtf8: "{}" }] })).toBe(true);
    expect(validateResult({ files: [{ relativePath: "a.json", contentBase64: "e30=" }] })).toBe(true);
    expect(validateResult({ files: [{ relativePath: "a.json" }] })).toBe(false);
    expect(
      validateResult({
        files: [{ relativePath: "a.json", contentUtf8: "{}", contentBase64: "e30=" }],
      }),
    ).toBe(false);
    expect(
      validateResult({ files: [{ relativePath: "file:stream.json", contentUtf8: "{}" }] }),
    ).toBe(false);
    expect(
      validateResult({
        files: Array.from({ length: 10_001 }, (_, index) => ({
          relativePath: `${index}.json`,
          contentUtf8: "{}",
        })),
      }),
    ).toBe(false);
  });
});
