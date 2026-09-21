export const LABEL_DRAFT_ZH_CN = {
  unsavedSelection: (name: string) => `标签「${name}」尚未保存，保存模板后才会生效`,
  cancelReferenced: (names: string[], count: number) =>
    `取消修改将移除未保存标签 ${names.map((name) => `「${name}」`).join("、")}，${count} 个标注正在使用。\n\n确定：移除这些标注；取消：保留这些标签继续编辑（其余修改仍放弃）。`,
  keepReferencedDraftLabels:
    "已保留仍被标注使用的未保存标签。请使用“取消修改”选择移除相关标注或保留标签。",
} as const;
