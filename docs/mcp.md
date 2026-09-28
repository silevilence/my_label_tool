# 内嵌 MCP 接口（v1）

## 已确认的产品边界

桌面应用内嵌 Rust HTTP 服务，不依赖 Node/Python 运行时，不访问模型服务。
启动应用自动启动服务；用户可停止、修改回环监听地址和端口（默认 127.0.0.1:1421）。
退出关闭监听、会话和未完成请求。启动失败在界面显示，不阻塞人工标注。
随机 256 位 Bearer 令牌首次生成后持久保存，永久有效，只有用户手动刷新才替换。
刷新同时废弃全部会话及控制权；日志、工具输出和导出数据不得含令牌。

## 协议与兼容范围

端点 `/mcp`；JSON-RPC 2.0 单消息 POST，返回 application/json。
支持协商 2025-03-26、2025-06-18、2025-11-25；未知版本返回服务器支持的最新版本，由客户端决定是否继续。
初始化返回 `Mcp-Session-Id`，后续请求必须携带；支持 initialized、ping、tools/list、tools/call。
GET 返回 405（不提供独立 SSE 流），DELETE 关闭会话。通知返回空 202。
不提供 2024-11-05 的旧 SSE 端点，不支持跳过初始化的客户端，不宣称 OAuth 自动发现。
工具结果同时提供 text JSON；支持的新版协议可同时使用 structuredContent。
长任务通过领域工具返回 taskId，并用任务查询/取消工具追踪，不声明 MCP 实验性 tasks 能力。

依据：[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)、
[生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)。

## 工具清单

工具名称、描述、参数上限和输入 JSON Schema 的机器可读清单为 `docs/mcp-tools.json`，
实现直接加载该清单，避免工具发现与参数校验两份定义漂移。

所有输入均为 JSON 对象，拒绝未知字段。查询返回的 projectId、imageId、labelId、annotationId、
leaseId、taskId 是后续调用的唯一引用，客户端不传绝对路径。
projectId 标识一次打开的项目，imageId 是项目内图片的稳定标识；重新打开项目必须重新查询。
任何写入均携带 projectId、expectedRevision、leaseId；版本不符整体拒绝。

| 工具 | 输入 | 输出 / 权限 |
| --- | --- | --- |
| app_state | 无 | 服务就绪、当前项目标识、revision、控制权和图片数量；只读 |
| project_read | 无 | projectId、revision、标签、图片标识及帧号、已配置模型标识；不返回绝对路径 |
| annotations_read | projectId, imageId | 当前图片标注、revision；只读 |
| control_request | projectId, permissions[] | pending 控制状态；权限为 annotations/save/export/prelabel |
| control_status | 无 | human/pending/mcp/locked、所有者、leaseId（仅所有者）、到期时间 |
| control_renew | leaseId | 新到期时间；仅当前所有者 |
| control_release | leaseId | 释放结果；仅当前所有者 |
| annotations_apply | projectId, expectedRevision, leaseId, changes[] | 原子事务结果、新 revision；annotations 权限 |
| project_save | projectId, expectedRevision, leaseId | taskId；save 权限、只写界面确认的位置 |
| project_export | projectId, expectedRevision, leaseId, format | taskId；export 权限、仅 UI 授权目录 |
| prelabel_start | projectId, expectedRevision, leaseId, modelId, imageIds[] | taskId；prelabel 权限、已配置本地模型 |
| task_status | taskId | running/completed/failed/cancelled、进度及失败码；仅任务所有者 |
| task_cancel | taskId | 取消受理结果；仅任务所有者 |

`changes` 每项为 `{imageId, operation, annotation?, annotationId?}`；operation 为 add/update/delete。
add/update 的 annotation 为完整 AnnotationShape，update/delete 必须指向已有 ID。
同次请求依次作用于暂存快照，全部通过共享校验后一次提交；单项无效时全部不写入。
一次调用为一个可撤销事务，沿用原图像素、标签图形约束与 bindFrame 源帧号语义。
MCP 使用共享 `validateAnnotationCore` 的精确坐标入口：矩形恰好四项且宽高为正，
关键点恰好两项，多边形至少三对坐标。既有导入/插件调用保留原有格式归一化契约。
不改变 AnnotationShape、LabelConfig、ProjectConfig、插件 schema 或任何插件版本。
内置 JSON/COCO/VOC/YOLO/custom 导出复用现有序列化；不开放安装插件、下载、任意命令或删图。

