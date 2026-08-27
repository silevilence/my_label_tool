import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import labelPresetSchema from "../../docs/plugin-label-preset.schema.json";

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(labelPresetSchema);

function validPreset() {
  return {
    id: "dev.acme.labels.traffic",
    name: "道路交通",
    labels: [
      {
        id: "dev.acme.labels.car",
        name: "汽车",
        color: "#38bdf8",
        shortcut: "1",
        shapeType: "rect",
      },
    ],
  };
}

describe("plugin-label-preset.schema.json", () => {
  it("accepts the public LabelTemplate shape with an optional shortcut", () => {
    expect(validate(validPreset())).toBe(true);
    const withoutShortcut = validPreset();
    delete (withoutShortcut.labels[0] as Partial<(typeof withoutShortcut.labels)[number]>).shortcut;
    expect(validate(withoutShortcut)).toBe(true);
  });

  it.each([
    ["missing required labels", { id: "dev.acme.labels", name: "x" }],
    ["unknown template field", { ...validPreset(), extra: true }],
    ["invalid template id", { ...validPreset(), id: "not-namespaced" }],
    [
      "too many labels",
      { ...validPreset(), labels: Array.from({ length: 1001 }, () => validPreset().labels[0]) },
    ],
    ["unknown label field", { ...validPreset(), labels: [{ ...validPreset().labels[0], x: 1 }] }],
    ["invalid label id", { ...validPreset(), labels: [{ ...validPreset().labels[0], id: "car" }] }],
    ["invalid color", { ...validPreset(), labels: [{ ...validPreset().labels[0], color: "blue" }] }],
    ["nullable shortcut", { ...validPreset(), labels: [{ ...validPreset().labels[0], shortcut: null }] }],
    ["invalid shortcut", { ...validPreset(), labels: [{ ...validPreset().labels[0], shortcut: "A" }] }],
    ["invalid shape", { ...validPreset(), labels: [{ ...validPreset().labels[0], shapeType: "line" }] }],
  ])("rejects %s", (_name, candidate) => {
    expect(validate(candidate)).toBe(false);
  });
});
