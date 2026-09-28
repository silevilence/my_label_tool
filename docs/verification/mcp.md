# MCP 验证记录

## 2026-09-28：服务与连接管理

- 官方 TypeScript SDK 客户端通过真实桌面进程连接：initialize、tools/list、app_state、ping、DELETE。
  可复跑 `node --experimental-strip-types scripts/verify-mcp-client.ts`，默认读取本机应用数据目录的 mcp.json，
  可用 MCP_CONFIG 指定测试配置；输出不包含令牌。
- 本机 Cherry Studio 已添加 `my-label-tool-local`（streamableHttp），地址 `http://127.0.0.1:1421/mcp`，
  使用 Authorization Bearer 请求头。界面显示「已连接」、宿主版本 0.11.0、「工具 (1)」。
  该阶段仅开放 app_state；后续任务逐步开放领域工具。
- Rust 新增真实 HTTP 测试验证：错误令牌、Origin/Host、缺失/失效会话、初始化、工具发现、
  桥接请求往返、DELETE、GET 405、令牌刷新、端口冲突恢复、限流；持久令牌重读一致。
- 前端桥接测试覆盖过期请求；现有 App 集成测试补充真实接口形状的 MCP 桩。
- 首次基线：108 文件 / 691 测试，96.46% 行覆盖率。服务阶段：109 文件 / 692 测试通过。
- 本机 Rust 文本读取测试需将 TEXT_READ_TEST_PYTHON 指向 Python EXE，不能指向 pyenv 的 .bat shim。
  并发压力下既有 dispatcher 超时时序测试曾偶发失败，全量验收使用 `-- --test-threads=1` 复核。

## 控制权阶段

- 控制状态机覆盖申请/批准/拒绝、权限子集、租约续期、人工收回、1–1440 分钟锁定、到期、
  会话失联、主动关闭、服务重启和停止；租约仅向持有者返回。
- 控制器测试验证模态窗口、草稿、已有操作阻止批准；人工 store 写入及操作入口在租约期间拒绝，
  经过校验的 MCP 同步事务可以进入同一个 store。
- 人工目录选择/加载登记到资源互斥表；常驻控制条独立于暂停交互的业务界面，保留人工收回入口。
- 111 个前端测试文件 / 700 测试通过，行覆盖率 96.60%。类型检查、lint、clippy 及 Rust 全量串行测试通过。
  本机并发编译时曾有既有 UI 测试超过默认 5 秒；以 `npm run test:coverage -- --maxWorkers=4` 复跑通过，未放宽断言或超时。

## 后续待验收

标注事务、项目操作与最终安全/兼容性审核尚待后续任务完成，不在上述结论范围内。

## 标注事务阶段

- 稳定不透明图片 ID、查询副本、跨图原子增删改、版本冲突、越权与忙碌拒绝均通过测试。
- 与原生 store 共用单条撤销事务；普通图片 frameIndex=0，视频使用源帧号，撤销/重做与 COCO 导出一致。
- 112 文件 / 705 测试通过，行覆盖率 96.68%；typecheck、lint、clippy、Rust 全量串行测试通过。
- 快速审核未发现阻塞项；项目任务与最终全面审核继续进行。
