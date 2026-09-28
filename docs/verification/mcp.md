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

## 后续待验收

控制权、标注事务、项目操作与最终安全/兼容性审核尚待后续任务完成，不在上述结论范围内。
