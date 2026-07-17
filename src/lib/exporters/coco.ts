import type { ExportData } from "../../types/export";
import type { AnnotationShape } from "../../types/annotation";
import { annotationBbox } from "../../components/canvas/geometry";

interface CocoImage {
  id: number;
  file_name: string;
  width: number;
  height: number;
}

interface CocoAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  bbox: number[];
  area: number;
  iscrowd: 0;
  segmentation?: number[][];
  keypoints?: number[];
  num_keypoints?: number;
}

interface CocoCategory {
  id: number;
  name: string;
}

export interface CocoExport {
  images: CocoImage[];
  annotations: CocoAnnotation[];
  categories: CocoCategory[];
}

export function exportCoco(data: ExportData): CocoExport {
  const categoryIdByLabel = new Map(data.labels.map((label, index) => [label.id, index + 1]));
  let annotationId = 1;

  return {
    images: data.images.map((image, index) => ({
      id: index + 1,
      file_name: image.name,
      width: image.width,
      height: image.height,
    })),
    annotations: data.images.flatMap((image, imageIndex) =>
      image.annotations.map((annotation) => {
        return {
          id: annotationId++,
          image_id: imageIndex + 1,
          category_id: categoryIdByLabel.get(annotation.labelId) ?? 0,
          bbox: annotationBbox(annotation),
          area: annotationArea(annotation),
          iscrowd: 0,
          ...annotationShapeFields(annotation),
        };
      }),
    ),
    categories: data.labels.map((label, index) => ({
      id: index + 1,
      name: label.name,
    })),
  };
}

function annotationArea(annotation: AnnotationShape): number {
  if (annotation.type === "polygon") {
    let area = 0;
    for (
      let index = 0, previous = annotation.points.length - 2;
      index < annotation.points.length;
      previous = index, index += 2
    ) {
      area +=
        annotation.points[previous] * annotation.points[index + 1] -
        annotation.points[index] * annotation.points[previous + 1];
    }
    return Math.abs(area / 2);
  }

  const [, , width, height] = annotationBbox(annotation);
  return width * height;
}

function annotationShapeFields(
  annotation: AnnotationShape,
): Pick<CocoAnnotation, "segmentation" | "keypoints" | "num_keypoints"> {
  if (annotation.type === "polygon") {
    return { segmentation: [annotation.points] };
  }

  if (annotation.type === "point") {
    return { keypoints: [annotation.points[0], annotation.points[1], 2], num_keypoints: 1 };
  }

  return {};
}
