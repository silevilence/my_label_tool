# 文本读取适配器实现验证

日期：2026-09-27。环境：Windows，Rust 1.94.0，独立 CPython 3.12.8；原生模式不依赖 Python。对应 ROADMAP「开发中」的三个读取适配器条目。完整执行输出保存在 [text-read-adapter-results.txt](text-read-adapter-results.txt)。

## 验证范围

| 项目 | 证据与结果 |
| --- | --- |
| 三种模式真实读取 | `text_read::tests::real_modes_read_unicode_and_preserve_bytes`：原生、真实 Python、真实命令程序；中文路径、引号与 shell 字符、BOM、CRLF/LF、NUL、多字节内容逐字保持 |
| 批量进程次数 | `batch_starts_one_process_and_arguments_are_literal`：200 个路径一次启动；可执行程序自身写计数文件，确认仅启动 1 次，参数中的 shell 字符保持字面值 |
| 自检与失败 | `bad_program_encoding_protocol_and_self_check_never_fall_back`：缺失程序、非法 UTF-8、错误 JSON/数组长度/元素类型、读回不一致均失败，无原生回退 |
| 超时、取消、退出 | `timeout_and_cancel_terminate_process_tree`：真实父子进程，取消/超时后子进程不能写出延迟标记；`requests_cancel_independently_and_release_ids` 包含后台开始前取消 |
| 启动配置 | `registry_bootstrap_round_trip_uses_an_isolated_key`：独立临时 HKCU 键验证缺省、Unicode 配置往返与损坏失败；不修改用户真实配置 |
| 设置与恢复 | `TextReadSettings.test.tsx`：注册表驱动字段、预览门禁、自检/保存/取消；`text-read-recovery.test.tsx`：修复配置后重试失败加载，已加载状态不覆盖 |
| 导入失败零写入 | `App.project-labels.test.tsx`：YOLO 全部标签文件一次批量读取；读取失败时不写项目文件、不提交标注；已有 YOLO/VOC 视频往返测试通过 |
| 插件代理 | `text_proxy_uses_reader_after_authorization_and_blocks_reader_failure`：磁盘不可解码字节由适配器返回明文；越权与适配器失效均拒绝，磁盘不变 |
| 插件隔离 | 全量 Rust 测试中的包内 EXE、系统 Python、包外读取拒绝、socket 拒绝、环境秘密隔离、超时与进程树清理通过；plugin conformance 通过 |
| 脚本链路 | 脚本库与读取恢复前端测试、脚本 UI 与 Rust script conformance 通过；Lua 宿主命令和协议未变化 |

开发机没有企业 DLP 客户端。上述受控文件测试验证宿主适配机制，不宣称验证特定厂商策略。实际目录、扩展名和白名单仍由使用者/IT 按[受控环境核实清单](dlp-encrypted-text-read-adapter.md)验证，该清单不是开发前置条件。

## 注册表扩展性实测

临时新增 `text_read/extension_probe.rs` 实现 `Adapter`，只在 `adapters.rs` 注册表加入模块与一个条目。未修改任何读取调用方、设置组件或配置校验。

`temporary_mode_needs_only_registry_and_implementation` 验证模式元数据可枚举、预览成功、共用 Unicode 自检通过、通用 `text_read::read` 可读取该模式。测试通过后按任务要求删除演示文件和注册项，结果保存在执行输出中。长期保留的前端测试使用返回的演示元数据，验证新模式无需新增 UI 分支。

## 复跑与结果

```powershell
# 使用本机已有工具链，不安装运行时依赖。
$env:RUSTUP_TOOLCHAIN = '1.94.0-x86_64-pc-windows-msvc'
$env:PATH = "$env:USERPROFILE/.cargo/bin;D:/uv/python/cpython-3.12.8-windows-x86_64-none;$env:PATH"
$env:RUST_TEST_THREADS = '1'
npm run typecheck
npm run lint
npm run test:coverage
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

- 前端：107 个测试文件、662 项测试通过；行覆盖率 96.38%。
- Rust：282 项单元测试通过；ACP 6 项、插件协议 1 项、脚本协议 4 项集成测试通过。
- 保留仓库原有忽略项：14 项依赖真实模型/推理资源的测试、1 项需要认证的真实 ACP Agent 测试。本次未新增忽略项。
- 首轮并行测试中，两项已有文件代理测试受 5 毫秒期限和全局 worker 计数影响而失败；使用串行测试后通过。PATH 初始命中 LilyPond 附带 Python，其运行目录无法完成 AppContainer 授权；改用本机独立 CPython 后隔离测试通过。未跳过或放宽相关断言。
- `typecheck`、`lint`、`cargo clippy`、`git diff --check` 通过。文案文件拆分后仍从 `i18n::zh_cn` 统一引用。

## plugin-review 正式审查

范围：本次宿主读取适配器、Tauri commands、插件内部文本读取与文件代理接入。结论：**通过**（阻断 0 / 严重 0 / 一般 0 / 建议 0）。初审发现新增文案导致单文件超过 1000 行，已在编码阶段拆分为 `i18n/text_read_zh_cn.rs`，复审通过。

| 维度 | 结果与证据 | 约束依据 |
| --- | --- | --- |
| 契约与 Schema | 通过。`src/types/text-read.ts:2` 与 `src-tauri/src/text_read/mod.rs:23` 对应；新增数据仅供宿主，`src-tauri/src/plugins/permissions.rs:40` 的既有代理类型及公开 Schema 不变 | AGENTS §10 契约先行、边界影响评估 |
| ID 与版本分层 | 通过。插件 ID、manifest、宿主 API、能力 API、协议版本文件均无变更；读取模式 ID 属宿主设置，不是插件 ID | AGENTS §10 稳定唯一 ID、版本分层；ADR 0003 |
| 能力声明 | 通过。`src-tauri/src/lib.rs:57` 注册宿主命令，不增加插件能力或握手字段 | AGENTS §10 能力声明优先 |
| 向后兼容 | 通过。`src/lib/tauri-api.ts:274` 保留单文件前端接口，转发统一批量命令；代理 UTF-8 返回结构不变，Base64 保持二进制字节语义 | AGENTS §10 向后兼容；ADR 0004、0006 |
| 权限与隔离 | 通过。`src-tauri/src/plugins/permissions.rs:509` 先授权打开，`:534` 调用适配器，`:684` 禁止文件替换；取消与既有代理期限关联。外部读取复用宿主进程管理，插件仍由 AppContainer 启动 | AGENTS §10 权限最小化、故障隔离；ADR 0003、0005 |
| 目录与工程 | 通过。`src-tauri/src/text_read/adapters.rs:5` 定义接口，`:19` 集中注册；`src/components/settings/TextReadSettings.tsx:110` 依字段元数据渲染，Tauri 调用统一在 `tauri-api.ts`；文案集中在 i18n | AGENTS §6、§10 目录归属 |
| 测试 | 通过。以上真实进程、自检、批量、取消、设置、导入、权限测试及全量 conformance 均有可复跑源码与留存输出 | AGENTS §7、§10 故障隔离；ADR 0005 |

规范缺陷：无。本次没有更改插件约束、扩充权限面或变更对外版本，因此无须修改 Schema、ADR 或项目级插件技能。
