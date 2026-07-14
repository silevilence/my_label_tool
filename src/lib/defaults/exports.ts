import type { CustomExportMapping, ExportTemplate } from "../../types/export";

export const EXPORT_TEMPLATES: ExportTemplate[] = [
  {
    id: "json",
    name: "原始 JSON",
    description: "保存当前内部标注结构，便于调试或二次处理。",
    output: "file",
  },
  {
    id: "coco",
    name: "COCO JSON",
    description: "目标检测常用的 images / annotations / categories 结构。",
    output: "file",
  },
  {
    id: "voc",
    name: "VOC XML",
    description: "每张图片生成一个 Pascal VOC XML 文件。",
    output: "directory",
  },
  {
    id: "yolo",
    name: "YOLO TXT",
    description: "每张图片生成一个归一化 txt，并生成 classes.txt。",
    output: "directory",
  },
  {
    id: "custom",
    name: "自定义 JSON",
    description: "按字段映射导出扁平标注记录。",
    output: "file",
  },
];

export const DEFAULT_CUSTOM_EXPORT_MAPPING: Required<CustomExportMapping> = {
  imagePath: "imagePath",
  imageName: "imageName",
  labelId: "labelId",
  labelName: "labelName",
  bbox: "bbox",
  attributes: "attributes",
};
