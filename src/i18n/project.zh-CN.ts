export const PROJECT_ZH_CN = {
  confirmYoloImport: (annotationFileCount: number, configName: string) =>
    `检测到 YOLO 标注（${annotationFileCount} 个标注文件），是否读取标签并创建项目配置？将读取已打标签并写入 ${configName}，下次打开该目录不再提示。`,
  yoloImportSummary: (missingCount: number, orphanCount: number, invalidLineCount: number) =>
    `YOLO 项目创建完成：${missingCount} 张图片缺少标注文件，${orphanCount} 个标注文件未匹配图片，${invalidLineCount} 行非法标注已跳过。`,
};
