import { useMemo } from "react";
import type { AnnotationShape } from "../types/annotation";
import type { ExportFormatId } from "../types/export";

export function useExportFormatWarning({
  annotationsByImage,
  setSelectedExportFormatId,
  showMessage,
}: {
  annotationsByImage: Record<string, AnnotationShape[]>;
  setSelectedExportFormatId: (format: ExportFormatId) => void;
  showMessage: (message: string) => void;
}) {
  const yoloUnsupportedCount = useMemo(
    () =>
      Object.values(annotationsByImage)
        .flat()
        .filter((annotation) => annotation.type !== "rect").length,
    [annotationsByImage],
  );

  function changeExportFormat(format: ExportFormatId) {
    setSelectedExportFormatId(format);
    if (format === "yolo" && yoloUnsupportedCount > 0) {
      showMessage(`YOLO 只支持矩形，将无法保存 ${yoloUnsupportedCount} 个非矩形标注。`);
    }
  }

  return changeExportFormat;
}
