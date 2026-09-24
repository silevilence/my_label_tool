/** Host-only directory convention; never serialized into labels or project configuration. */
export interface LabelSample {
  name: string;
  fileName: string;
  preview: string;
}

export interface LabelSampleChange {
  name: string;
  originalName?: string;
  sourcePath?: string;
  clear: boolean;
}

export interface LabelSampleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelSampleCandidate {
  imagePath: string;
  imageName: string;
  annotationId: string;
  bounds: LabelSampleBounds;
}

export interface LabelSampleCrop {
  path: string;
  preview: string;
}