## 控制权与人工优先

初始 human；每次申请由界面批准，60 秒未处理失效。批准时分别授予四种权限。
租约 5 分钟，可显式续租。只有一个会话持有控制权；现有冲突操作未结束时不能批准。
MCP 持有租约时，人工冲突输入、快捷键及写操作暂停；状态与人工收回入口持续可见。
人工收回立即使租约失效，取消未完成任务，拒绝迟到结果；已完成变更保留、可撤销。
用户可按分钟锁定所有 MCP 写操作，锁定到期回到 human；鉴权后的只读仍可调用。
会话 DELETE 立即释放，异常退出以 60 秒无活动检测释放；普通 HTTP 响应结束不算断连。
客户端持有控制权时至少每 30 秒 ping 或查询一次；租约续期不能替代会话活动检测。
停止服务、刷新令牌、项目切换、前端卸载同样撤销租约及未完成任务。

## 安全与限额

- 只接受 IPv4/IPv6 回环监听；校验 Host 与实际监听端口，拒绝 DNS 重绑定。
- 缺失 Origin 允许原生客户端；存在 Origin 时只接受该服务的回环来源；不开放通配 CORS。
- 所有端点、方法先验 Bearer；无令牌/令牌错误 401，来源错误 403。
- 不把任何现有 Tauri command 直接映射成 HTTP 方法；管理配置只在宿主 UI 可用。
- 只读结果不含绝对路径、模型路径、令牌或配置秘密。客户端只能引用当前项目枚举的 ID。
- 磁盘输出在宿主校验授权位置和重解析点/符号链接；拒绝路径逃逸、特殊文件和危险文件覆盖。
- 保存只复用当前项目已确认的位置；导出覆盖既有文件由人工另行确认。
- 请求体最多 2 MiB，会话最多 16 个，每会话每分钟最多 120 请求，全局待处理请求最多 32。
- 单次标注变更最多 1000 条；普通桥接请求 10 秒超时；任务有取消和总超时。
- 界面提供有界审计记录（最近 200 项：时间、会话、工具、结果），不记录令牌/完整参数/标注内容。

HTTP 层：400 非法协议/缺失会话，401 鉴权，403 来源，404 会话失效，405 不支持方法，
413 请求过大，429 限流，503 宿主未就绪。JSON-RPC 使用 -32700/-32600/-32601/-32602。
领域失败用工具 `isError: true` 与 `{code, message}`：INVALID_ARGUMENT、NOT_READY、
NOT_FOUND、PERMISSION_DENIED、CONTROL_PENDING、CONTROL_DENIED、CONTROL_REVOKED、
CONTROL_LOCKED、CONFLICT、BUSY、TIMEOUT、CANCELLED、TASK_FAILED、INTERNAL_ERROR。
客户端不得对冲突/超时盲目重放写操作，先读取状态确认结果，再重新申请/提交。

## 连接与操作步骤

在顶部「连接设置」查看地址并点击「显示令牌」。令牌存于应用数据目录的 `mcp.json`，
重启不变；不要把真实令牌提交到仓库或发给模型。Cherry Studio 的设置 → MCP → 添加服务器，
选择 Streamable HTTP，填 URL 与 Authorization 请求头。可导入如下配置：

```json
{"mcpServers":{"my-label-tool":{"type":"streamableHttp","url":"http://127.0.0.1:1421/mcp","headers":{"Authorization":"Bearer <界面显示的令牌>"}}}}
```

1. 在桌面打开项目。调用 `project_read` 获取 projectId、revision、图片与标签 ID。
2. 调用 `control_request` 请求所需权限；用户在常驻控制条勾选并批准。
   保存权限要求已有项目保存位置，界面会显示该位置；导出权限必须先在控制条选择目标目录。
3. 轮询 `control_status`，获得 mcp 状态与 leaseId 后才可写入。只读工具不需要租约。
4. 写入携带最新 revision。成功后使用返回的新版本；遇到 CONFLICT 先重读，不盲重试。
5. 保存、导出、预打标立即返回 taskId；用 `task_status` 查询，`task_cancel` 取消。
6. 完成后 `control_release`，再 DELETE 会话。人类可以随时收回或限时锁定。

