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

export interface CanvasContextMenu {
  x: number;
  y: number;
  annotationId?: string;
}

export interface PanState {
  startX: number;
  startY: number;
  layoutX: number;
  layoutY: number;
}

export type InteractionMode = "default" | "select" | "annotate";

export const INTERACTION_MODE_HELP: Record<InteractionMode, { title: string; tips: string[] }> = {
  default: {
    title: "默认模式",
    tips: [
      "左键：点框选择，空白处绘制",
      "Shift：强制选择",
      "Ctrl：强制标注",
      "右键：打开菜单",
      "滚轮：缩放",
    ],
  },
  select: {
    title: "选择模式（Shift）",
    tips: [
      "左键：选择/取消选择",
      "右键：打开菜单",
      "滚轮：循环高亮重叠框",
      "松开 Shift：返回默认模式",
    ],
  },
  annotate: {
    title: "标注模式（Ctrl）",
    tips: ["左键：绘制新框", "Ctrl+右键：平移画布", "滚轮：缩放", "松开 Ctrl：返回默认模式"],
  },
};
