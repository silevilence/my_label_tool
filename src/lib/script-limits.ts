import spec from "./defaults/script-limits.json";
import type { ScriptLimits } from "../types/script";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";
export const DEFAULT_SCRIPT_LIMITS: Readonly<ScriptLimits> = spec.defaults;
export const SCRIPT_LIMIT_RANGES = { memory: spec.memory, timeout: spec.timeout };
export function validateScriptLimits(value: ScriptLimits): void {
  if (!Number.isSafeInteger(value.maxMemoryMiB) || value.maxMemoryMiB < spec.memory.min || value.maxMemoryMiB > spec.memory.max || !Number.isSafeInteger(value.timeoutSeconds) || value.timeoutSeconds < spec.timeout.min || value.timeoutSeconds > spec.timeout.max) throw new Error(text.invalidLimits(spec.memory.min, spec.memory.max, spec.timeout.min, spec.timeout.max));
}
