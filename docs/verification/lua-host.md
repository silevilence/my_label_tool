# Lua 宿主原型与隔离验收

选择标准 Lua 5.4（mlua 0.12，vendored 静态编译），无需用户安装解释器。
未选择 Luau：进程上限已经覆盖 Lua 堆、Rust 快照及结果缓冲，不需要换方言获得这一约束。
mlua 内存和文本 chunk 接口依据 [官方 API](https://docs.rs/mlua/0.12.1/mlua/struct.Lua.html)。

可复跑：`cargo test --manifest-path src-tauri/script-host/Cargo.toml`。

- `vm::tests`：三个真实脚本、io/os/require/debug/dofile/load、字节码、巨量 Lua 分配、死循环、捕获命令错误仍整体失败。
- `tests/host.rs`：真实二进制通过 NDJSON 处理四图；分块大小 1 与 4 的输出完全一致。
- 相同进程测试发送 150 个 1 MiB 快照项，配置 64 MiB，在执行 Lua 前以 125 退出，验证快照也受内存限制。
- 无限 pcall 循环在 2 秒总时限以 124 退出，避免 Lua 捕获 hook 错误绕过时限。

Windows 使用 Job Object 的 ProcessMemoryLimit（提交内存）；Unix 使用 RLIMIT_AS（地址空间，包含映射）。
Rust 分配失败无额外分配地以 125 退出；Lua 堆预算为进程预算的一半，分配失败返回 MEMORY_LIMIT。
总时限覆盖收快照、执行和发结果，runner 另有独立看门狗与取消。
上限是拒绝执行/终止，绝不截断快照或部分写回。

Windows 原型上述测试通过。默认采用 256 MiB / 30 秒：64 MiB 已通过小样例，256 MiB 为解析和双份数据留余量；它不是项目规模承诺。
可配置范围 64–4096 MiB、1–3600 秒；具体可处理规模取决于标注数与脚本分配，失败时增加上限或缩小作用域。
Linux 容器（Podman / Debian bookworm）同组测试通过：六个库测试及两个真实进程测试，
包括 RLIMIT_AS 快照超限与看门狗终止，均未截断或返回部分成功。

## 桌面界面验收（2026-09-24）

使用独立应用标识 `com.mylabeltool.scriptqa` 与两张合成图片，不接触已有用户项目。
每张图片一份矩形标注，标签名为「车辆」「汽车」。真实 Tauri → runner → Lua 宿主链路：

- 默认编号脚本开启差异预览，显示两图修改、零新增/删除/跳过；第一图预览属性 sequence 为 1。
- 应用整轮结果，报告数字一致；撤销一次清空本轮历史，普通重做一次恢复全部两图。
- 通过既有保存按钮保存，检查 JSON：两图的 sequence 分别为 1、2，坐标和标签不变。
- 重新打开该目录，加载两图标注，历史为空、统计为已标注 2/2。
- 缩放至 160% 后矩形与合成图片矩形对齐，右方向键切至第二图后仍对齐。
- 预览的应用按钮和取消按钮可通过面板滚动到达；本次未新增或改绑快捷键。

## 插件契约影响核对

本次新增命令仅供宿主 UI，未暴露给插件；AnnotationShape、LabelConfig、ProjectConfig 与
插件导出/预打标协议结构未改动。共享校验提取维持既有核心约束。
manifest schemaVersion、插件协议、整体宿主 API、exporter/prelabel 能力版本均保持 1；
与任务起点比较，插件 manifest、协议和 API 版本实现无差异。不随主程序或脚本版本递增。

## 交付形态验收

`scripts/verify-script-host.ps1` 在 Windows 生产宿主和容器镜像上均通过三个真实示例：
按名称改派标签、坐标修正、跨图连续编号，每项核对两张图片的结果。
容器以非 root 身份、只读文件系统、无网络、无项目挂载运行。
桌面资源含 `script-tools/label-script-host.exe` 与 Lua/mlua 许可；容器交付相同源码编译的
独立 NDJSON 宿主。完整服务端应用仍属计划任务，普通浏览器未连接宿主时如实显示不可用。
