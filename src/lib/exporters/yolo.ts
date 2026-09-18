import type { ExportData, TextExportFile } from "../../types/export";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function exportYolo(data: ExportData): TextExportFile[] {
  const classIndexByLabel = new Map(data.labels.map((label, index) => [label.id, index]));
  const paths = new Set(["classes.txt"]);
  for (const image of data.images) {
    const path = `${baseName(image.name)}.txt`.replace(/\\/g, "/").toLowerCase();
    if (paths.has(path)) throw new Error(text.duplicateYoloPath(path));
    paths.add(path);
    if (
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.height) ||
      image.width <= 0 ||
      image.height <= 0
    )
      throw new Error(text.invalidYoloSize(image.name));
    for (const annotation of image.annotations.filter((shape) => shape.type === "rect")) {
      const [x, y, width, height] = annotation.points;
      if (
        annotation.points.length !== 4 ||
        !annotation.points.every(Number.isFinite) ||
        width <= 0 ||
        height <= 0 ||
        x < 0 ||
        y < 0 ||
        x + width > image.width ||
        y + height > image.height ||
        !classIndexByLabel.has(annotation.labelId)
      )
        throw new Error(text.invalidYoloBox(image.name));
    }
  }
  const files = data.images.map((image) => ({
    path: `${baseName(image.name)}.txt`,
    content:
      image.annotations
        .filter((annotation) => annotation.type === "rect")
        .map((annotation) => {
          const [x, y, width, height] = annotation.points;
          const classIndex = classIndexByLabel.get(annotation.labelId) ?? 0;
          return [
            classIndex,
            formatNumber((x + width / 2) / image.width),
            formatNumber((y + height / 2) / image.height),
            formatNumber(width / image.width),
            formatNumber(height / image.height),
          ].join(" ");
        })
        .join("\n") +
      (image.annotations.some((annotation) => annotation.type === "rect") ? "\n" : ""),
  }));

  return [
    {
      path: "classes.txt",
      content: data.labels.map((label) => label.name).join("\n") + "\n",
    },
    ...files,
  ];
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : "0";
}
