export const CANVAS_ZH_CN = { missingLabel: "标签缺失" };

export const INTERACTION_MODE_ZH_CN = {
  default: {
    title: "默认模式",
    tips: [
      "左键：点框选择，空白处绘制",
      "Shift：强制选择",
      "Ctrl：强制标注",
      "空格+左键拖拽：平移画布",
      "中键：拖拽平移，单击取消草稿",
      "右键：打开菜单",
      "滚轮：缩放（图片内外均可）",
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
    tips: [
      "左键：绘制新框",
      "Ctrl+右键拖拽：平移画布",
      "空格+左键拖拽：平移画布",
      "滚轮：缩放",
      "松开 Ctrl：返回默认模式",
    ],
  },
};
