---
name: plugin-coding
description: 项目级插件开发约束技能（my_label_tool 插件系统）。在本仓库设计、实现或修改任何插件相关代码时必须使用：插件框架（src-tauri/src/plugins/ 的 manifest/protocol/runtime/permissions/registry/config）、前端插件契约与 UI（src/types/plugin.ts、lib/tauri-api.ts 插件命令封装、src/components/settings/ 插件管理）、插件 Schema 与校验逻辑，以及任何会触及插件层契约的核心改动（AnnotationShape/LabelConfig/LabelTemplate、ProjectConfig、导出结构、预打标请求/结果、Tauri commands）。用户提到插件、plugin、manifest、扩展类型、插件协议、权限授予、配置迁移、安全模式、插件导出格式、外部预打标程序时都适用，即使没有明说"插件"二字。开发后交付前调用 plugin-review 做正式审查。
---

# Plugin Coding (my_label_tool)

项目级插件开发约束技能。所有插件相关设计、编码、修改都必须遵守本技能流程与仓库约束文档。

## 1. 编码前必读（必须）

设计或编码前，先读取以下文件（除非本会话已读过且未被修改）：

- `AGENTS.md` — §10 插件系统开发约束（本次编码的主依据）+ 其余章节的常规规范（命令、编码规范、测试要求）
- `CONTEXT.md` — 插件系统术语表；输出与代码命名必须使用其中词汇（插件/扩展类型/插件清单/插件 ID/宿主 API 版本/协议版本/能力/权限授予/授权/插件配置/配置迁移/安全模式/自动禁用/标准错误码/调用/注册）
- `docs/adr/0003-plugin-runtime-external-process-stdio.md`、`0004-exporter-plugins-use-code-plugin-protocol.md`、`0005-plugin-trust-no-signing-minimal-permissions.md`、`0006-plugin-config-opaque-json-with-migration-calls.md` — 插件系统架构决策
- `ROADMAP.md` 插件系统章节 — 当前任务在整体计划中的位置与验收标准
- 本次改动触及的核心契约：`src/types/annotation.ts`、`src/types/export.ts`、`src/types/prelabel.ts`、`src/lib/importers.ts`（ProjectConfig）、`src/lib/tauri-api.ts`（命令封装）

## 2. 编码规则（必须）

- **契约先行**：插件域数据类型（Manifest、能力、权限、协议消息、插件配置）先在 `src/types/plugin.ts` 定义并带版本号，Rust 端 `src-tauri/src/plugins/` 模型保持字段一一对应；对外 Schema 提供 JSON Schema 文件与校验测试。
- **稳定唯一 ID**：插件及功能 ID 使用反向域名命名空间（如 `dev.acme.xxx`），永久稳定、不复用；显示名称可以改，ID 一经发布不得变更。
- **版本分层**：插件版本、宿主 API 版本、协议版本三者独立编号，禁止混用或互相推导；宿主 API 版本分整体版本与业务能力版本（`exporter`/`prelabel` 各自独立）；manifest 以 `apiVersion.min` 声明目标版本，宿主按目标版本分派实现；同一版本号内禁止破坏性变更，破坏性变更必须开新版本号并把旧版本实现按弃用期保留后移除（ADR 0007）；协议消息携带协议版本。
- **版本号独立维护**：宿主 API 版本与协议版本独立于主程序版本号；主程序发版 bump 自身版本号时不得顺手同步 bump 插件 API 或协议版本，仅当契约实际变更时才递增。
- **能力声明优先**：宿主以插件握手时的能力声明为准，不得以版本号推断能力；新增能力走 manifest 声明 + 握手协商，禁止隐式约定。
- **向后兼容优先**：新增字段可选且有默认值；禁止删除字段、改变既有字段语义或重排必需字段；宿主 API 变更走弃用流程：标记 deprecated → 提供替代 → 兼容期 → 移除，禁止直接硬删。
- **权限最小化**：插件访问文件/网络/项目数据必须经宿主协议代理与权限模型（`fs.read`/`fs.write` 目录级授予、`network` 默认拒绝、`spawn` 不开放）；禁止绕过权限模型直接向插件暴露 Tauri commands、文件句柄或底层系统能力。
- **故障隔离**：插件调用必须有超时；宿主启动、项目打开、数据保存等关键路径不得同步等待插件；连续失败 3 次自动禁用，安全模式下禁用全部代码型插件（数据型插件保留）。
- **目录归属**：Rust 插件框架代码集中在 `src-tauri/src/plugins/`；前端类型放 `src/types/plugin.ts`，Tauri 调用封装进 `lib/tauri-api.ts`，管理 UI 放 `src/components/settings/`，用户可见文案进 i18n；组件内禁止直接 `invoke`。
- **测试要求**：manifest 校验、协议解析、权限判定、配置迁移、故障隔离逻辑必须有单元测试；新增错误码、消息类型、协议行为必须同步 conformance 测试与文档。行为验证（单测/冒烟）的测试脚本与运行结果必须保留在可复核位置，禁止跑完即删、只留口头结论——审查方要能复跑或查看证据。
- **术语与契约一致性**：协议消息字段、错误码、能力名、术语必须与 `CONTEXT.md` 逐项一致，不得自造平行词汇或改错误码语义；新增用户可见文案走 i18n 并同步前后端语言文件。
- 遵守仓库禁止 `any`、i18n 集中、单文件 ≤1000 行等常规约束。

## 3. 边界影响评估（必须）

改动**非插件代码**时同样适用本技能：任何涉及标注数据模型（`AnnotationShape`/`LabelConfig`/`LabelTemplate`）、项目配置（`ProjectConfig`）、导出结构、预打标请求/结果或 Tauri commands 的改动，都会改变插件层可见的契约面。编码前先回答：这个改动是否会被插件读取或调用？回答"是"时：

1. 同步更新对应 Schema、兼容性说明与 conformance 测试；
2. 若改动与 `docs/adr/0003-0006` 的决策冲突或开辟新契约面，向用户提出 ADR 更新/新建建议，经确认后先改文档再编码；
3. 不得"改完核心后才发现插件契约被破坏"。

## 4. 规范冲突处理（必须，逐点确认）

当用户新要求与 `AGENTS.md §10` 或 ADR 约束冲突时：

1. **不得**直接修改约束文档，也**不得**静默按新要求编码绕过约束。
2. 将冲突完整列出：约束原文（文件+条款）vs 用户要求，呈现给用户确认。
3. **每次每点修改单独确认**：用户确认第 1 点后，才能修改第 1 点；未确认的点不得修改。禁止"确认了 A 顺手改 B"。
4. 确认后先更新约束文档（AGENTS.md/CONTEXT.md/ADR，保持互相一致），再按新约束编码。
5. 冲突只针对约束条款；实现细节层面的取舍记录理由即可，不需逐点确认。

## 5. 交付前自查（必须）

编码完成后，对照 `plugin-review` 技能的审查维度自查一遍：契约与 Schema、ID 与版本分层、能力声明、向后兼容、权限与隔离、目录与工程约定、测试。自查时把代码当作待审查对象：逐条核对必读文档中的条款是否落实、测试证据是否可复核、术语与 `CONTEXT.md` 是否一致。发现不通过项先修复再交付。自查不代替正式审查：交付后调用 `plugin-review` 进行正式审查。

## 6. 禁止事项

- 禁止新增与约束并行的"第二套约定"（新 ID 体系、新错误码集合、新版本号机制）。
- 禁止为了绕过约束而把插件逻辑塞进非插件模块或反之。
- 禁止未读约束文档直接编码。
- 禁止删除或重定义已有契约字段而不走弃用流程。
