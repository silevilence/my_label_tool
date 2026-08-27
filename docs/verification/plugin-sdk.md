# 插件 SDK 与开发者工具验收记录

执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-plugin-sdk.ps1
```

脚本离线验证：

- 三个示例目录均通过 Rust manifest/包结构校验器
- Node 打包脚本分别产出可被宿主 zip 读取的插件包
- 自定义后缀可用；多余顶层文件、不安全 manifest 文件名与超限文件会在写出前拒绝
- 独立 Rust 桩进程完成握手、消息、错误码、进度、取消和 16 MiB 基线边界用例
- exporter 额外验证能力限定的 72 MiB 收发边界，可容纳单个 50 MiB Base64 文件
- 本机 Python 可用时，示例额外验证 hello 版本协商与协议错误分类
- manifest schema、标签预置 schema、协议文档、示例与校验工具使用同一 v1 契约
