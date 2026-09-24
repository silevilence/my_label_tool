# 内部脚本协议 v1

本协议独立于插件协议与宿主 API，遵守 ADR 0013–0015。仅允许用户显式执行文本脚本，项目文件不携带脚本。

## 传输与事务

UTF-8 NDJSON，单行上限 8 MiB（含换行）。启动发送
`{"op":"hello","version":1,"limits":{"maxMemoryMiB":256,"timeoutSeconds":30}}`，
宿主回答 `{"event":"ready","version":1}`。版本不匹配拒绝启动。
随后发送任意多段 `{"op":"section","name":"labels"或"images","items":[...]}`；
最后发送 `{"op":"execute","source":"Lua 文本"}`。所有信封容忍未知字段，未知操作返回 METHOD_NOT_FOUND；已知字段类型错误返回 INVALID_ARGUMENT。

labels 段为当前 LabelConfig 数组；images 段为 `{path,name,annotations,size?}` 数组。
annotations 遵守原图像素坐标，size 为可选 `{width,height}`，默认不传。
图片路径仅作为快照内定位键，不能用于文件访问。标签查询支持 name → id 与 id → name，缺失或重名均报错，不取首项。

脚本只执行一次，看到整份快照，分块不改变结果；分块不是内存限额。
宿主用 `result` 事件返回 `{imagePath,annotations}`，最后发送 `done`。
失败发送 `failed` 与 `errors:[{code,message,imagePath?}]`。
前端在 done 且进程正常退出后校验全部结果，任何错误均丢弃整轮结果。
提交是覆盖指定图片全表，未提交不变，重复提交取最后一次；读取始终返回原始快照。
新图形可省略 id，由主程序补齐。核心合法性由共享 `annotation-validation.ts` 校验，宿主不另建一份共同规则。

## 脚本命令

入口 `annotool.<name>(args)`，例如 `annotool.images()`、`annotool.annotations {imagePath="a.png"}`。
兼容入口 `annotool.call(name, args)` 保留；两种入口共用参数校验、返回值转换与失败登记。
常量 `annotool.API_VERSION == 1`；直接函数是兼容性增量，传输协议不变。
命令唯一注册表为 `src-tauri/script-host/src/commands.rs`（含参数、结果、错误、所需段落与实现函数），Lua 直接函数由该表自动生成。

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| images | 无 | `{path,name}[]` |
| label | `{name}` 或 `{id}`，恰好一个 | LabelConfig |
| annotations | `{imagePath}` | AnnotationShape[] |
| submit | `{imagePath,annotations}` | true |
| size | `{imagePath}` | `{width,height}` |
| progress | `{completed,total}`，非负整数、total > 0、completed ≤ total | true |
| log | `{message}` | true |

读写标注没有格式、模式或解析选项。未知参数字段容忍以便增量演进，但不会改变读写语义。
命令错误会登记为运行失败，即使脚本用 pcall 捕获也不能提交部分结果。
progress/log 分别产生同名事件，进度字段同参数。

## 错误

PARSE_ERROR（JSON 解析）、PROTOCOL_ERROR（顺序/传输/异常结束）、VERSION_UNSUPPORTED、
METHOD_NOT_FOUND、INVALID_ARGUMENT、IMAGE_NOT_FOUND、LABEL_NOT_FOUND、LABEL_AMBIGUOUS、
DIMENSIONS_UNAVAILABLE、INVALID_ANNOTATION（前端共享校验）、SCRIPT_ERROR、MEMORY_LIMIT、
TIMEOUT、CANCELLED、LINE_LIMIT、HOST_UNAVAILABLE。任何失败不写回。

## 扩展

只依赖已有快照：注册一个命令及实现。需要新数据：增加一个可选快照段落及构建逻辑。
每个命令必须在 `examples/scripts/catalog.json` 登记对应的可执行 `.lua` 示例；新增或修改接口时同步更新示例、界面说明和用户指南。前端与真实宿主验收共用这份目录，宿主测试检查全部注册命令的示例覆盖与执行结果，具体规范见 `AGENTS.md` §7。
需要宿主动作或惰性拉取：先开 ADR，新增反向请求方向及生命周期控制；v1 不提供。
新可选字段必须保持旧字段语义，破坏性变更使用新协议版本并协商。

## 契约验收

`cargo test --manifest-path src-tauri/script-host/Cargo.toml`。
`script-conformance-stub` 按同一协议收发，execute.source 可设 normal、timeout、crash、line-limit。
真实脚本见 `examples/scripts/`，无标签 id 字面量。
