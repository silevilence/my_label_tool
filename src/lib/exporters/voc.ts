import type { ExportData, TextExportFile } from "../../types/export";

export function exportVoc(data: ExportData): TextExportFile[] {
  const labelById = new Map(data.labels.map((label) => [label.id, label]));

  return data.images.map((image) => ({
    path: `${baseName(image.name)}.xml`,
    content: [
      "<annotation>",
      `  <filename>${escapeXml(image.name)}</filename>`,
      "  <size>",
      `    <width>${image.width}</width>`,
      `    <height>${image.height}</height>`,
      "    <depth>3</depth>",
      "  </size>",
      ...image.annotations
        .filter((annotation) => annotation.type === "rect")
        .flatMap((annotation) => {
          const [x, y, width, height] = annotation.points;
          const label = labelById.get(annotation.labelId);
          return [
            "  <object>",
            `    <name>${escapeXml(label?.name ?? annotation.labelId)}</name>`,
            "    <bndbox>",
            `      <xmin>${Math.round(x)}</xmin>`,
            `      <ymin>${Math.round(y)}</ymin>`,
            `      <xmax>${Math.round(x + width)}</xmax>`,
            `      <ymax>${Math.round(y + height)}</ymax>`,
            "    </bndbox>",
            "  </object>",
          ];
        }),
      "</annotation>",
      "",
    ].join("\n"),
  }));
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}
