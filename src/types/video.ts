/** Host-only video metadata. frameIndex is the zero-based decoded source frame. */
export interface VideoFrame {
  name: string;
  frameIndex: number;
  timestampSeconds: number;
}

export interface VideoProject {
  schemaVersion: 1;
  sourcePath: string;
  frameInterval: number;
  totalFrames: number;
  width: number;
  height: number;
  frames: VideoFrame[];
}

export interface VideoImportResult {
  folderPath: string;
  video: VideoProject;
}
