import { describe, expect, it } from "vitest";
import { DEFAULT_PRELABEL_RESOURCE_LIMITS, MAX_PRELABEL_MEMORY_MIB } from "./defaults/prelabel";
import {
  maxPrelabelOutputElements,
  validatePrelabelResourceLimits,
} from "./prelabel-resource-limits";

describe("prelabel output budgets", () => {
  it("accounts for the runtime tensor and host copy", () => {
    expect(maxPrelabelOutputElements(DEFAULT_PRELABEL_RESOURCE_LIMITS)).toBe(10_485_760);
    expect(maxPrelabelOutputElements({ maxMemoryMiB: 128, maxCandidates: 150_000 })).toBe(
      16_777_216,
    );
    expect(maxPrelabelOutputElements({ maxMemoryMiB: 1, maxCandidates: 1 })).toBe(131_072);
    expect(
      maxPrelabelOutputElements({
        maxMemoryMiB: MAX_PRELABEL_MEMORY_MIB,
        maxCandidates: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(MAX_PRELABEL_MEMORY_MIB * 131_072);
  });

  it("rejects invalid, fractional and unsafe values instead of disabling protection", () => {
    for (const field of ["maxMemoryMiB", "maxCandidates"] as const) {
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const limits = { ...DEFAULT_PRELABEL_RESOURCE_LIMITS, [field]: value };
        expect(validatePrelabelResourceLimits(limits)).not.toBeNull();
        expect(() => maxPrelabelOutputElements(limits)).toThrow();
      }
    }
    expect(
      validatePrelabelResourceLimits({
        ...DEFAULT_PRELABEL_RESOURCE_LIMITS,
        maxMemoryMiB: MAX_PRELABEL_MEMORY_MIB + 1,
      }),
    ).not.toBeNull();
  });
});