任务使用现有操作资源互斥表；桌面操作面板显示进度与详细失败原因，客户端失败仅含安全摘要。
最多保留 100 条任务记录，仅创建会话可查。任务总时限 5 分钟，取消在安全边界生效：
推理等本机操作可能需要等待当前图片结束，取消后不会写回缓冲标注。
预打标只追加已配置模型及有效类别映射产生的结果，整轮形成一个可撤销事务，不覆盖原标注。
导出支持 JSON、COCO、VOC、YOLO、custom（使用界面中现有字段映射）；YOLO 拒绝非矩形标注。
导出不改变当前项目的保存位置。保存同时写标注及当前项目配置，保留原有配置扩展字段。

文件输出最多 10000 个文件、64 MiB 文本，仅 JSON/XML/TXT；已有文件备份总量同样最多 64 MiB，
目录句柄最多 16384 个；暂存与目标位于同一文件系统。
Windows 通过无重解析点的目录句柄阻止父目录重命名逃逸，提交前重新核对目标内容摘要。
本版安全磁盘输出仅支持 Windows；其他系统的 MCP 保存/导出明确失败，不退化为缺少路径竞争保护的写入。
文件变化后需重新请求；导出已有文件另行显示覆盖确认，取消/超时会移除该确认。
每个文件原子替换；普通提交失败回滚已经替换的文件。多文件提交不承诺断电时的整批事务性。
权限撤销、会话删除、服务关闭与磁盘提交在宿主互斥区排序；撤销之前已完成的提交保留。
`notifications/cancelled` 取消尚未送到界面的桥接请求；已返回 taskId 的任务使用 `task_cancel`。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 启动失败 / 端口占用 | 在连接设置修改端口并应用，更新客户端 URL；人工标注仍可使用 |
| 401 | 检查 Bearer 请求头；仅在主动刷新令牌后更新客户端令牌 |
| 403 | 使用界面显示的回环 URL，检查代理是否改写 Host 或 Origin |
| 404 会话失效 | 重连并重新初始化；60 秒无活动、停止服务或刷新令牌会废弃会话 |
| 405 / 406 | 使用 Streamable HTTP 的 POST；Accept 包含 application/json 和 text/event-stream，旧 SSE 客户端不支持 |
| NOT_READY / BUSY | 打开项目，等待当前任务结束，完成绘制并关闭弹窗后重新申请 |
| CONTROL_REVOKED / CONTROL_LOCKED | 等待人工解锁，重新请求批准，不复用旧租约 |
| TASK_FAILED | 查看桌面操作面板；目标目录需存在且可写，不能经过符号链接/重解析点；模型和 Runtime 需已配置 |
| 保存位置未建立 | 先通过桌面保存一次项目；MCP 不提供任意路径参数 |

开发验收：`node --experimental-strip-types scripts/verify-mcp-client.ts` 检查真实 SDK 连接；
`scripts/verify-mcp-workflow.ts --prepare` 创建临时验收项目，按脚本顶部步骤测试完整写入流程。
两者均只连接本机，不调用模型服务。HTTP 协议兼容矩阵及安全失败场景由 Rust MCP 测试覆盖。

## 验收清单

- [x] SDK 客户端：初始化、工具列表、状态读取、关闭与领域流程；三个协议版本由真实 HTTP 集成测试覆盖。
- [x] 本机 Cherry Studio：Streamable HTTP URL + Bearer 配置，连接、工具发现、断连与重连；不调用模型服务。
- [x] 错误令牌、恶意 Host/Origin、过大请求、非法输入、错误会话、超限均拒绝。
- [x] 人工批准、拒绝、申请超时、收回、锁定、到期、续租、断连释放可重复验证（UI + 自动化）。
- [x] 原子增删改与单步撤销/重做、界面和导出一致；过期版本/非法坐标/标签不匹配不写入。
- [x] 保存/导出/预打标按权限执行，覆盖确认、路径逃逸、任务取消、迟到结果和退出均覆盖；预打标编排采用确定性推理桩。
- [x] 类型检查、lint、覆盖率、Rust clippy/test 通过；完整审核后无阻塞项。

验收记录保存在 `docs/verification/mcp.md`，未执行的人工项不得标成已通过。
