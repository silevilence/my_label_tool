# 标签样例图验证记录

日期：2026-09-24。环境：Windows、Node/npm、Rust stable、Tauri 开发构建。

## 自动化验收

| 范围 | 可复跑入口 | 结果 |
| --- | --- | --- |
| Windows 名称清洗、空名称、设备名、大小写/清洗后冲突 | `src/lib/label-samples.test.ts` | 通过 |
| 草稿预览、取消不写盘、切换项目丢弃过期回调、保存互斥、失败回滚 | `src/hooks/useLabelSamples.test.tsx` | 通过 |
| 内置模板仅保存图片、另存为取消、重命名关联、标签持久化失败恢复 | `src/hooks/useLabelActions.test.tsx` | 通过 |
| 无项目禁用、预览展开、更换、清除、打开目录、重开刷新 | `src/components/settings/LabelSettings.samples.test.tsx` | 通过 |
| 真实 PNG 读写、外部替换刷新、名称互换、仅大小写改名、清除、错误文件/目录 | `src-tauri/src/media/label_samples_tests.rs` | 通过 |
| Windows 文件锁：移动部分原图后失败，原文件字节保持、临时文件清理 | 同上 `partial_move_failure_restores_originals_without_rewriting_bytes` | 通过 |

命令：

```powershell
npm run typecheck
npm run lint
npm run test:coverage
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml --lib label_samples
```

前端全量：100 个测试文件、620 个测试通过；行覆盖率 96.23%，语句覆盖率 96.20%，
函数覆盖率 99.04%，分支覆盖率 91.75%。typecheck、lint、clippy 通过。
Rust 全量串行：269 个库单元测试、1 个插件协议集成测试、4 个脚本集成测试通过，
14 个已有测试按仓库约定忽略；最后的历史非法标签名修复另用样例图专项测试复核。
原始输出保存在本地忽略目录 `src-tauri/target/label-samples-coverage.log`、
`src-tauri/target/label-samples-cargo-test-serial.log`。

首次并行运行 Rust 全量时，既有插件超时竞争测试
`dispatcher_waits_for_a_commit_that_won_the_timeout_race` 出现一次超时；单独重跑通过，
随后全量使用单测试线程复跑。未修改该插件测试或实现。

## 桌面检查

通过 `npm run tauri dev` 启动真实桌面应用，在最大化窗口打开标签管理弹窗，
确认新增预览列、图片操作入口及无项目说明可见，样例图操作禁用，标签编辑控件仍可用。
操作系统文件选择对话框的自动化定位不稳定，未以该路径宣称完成项目内端到端人工验收；
项目内设置、更换、清除与保存流程由上述 React 验收测试及真实文件系统测试覆盖。
本次没有修改画布交互。

## 插件边界正式审查

- 范围：标签样例图功能及新增宿主 Tauri commands。
- 结论：通过（阻断 0 / 严重 0 / 一般 0 / 建议 0）。

| 维度 | 条目 | 结果 | 证据 | 严重度 |
| --- | --- | --- | --- | --- |
| 契约与 Schema | 新结构仅用于宿主图片草稿，TypeScript/Rust 字段对应；插件 Schema 无变化 | 通过 | `src/types/label-sample.ts:2`、`src-tauri/src/media/label_samples.rs:25` | — |
| ID 与版本分层 | 通过已有标签 ID 关联原名称；未修改插件 ID、API、协议或主程序版本 | 通过 | `src/hooks/useLabelSamples.ts:92`；契约/版本文件 diff 核对 | — |
| 能力声明 | 命令只注册到宿主 invoke_handler，未进入插件或脚本命令分派 | 通过 | `src-tauri/src/lib.rs:25`；在 plugins/script-host 中搜索无引用 | — |
| 向后兼容 | 标签、模板、项目配置不增加字段，原文件格式保持不变 | 通过 | `src/types/label-sample.ts:1`；annotation.ts/importers.ts diff 为空 | — |
| 权限与隔离 | 插件权限面不变；项目内 icon 拒绝链接/重解析点，目标文件名清洗且冲突拒绝 | 通过 | `src-tauri/src/media/label_samples.rs:51`、`:91` | — |
| 目录与工程约定 | 组件经 tauri-api 调用；command 返回 Result，文件处理在 media，文案集中 | 通过 | `src/lib/tauri-api.ts:5`、`src-tauri/src/commands/label_samples.rs:8`、`src/components/settings/LabelSampleCell.tsx:4` | — |
| 测试 | 前端验收与真实文件操作覆盖草稿/保存/回滚、冲突、刷新；无需新增插件协议测试 | 通过 | `src-tauri/src/media/label_samples.rs:396`；上方自动化验收表 | — |

