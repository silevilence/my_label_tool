import type { LabelConfig } from "../../types/annotation";

export const DEFAULT_LABELS: LabelConfig[] = [
  { id: "person", name: "人", color: "#38bdf8", shortcut: "1", shapeType: "rect" },
  { id: "car", name: "车", color: "#f97316", shortcut: "2", shapeType: "rect" },
  { id: "other", name: "其他", color: "#a78bfa", shortcut: "3", shapeType: "rect" },
];
