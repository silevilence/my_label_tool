import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import prelabelSchema from "../../docs/plugin-prelabel.schema.json";

function validator(definition: "params" | "result") {
  return new Ajv2020({ allErrors: true, strict: true }).compile({
    $id: prelabelSchema.$id,
    $ref: `${prelabelSchema.$id}#/$defs/${definition}`,
    $defs: prelabelSchema.$defs,
  });
}

describe("plugin-prelabel.schema.json", () => {
  it("accepts relative inputs and routed pixel-coordinate shapes", () => {
    expect(
      validator("params")({
        imagePaths: ["images/a.jpg", "images/b.jpg"],
        classMappings: [
          { modelClass: "car", labelId: "vehicle", labelName: "车辆" },
        ],
        params: {},
      }),
    ).toBe(true);
    expect(
      validator("result")({
        shapes: [
          {
            imagePath: "images/a.jpg",
            id: "one",
            type: "rect",
            labelId: "vehicle",
            points: [1, 2, 3, 4],
            attributes: { confidence: 0.9 },
            frameIndex: 0,
          },
        ],
      }),
    ).toBe(true);
    expect(
      validator("result")({
        cancelled: true,
        completedImagePaths: ["images/a.jpg"],
        shapes: [],
      }),
    ).toBe(true);
  });

  it.each([
    { imagePaths: ["../a.jpg"], classMappings: [], params: {} },
    { imagePaths: ["C:/a.jpg"], classMappings: [], params: {} },
    { imagePaths: [], classMappings: [], params: {} },
  ])("rejects unsafe or empty input: %#", (candidate) => {
    expect(validator("params")(candidate)).toBe(false);
  });

  it.each([
    { shapes: [{ id: "one", type: "line", labelId: "vehicle", points: [1, 2] }] },
    { shapes: [{ id: "one", type: "point", labelId: "vehicle", points: [-1, 2] }] },
    { shapes: [{ id: "one", type: "point", labelId: "vehicle", points: [1, 2, 3] }] },
    { shapes: [{ id: "one", type: "rect", labelId: "vehicle", points: [1, 2, 3] }] },
    { shapes: [{ id: "one", type: "rect", labelId: "vehicle", points: [1, 2, 0, 4] }] },
    { shapes: [{ id: "one", type: "polygon", labelId: "vehicle", points: [1, 2, 3, 4] }] },
    {
      shapes: [
        { id: "one", type: "polygon", labelId: "vehicle", points: [1, 2, 3, 4, 5, 6, 7] },
      ],
    },
    {
      shapes: [
        {
          id: "one",
          type: "rect",
          labelId: "vehicle",
          points: [1, 2, 3, 4],
          attributes: { confidence: 2 },
        },
      ],
    },
    { cancelled: true, shapes: [] },
    { cancelled: false, completedImagePaths: ["images/a.jpg"], shapes: [] },
  ])("rejects invalid plugin shape: %#", (candidate) => {
    expect(validator("result")(candidate)).toBe(false);
  });
});
