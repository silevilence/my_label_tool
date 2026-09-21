# 预打标资源设置验收与插件边界审查

日期：2026-09-21。范围：当前工作区的预打标错误提示明确化、全局资源设置、模型管理预算提示和后端限制接入。

## 验收结果

- 设置入口：侧栏「设置」中的「预打标资源限制」。两个字段独立校验，显式保存；保存失败保留旧配置，未保存关闭需确认。
- 默认 80 MiB / 100000 个原始候选框；内存按输出及副本每元素 8 字节计算，模型管理显示 10485760 个输出元素。
- YOLOv8 2560×2560、80 类输出 `[1, 84, 134400]`：默认拒绝；128 MiB / 150000 候选框通过。分别降低内存或候选框上限会报告对应原因。
- 保存配置会改变会话缓存键，下一次推理不会继续使用旧预算；前后两次输出形状检查均使用同一快照。
- 内存预算只覆盖输出张量与一份副本，不保证模型权重、中间层、预处理、候选框对象及显存峰值。这一点已写入设置说明和用户文档。

## 可复核测试

所有命令在仓库根目录执行，测试文件留在源码目录中。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run test:coverage` | 84 文件、475 测试通过；行覆盖率 95.69%，语句 95.63%，分支 90.93%，函数 99.07% |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` | 250 单元测试及 1 个插件 conformance 集成测试通过；13 项按原有声明忽略 |
| `git diff --check` | 通过 |

真实模型/DirectML/转换测试依赖外部 ONNX、Runtime、图片或 Python 环境，本机未配置相应 fixture，因此本次没有声称完成真实模型端到端验收。2560 案例通过生产输出契约校验函数测试，未执行实际 YOLO 网络。未改动画布坐标或标注交互。新增界面通过 React DOM 测试验证，未运行桌面窗口人工验收。

首次全量前端测试因旧设置界面测试缺少新接口 mock，导致三个断言读到配置读取错误。已补齐 mock，重新全量执行通过。未降低断言或覆盖率阈值。

重点测试文件：

- `src/lib/prelabel-resource-limits.test.ts`：预算换算、数值上下界、非整数/非法值。
- `src/store/usePrelabelResourceStore.test.ts`：读取失败重试、写入失败、保存成功后发布、并发读写保护。
- `src/components/settings/PrelabelResourceSettings.test.tsx`：设置保存、重新打开、换算提示更新、无效输入和错误反馈。
- `src/hooks/useShortcutsConfig.test.tsx`：新增未保存关闭确认回归，保留原快捷键测试。
- `src-tauri/src/media/prelabel/resource_limits.rs`：默认兼容、JSON 字段对应、持久化、非法配置拒绝。
- `src-tauri/src/media/prelabel/runtime.rs`：2560 输出、双上限独立生效、边界和溢出、实际输出同预算校验。
- `src-tauri/src/media/prelabel/execution.rs`：两个设置分别改变时的会话缓存失效。

## 审查结果

- 使用技能：`.agents/skills/plugin-review/SKILL.md`；审查阶段只读代码和规范。
- 结论：通过（阻断 0 / 严重 0 / 一般 0 / 建议 0）。

| 维度 | 条目 | 结果 | 证据 | 严重度 |
| --- | --- | --- | --- | --- |
| 契约与 Schema | TS/Rust 字段对应，设置属于宿主私有配置；无对外插件 Schema 改动 | 通过 | `src/types/prelabel.ts:4`、`src-tauri/src/models/prelabel.rs:7` | — |
| ID 与版本分层 | 未新增插件 ID；不改变插件 API、协议及主程序版本 | 通过 | `docs/prelabel-resource-limits.md` 的宿主与插件边界；本次变更未涉及插件版本常量和清单 | — |
| 能力声明 | 仅新增宿主设置命令，无插件能力或握手变更 | 通过 | `src-tauri/src/lib.rs:42`、`src-tauri/src/commands/prelabel_settings.rs:4` | — |
| 向后兼容 | 设置文件缺失、字段缺省有默认值；原模型库、项目配置及预打标命令参数不变 | 通过 | `src-tauri/src/models/prelabel.rs:6`、`src-tauri/src/media/prelabel/resource_limits.rs:45` | — |
| 权限与隔离 | 路径由宿主应用数据目录派生，不接受调用方路径，不开放插件访问 | 通过 | `src-tauri/src/media/prelabel/resource_limits.rs:30`、`src-tauri/src/commands/prelabel_settings.rs:11` | — |
| 目录与工程约定 | command 转发，处理逻辑在 media，前端通过 tauri-api，文案集中 | 通过 | `src-tauri/src/commands/prelabel_settings.rs:4`、`src/lib/tauri-api.ts:287`、`src/i18n/prelabel-resource.zh-CN.ts` | — |
| 测试 | 覆盖预算、持久化、UI 和缓存；原插件 conformance 通过 | 通过 | 本文可复核测试记录；`src-tauri/src/media/prelabel/runtime.rs:494`、`src-tauri/src/media/prelabel/execution.rs:227` | — |

约束引用：AGENTS.md §6（目录、类型、i18n）、§7（测试）、§10（契约先行、边界影响、版本分层、兼容、权限、目录）；ADR 0003/0004（独立插件进程与协议）、0005（权限边界）、0006（插件配置不透明）。新增设置不是插件配置，不写入 ProjectConfig，不改变上述 ADR。无规范缺陷。
