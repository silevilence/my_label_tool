export const SHORTCUT_ZH_CN = {
  undo: "撤销",
  redo: "重做",
  save: "保存",
  deleteShape: "删除选中标注",
  search: "搜索图片",
  fixed: "固定快捷键，不可改绑",
  unavailable: "当前不可用",
  resolved: (winner: string) => `本次按优先级执行「${winner}」。`,
  conflict: (key: string, labels: string[]) =>
    `快捷键 ${key} 同时绑定了「${labels.join("」「")}」，请修改冲突绑定。`,
  singleKey: "暂不支持组合键，请按单个按键。",
  reserved: "此按键用于输入或确认，不能绑定该动作。",
};
