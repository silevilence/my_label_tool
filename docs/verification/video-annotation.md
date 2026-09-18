# 视频标注开发与验收记录

## 混合项目与 UI 整合复审（2026-09-18）

针对用户反馈「顶部视频条与现有 UI 脱节」，范围覆盖菜单、素材列表、画布底部、
项目加载、添加视频、统一保存/导出，以及图片与多视频混合项目。
现有 slate/sky 样式和侧栏布局保持一致，移除 VideoImportBar；本轮仍不使用 Computer Use。

完成行为：

- 项目目录同时显示图片、待抽帧视频、已抽帧视频；视频为独立素材条目，选中后展示帧。
- 时间轴和插值只出现在选中视频的画布底部；切回图片隐藏，重新选择视频恢复此前帧位置。
- 视频添加到当前目录，不清空其它素材、标签、标注或历史；已存在的视频直接定位。
- 原生 JSON 共用保存/另存为及 Ctrl+S，附带可选版本化 projectMedia；COCO/VOC/YOLO 另存为不改变混合项目的原生保存配置。
- 多视频帧使用子目录前缀避免重名；插值仅处理当前视频，即使跨视频轨迹 ID 相同也不合并。

审核后修复：

| 问题 | 决策及修复 | 证据 |
| --- | --- | --- |
| 原视频导入替换整个项目，顶部控件脱离素材和导出流程 | 完全采纳；改为项目内追加、侧栏统一素材、画布底部控件及原生保存 | `src/components/AppLayout.tsx:637`、`src/components/sidebar/AppSidebar.tsx:470`、`src/lib/project-media.ts:54` |
| 相同帧文件名/轨迹 ID 会导致多个视频相互覆盖 | 完全采纳；给帧添加项目相对目录命名空间，插值接收当前视频帧集 | `src/lib/project-media.ts:11`；project-media.test.ts 重名帧、轨迹隔离、YOLO 输出路径及原生回读测试 |
| 旧单视频目录新增视频后重开可能只枚举根目录视频 | 完全采纳；根目录元数据作为一个素材保留，继续扫描子目录 | `src-tauri/src/media/project_media.rs:6`、`:85` 的旧目录扩展回归 |

正式插件边界审核（AGENTS.md §10，ADR 0003–0007）：

| 维度 | 结论与证据 | 约束 |
| --- | --- | --- |
| 契约与 Schema | 通过；ProjectVideo 两端对应（`src/types/video.ts:24`、`src-tauri/src/models/video.rs:33`）；projectMedia.schema.json 通过 AJV 校验，原生 JSON 附加元数据不传入插件 exportData | §10 契约先行、边界影响评估 |
| ID 与版本分层 | 通过；没有改变插件 ID、宿主 API、能力或协议版本；新增宿主元数据独立 schemaVersion 1 | §10 版本分层，ADR 0007 |
| 能力声明 | 通过；无插件能力变化，继续使用原 exporter/prelabel 握手与执行流程 | §10 能力声明优先，ADR 0003/0004 |
| 向后兼容 | 通过；ProjectConfig 保持 schemaVersion 1，普通图片及旧单视频目录回归通过；labels/images 原生解析保持兼容 | §10 向后兼容，ADR 0006 |
| 权限与隔离 | 通过；`src-tauri/src/commands/video.rs:48` 仅宿主枚举入口，未加入插件协议；帧均在项目目录内，插件继续受原代理和权限约束 | §10 权限最小化，ADR 0003/0005 |
| 目录与工程约定 | 通过；扫描在 media/project_media，命令只转发，Tauri 调用集中封装，新文案集中 i18n；未新增依赖 | §6，§10 目录归属 |
| 测试 | 通过；完整 App DOM 测试覆盖素材切换、时间轴归属、添加第三个视频保留原标注；混合 JSON 保存重开与 Rust 枚举测试覆盖多视频，既有插件 conformance 继续执行 | §7，§10 契约先行，ADR 0003/0004 |

