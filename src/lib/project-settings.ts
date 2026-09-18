import type { ProjectSettings } from "../types/project-settings";
import { DEFAULT_PROJECT_SETTINGS, MAX_FRAME_INTERVAL } from "./defaults/video";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";

export const PROJECT_SETTINGS_NAME = "my-label-tool.settings.json";
export function validFrameInterval(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_FRAME_INTERVAL;
}
export function parseProjectSettings(content: string): ProjectSettings {
  const value: unknown = JSON.parse(content);
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1
  )
    throw new Error(text.invalidSettings);
  if (!("videoExtraction" in value)) return structuredClone(DEFAULT_PROJECT_SETTINGS);
  const extraction = value.videoExtraction;
  if (
    !extraction ||
    typeof extraction !== "object" ||
    !("frameInterval" in extraction) ||
    typeof extraction.frameInterval !== "number" ||
    !validFrameInterval(extraction.frameInterval)
  )
    throw new Error(text.invalidSettings);
  return { schemaVersion: 1, videoExtraction: { frameInterval: extraction.frameInterval } };
}
