export const TEXT_READ_ZH_CN = {
  title: "文本读取适配器",
  readFiles: (count: number) => `读取文本（${count} 个文件）`,
  mode: "读取模式",
  timeout: "超时（毫秒）",
  preview: "预览读取命令",
  check: "重新自检",
  save: "自检并保存",
  cancel: "取消读取",
  cancelled: "文本读取已取消，未应用读取结果。",
  native: "由宿主直接读取，不启动外部程序。",
  hint: '命令通过 stdin 接收 {"paths":["绝对路径"]}，stdout 须返回同序的 UTF-8 JSON 字符串数组。参数不经 shell 解析。请先预览命令。',
  writeHint:
    "仅影响本机文本读取。写入仍由宿主完成；受控环境下写入后回读校验不成立，保存成败以写入调用返回为准。",
  saved: "读取配置已保存，立即生效。可重新打开项目或重试之前失败的读取。",
  noCheck: "尚未执行读取自检",
  lastCheck: "最近一次自检",
  loading: "正在读取设置…",
} as const;
