export const ANNOTATION_ZH_CN = {
  invalidAnnotation: "标注必须是对象",
  invalidLabel: "标注标签为空或不存在",
  invalidShape: "图形类型无效或与标签不兼容",
  invalidCoordinates: "坐标数量不足或包含非有限数值",
  invalidAt: (field: string, message: string) => `${field}: ${message}`,
} as const;
