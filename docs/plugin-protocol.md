# 插件协议 v1

插件代码进程与宿主通过标准输入/输出交换 UTF-8 NDJSON。协议版本独立于插件版本、
宿主 API 版本、业务能力版本和 manifest `schemaVersion`；当前协议版本为 `1`。
机器可读契约见 [`plugin-protocol.schema.json`](plugin-protocol.schema.json)。

## 传输与行限制

- 每行恰好一个 JSON 对象，以 `\n` 分隔；输入也接受 `\r\n`。
- v1 基线单行上限为 16 MiB（16,777,216 字节，不含 `\n` 或 `\r\n` 行尾）。
- `exporter` 代码插件进程使用能力限定的 72 MiB 上限（75,497,472 字节），仅用于
  容纳 50 MiB Base64 导出文件及 JSON 信封；其他插件类型仍执行 16 MiB 基线。
- 非法 JSON 返回 `PARSE_ERROR`。
- 非对象信封、缺失或不支持的 `v`、未知 `type`、非法消息形状返回
  `PROTOCOL_ERROR`。
- 收发两端都拒绝超长行并返回一次 `PROTOCOL_ERROR`；接收端丢弃该行直至下一个换行符，然后继续解析
  后续消息，不终止会话。

## 公共信封

所有消息包含以下字段：

```json
{ "v": 1, "id": "7", "type": "request" }
```

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `v` | `1` | NDJSON 协议版本，必需 |
| `id` | `string \| null` | 请求关联标识；请求、响应和事件必须为非空字符串，heartbeat 可为 `null` |
| `type` | `request \| response \| event \| control` | 消息类型 |

同一协议版本内允许增加可选字段；接收方必须忽略不认识的可选字段，不得据版本号推断
能力。

## 消息形状

### request

```json
{"v":1,"id":"7","type":"request","method":"exporter.export","params":{}}
```

`method` 为非空字符串，`params` 必须存在（可以为 `null`）。请求方产生并递增 `id`。

### response

成功响应只含 `result`：

```json
{"v":1,"id":"7","type":"response","result":{"written":3}}
```

失败响应只含 `error`：

```json
{"v":1,"id":"7","type":"response","error":{"code":"INVALID_ARGUMENT","message":"缺少输出目录","data":{"field":"outputDir"}}}
```

`result` 与 `error` 必须且只能出现一个；`data` 可选。响应回显请求 `id`。

### event

事件仅支持 `progress` 与 `log`，并通过 `id` 关联调用：

```json
{"v":1,"id":"7","type":"event","event":"progress","payload":{"percent":42.5,"message":"处理中"}}
{"v":1,"id":"7","type":"event","event":"progress","payload":{"message":"准备中"}}
{"v":1,"id":"7","type":"event","event":"log","payload":{"level":"info","message":"ready"}}
```

`payload` 必须是对象。`progress.payload.percent` 是可选数字；缺省表示无法计算百分比，
不表示 0%。

### control

```json
{"v":1,"id":"7","type":"control","action":"cancel"}
{"v":1,"id":null,"type":"control","action":"heartbeat"}
```

`cancel.id` 指向待取消请求。插件停止该调用后必须以 `CANCELLED` 错误响应结束。
`heartbeat` 用于双向探活，`id` 可为 `null` 或调用标识。

## 文件权限代理

插件只能在宿主发起的调用期间反向发送文件代理请求。安装授权时，manifest 中的
`%PROJECT%`、`%MODELS%`、`%APP_DATA%` 会解析为绝对目录并写入注册表；运行时以
解析后的目录级授权判定访问，未授权、`..` 穿越或经符号链接逃逸均返回
`PERMISSION_DENIED`，错误响应不得包含文件内容。

占位符根目录固定为：`%PROJECT%` = 当前打开的图片项目目录，`%MODELS%` =
应用数据目录下的 `models` 子目录，`%APP_DATA%` = 应用数据目录。旧版注册表若仍
保存占位符字符串，宿主会安全停用该插件，直到用户重新安装或更新并确认实际目录。

读取 UTF-8 文本：

```json
{"v":1,"id":"plugin-1","type":"request","method":"fs.read","params":{"path":"C:\\project\\images\\note.txt"}}
{"v":1,"id":"plugin-1","type":"response","result":{"contentUtf8":"..."}}
```

写入 UTF-8 文本：

```json
{"v":1,"id":"plugin-2","type":"request","method":"fs.write","params":{"path":"C:\\project\\exports\\result.txt","contentUtf8":"..."}}
{"v":1,"id":"plugin-2","type":"response","result":{"writtenBytes":3}}
```

`fs.read` 与 `fs.write` 分别校验，写授权不隐含读授权。为避免创建路径时的链接竞态，
v1 的 `fs.write` 只写入已存在的普通文件，不创建新文件；单文件/内容上限为 8 MiB，
每次宿主调用最多处理 8 个文件代理请求且累计预算不超过 64 MiB。
Windows 下文件代理拒绝远程卷，避免网络文件系统 I/O 绕过调用超时边界。
其他宿主代理方法（包括网络方法）在 v1 未实现，返回 `METHOD_NOT_FOUND`。代码型
插件进程启动时会移除常见代理环境变量；`network` 声明在 v1 不会开放网络代理。

## 配置迁移

