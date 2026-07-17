import { describe, expect, it } from "vitest";
import { isLabelCompatibleWithShape } from "./annotation";

describe("annotation types", () => {
  it("checks label shape compatibility", () => {
    expect(
      isLabelCompatibleWithShape({ id: "any", name: "Any", color: "#fff", shapeType: "any" }, "rect"),
    ).toBe(true);
    expect(
      isLabelCompatibleWithShape({ id: "point", name: "Point", color: "#fff", shapeType: "point" }, "point"),
    ).toBe(true);
    expect(
      isLabelCompatibleWithShape({ id: "point", name: "Point", color: "#fff", shapeType: "point" }, "rect"),
    ).toBe(false);
  });
});
