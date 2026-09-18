/** Host-only project configuration; never sent to plugins. */
export interface VideoExtractionSettings {
  mode: "fps" | "interval";
  fps: number;
  frameInterval: number;
}
export interface ProjectSettings {
  schemaVersion: 1;
  videoExtraction: VideoExtractionSettings;
}
