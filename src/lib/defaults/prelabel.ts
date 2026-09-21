export const DEFAULT_PRELABEL_CONFIDENCE_THRESHOLD = 0.25;
export const DEFAULT_PRELABEL_IOU_THRESHOLD = 0.45;
export const DEFAULT_PRELABEL_DYNAMIC_INPUT_SIZE = 640;

export const DEFAULT_PRELABEL_RESOURCE_LIMITS = {
  maxMemoryMiB: 80,
  maxCandidates: 100_000,
};
// Keep byte calculations exact in JavaScript; these are representation bounds, not machine budgets.
export const MAX_PRELABEL_MEMORY_MIB = Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024));
export const MAX_PRELABEL_CANDIDATES = Number.MAX_SAFE_INTEGER;
export const PRELABEL_BYTES_PER_OUTPUT_ELEMENT = 8;
