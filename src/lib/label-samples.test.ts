import { describe, expect, it } from "vitest";
import { sampleFileStem, sampleNameError } from "./label-samples";

describe("Windows sample file names", () => {
  it.each([
    ["  行人. ", "行人"],
    ['a/b\\c:d*e?f"g<h>i|j\u0001', "a_b_c_d_e_f_g_h_i_j_"],
    ["CON", "_CON"],
    ["com1.png", "_com1.png"],
    ["LPT²", "_LPT²"],
    ["conifer", "conifer"],
    ["com10", "com10"],
    ["...", ""],
  ])("cleans %s", (name, expected) => expect(sampleFileStem(name)).toBe(expected));

  it("detects collisions after cleaning including case and reserved names", () => {
    for (const pair of [
      ["Cat", "cat"],
      ["a/b", "a:b"],
      ["x.", "x"],
      ["CON", "_CON"],
    ]) {
      expect(sampleNameError(pair.map((name) => ({ name })))).toContain("冲突");
    }
    expect(sampleNameError([{ name: "..." }])).toContain("无法生成");
    expect(sampleNameError([{ name: "a".repeat(201) }])).toContain("无法生成");
    expect(sampleNameError([{ name: "行人" }, { name: "车辆" }])).toBe("");
  });
});
