import type { LabelConfig, LabelTemplate } from "../../types/annotation";

export const DEFAULT_LABEL_COLORS = [
  "#38bdf8",
  "#f97316",
  "#a78bfa",
  "#22c55e",
  "#f43f5e",
  "#eab308",
];

export const DEFAULT_LABELS: LabelConfig[] = [
  { id: "person", name: "人", color: "#38bdf8", shortcut: "1", shapeType: "any" },
  { id: "car", name: "车", color: "#f97316", shortcut: "2", shapeType: "any" },
  { id: "other", name: "其他", color: "#a78bfa", shortcut: "3", shapeType: "any" },
];

export const DEFAULT_LABEL_TEMPLATES: LabelTemplate[] = [
  {
    id: "common-detection",
    name: "通用目标检测",
    labels: DEFAULT_LABELS,
  },
  {
    id: "traffic",
    name: "道路交通",
    labels: [
      { id: "person", name: "行人", color: "#38bdf8", shortcut: "1", shapeType: "any" },
      { id: "car", name: "汽车", color: "#f97316", shortcut: "2", shapeType: "any" },
      { id: "truck", name: "卡车", color: "#eab308", shortcut: "3", shapeType: "any" },
      { id: "traffic_light", name: "交通灯", color: "#22c55e", shortcut: "4", shapeType: "any" },
    ],
  },
];
