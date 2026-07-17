export const SHORTCUT_ACTIONS = [
  { id: "previousImage", label: "上一张图片", description: "切换到图片列表中的上一张" },
  { id: "nextImage", label: "下一张图片", description: "切换到图片列表中的下一张" },
  { id: "zoomIn", label: "放大画布", description: "以画布中心放大当前图片" },
  { id: "zoomOut", label: "缩小画布", description: "以画布中心缩小当前图片" },
  { id: "selectRectTool", label: "矩形工具", description: "切换到矩形标注" },
  { id: "selectPolygonTool", label: "多边形工具", description: "切换到多边形标注" },
  { id: "selectPointTool", label: "关键点工具", description: "切换到关键点标注" },
  {
    id: "undoPolygonPoint",
    label: "撤销多边形上一点",
    description: "绘制多边形时撤销最后一个顶点",
  },
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]["id"];
export type ShortcutMap = Record<ShortcutActionId, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  previousImage: "ArrowLeft",
  nextImage: "ArrowRight",
  zoomIn: "=",
  zoomOut: "-",
  selectRectTool: "r",
  selectPolygonTool: "p",
  selectPointTool: "k",
  undoPolygonPoint: "Backspace",
};