约束引用：AGENTS.md §10 契约先行、边界影响评估、版本分层、能力声明、向后兼容、
权限最小化、目录归属；ADR 0003–0007。新命令不向插件开放，因此无需变更
manifest Schema、插件宿主 API/协议版本或能力协商。
规范缺陷：无。

## 项目标注裁剪补充验收

同日补充需求：设置样例图时可从当前项目同标签的标注中选择，点击选择时写出真实裁剪文件。

- `src/lib/label-sample-crops.test.ts`：原图矩形、多边形外接矩形、关键点邻域、非法几何过滤、当前图片优先与排除其他标签/已移出项目的图片。
- `src/hooks/useLabelSamples.test.tsx`：选择时生成临时 PNG；保存失败保留草稿文件；成功保存、取消、清除、更换和切换项目时清理；异步迟到的裁剪结果清理且不污染新项目。
- `src/components/settings/LabelSettings.samples.test.tsx`：选择窗口展示同标签标注；预览不写文件，点击才裁剪；外部图片入口可用；分页仅加载当前页，坏图禁用而其他标注可用。
- `src-tauri/src/media/label_sample_crops_tests.rs`：真实 PNG 裁剪尺寸与像素逐项比对；小数外扩取整、越界裁切、无效几何及项目外路径拒绝；清理仅能删除本进程登记的临时图，不删除原图。

复跑：`npx vitest run src/lib/label-sample-crops.test.ts src/hooks/useLabelSamples.test.tsx src/components/settings/LabelSettings.samples.test.tsx`；
`cargo test --manifest-path src-tauri/Cargo.toml --lib label_sample`。
全量结果保存在本地 `src-tauri/target/label-sample-final-coverage.log` 和
`src-tauri/target/label-sample-crops-cargo-test.log`。
全量前端 101 个文件、628 项通过（包含分页回归用例），行覆盖率 96.28%；
typecheck、lint、clippy 通过；Rust 全量串行 271 项库单测和 5 项集成测试通过，14 项既有测试忽略。

### 补充宿主命令的正式审查

结论：通过（阻断 0 / 严重 0 / 一般 0 / 建议 0），约束仍为 AGENTS.md §10 与 ADR 0003–0007。

| 维度 | 结果与证据 |
| --- | --- |
| 契约与 Schema | 通过：宿主裁剪边界与输出独立定义，Rust `label_sample_crops.rs:22`、`:30` 对应 `src/types/label-sample.ts`；没有修改插件 Schema |
| ID 与版本分层 | 通过：候选使用已有标签/标注 ID，临时文件标识只用于宿主缓存；插件 ID、API/协议版本不变 |
| 能力声明 | 通过：三条命令仅在 `src-tauri/src/lib.rs:26` 注册，不进入插件或 Lua 分派 |
| 向后兼容 | 通过：沿用既有 PNG 样例保存流程；AnnotationShape、LabelConfig、ProjectConfig 均不变 |
| 权限与隔离 | 通过：`label_sample_crops.rs:35` 规范化并限制来源位于项目；`:127` 仅允许清理已登记的临时文件 |
| 目录与工程约定 | 通过：命令仅转发（`commands/label_samples.rs:23`），裁剪位于 media，组件经过 tauri-api，文案进入 i18n |
| 测试 | 通过：上述逻辑、Hook、UI 与真实文件测试；未新增插件行为，无需变更插件 conformance 契约 |

规范缺陷：无。界面新增流程通过 React 自动化验收，未额外宣称已完成原生桌面全流程人工验收。
