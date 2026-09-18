export const VIDEO_ZH_CN = {
  open: "导入视频",
  interval: "抽帧间隔（源帧）",
  importing: "正在解析视频并抽帧…",
  cancel: "取消抽帧",
  cancelled: "视频导入已取消，原项目未改变。",
  invalid: "视频项目信息无效或帧文件不完整，请重新导入视频。",
  frames: (count: number) => `已抽取 ${count} 帧`,
  replace: "导入视频将切换项目，请先保存当前标注。继续？",
  deleteDisabled: "视频帧不能单独删除，请保留完整帧序列。",
};
