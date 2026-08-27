# my_label_tool 标注工具上下文

图片/视频标注桌面工具（Tauri 2 + React）。本上下文覆盖两个领域的语言约定：「预打标链路」中 `.pt` 模型自动转换，以及插件系统。

## Language

**转换方法 (Conversion Method)**:
`.pt` 模型转换为 ONNX 时采用的执行环境方式。取值：`yolo-cli`（PATH 上的 yolo 命令直接执行）、`python-ultralytics`（PATH 上的 Python 且已安装 yolo 相关模块）、`uvx-yolo`（PATH 上的 uv，经 `uvx` 运行 yolo 命令）。
_Avoid_: 转换器、converter、执行器

**转换参数 (Conversion Parameters)**:
发起 .pt 转换时可由用户确认或修改的参数。当前为 `imgsz`（默认 640，32 的倍数）与 `simplify`（默认关闭）；弹窗始终预填默认值，不持久化。
_Avoid_: 配置项、导出参数

## 插件系统 (Plugin System)

**插件 (Plugin)**:
独立打包、可安装启用的功能扩展单元；zip 格式打包，后缀不限。按扩展类型分数据型（预置标签）与代码型（导出格式、外部预打标程序）。
_Avoid_: 扩展、模块、addon

**扩展类型 (Extension Kind)**:
插件在清单中声明的能力类别。v1 取值：`label-preset`（预置标签，纯数据）、`exporter`（保存/导出格式扩展）、`prelabel`（外部预打标程序）。
_Avoid_: 插件分类、category

**插件清单 (Manifest)**:
插件包内的声明文件，包含 ID、名称、插件版本、宿主 API 兼容区间、运行时与入口命令、能力声明、权限清单、配置版本，以及可选的调用超时 `timeoutMs`（缺省 30000 毫秒，上限 300000 毫秒）。
_Avoid_: 元数据、插件配置

**插件 ID (Plugin ID)**:
反向域名命名空间的永久稳定标识（如 `dev.acme.xxx`）。名称可改，ID 一经发布不得复用。
_Avoid_: 插件名、slug

**标签预置 (Label Preset)**:
`label-preset` 数据型插件在包根 `labels.json` 提供的只读 `LabelTemplate`。模板与标签 ID
使用插件 ID 命名空间；加载后进入项目标签快照，插件更新、停用或卸载不回写已加载项目。
_Avoid_: 标签包、在线模板

**插件导出格式 (Plugin Export Format)**:
`exporter` 代码型插件在 manifest `exporterOptions.formats` 中静态声明的格式。插件通过
`exporter.export` 返回相对路径与文件内容，宿主先校验全部文件再写入用户选择目录；
插件不接触输出目录。

`prelabel` 代码型插件是与内置 ONNX 管线并存的预打标来源。插件只接收项目相对图片
路径，通过 `fs.read:%PROJECT%` 代理读取图片，并返回原图像素坐标的标注图形；宿主
负责类别映射、结果校验、按图片合并与撤销历史。
_Avoid_: 外部导出器、动态格式

**宿主 API 版本 (Host API Version)**:
宿主暴露给插件的能力接口版本号，独立递增，与主程序版本号互不绑定（主程序发版不得顺手同步 bump）。分两层：整体版本（覆盖 `hello`/`fs`/`config.migrate` 等基础能力）与业务能力版本（`exporter`/`prelabel` 各自独立）。同一版本号内宿主承诺增量兼容；破坏性变更必须开新版本号，旧版本实现按弃用期保留后移除，宿主按插件声明的目标版本分派对应实现（见 ADR 0007）。
_Avoid_: 接口版本、API 兼容区间

**目标版本 (Target API Version)**:
插件清单 `apiVersion.min` 声明的宿主 API 版本，表示插件编写所针对的确切版本；宿主按此版本分派对应实现，版本不匹配时以 `API_VERSION_UNSUPPORTED` 拒绝。
_Avoid_: 兼容范围、最低版本

**能力 (Capability)**:
插件启动握手时声明的实际支持项：标注类型、批处理、进度、取消、配置迁移。宿主以能力声明为准，不以版本号推断。
_Avoid_: 特性、功能列表

**权限授予 (Permission Grant)**:
宿主授予插件的资源访问权。v1 权限面为 `fs.read` / `fs.write`（安装授权时把目录占位符解析为绝对路径后落盘）与 `network`，默认全部拒绝；v1 不提供网络代理。
_Avoid_: 权限、access

**授权 (Authorization)**:
安装或权限变更时，用户对权限清单的逐项确认动作。未经授权的访问在运行时返回 `PERMISSION_DENIED`。
_Avoid_: 审批、放行

**插件配置 (Plugin Config)**:
项目保存的插件状态三元组 `pluginId + configVersion + config`；config 对宿主不透明，宿主不解释其内容。
_Avoid_: 插件设置、配置项

**配置迁移 (Config Migration)**:
插件配置版本落后时，宿主经 `config.migrate` 调用由插件升级配置的过程。失败时配置标记「待迁移」、相关能力降级，项目照常打开。
_Avoid_: 升级、数据迁移

**安全模式 (Safe Mode)**:
手动开关的排查状态：禁用全部代码型插件，保留数据型插件（预置标签）。
_Avoid_: 恢复模式、诊断模式

**自动禁用 (Auto-Disable)**:
同一插件连续 3 次调用失败或启动崩溃后进入禁用态；需用户手动重新启用。
_Avoid_: 熔断、封禁

**标准错误码 (Error Code)**:
协议规定的错误标识集合：`PARSE_ERROR`、`PROTOCOL_ERROR`、`METHOD_NOT_FOUND`、`PERMISSION_DENIED`、`TIMEOUT`、`CANCELLED`、`INTERNAL_ERROR`、`CONFIG_MIGRATION_REQUIRED`、`INVALID_ARGUMENT`、`API_VERSION_UNSUPPORTED`（协商阶段插件声明版本与宿主支持版本不匹配）。
_Avoid_: 异常、错误信息

**调用 (Call)**:
宿主向插件进程发起的一次请求-响应事务；默认超时 30 秒，可关联进度事件与取消控制。
_Avoid_: 请求、任务

**注册 (Registration)**:
插件安装流程的收尾环节：发现 → 静态校验 → 兼容性协商 → 授权 → 注册 → 启用。
_Avoid_: 安装流程、登记
