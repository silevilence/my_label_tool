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
