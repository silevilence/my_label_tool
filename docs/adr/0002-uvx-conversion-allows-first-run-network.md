# uvx 转换模式允许首次联网安装 ultralytics

`.pt` 自动转换在 PATH 仅有 uv 时经 `uvx --from ultralytics yolo` 执行，首次运行必须联网下载安装 ultralytics 依赖，与「运行期离线」原则（ADR 0001）冲突。决定：uvx 模式放宽网络限制（不注入 `PIP_NO_INDEX`/`HF_HUB_OFFLINE`），保留 `YOLO_AUTOINSTALL=false` 与 `YOLO_OFFLINE=true`；yolo-cli / python-ultralytics 模式维持全量离线环境变量。用户点击「转换」即视为对该次联网的显式授权。

**Status**: accepted

**Considered Options**
- 全模式保持离线变量：uvx 首装必然失败，uv 兜底形同虚设
- 转换前提示用户手动安装：把可自动化路径退回手动指引，与「可视化首装」需求相悖
- 仅 uvx 模式放宽（选定）：联网范围最小化，仅首次装依赖；转换计算本身仍离线

**Consequences**
- uvx 模式首次转换依赖网络；断网时借助实时输出明确提示安装依赖失败
- 后续转换命中 uv 缓存，不再联网
- 参数弹窗/转换面板需提示首次转换将联网下载依赖
