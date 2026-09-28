# MCP 完整审核报告

审核日期：2026-09-28。范围：`55e03a6..e8c0767` 的五项 MCP 任务及其后最终修复。
按只读审核、编码修复、复核分阶段执行；本文件为复核结束后的交付记录。

## 结论

通过。剩余问题：阻断 0 / 严重 0 / 一般 0 / 建议 0。五项任务可标记完成，已按用户要求在原位置勾选并分别本地提交。

## 需求核对

| 任务 | 实现与证据 | 结论 |
| --- | --- | --- |
| 接口契约与安全边界 | [接口文档](../mcp.md)、[唯一工具清单](../mcp-tools.json)：13 个领域工具、权限、版本、错误码、长任务；无任意路径或 Tauri 调度 | 通过 |
| HTTP 服务与连接管理 | [Rust 服务](../../src-tauri/src/mcp/mod.rs)、[连接面板](../../src/components/settings/McpPanel.tsx)：随应用启停、回环监听、持久令牌与手动刷新、审计；SDK 与 Cherry Studio 实机验收 | 通过 |
| 人工优先的操作控制权 | [状态机](../../src/lib/mcp-control.ts)、[控制条](../../src/components/settings/McpControlBar.tsx)：申请、批准、拒绝、续期、收回、限时锁定、断连释放与资源门禁 | 通过 |
| 标注与界面同步 | [标注事务](../../src/lib/mcp-annotations.ts)：共享坐标校验、版本检查、跨图原子事务、单步撤销；实机画布、计数、撤销重做和缩放验证 | 通过 |
| 项目操作与安全兼容验收 | [项目任务](../../src/lib/mcp-project.ts)、[安全磁盘输出](../../src-tauri/src/mcp/output.rs)：保存、五种内置导出、预打标追加、取消、覆盖确认、路径保护与三版本 HTTP 测试 | 通过 |

## 审核发现与修复复核

以下为已修复问题，严重度统一使用项目术语；证据链接指向修复后的保护措施。

| 原问题 | 严重度 | 修复与复核 |
| --- | --- | --- |
| 取消可能先于原生推理任务登记，首次取消无法命中 | 🟠 严重 | [mcp-project.ts:209](../../src/lib/mcp-project.ts#L209) 在后续原生事件重试取消；[竞态测试](../../src/lib/mcp-project.test.ts#L245) 验证重试、拒绝迟到结果和空撤销栈 |
| 既有文件备份总量和目录句柄未设置整批上限 | 🟠 严重 | [output.rs:351](../../src-tauri/src/mcp/output.rs#L351) 累加限制 64 MiB，目录句柄限制 16384；[超限测试](../../src-tauri/src/mcp/output.rs#L498) 验证原文件及暂存清理 |
| 原生失败可能覆盖收回、超时或取消的真实原因 | 🟡 一般 | [mcp-jobs.ts:87](../../src/lib/mcp-jobs.ts#L87) 优先使用取消原因；远端只获得安全错误摘要，详细错误留在桌面 |
| 非 Windows 目录句柄不能提供同等父路径重命名保护 | 🟠 严重 | [output.rs:151](../../src-tauri/src/mcp/output.rs#L151) 对非 Windows 磁盘输出显式失败；Windows junction 越界与句柄阻止重命名测试通过 |

## 规范与插件边界审核

本次 MCP 属于宿主独立通道。与基线对比，插件框架、插件类型、标注核心类型、ProjectConfig 解析及预打标类型没有修改；不需要升级插件协议、宿主 API 或 manifest schemaVersion。

| 维度 | 结论 | 证据与约束 |
| --- | --- | --- |
| 契约与 Schema | 通过 | [mcp-controller.ts:18](../../src/lib/mcp-controller.ts#L18) 从唯一清单编译输入 Schema；Rust [mod.rs:27](../../src-tauri/src/mcp/mod.rs#L27) 读取同一清单。AGENTS.md §10「契约先行」「边界影响评估」，ADR 0003、0004 |
| ID 与版本分层 | 通过 | MCP [mod.rs:19](../../src-tauri/src/mcp/mod.rs#L19) 独立协商协议版本；[plugin.ts:5](../../src/types/plugin.ts#L5) 的插件版本常量不变，无插件 ID 变更。AGENTS.md §10「稳定唯一 ID」「版本分层」「版本号独立维护」 |
| 能力声明 | 通过 | [mod.rs:26](../../src-tauri/src/mcp/mod.rs#L26) 只发现显式领域工具；未新增插件能力或改变握手。AGENTS.md §10「能力声明优先」，ADR 0003、0004 |
| 向后兼容 | 通过 | [annotation-validation.ts:9](../../src/lib/annotation-validation.ts#L9) 严格坐标参数默认 false，旧导入行为保留；[mcp-project.ts:134](../../src/lib/mcp-project.ts#L134) 保存时保留原配置字段。AGENTS.md §10「向后兼容优先」，ADR 0006 |
| 权限与隔离 | 通过 | [http.rs:35](../../src-tauri/src/mcp/http.rs#L35) 请求鉴权，[mcp-control.ts:135](../../src/lib/mcp-control.ts#L135) 对其他会话隐藏会话和租约 ID，[output.rs:109](../../src-tauri/src/mcp/output.rs#L109) 平台安全门禁；无插件权限绕过或隔离放宽。AGENTS.md §10「权限最小化」「故障隔离」，ADR 0005 |
| 目录与工程约定 | 通过 | [commands/mcp.rs:5](../../src-tauri/src/commands/mcp.rs#L5) 仅转发；前端调用集中于 tauri-api，文案集中于 MCP i18n，模块均低于 1000 行。AGENTS.md §6、§10「目录归属」 |
| 测试 | 通过 | 9 项 MCP Rust 专项及全部前端、Rust 回归通过，既有 plugin_conformance 通过。AGENTS.md §3、§7、§10「边界影响评估」，ADR 0003–0006 |

未发现需要另行修改的规范缺陷。

## 验证证据与覆盖范围

- 类型检查、lint、Rust clippy 均通过；项目任务阶段的前端生产构建通过。
- 前端：113 文件 / 713 测试通过。覆盖率按仓库配置统计：语句 95.75%、分支 91.42%、函数 97.78%、行 96.08%，满足全局阈值；此数值不是所有 UI 文件或 Rust 代码的覆盖率。
- MCP 核心模块行覆盖率：annotations 100%、control 100%、controller 92.50%、jobs 89.36%、project 91.37%。jobs 未覆盖行 33、44、47–49 主要涉及历史容量清理和操作入口分支；project 未覆盖分支主要涉及错误及部分可选输出/模型映射路径。没有把全局阈值误报为每文件均达 90%。
- Rust：291 单元测试通过，14 项既有忽略；6 ACP、1 插件、4 脚本集成测试通过；1 项真实 Agent 测试继续忽略。MCP 专项 9 项通过，未测量 Rust 覆盖率。
- [实机验收记录](mcp.md)：Cherry Studio 验证连接、13 个工具发现、断连重连；官方 SDK 验证增删改、冲突拒绝、保存、COCO 导出、权限收回。实际界面验证撤销重做、计数、缩放、切图和锁定。
- 预打标 MCP 编排使用确定性推理桩验证；未新增下载模型、调用付费模型或真实 Agent。Windows 以外保存/导出明确不支持；多文件保存不承诺断电时的整批原子性。

最终阻塞项：无。
