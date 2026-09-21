import { CANVAS_ZH_CN, INTERACTION_MODE_ZH_CN } from "../../i18n/canvas.zh-CN";
import type { LabelConfig } from "../../types/annotation";

export interface ImageLayout {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
}

export interface DrawingRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// 标注引用的标签不存在时的渲染哨兵：警示色 + 可见名称，替代原先静默套用第一个标签。
export const MISSING_ANNOTATION_LABEL: LabelConfig = {
  id: "",
  name: CANVAS_ZH_CN.missingLabel,
  color: "#f59e0b",
  shapeType: "any",
};

export interface CanvasContextMenu {
  x: number;
  y: number;
  annotationId?: string;
}

export interface PanState {
  button: number;
  moved: boolean;
  startX: number;
  startY: number;
  layoutX: number;
  layoutY: number;
}

export type InteractionMode = "default" | "select" | "annotate";

export const INTERACTION_MODE_HELP: Record<InteractionMode, { title: string; tips: string[] }> =
  INTERACTION_MODE_ZH_CN;
