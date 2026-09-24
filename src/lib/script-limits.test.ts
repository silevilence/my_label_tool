import { expect, it } from "vitest";
import { DEFAULT_SCRIPT_LIMITS, validateScriptLimits } from "./script-limits";
it("validates shared defaults and refuses out of range or fractional limits", () => {
  expect(() => validateScriptLimits(DEFAULT_SCRIPT_LIMITS)).not.toThrow();
  for (const limits of [
    { maxMemoryMiB: 63, timeoutSeconds: 30 },
    { maxMemoryMiB: 4097, timeoutSeconds: 30 },
    { maxMemoryMiB: 256, timeoutSeconds: 0 },
    { maxMemoryMiB: 256, timeoutSeconds: 3601 },
    { maxMemoryMiB: NaN, timeoutSeconds: 1 },
    { maxMemoryMiB: 256, timeoutSeconds: 1.5 },
  ])
    expect(() => validateScriptLimits(limits)).toThrow();
});
