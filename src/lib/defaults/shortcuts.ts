export const SHORTCUT_ACTIONS = [
  { id: "previousImage", label: "上一张图片", description: "切换到图片列表中的上一张" },
  { id: "nextImage", label: "下一张图片", description: "切换到图片列表中的下一张" },
  { id: "zoomIn", label: "放大画布", description: "以画布中心放大当前图片" },
  { id: "zoomOut", label: "缩小画布", description: "以画布中心缩小当前图片" },
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]["id"];
export type ShortcutMap = Record<ShortcutActionId, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  previousImage: "ArrowLeft",
  nextImage: "ArrowRight",
  zoomIn: "=",
  zoomOut: "-",
};
