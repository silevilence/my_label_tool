import type { PrelabelResourceLimits } from "../types/prelabel";
import {
  MAX_PRELABEL_CANDIDATES,
  MAX_PRELABEL_MEMORY_MIB,
  PRELABEL_BYTES_PER_OUTPUT_ELEMENT,
} from "./defaults/prelabel";
import { PRELABEL_RESOURCE_ZH_CN as text } from "../i18n/prelabel-resource.zh-CN";

export function validatePrelabelResourceLimits(limits: PrelabelResourceLimits): string | null {
  if (
    !Number.isSafeInteger(limits.maxMemoryMiB) ||
    limits.maxMemoryMiB < 1 ||
    limits.maxMemoryMiB > MAX_PRELABEL_MEMORY_MIB
  ) {
    return text.invalidMemory;
  }
  if (
    !Number.isSafeInteger(limits.maxCandidates) ||
    limits.maxCandidates < 1 ||
    limits.maxCandidates > MAX_PRELABEL_CANDIDATES
  ) {
    return text.invalidCandidates;
  }
  return null;
}

export function maxPrelabelOutputElements(limits: PrelabelResourceLimits): number {
  const error = validatePrelabelResourceLimits(limits);
  if (error) throw new Error(error);
  return Math.floor((limits.maxMemoryMiB * 1024 * 1024) / PRELABEL_BYTES_PER_OUTPUT_ELEMENT);
}
