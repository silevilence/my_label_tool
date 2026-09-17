# 图片删除：插件边界正式审查

## 审查结果

- 日期：2026-09-17。
- 范围：本次图片删除改动，重点检查新增 Tauri command、状态清理与插件边界。
- 方法：按 `.agents/skills/plugin-review/SKILL.md` 对最终工作区只读审查；不是独立子代理审查。
- 结论：通过（阻断 0 / 严重 0 / 一般 0 / 建议 0）。

| 维度 | 条目 | 结果 | 证据 | 严重度 |
| --- | --- | --- | --- | --- |
| 契约与 Schema | 新增命令参数与返回值前后端对应；核心模型与插件 Schema 未变更 | 通过 | `src/lib/tauri-api.ts:87`；`src-tauri/src/commands/image_deletion.rs:7`；契约文件 diff 为空 | — |
| ID 与版本分层 | 未修改插件 ID、宿主 API / 业务能力 / 协议版本，无随主程序同步 bump | 通过 | 本次 diff 仅新增宿主 UI 命令注册 `src-tauri/src/lib.rs:22`；插件类型与实现 diff 为空 | — |
| 能力声明 | 不新增插件能力、不通过版本推断能力 | 通过 | `src-tauri/src/commands/image_deletion.rs:5`；插件代理仅分派 fs.read / fs.write，`src-tauri/src/plugins/permissions.rs:339` | — |
| 向后兼容 | 既有数据与调用未改变；旧快捷键配置兼容；被删图片不会由旧历史恢复 | 通过 | `src/lib/app-utils.ts:17`；`src/store/useAnnotationStore.ts:82`；相关回归测试通过 | — |
| 权限与隔离 | 插件不可调用新增删除命令；原生路径限制与永久删除否决；背景预打标期间拒绝删图 | 通过 | `src-tauri/src/plugins/permissions.rs:339`；`src-tauri/src/media/image_deletion.rs:29`；`src-tauri/src/media/image_recycle_windows.rs:71`；`src/App.tsx:337` | — |
| 目录与工程约定 | command 仅转发，文件逻辑位于 media，invoke 集中封装，文案集中，无超长新增文件 | 通过 | `src-tauri/src/commands/image_deletion.rs:7`；`src/lib/tauri-api.ts:87`；`src/i18n/image-deletion.zh-CN.ts:1`；`src-tauri/src/i18n/zh_cn.rs:1` | — |
| 测试 | 前后端回归、真实回收恢复、失败保持状态、完整插件 conformance 通过 | 通过 | [可复跑命令及桌面验收记录](image-deletion.md) | — |

## 约束引用

- AGENTS.md §10：契约先行、边界影响评估、稳定唯一 ID、版本分层及独立维护、能力声明、向后兼容、权限最小化、故障隔离、目录归属。
- ADR 0003：插件仍由外部进程与 stdio NDJSON 接入，未增加直接 Tauri 调用通道。
- ADR 0004：导出 / 预打标插件协议与数据格式未变化。
- ADR 0005：文件访问代理与 AppContainer 隔离未变化，现有对抗测试通过。
- ADR 0006：项目插件配置及迁移流程未变化。

规范缺陷：本次审查未发现需调整的约束。AGENTS.md 只补充命令清单，§10 未变化，因此项目技能不需同步修订。
