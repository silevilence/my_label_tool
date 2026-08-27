# 插件使用与开发指南

本指南对应插件 manifest schema v1、宿主 API v1 与 NDJSON 协议 v1。插件在本地离线
运行；代码型插件是独立进程，可能执行任意代码，因此只应安装可信来源的包。

## 用户指南

### 安装与授权

1. 在「设置 → 插件管理」选择插件 zip。
2. 核对插件 id、版本、扩展类型与“未验证作者”提示。
3. 逐项检查权限解析后的真实目录，只勾选准备授予的权限。manifest 未声明的权限不能
   临时追加；拒绝任一声明即取消本次安装。
4. 安装后可独立启用、停用、清除故障计数或卸载插件。更新同一 id 的插件会保留既有
   授权与项目内配置；卸载不删除项目文件中的配置快照。

`network` 在 v1 始终拒绝。`fs.read` 与 `fs.write` 分开授权，写权限不隐含读权限；
`%PROJECT%`、`%MODELS%`、`%APP_DATA%` 会在安装授权时解析成真实目录。

### 安全模式与故障隔离

- 安全模式禁用全部代码型插件，但保留纯数据 `label-preset` 插件。
- 单次调用使用 manifest 的 `timeoutMs`（默认 30 秒）；超时会终止插件进程树。
- 连续失败 3 次后插件自动停用；检查日志并修复后可手动清除故障计数再启用。
- 配置迁移失败时项目仍可打开，插件显示「配置待迁移」，业务入口不可用；在插件管理
  中点击「重试迁移」。迁移成功前不会覆盖原配置。

### 故障排查

1. 在插件管理中查看注册状态、最近错误和 stderr 日志。stdout 专用于 NDJSON，任何
   调试打印都必须写入 stderr。
2. `PARSE_ERROR` 通常表示 stdout 混入普通文本或 JSON 不完整；
   `PROTOCOL_ERROR` 表示信封/字段/行限制不合规（v1 基线 16 MiB，exporter 进程
   因 50 MiB 文件响应使用能力限定的 72 MiB 上限）；
   `API_VERSION_UNSUPPORTED` 表示目标 API 不受宿主支持。
3. `PERMISSION_DENIED` 时核对 manifest 声明与安装时解析后的实际目录。不要尝试通过
   `..`、符号链接或网络路径绕过授权。
4. 用本文的校验器和 conformance 测试先在命令行复现，再回到应用重试。

## 开发者指南

### 最小目录结构

```text
label-preset-plugin/
├── manifest.json
└── labels.json

code-plugin/
├── manifest.json
└── plugin/
    └── main.py、可执行文件或运行资源
```

打包脚本按扩展类型限制根目录：`label-preset` 只接受 `manifest.json` 与必需的
`labels.json`；代码型插件只接受 `manifest.json` 与可选 `plugin/`。这样可以避免把
源码缓存、密钥或构建产物误装入插件包。入口路径与资源路径均相对包根目录。

### 编写 manifest

以 [prelabel-demo](../examples/plugins/prelabel-demo/manifest.json) 为例：

```json
{
  "schemaVersion": 1,
  "id": "dev.example.prelabel",
  "name": "示例预打标",
  "version": "1.0.0",
  "apiVersion": { "min": 1 },
  "extensionKind": "prelabel",
  "runtime": "process",
  "entry": { "command": "python", "args": ["plugin/main.py"] },
  "prelabelOptions": { "classNames": ["example-object"] },
  "capabilities": {
    "annotationTypes": ["rect"],
    "batch": true,
    "progress": true,
    "cancel": true,
    "prelabel": { "apiVersion": { "min": 1 } }
  },
  "permissions": ["fs.read:%PROJECT%"],
  "timeoutMs": 30000
}
```

- `id` 使用稳定的反向域名命名空间，发布后不得变更或复用。
- 插件版本、宿主 API、业务能力、协议和 manifest schema 独立维护。
- 只声明实际实现并在 `hello` 中再次确认的能力；宿主以握手结果为准。
- `label-preset` 是纯数据扩展，不得声明 `runtime`/`entry`；代码型 exporter/prelabel
  必须声明 `runtime: "process"` 与入口。
- `label-preset` 的包根 `labels.json` 复用 `LabelTemplate` 结构。模板与标签 ID 必须在
  插件 ID 命名空间内，标签 ID/快捷键必须唯一；完整结构见
  [plugin-label-preset.schema.json](plugin-label-preset.schema.json)。安装时宿主会同时执行
  Schema 等价的严格结构校验与命名空间、唯一性语义校验；文件上限为 1 MiB。
