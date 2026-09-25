# ACP 本机 Agent 接入

ACP 通道独立于 Lua 宿主与插件系统。新增的 `run_acp_agent`、`cancel_acp_agent`、`respond_acp_permission` 仅供宿主 UI 调用，不向插件或 Lua 暴露；不修改标注模型、ProjectConfig、插件 Schema、宿主 API 或协议版本。

客户端按用户提供的可执行程序和参数数组直接启动子进程，不经 shell 解释。每次运行建立一个全新会话，结束后回收进程；不加载 Agent 的历史会话。会话 cwd 为单独的临时目录，MCP 服务列表为空。客户端自身没有在线中转服务，本机 Agent 是否访问模型服务由其配置决定，未配置 Agent 时离线标注与 Lua 功能完全可用。

## 协议

实现 ACP 协议版本 1 的 `initialize` → `session/new` → `session/prompt`，接收 `session/update`，使用 `session/cancel` 通知取消并终止进程树。版本不兼容在发送用户上下文前失败。保存 Agent 的能力信息，但本期仅使用基础文本消息与新建会话，不推断其他可选能力。

`session/request_permission` 通过事件发送到前端独立确认弹窗；每次请求重新确认，仅提供 `allow_once` 或拒绝，没有“永久允许”。未确认请求保持等待，随运行总超时结束。关闭弹窗视为拒绝，过期请求或重复答复被拒绝。任何一次拒绝使本轮回复不能成为可应用的脚本草稿。

客户端不声明文件和终端能力，所有 `fs/*`、`terminal/*` 以及未知方法直接返回 JSON-RPC `-32601`，权限确认不会改变这一策略。协议调用不会读取任何项目数据或本地文件。**ACP 权限交互不是 OS 沙箱**：用户配置的是自己信任的本机程序，应配置 Agent 不使用自身文件工具或自动批准；普通本机进程仍有用户级系统权限。AI 编写入口只发送当前 Lua 源码、命令说明和输入的指令，不发送项目图片、标注或项目路径。

每行最多 1 MiB，总接收数据最多 4 MiB，提示词最多 512 KiB；运行总时限含启动和权限等待，为 1–600 秒。队列有界，读写在独立线程中运行，避免 Agent 不读 stdin 导致 UI 和取消阻塞。进程崩溃、stdout 断连、非法 JSON、超限、超时均失败，部分回复不能自动保存。stderr 不作为脚本或协议数据。

Windows 在恢复 Agent 主线程前将进程加入 kill-on-close Job Object；即使父进程先退出，持有管道的后代也能被终止。它与插件启动共用句柄/Job 实现，但插件入口仍强制 AppContainer 与白名单环境，ACP 本机 Agent 使用独立构造入口，不改变插件隔离策略。

## 验证

`cargo test --manifest-path src-tauri/Cargo.toml --test acp_conformance` 使用真实桩子进程验证协商、会话、流式输出、权限往返、拒绝与未确认、文件请求拒绝、版本不兼容、崩溃、断连、超时、非法消息、超限及取消。前端会话测试验证迟到结果丢弃和逐次确认。

参考：[ACP 初始化](https://agentclientprotocol.com/protocol/v1/initialization)、[会话建立](https://agentclientprotocol.com/protocol/v1/session-setup)、[提示轮次](https://agentclientprotocol.com/protocol/v1/prompt-turn)。