没有发现插件契约违规或规范缺陷。验证命令为 `scripts/verify-video-support.ps1`；
完整输出保留在 git 忽略的 `docs/verification/video-project-ui-checks.log`。
结果：前端 41 个文件、267 项测试通过，行覆盖率 94.51%；typecheck、lint、
clippy（-D warnings）、前端生产构建均通过。Rust 224 项通过、12 项 ignore，
conformance 1 项通过；真实 FFmpeg ignore 用例另行显式执行并通过。
最后的导出面板保存按钮调整再次通过 typecheck、lint 和 8 项相关回归。
自动化已覆盖组件结构与交互；没有声称执行实际桌面标注或视觉验收。

## 全量审核与修复（2026-09-18）

范围：五个任务提交 `42eca95`、`cf969d3`、`5863d6a`、`91f45e7`、`b6fe354`，
以及随后完整审核发现的问题修复。按依赖顺序完成导入、时间轴、逐帧关联、插值和导出；
每项先开发和快速审核、修复阻塞，再原地勾选 ROADMAP 并本地提交。
最终流程为只读审核、逐项核实修复、自动化验证、只读复审。

结论：五项需求均满足，可以标记完成；修复后无阻断或严重问题，无需用户决策。
依据 AGENTS.md §3/§6/§7/§10、CONTEXT.md、ADR 0003–0007。
按用户明确要求，未使用 Computer Use，未进行人工画布标注验收。

### 审核发现及逐条决策

以下行号指向修复后的实现，可由相应任务提交对比修复前行为。

| 编号 | 严重度 | 核实与决策 | 修复证据及验证 |
| --- | --- | --- | --- |
| Q1 | 严重 | 完全采纳。原保存流程通过 Promise.all 为全部帧解码尺寸，大视频会同时加载大量图片；视频元数据已校验同尺寸，可直接复用。 | `src/hooks/useProjectActions.ts:604` 使用视频尺寸；`src/hooks/video-project-roundtrip.test.tsx:27` 覆盖保存/重开、轨迹/源帧/坐标恢复，并断言不调用图片解码。 |
| Q2 | 严重 | 完全采纳。原批量写入逐帧复制整个索引和历史，帧数增长后形成二次方开销。 | `src/store/useAnnotationStore.ts:144` 单次复制索引、暂存逐帧历史后原子写入；`src/store/video-annotations.test.ts:79` 一万帧回归通过，单独运行测得 32 ms，保留逐帧撤销/重做语义。 |
| Q3 | 严重 | 完全采纳。仅检查有限数值不足以拒绝畸形矩形、点和多边形，导出可能不满足图形契约。 | `src/lib/exporters/video.ts:18` 复用 `src/lib/video-interpolation.ts:110` 的完整图形校验；新增异常几何回归，导出样例经 AJV Schema 校验。 |
| Q4 | 一般 | 完全采纳。加载端未对齐元数据 Schema 的间隔上限及非空源路径，也未强制首帧时间归零。 | `src-tauri/src/media/video.rs:273` 补齐拒绝条件；真实视频测试增加畸形元数据拒绝。 |
| Q5 | 一般 | 完全采纳。抽帧期间插值预览中的导航按钮仍允许激活，与其它工作区禁用状态不一致。 | `src/components/video/VideoInterpolationPanel.tsx:143` 同步 disabled；前端组件和项目回归通过。 |
| Q6 | 一般 | 部分采纳。旋转样例尺寸断言失败真实存在；不采纳直接修改生产解码方向的建议，ffprobe 证明夹具未携带旋转矩阵。 | `src-tauri/src/media/video_tests.rs:114` 用 `-display_rotation 90` 构造真实矩阵；保持生产 autorotate 行为，64×48 视频抽出 48×64 图片。 |
| Q7 | 严重 | 完全采纳。实际桌面构建的 Windows PowerShell 无 Get-FileHash，导致 beforeBuildCommand 退出。 | `scripts/prepare-video-tools.ps1:21` 改用 .NET SHA256 流式计算并释放句柄；在同一个 Tauri 构建入口重新验证。 |

### 需求与自动化证据

