# 插件系统整体验收记录

验收日期：2026-08-27（Windows，本地离线开发环境）

## 复现方式

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-plugin-system.ps1
```

脚本失败即返回非零；完整控制台记录写入
`target/plugin-system-verification.log`。该日志属于本机构建产物，不提交仓库。

AppContainer 场景必须在拥有正常 Windows 用户 profile 的普通交互账户运行。服务账户或
`CodexSandboxOnline` 这类没有可用用户 profile 的受限账户会在 profile 初始化处按设计
fail-closed；这表示隔离启动被安全拒绝，不等同于普通用户上下文的验收失败。

## 八类场景

| 场景 | 自动化证据 | 本次结果 |
| --- | --- | --- |
| 坏插件隔离 | `timeout_crash_and_garbage_remove_the_session`：显式调用后的启动即崩、死循环、垃圾 stdout 均只移除对应会话，不影响宿主测试进程 | PASS |
| 权限拒绝 | `file_proxy_returns_only_authorized_content_and_denies_outside_paths` 验证宿主代理；`appcontainer_denies_direct_file_escape_and_unauthorized_network` 从插件包复制并真实启动 PE，读取包内/包外文件并直连宿主 listener，只有包内读取成功；`appcontainer_runs_system_python_without_host_secrets` 真实启动系统 Python 示例并确认宿主秘密环境变量不可见 | PASS |
| 超时与取消 | `timeout_terminates_the_parent_and_descendant_processes`、`cancellation_aware_prelabel_can_return_partial_result_before_termination` | PASS |
| 自动禁用 | `failures_auto_disable_and_a_later_success_clears_the_counter`：连续 3 次、手动恢复、成功清零 | PASS |
| 安全模式 | `safe_mode_rejects_code_plugins_but_keeps_label_presets_available`：代码型禁用、数据型保留 | PASS |
| 迁移失败降级 | `plugins::config_tests`：失败不阻塞项目、pending-migration、重试与链式迁移 | PASS |
| 卸载清理 | `uninstall_removes_only_package_and_registry_entry`：包目录/注册表清理，项目配置不在卸载边界内 | PASS |
| 更新流程 | `update_preserves_install_time_and_marks_changed_config_for_migration`：保留授权、配置版本变化触发迁移 | PASS |

## 状态、重启与 UI 清单

- 启用/禁用后能力入口：注册表状态测试、exporter/prelabel 来源快照与前端 disabled/reason
  契约共同覆盖；安全模式与 pending-migration 均返回明确禁用原因。
- 重启恢复：注册表、绝对授权根、标签预置生命周期与项目 `pluginConfigs` 往返测试通过；
  卸载插件的项目配置仍保留。
- 安全模式即时生效：设置持久化、runtime 拒绝、代码型来源置灰与数据型保留路径均通过测试。
- `plugin-ui.acceptance.test.tsx` 在 jsdom 中渲染真实 `PluginSettings`、`ExportPanel`、
  `PrelabelSettings` 组件，验证生命周期状态、安全模式即时切换、代码型/数据型差异、
  导出禁用原因/进度/取消，以及预打标来源启用状态；3 个 UI 场景通过。
- `npm run tauri dev` 实际启动到 `target/debug/my_label_tool.exe`。验收中发现多 bin 导致
  Cargo 无法选择主程序，已通过 `default-run = "my_label_tool"` 修复后复验启动成功。
- Windows computer-use 原生管道在本机不可用（初始化、重试、重置后均报 native pipe
  不存在），因此没有伪造鼠标点击截图；改用真实组件渲染与点击的自动化 UI 验收，
  不再把纯状态契约测试当作 UI 证据。

## 文档与门禁

- `docs/plugins.md`、`docs/plugin-protocol.md`、manifest/exporter/prelabel JSON Schema、
  `CONTEXT.md` 与实现已通过双重代码审查。
- Windows AppContainer 是文件/网络默认拒绝的安全边界；代码插件每次启动使用临时 profile，
  仅临时授权插件包和声明使用的 Python 运行目录，宿主环境按白名单重建；离线环境变量仅为兼容补充。
  该修改落实已有 ADR 0005 契约，没有新增或破坏插件 API、协议消息、错误码或 Schema，
  因此宿主 API/能力 API/协议/schemaVersion 均不 bump。
- 三个示例目录和打包产物均通过离线 validator；conformance 覆盖握手、消息、错误码、
  进度、取消与消息上限。
- 本次最终门禁：前端 169 项通过，行覆盖率 93.45%；Rust 187 项通过、8 项既有官方
  ONNX/YOLO 外部夹具测试按设计忽略；typecheck、lint、clippy、conformance 全部通过。
