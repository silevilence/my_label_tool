export const DISPLAY_ZH_CN = {
  settingsDescription: "配置快捷键、画布提示，以及不同交互模式下的标签名与标注框大小显示。",
  labelTitle: "标签名显示",
  rectSizeTitle: "标注框大小显示",
  rectSizeDescription: "矩形框内显示原图像素宽x高，数值不随画布缩放变化。",
  modes: [
    { id: "default", label: "默认模式", description: "普通查看、选择与调整" },
    { id: "select", label: "选择模式", description: "按住 Shift 强制选择" },
    { id: "annotate", label: "标注模式", description: "按住 Ctrl 强制绘制" },
  ],
  rectSize: (width: number, height: number) =>
    `${Number(width.toFixed(2))}x${Number(height.toFixed(2))}`,
} as const;
