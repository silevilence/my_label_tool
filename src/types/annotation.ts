/**
 * Coordinate contract:
 * Annotation coordinates are stored in original image pixels, not normalized
 * viewport/canvas coordinates. Rectangles use [x, y, width, height],
 * polygons use [x1, y1, x2, y2, ...], points use [x, y].
 */
export type AnnotationShapeType = "rect" | "polygon" | "point";
export type LabelShapeType = AnnotationShapeType | "any";

export const ANNOTATION_SHAPE_TYPES: AnnotationShapeType[] = ["rect", "polygon", "point"];
export const LABEL_SHAPE_TYPES: LabelShapeType[] = ["any", ...ANNOTATION_SHAPE_TYPES];

export const SHAPE_TYPE_LABELS: Record<AnnotationShapeType, string> = {
  rect: "矩形",
  polygon: "多边形",
  point: "关键点",
};

export const LABEL_SHAPE_TYPE_LABELS: Record<LabelShapeType, string> = {
  any: "通用",
  ...SHAPE_TYPE_LABELS,
};

export function isLabelCompatibleWithShape(
  label: LabelConfig,
  shapeType: AnnotationShapeType,
): boolean {
  return label.shapeType === "any" || label.shapeType === shapeType;
}

export interface AnnotationShape {
  id: string;
  type: AnnotationShapeType;
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
  shapeType: LabelShapeType;
}

export interface LabelTemplate {
  id: string;
  name: string;
  labels: LabelConfig[];
}
