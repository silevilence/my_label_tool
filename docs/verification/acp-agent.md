# 脚本增强与 ACP 验证记录

日期：2026-09-25；Windows x64，Rust 1.94.0，Node 22.15.1。

## 真实 Agent 与宿主

由用户指定本机 Oh My Pi（`omp` 18.0.8），使用既有登录。本次验收启动参数：

```json
["acp", "--model", "deepseek/deepseek-v4-flash", "--no-tools", "--no-skills", "--no-rules", "--no-extensions"]
```

执行 `scripts/verify-acp-agent.ps1 -Executable <omp.exe绝对路径> -ArgumentsJson <上述JSON> -Toolchain 1.94.0`，真实完成 initialize → session/new → session/prompt → 流式回复 → end_turn。提示仅含示例 Lua、宿主命令注册表与统计标注数的指令，工作目录为独立临时目录，无项目数据。自动验收拒绝所有权限请求，没有自动批准。

生成源码保存在 [acp-generated.lua](acp-generated.lua)。它调用 `annotool.images`、`annotool.annotations` 与 `annotool.log`，经真实 Lua runner/宿主对一张无标注的合成图片执行，日志为 `0`，没有标注写入，测试通过。原始本地诊断保存在忽略目录 `.local-script-qa/acp-real-result.json`，不提交用户机器路径或 Agent 会话数据。

最初默认 OpenCode Go 模型返回 `MissingSessionID` 服务错误；用户确认避开该提供商，指定非 OpenCode Go 模型后通过。未修改 Agent 全局配置、安装适配器或读取凭据。

## 脚本面板与失败语义

`script-ui.acceptance.test.tsx` 读取同一份真实生成源码，验证流式展示 → 独立草稿/diff → 取消命名不写盘 → 确认另存 → 新脚本可编辑 → 经原有运行入口执行，且内置原文未变化。取消、断连失败、拒绝权限即使收到迟到完整代码也不写入主编辑器或脚本库；原脚本变化时禁止保存过期结果。

`script-assistance.test.ts` 验证参数、上下文边界、大小限制、拒绝不完整/多段 Lua 代码及差异的前后重建。`useAcpSession.test.tsx` 验证取消、拒绝和迟到结果。`acp_conformance` 用真实桩进程验证 ACP 生命周期、逐次权限、未确认超时、非法消息、行限制、崩溃与持有管道的后代进程回收。

这里的界面证据为 React/jsdom 自动化验收；不将其表述为原生 WebView 人工点击验收。真实 Agent 生成和 Lua 执行使用实际子进程。

## 完整审核与修复

范围：基线 `b9b111001ec473aac402753a7b7364f15b248725` 起的三项增强。按顺序完成快速审核和提交：`e980caf`（编辑器）、`eb64059`（ACP）、`c2ca6aa`（AI 草稿）；ROADMAP 保持原位勾选。

### Standards

完整审核发现 2 项：补全列表的英文无障碍标签未进入 i18n（严重）、权限弹窗未显示已有操作详情（一般）。已增加中文 CodeMirror phrases、可选的纯文本权限详情，以及 UI/协议回归测试；只读复核通过，剩余 0 项。

### Spec

完整审核发现 3 项：Lua 5.4 部分词法着色缺失、首次保存清空撤销历史、收起面板丢失 AI 候选草稿。已共享高亮/补全的 Lua 5.4 词表，使用独立文档版本区分保存与切换，将 AI 状态上提到保留的 hook；对应回归全部通过，只读复核后剩余 0 项。

主审另修复取消 IPC 失败时迟到结果可能被采用，以及权限答复/取消连续失败产生未处理异常并提前释放操作资源的问题。取消意图独立保留，结果永久丢弃；异常路径保持操作互斥直到请求结束，有单独回归测试。

### 插件正式审查

依照 AGENTS.md §10、ADR 0003–0006 与 plugin-review 七维度，结论通过，无阻断项：

| 维度 | 复核结论 |
| --- | --- |
| 契约与 Schema | ACP 仅为宿主命令，标注/项目/导出/预打标/插件结构未变 |
| ID 与版本分层 | ACP 版本独立，插件与宿主 API 版本均未调整 |
| 能力声明 | 握手显式关闭客户端文件与终端能力 |
| 向后兼容 | 插件契约不变；ACP 详情字段可选 |
| 权限与隔离 | 插件入口强制 AppContainer 和过滤环境；ACP 构造入口独立；空 capability 指针修复不扩权 |
| 目录与工程约定 | Tauri 调用集中封装，脚本/ACP/插件职责分离 |
| 测试 | 真实插件隔离测试、ACP 桩往返、后代进程回收与前端失败回归通过 |

复核源码包括 `acp/client.rs`、`process_control/piped.rs`、`process_control/app_container.rs`、`tauri-api.ts` 与脚本面板/会话 hook；未修改插件规范或模型契约。

## 提交前检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` / `npm run lint` | 通过 |
| `npm run test:coverage` | 104 文件、652 测试通过；行覆盖率 96.38% |
| `npm run build` | 通过；仍有主包超过 500 kB 的构建体积提示 |
| 主 crate `cargo clippy` | 通过 |
| 主 crate `cargo test -- --test-threads=1` | 273 单元测试通过、14 既有真实模型等测试按标记忽略；ACP 6、插件 1、Lua runner 4 项集成测试通过 |
| 独立 Lua 宿主 `cargo test --locked` / `cargo clippy --locked --all-targets -- -D warnings` | 14 测试通过；clippy 通过 |
| `scripts/verify-script-host.ps1` | 桌面宿主 10 个内置示例全部通过 |
| 真实 ACP 验收 | 单独显式运行的 `acp_real_agent` 通过；常规套件默认忽略，避免自动消费模型额度 |

Rust 命令使用 `+1.94.0`，独立宿主 manifest 为 `src-tauri/script-host/Cargo.toml`。Windows 插件真实系统解释器测试使用可用的轻量 Python，并设置 `NO_PROXY=localhost,127.0.0.1,::1`，其包外文件与未授权网络拒绝测试均通过。本轮未重复容器或真实 ONNX 模型验收。
