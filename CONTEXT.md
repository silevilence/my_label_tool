# my_label_tool 标注工具上下文

图片/视频标注桌面工具（Tauri 2 + React）。本上下文覆盖「预打标链路」中 `.pt` 模型自动转换领域的语言约定。

## Language

**转换方法 (Conversion Method)**:
`.pt` 模型转换为 ONNX 时采用的执行环境方式。取值：`yolo-cli`（PATH 上的 yolo 命令直接执行）、`python-ultralytics`（PATH 上的 Python 且已安装 yolo 相关模块）、`uvx-yolo`（PATH 上的 uv，经 `uvx` 运行 yolo 命令）。
_Avoid_: 转换器、converter、执行器

**转换参数 (Conversion Parameters)**:
发起 .pt 转换时可由用户确认或修改的参数。当前为 `imgsz`（默认 640，32 的倍数）与 `simplify`（默认关闭）；弹窗始终预填默认值，不持久化。
_Avoid_: 配置项、导出参数

**uvx 首装 (uvx First-Run Install)**:
PATH 仅有 uv 时，经 `uvx` 首次执行转换需要联网下载安装 ultralytics 依赖的过程。命中 uv 缓存后不再联网。
_Avoid_: 装包、初始化安装
