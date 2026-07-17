import type { ExportData, TextExportFile } from "../../types/export";

export function exportYolo(data: ExportData): TextExportFile[] {
  const classIndexByLabel = new Map(data.labels.map((label, index) => [label.id, index]));
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
