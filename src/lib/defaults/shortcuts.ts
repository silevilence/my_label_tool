import { SHORTCUT_ZH_CN as actionText } from "../../i18n/shortcuts.zh-CN";
import { IMAGE_DELETION_ZH_CN as text } from "../../i18n/image-deletion.zh-CN";
import { VIDEO_ZH_CN as videoText } from "../../i18n/video.zh-CN";

const ACTION_LABELS = [
  { id: "deleteImage", label: text.deleteCurrentImage, description: text.shortcutDescription },
  { id: "previousImage", ...actionText.previousImage },
  { id: "nextImage", ...actionText.nextImage },
  {
    id: "previousFrame",
    label: videoText.previousFrame,
    description: videoText.previousFrameDescription,
  },
  { id: "nextFrame", label: videoText.nextFrame, description: videoText.nextFrameDescription },
  { id: "zoomIn", ...actionText.zoomIn },
  { id: "zoomOut", ...actionText.zoomOut },
  { id: "selectRectTool", ...actionText.selectRectTool },
  { id: "selectPolygonTool", ...actionText.selectPolygonTool },
  { id: "selectPointTool", ...actionText.selectPointTool },
  {
    id: "undoPolygonPoint",
    ...actionText.undoPolygonPoint,
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
