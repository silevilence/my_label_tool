import type { CustomExportMapping, ExportData } from "../../types/export";
import { annotationBbox } from "../../components/canvas/geometry";

export function exportCustom(data: ExportData, mapping: Required<CustomExportMapping>) {
  const labelById = new Map(data.labels.map((label) => [label.id, label]));

  return data.images.flatMap((image) =>
    image.annotations.map((annotation) => {
      const label = labelById.get(annotation.labelId);
      return {
        [mapping.imagePath]: image.path,
        [mapping.imageName]: image.name,
        [mapping.labelId]: annotation.labelId,
        [mapping.labelName]: label?.name ?? annotation.labelId,
        [mapping.bbox]: annotationBbox(annotation),
        type: annotation.type,
        points: annotation.points,
        [mapping.attributes]: annotation.attributes ?? {},
      };
    }),
  );
}
