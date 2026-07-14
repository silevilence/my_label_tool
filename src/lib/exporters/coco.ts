import type { ExportData } from "../../types/export";

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
        const [, , width, height] = annotation.points;
        return {
          id: annotationId++,
          image_id: imageIndex + 1,
          category_id: categoryIdByLabel.get(annotation.labelId) ?? 0,
          bbox: annotation.points,
          area: width * height,
          iscrowd: 0,
        };
      }),
    ),
    categories: data.labels.map((label, index) => ({
      id: index + 1,
      name: label.name,
    })),
  };
}
