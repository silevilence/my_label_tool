export const IMAGE_DELETION_ZH_CN = {
  deleteImage: "删除图片",
  unassignedShortcut: "未绑定",
  deleteCurrentImage: "删除当前图片",
  shortcutDescription: "确认后将当前图片移入系统回收站，并移除其标注",
  title: "确认删除图片",
  consequence:
    "源文件将移入系统回收站，当前项目中的标注将一并删除。图片可从回收站恢复，但标注不能通过撤销恢复。",
  annotationCount: (count: number) => `该图片已有 ${count} 个标注，确认后将一并删除。`,
  pointerOnly: "请等待 3 秒后用鼠标确认；Enter、空格等按键不能确认，Esc 可取消。",
  countdown: (seconds: number) => `请等待 ${seconds} 秒`,
  confirm: "移入回收站并删除标注",
  cancel: "取消",
  deleting: "正在移入回收站…",
  failure: (reason: string) => `删除图片失败：${reason}。图片列表和标注保持不变。`,
  busy: "请等待保存、导出或预打标结束后再删除图片。",
  stale: "图片目录或文件列表已变化，请重新选择要删除的图片。",
  shortcutConflict: "该按键用于固定操作或标签，请选择其他按键。",
} as const;
