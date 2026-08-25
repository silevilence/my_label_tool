---
name: plugin-api-versioning
description: 插件 API 版本号与契约文档维护技能（my_label_tool 插件系统）。用于维护宿主 API 版本（整体版本 + exporter/prelabel 业务能力版本）、协议版本与 manifest schemaVersion：主程序发版前核对插件契约变更、判定增量/破坏性变更并决定是否 bump 及 bump 哪个版本、bump 时同步全部契约文档（docs/plugin-api-versioning.md、docs/plugin-protocol.md、CONTEXT.md、ADR）与项目技能（AGENTS.md §11 同步规则）。用户提到插件 API 版本、宿主 API 版本、协议版本、能力版本、schemaVersion、破坏性升级、版本兼容、发版时检查插件契约、插件 API 要不要升版本时适用——尤其是主程序发版场景，禁止顺手同步 bump 插件版本号。
---

# Plugin API Versioning (my_label_tool)

插件 API 版本号与契约文档维护技能。所有涉及插件契约版本的变更与主程序发版核对都必须遵守本技能流程。

## 1. 版本号基线（必须）

本项目存在互不绑定的多套版本号，先确认各自位置与规则：

- **主程序版本**：`package.json` / `src-tauri/Cargo.toml` / `tauri.conf.json`——由发布流程与 `generate-changelog` 技能维护，**本技能不修改**，只作为核对参照。
- **宿主 API 整体版本**（覆盖 `hello`/`fs`/`config.migrate` 等基础能力）：常量维护在 `src-tauri/src/plugins/`（如 `api.rs` 的 `HOST_API_VERSION`），握手 `hello` 的 `supportedVersions.hostApi` 下发；基础能力破坏性变更时 +1。
- **业务能力版本**：`exporter` / `prelabel` 各自独立（`capabilities.<name>.apiVersion`，握手 `supportedVersions.exporter/prelabel` 下发）；仅对应能力的破坏性变更时 +1。
- **协议版本**：NDJSON 信封 `v`（`protocol.rs`），协议行为破坏性变更时 +1；新增错误码/新消息类型属增量，不 bump。
- **manifest schemaVersion**：`manifest.rs`，manifest 字段结构破坏性变更时 +1。
- **插件配置版本（configVersion）**：插件侧声明、宿主不解释——不属本技能维护范围。

文档真相源为 `docs/plugin-api-versioning.md` 的版本表（当前版本 / 支持版本集合 / 弃用中 / 移除历史），版本号变更必须与之一致。

## 2. 变更判定（必须）

先判定契约变更类型，再决定是否 bump：

- **增量变更**（新增可选字段、新协议方法、新错误码、能力扩展）：**不 bump 任何版本号**；同步文档记录即可（协议文档变更条目、版本表历史）。同一版本号内宿主承诺增量兼容（ADR 0007）。
- **破坏性变更**（删除字段/改变既有语义/重排必需字段/改变消息形状/移除错误码/改变参数语义）：
  - 仅基础能力（`hello`/`fs`/`config.migrate`）→ 整体版本 +1
  - 仅 `exporter` → `exporter` 能力版本 +1
  - 仅 `prelabel` → `prelabel` 能力版本 +1
  - 跨多个 → 各自分别 +1
  - 信封/消息形状/错误码语义 → 协议版本 +1
  - manifest 结构 → `schemaVersion` +1
- **禁止**：随主程序发版同步 bump（无契约变更时版本号一律不动）；增量变更 bump 版本号；一个变更同时 bump 多个无关版本面。

## 3. bump 流程（破坏性变更时）

1. 列出受影响版本面并各 +1，旧版本进入弃用期（兼容期 ≥2 个 host API 版本，ADR 0007）。
2. 同步全部文档落点（缺一不可）：
   - `docs/plugin-api-versioning.md`：版本表更新 + 变更条目（类型/受影响面/兼容期/移除时间）
   - `docs/plugin-protocol.md`：协议层变更时
   - `docs/plugin-manifest.schema.json`：manifest 结构变更时
   - `CONTEXT.md`：错误码、术语变化时
   - ADR：模型本身变化时新建/修订（修订需用户确认，不静默改）
   - `ROADMAP.md`：需要实现工作（新实现/迁移）时
   - `AGENTS.md §10` 与 `plugin-coding`/`plugin-review`/本技能：契约规则变化时同步（AGENTS.md §11 同步规则）
3. 弃用期满：在版本表中标记移除，更新协商失败消息样例（`API_VERSION_UNSUPPORTED` 的可操作原因）。

## 4. 主程序发版核对（必须）

每次主程序发版（`generate-changelog` 流程或用户要求发版）时执行：

1. 检查本次版本范围内的 git diff 是否触及插件契约：`src-tauri/src/plugins/`、`src/types/plugin.ts`、协议/错误码/权限/配置结构及对应文档。
2. **无契约变更** → 明确报告「无插件契约变更，所有插件 API 版本号保持不变」，不修改任何版本常量。
3. **有变更** → 按 §2 判定：增量只同步文档，破坏性走 §3 bump 流程。
4. 版本号一致性核对：常量、握手 `supportedVersions`、`docs/plugin-api-versioning.md` 版本表三处一致。

## 5. 报告格式（必须）

```
## 插件 API 版本核对
- 本次变更类型：无契约变更 / 增量（列出项）/ 破坏性（列出项）
- 版本变化：宿主 API 整体 x→y；exporter x→y；prelabel x→y；协议 v_x→v_y；schemaVersion x→y（未动者注明"不变"）
- 弃用/移除：旧版本 x 进入弃用期（移除时间预估）；版本 y 已移除
- 文档同步：列出实际更新的文件；未更新的维护位置与原因
- 一致性：常量 / supportedVersions / 版本表 核对结果
```

## 6. 禁止事项

- 禁止随主程序发版无脑同步 bump 插件 API/协议版本。
- 禁止增量变更 bump 版本号。
- 禁止只改版本号不同步文档（§11 同步规则）。
- 禁止修改主程序版本号（`package.json`/`Cargo.toml`/`tauri.conf.json`——那是 `generate-changelog` 的职责）。
- 禁止静默修订 ADR；ADR 变更需用户确认。