插件清单和 `hello` 握手都声明 `configMigration: true` 时，宿主可调用
`config.migrate`。宿主只编排版本并透传不透明的 `config`，不会读取或改写其内容：

```json
{"v":1,"id":"config-1","type":"request","method":"config.migrate","params":{"fromVersion":1,"toVersion":2,"config":{"pluginOwned":true}}}
{"v":1,"id":"config-1","type":"response","result":{"configVersion":2,"config":{"pluginOwned":true,"addedByV2":true}}}
```

每次调用只迁移一个版本，`toVersion` 必须等于 `fromVersion + 1`；跨多版本时宿主按
顺序重复调用。响应 `configVersion` 必须等于本次 `toVersion` 且必须包含 `config`
字段，否则按 `PROTOCOL_ERROR` 处理并保留迁移前配置。调用超时、进程崩溃、无迁移
能力或结果非法时，项目照常打开，注册状态进入 `pending-migration`，相关能力不可用；
用户可重试。迁移结果只写回内存，在用户下一次保存项目时进入项目文件。

配置迁移属于宿主 API v1 的增量方法，NDJSON 信封和协议版本仍为 v1。迁移进程沿用
运行时的断网环境和权限模型，不开放网络代理。

## 导出格式插件

`exporter` 插件在 manifest 的可选 `exporterOptions.formats` 中静态声明格式；v1 不接受
运行时动态增删格式。每项包含稳定的插件内 `id`、`displayName`、不带点号的
`extensions` 和 `multiFile`。宿主调用 `exporter.export`：

```json
{"v":1,"id":"export-1","type":"request","method":"exporter.export","params":{"formatId":"labelme","exportData":{"labels":[],"images":[]},"options":{},"outputBaseName":"annotations"}}
```

`exportData` 是宿主现有 `AnnotationExport` 结构，包含标签快照与图片数组；图片 `path`
始终转换为项目相对路径，插件不会收到用户选择的输出目录。响应只返回待写文件：

```json
{"v":1,"id":"export-1","type":"response","result":{"files":[{"relativePath":"image-1.json","contentUtf8":"{}"}]}}
```

每个文件必须且只能包含 `contentUtf8` 或 `contentBase64`。宿主先完整校验响应，再统一
写盘：`relativePath` 必须非空、非绝对路径且不能包含 `.`/`..` 路径段，扩展名必须在
manifest 声明中；路径按大小写不敏感去重，并拒绝 Windows ADS、设备保留名及
reparse point。单文件和单次总计上限均为 50 MiB、最多 10,000 个文件；
`multiFile: false` 时必须恰好返回一个文件。任一文件
非法时本次响应不写入任何文件。

插件和 manifest/hello 同时声明 `progress` 后，插件可发送已有的进度事件驱动宿主
进度条；同时声明 `cancel` 后，宿主发送 `control.cancel`。取消后宿主最多等待 2 秒，
随后终止进程树并以 `CANCELLED` 结束。响应返回后仍先写入宿主暂存目录；发布前取消
会删除暂存目录且不写目标文件，进入不可取消的短发布阶段后取消接口返回未找到。
机器可读的参数与响应
结构见 [`plugin-exporter.schema.json`](plugin-exporter.schema.json)。

## 标准错误码

| 错误码 | 产生位置 |
| --- | --- |
| `PARSE_ERROR` | 解析层：非法 JSON/UTF-8 |
| `PROTOCOL_ERROR` | 解析层：信封或消息形状非法、超长行 |
| `METHOD_NOT_FOUND` | 分发层：方法不存在 |
| `PERMISSION_DENIED` | 权限代理：请求未获授权 |
| `TIMEOUT` | 运行时：调用超时并终止进程树 |
| `CANCELLED` | 运行时/插件：调用已取消 |
| `INTERNAL_ERROR` | 宿主或插件内部失败 |
| `CONFIG_MIGRATION_REQUIRED` | 配置版本变化且等待迁移 |
| `INVALID_ARGUMENT` | 方法参数不合法 |
| `API_VERSION_UNSUPPORTED` | 安装或 hello 协商的目标版本不受支持 |

解析层只产生 `PARSE_ERROR` 与 `PROTOCOL_ERROR`。其余错误码由协商、分发、权限或
运行时产生。

## hello 握手与能力缓存

宿主 spawn 插件后发送首条请求：

```json
{
  "v": 1,
  "id": "1",
  "type": "request",
  "method": "hello",
  "params": {
    "protocolVersion": 1,
    "hostApiVersion": 1,
    "supportedVersions": {
      "hostApi": [1],
      "exporter": [1],
      "prelabel": [1]
    }
  }
}
```

插件校验协议及其目标宿主 API/业务能力版本。不匹配时响应
`API_VERSION_UNSUPPORTED`；成功时返回实际能力声明：

```json
{
  "v": 1,
  "id": "1",
  "type": "response",
  "result": {
    "protocolVersion": 1,
    "capabilities": {
      "exporter": true,
      "prelabel": false,
      "batch": true,
      "progress": true,
      "cancel": true,
      "configMigration": false
    }
  }
}
```

能力字段全部可选且缺省为 `false`（不支持）。宿主只缓存插件实际声明的能力；后续
调用以该会话缓存为准，禁止从插件版本、宿主 API 版本或 manifest 推断实际能力。