| 需求 | 证据 |
| --- | --- |
| 离线导入与固定源帧间隔 | Rust 真实 FFmpeg 测试：中文路径、10 帧取 0/3/6/9、目录重开、缺帧/越界文件名/损坏输入拒绝、取消和失败目录回滚；附带工具优先级单测。 |
| 时间轴与快速切帧 | VideoTimeline DOM 测试：首尾、单帧、禁用、当前帧号及实际时间；useImageLoader 测试过期回调隔离，image-cache 测试数量/内存界限。 |
| 单帧标注关联 | store 对矩形/点/多边形、导入和批量写入、编辑与撤销重做统一绑定源 frameIndex；原生 JSON 保存重开集成测试。 |
| 关键帧插值 | 纯逻辑与 DOM 测试覆盖分段线性插值、三种图形、重复轨迹、不兼容端点、人工标注保护、过期预览、显式应用、撤销重做。 |
| 视频格式导出 | AJV Schema、原生解析回读、空帧/轨迹/时间戳保真；COCO bbox、VOC XML 解析、YOLO 数值检查；导出按钮取消与写盘失败测试。 |

### 插件正式复审

七个维度全部通过；阻断 0、严重 0、一般 0、建议 0；未发现需修改约束的规范缺陷。
审核对象是本次视频改动对插件边界的影响，未修改插件运行时隔离机制。

| 维度 | 结果与证据 | 约束引用 |
| --- | --- | --- |
| 契约与 Schema | 通过。`src/types/video.ts:9` 与 `src-tauri/src/models/video.rs:14` 对应；宿主导出独立版本化，`src/lib/exporters/video.test.ts:12` 编译 Schema 并校验。 | AGENTS.md §10 契约先行、边界影响评估 |
| ID 与版本分层 | 通过。插件 ID、宿主 API、exporter/prelabel 业务能力及协议版本未变；宿主 VideoProject.schemaVersion 独立维护。 | AGENTS.md §10 版本分层、版本号独立维护；ADR 0007 |
| 能力声明 | 通过。没有新增插件能力，现有 manifest/握手分派未修改；视频专用 envelope 不传给插件。 | AGENTS.md §10 能力声明优先；ADR 0003/0004 |
| 向后兼容 | 通过。`src/store/useAnnotationStore.ts:326` 仅对已绑定视频帧规范源帧号；无视频映射时保持图片行为。ProjectConfig、插件导出结构与迁移流程保持兼容。 | AGENTS.md §10 向后兼容；ADR 0006 |
| 权限与隔离 | 通过。`src-tauri/src/commands/video.rs:9` 是宿主入口，未接入插件协议方法；插件继续通过既有代理读取帧图片，未获得进程启动或原视频路径能力。 | AGENTS.md §10 权限最小化、故障隔离；ADR 0003/0005 |
| 目录与工程约定 | 通过。处理逻辑在 media/video、模型在 models/video，调用在 `src/lib/tauri-api.ts:13`，文案在两端 i18n，组件无直接 invoke。 | AGENTS.md §6/§10 目录归属 |
| 测试 | 通过。既有插件契约、配置、UI 测试及 Rust conformance 均通过；无新增协议消息/错误码，故无需新增协议案例。 | AGENTS.md §7/§10 契约先行；ADR 0003/0004/0006 |

### 最终验证结果

`scripts/verify-video-support.ps1` 全程成功退出：

- typecheck、lint、cargo clippy（`-D warnings`）通过。
- 前端 40 个文件、262 项测试通过；行覆盖率 94.44%（1241/1314），高于 90% 要求。
- Rust 222 项通过，12 项 ignore；插件协议 conformance 1 项通过。
- 另显式执行其中真实 FFmpeg ignore 测试并通过：恒定帧率、变帧率时间戳 1.1/1.4 秒、旋转及异常/取消路径均验证。其余 11 项外部环境/交互测试未执行；本次未修改生产预打标逻辑。
- 前端生产构建通过；Vite 提示主 chunk 超过 500 kB，是体积建议而非构建错误。
- `npm run tauri build -- --debug --no-bundle` 通过，生成 `src-tauri/target/debug/my_label_tool.exe`；没有启动窗口或安装器。FFmpeg 资源准备和 SHA-256 清单生成通过。
- 本地完整测试输出保存在 git 忽略的 `docs/verification/video-support-checks.log`；桌面构建输出在 `docs/verification/video-desktop-build.log`。

测试只验证自动化覆盖范围，不声称替代人工缩放对齐、连续实际绘制或安装器安装验收。
诊断生成的 `.local-video-qa/` 样例因工具策略拦截清理而保留，已排除版本控制。

## 任务 5：视频导出

