import type { ProjectSettings } from "../../types/project-settings";

export const MAX_FRAME_INTERVAL = 1_000_000;
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  schemaVersion: 1,
  videoExtraction: { frameInterval: 30 },
};
