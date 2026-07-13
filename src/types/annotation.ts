/**
 * Coordinate contract:
 * Annotation coordinates are stored in original image pixels, not normalized
 * viewport/canvas coordinates. Rectangles use [x, y, width, height].
 */
export interface AnnotationShape {
  id: string;
  type: "rect";
  labelId: string;
  points: number[];
  attributes?: Record<string, string | number | boolean>;
  frameIndex?: number;
}

export interface LabelConfig {
  id: string;
  name: string;
  color: string;
  shortcut?: string;
  shapeType: AnnotationShape["type"];
}

export interface LabelTemplate {
  id: string;
  name: string;
  labels: LabelConfig[];
}
