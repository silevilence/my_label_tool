import type { ProjectSettings, VideoExtractionSettings } from "../types/project-settings";
import { DEFAULT_PROJECT_SETTINGS, MAX_FRAME_INTERVAL, MAX_EXTRACTION_FPS } from "./defaults/video";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";

export const PROJECT_SETTINGS_NAME = "my-label-tool.settings.json";
export function validFrameInterval(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_FRAME_INTERVAL;
}
export function validExtraction(value: VideoExtractionSettings): boolean {
  return (
    (value.mode === "fps" || value.mode === "interval") &&
    Number.isFinite(value.fps) &&
    value.fps > 0 &&
    value.fps <= MAX_EXTRACTION_FPS &&
    validFrameInterval(value.frameInterval)
  );
}
export function extractionSettings(
  value: number | VideoExtractionSettings,
): VideoExtractionSettings {
  return typeof value === "number"
    ? { ...DEFAULT_PROJECT_SETTINGS.videoExtraction, mode: "interval", frameInterval: value }
    : value;
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
  const settings: VideoExtractionSettings = {
    mode: "mode" in extraction ? (extraction.mode as VideoExtractionSettings["mode"]) : "interval",
    fps:
      "fps" in extraction
        ? (extraction.fps as number)
        : DEFAULT_PROJECT_SETTINGS.videoExtraction.fps,
    frameInterval: extraction.frameInterval,
  };
  if (!validExtraction(settings)) throw new Error(text.invalidSettings);
  return { schemaVersion: 1, videoExtraction: settings };
}
