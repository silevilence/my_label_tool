export const PRELABEL_RESOURCE_ZH_CN = {
  title: "预打标资源限制",
  memory: "预打标最大内存占用（MiB）",
  candidates: "预打标最大原始候选框数量",
  scope:
    "仅用于内置 ONNX 预打标。内存预算包含输出张量及一份副本，不包含模型权重、中间层、图片处理或显存，因此不代表整个推理过程的内存峰值。",
  hint: "保存后用于新发起的模型校验和推理；已开始的推理调用保持原预算。原始候选框按置信度过滤前的数量计算。",
  conversion: (memory: number, elements: number, candidates: number) =>
    `内置 ONNX 预算 ${memory.toLocaleString("zh-CN")} MiB ÷ 8 字节/元素（输出及副本）＝最多 ${elements.toLocaleString("zh-CN")} 个输出元素；最多 ${candidates.toLocaleString("zh-CN")} 个原始候选框。`,
  modelHint: "可在「设置 → 预打标资源限制」中调整上限。",
  invalidMemory: "内存上限必须是 1–8589934591 MiB 的整数。",
  invalidCandidates: "原始候选框上限必须是 1–9007199254740991 的整数。",
  loading: "正在读取预打标资源设置…",
  save: "保存资源设置",
  saving: "正在保存…",
  saved: "资源设置已保存",
  defaults: "填入默认值",
  retry: "重新读取",
  discardReload: "重新读取将丢弃尚未保存的资源设置，是否继续？",
  loadFailed: (error: unknown) => `预打标资源设置读取失败：${String(error)}`,
  saveFailed: (error: unknown) => `预打标资源设置保存失败：${String(error)}`,
  busy: "资源设置正在读写，请稍后重试。",
  discard: "预打标资源设置尚未保存，是否放弃修改并关闭？",
};
