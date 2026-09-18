import type { ProjectSettings } from "../../types/project-settings";

export const MAX_FRAME_INTERVAL = 1_000_000;
export const MAX_EXTRACTION_FPS = 1000;
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  schemaVersion: 1,
  videoExtraction: { mode: "fps", fps: 5, frameInterval: 30 },
};
