import type { InteractionMode } from "../../components/canvas/types";

export type LabelDisplaySettings = Record<InteractionMode, boolean>;

export const DEFAULT_LABEL_DISPLAY_SETTINGS: LabelDisplaySettings = {
  default: false,
  select: true,
  annotate: true,
};

const LABEL_DISPLAY_SETTINGS_KEY = "my-label-tool.label-display-settings";

export function loadLabelDisplaySettings(): LabelDisplaySettings {
  try {
    const raw = window.localStorage.getItem(LABEL_DISPLAY_SETTINGS_KEY);
    return raw ? parseLabelDisplaySettings(JSON.parse(raw) as unknown) : DEFAULT_LABEL_DISPLAY_SETTINGS;
  } catch {
    return DEFAULT_LABEL_DISPLAY_SETTINGS;
  }
}

export function saveLabelDisplaySettings(settings: LabelDisplaySettings) {
  try {
    window.localStorage.setItem(LABEL_DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can fail in restricted WebView contexts; the setting still works for this session.
  }
}

function parseLabelDisplaySettings(value: unknown): LabelDisplaySettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_LABEL_DISPLAY_SETTINGS;
  }

  const record = value as Record<string, unknown>;
  return {
    default: readBoolean(record.default, DEFAULT_LABEL_DISPLAY_SETTINGS.default),
    select: readBoolean(record.select, DEFAULT_LABEL_DISPLAY_SETTINGS.select),
    annotate: readBoolean(record.annotate, DEFAULT_LABEL_DISPLAY_SETTINGS.annotate),
  };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
