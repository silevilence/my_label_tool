import type { AutosaveSettings } from "../../types/recovery";

export const DEFAULT_AUTOSAVE: AutosaveSettings = { mode: "off", intervalSeconds: 60 };
export const AUTOSAVE_MIN_SECONDS = 10;
export const AUTOSAVE_MAX_SECONDS = 3600;