快速审核：通过，无阻塞项。版本化视频 JSON 包含元数据、空帧、原图坐标与轨迹，图片路径
采用帧文件名。Schema 复用现有标签/图形定义，未改变插件请求与 ProjectConfig。
格式取舍与来源见 docs/video-annotation.md。259 项前端测试通过，行覆盖率 94.41%；
video exporter 行覆盖率 100%。样例同时检查 COCO bbox、VOC XML 解析与 YOLO 归一化数值；
DOM 测试覆盖实际导出入口、取消和写盘失败。typecheck、lint、cargo clippy 通过。

## 任务 4：跨帧插值

快速审核：通过，无阻塞项。计算阶段不写 store，应用前检查快照未过期；保留其它目标，
拒绝重复轨迹、人工中间标注和不兼容端点，人工修改自动插值后提升为关键帧。
252 项前端测试通过（含分段插值、三种图形、无效坐标、预览/应用 DOM 流程与撤销重做），
行覆盖率 94.36%；typecheck、lint、cargo clippy 通过。
插件检查沿用任务 1 七维度：全部通过；新增信息位于既有 attributes 扩展字典，
无需改插件 Schema、能力声明、ID、API/协议版本、权限或配置迁移。

## 任务 3：单帧标注与帧关联

快速审核及插件边界检查：通过，无阻塞项；沿用已存在的 frameIndex，不改变 Schema、API 或协议。
store 对当前视频帧绑定统一作用于手绘、编辑、预打标批量合并、导入和撤销/重做。
矩形、多边形、点的原图坐标及不同帧的数据隔离、原生 JSON 保存恢复均有回归测试。
快速切帧的过期图片回调不会覆盖新帧；解码缓存按最近使用顺序淘汰，最多 8 张/128 MiB。
typecheck、lint、coverage（244 项，行覆盖率 94.19%）、cargo clippy 均通过。

## 任务 2：时间轴

快速审核：通过，无阻塞项。时间轴按抽取帧导航，界面源帧从 1 显示，文件源帧从 0 保存。
当前帧来自同一 selectedPath，列表、快捷切帧和时间轴无独立选中状态。
自动化覆盖首/尾跳转、实际时间戳、单帧、无选中项和禁用状态。
typecheck、lint、coverage（236 项，行覆盖率 94.07%）、cargo clippy 均通过。

按用户要求仅采用自动化测试，没有使用 Computer Use 或实际人工标注验收。

## 任务 1：视频导入与抽帧

快速审核：通过，无阻塞项。固定源帧间隔、真实时间戳、帧列表复用、重开校验、
取消/失败回滚、独占任务、进程超时、离线安装包资源均有实现。

- `npm run typecheck`、`npm run lint`、`cargo clippy --manifest-path src-tauri/Cargo.toml`：通过。
- `npm run test:coverage`：233 项通过，行覆盖率 94.07%；`video-images.ts` 全部语句/分支命中。
- `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=4`：221 项通过、12 项隔离；conformance 1 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml real_video_extract_reload_cancel_and_failure_cleanup -- --ignored`：通过。自动生成 64×48 / 10 帧视频，间隔 3 得到源帧 0/3/6/9，末帧时间 0.9 秒；覆盖中文路径、元数据重开、缺帧拒绝、取消、损坏输入与失败清理。
- `scripts/prepare-video-tools.ps1`：本地 FFmpeg 7.1.1 资源复制、LICENSE、版本、SHA-256 清单生成通过。

已修复测试阻塞：模拟 API 补充视频查询；快捷键测试等待实际 lazy import；
Rust 响应头超时夹具保持连接但不无限读取可能未发送的请求。生产下载逻辑未修改。

插件快速审查（依据 AGENTS.md §10、ADR 0003–0007）：

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 契约与 Schema | 通过 | 独立宿主 VideoProject，不修改插件结构 |
| ID 与版本分层 | 通过 | 插件 ID/API/协议版本保持原值 |
| 能力声明 | 通过 | 无新增插件能力 |
| 向后兼容 | 通过 | 普通目录返回 null，既有图片项目测试通过 |
| 权限与隔离 | 通过 | 视频 commands 仅宿主调用，插件代理不变 |
| 目录与工程约定 | 通过 | media/video、models/video、tauri-api、i18n 分层 |
| 测试 | 通过 | 前后端回归、真实 FFmpeg 与 conformance 均通过 |
