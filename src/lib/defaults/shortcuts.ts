import { SHORTCUT_ZH_CN as actionText } from "../../i18n/shortcuts.zh-CN";
import { IMAGE_DELETION_ZH_CN as text } from "../../i18n/image-deletion.zh-CN";
import { VIDEO_ZH_CN as videoText } from "../../i18n/video.zh-CN";

const ACTION_LABELS = [
  { id: "deleteImage", label: text.deleteCurrentImage, description: text.shortcutDescription },
  { id: "previousImage", label: "上一张图片", description: "切换到图片列表中的上一张" },
  { id: "nextImage", label: "下一张图片", description: "切换到图片列表中的下一张" },
  {
    id: "previousFrame",
    label: videoText.previousFrame,
    description: videoText.previousFrameDescription,
  },
  { id: "nextFrame", label: videoText.nextFrame, description: videoText.nextFrameDescription },
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

const bindings = {
  deleteImage: ["F8", "canvas", true],
  previousImage: ["ArrowLeft", "canvas", true],
  nextImage: ["ArrowRight", "canvas", true],
  previousFrame: ["PageUp", "canvas", true],
  nextFrame: ["PageDown", "canvas", true],
  zoomIn: ["=", "global", true],
  zoomOut: ["-", "global", true],
  selectRectTool: ["r", "canvas", true],
  selectPolygonTool: ["p", "canvas", true],
  selectPointTool: ["k", "canvas", true],
  undoPolygonPoint: ["Backspace", "canvas", true],
} as const;
export const SHORTCUT_ACTIONS = [
  ...ACTION_LABELS.map((action) => ({
    ...action,
    defaultKey: bindings[action.id][0],
    scope: bindings[action.id][1],
    rebindable: bindings[action.id][2],
    priority: 0,
  })),
  ...(
    [
      ["undo", "Ctrl+z", "canvas"],
      ["redo", "Ctrl+y", "canvas"],
      ["save", "Ctrl+s", "global"],
      ["deleteShape", "Delete", "canvas"],
      ["search", "Ctrl+f", "global"],
    ] as const
  ).map(([id, defaultKey, scope]) => ({
    id,
    defaultKey,
    scope,
    rebindable: false,
    priority: 100,
    label: actionText[id],
    description: actionText.fixed,
  })),
];
export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]["id"];
export type ShortcutMap = Record<ShortcutActionId, string>;
export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUT_ACTIONS.map((action) => [action.id, action.defaultKey]),
) as ShortcutMap;