- `exporter` 通过可选 `exporterOptions.formats` 静态声明格式。插件只返回相对路径和
  UTF-8/Base64 内容，宿主在完整校验后写入用户选择目录；插件不会收到输出目录。
  请求/响应、50 MiB 单文件限制、进度与取消语义见
  [plugin-exporter.schema.json](plugin-exporter.schema.json) 和
  [plugin-protocol.md](plugin-protocol.md#导出格式插件)。
- `prelabel` 必须声明非空 `annotationTypes` 与当前项目根读取权限；授权与打开项目绑定，
  切换项目后需重新授权。可选
  `prelabelOptions.classNames` 复用现有类别映射面板。图片路径按项目相对路径传递，插件
  用 Base64 文件代理读取图片；请求/响应与像素坐标校验见
  [plugin-prelabel.schema.json](plugin-prelabel.schema.json) 和
  [plugin-protocol.md](plugin-protocol.md#外部预打标插件)。
- 完整约束见 [plugin-manifest.schema.json](plugin-manifest.schema.json)，版本与兼容策略
  见 [plugin-api-versioning.md](plugin-api-versioning.md)。

### 实现 NDJSON 协议

插件逐行读取 stdin，并将每个响应/事件作为单行 UTF-8 JSON 写到 stdout 后立即 flush。
首个调用是 `hello`；响应必须回显 id、返回 `protocolVersion` 和实际能力。业务调用可先
发送同 id 的 `progress`/`log` 事件，最终只发送一个成功或错误响应。收到
`{"type":"control","action":"cancel"}` 后停止对应调用，并以 `CANCELLED` 响应结束。

单行基线上限 16 MiB；仅 exporter 进程使用 72 MiB 的能力限定上限。stdout 不得输出 banner、traceback 或调试文本；使用
stderr 打印，例如 Python 的 `print("debug", file=sys.stderr, flush=True)`。完整信封、
配置迁移、文件代理和十个标准错误码见 [plugin-protocol.md](plugin-protocol.md)。

标准错误码：`PARSE_ERROR`、`PROTOCOL_ERROR`、`METHOD_NOT_FOUND`、
`PERMISSION_DENIED`、`TIMEOUT`、`CANCELLED`、`INTERNAL_ERROR`、
`CONFIG_MIGRATION_REQUIRED`、`INVALID_ARGUMENT`、`API_VERSION_UNSUPPORTED`。

### 离线校验

校验目录或 zip，输出机器可读 JSON（包含规范化 manifest、权限清单与字段级问题）：

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --bin plugin-validator -- examples/plugins/prelabel-demo
cargo run --manifest-path src-tauri/Cargo.toml --bin plugin-validator -- plugin.zip
```

退出码：`0` 通过、`1` 契约校验失败、`2` 来源/参数等调用错误。校验器不会安装或执行
插件，也不会访问网络；Python 入口只验证声明与包结构，不探测系统 Python。

### 打包

脚本仅使用 Node 内置模块，产出标准 ZIP（store 模式）。它会先校验用于默认文件名的
manifest id/SemVer，并在分配缓冲区前按文件统计单文件 50 MiB、总计 200 MiB 上限，
避免路径逃逸和超限读入。默认输出到源目录同级；输出已存在时拒绝覆盖。

```powershell
node scripts/package-plugin.mjs examples/plugins/prelabel-demo
node scripts/package-plugin.mjs examples/plugins/prelabel-demo --extension .mlt-plugin
node scripts/package-plugin.mjs examples/plugins/prelabel-demo --output target/prelabel.zip --force
node scripts/package-plugin.mjs examples/plugins/exporter-labelme-demo
```

已启用的标签预置会出现在“加载预置模板”列表，并显示“插件：插件名”来源。加载动作
复用现有模板语义；加载后的标签成为项目快照，因此插件更新、停用或卸载只改变后续
可选列表，不会改写当前项目的标签、既有标注或导出结果。应用重启后会从注册表恢复
已启用的预置列表。插件模板为只读，修改后需另存为用户模板。

### Conformance 自测与打印式调试

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test plugin_conformance
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-plugin-sdk.ps1
```

测试会启动同仓库的独立 Rust 桩进程，覆盖四类消息、握手、全部错误码、进度、取消和
16 MiB 基线边界（并验证 exporter 的 72 MiB 能力限定边界）。开发时可先直接运行入口，逐行粘贴 `hello` 请求；保持 stdout 纯净，把
接收参数、分支和异常打印到 stderr。仓库提供以下起点：
[label-preset-demo](../examples/plugins/label-preset-demo) 与
[prelabel-demo](../examples/plugins/prelabel-demo)，以及可直接导出 LabelMe JSON、演示进度
与取消的 [exporter-labelme-demo](../examples/plugins/exporter-labelme-demo)。
