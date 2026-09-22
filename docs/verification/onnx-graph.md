# ONNX 图结构与形状推导验收

日期：2026-09-22。范围：ROADMAP「开发中」的宿主解析、应用内结构视图、展示用形状推导三项任务。

## 需求来源与 Git 基线

本次实施会话开始时，工作区已有用户未提交的 ROADMAP 修改：三条 ONNX 任务及验收标准均已存在且未勾选，十二项旧任务也已经移到「已完成」。实现是在读取该工作区内容后开始的；完成时仅将三条任务及子项原地勾选，保留用户整理。`3a95922` 不包含这份未提交内容，因此 `7f658a8` 相对 Git 基线的差异同时包含用户原有编辑和本次勾选。

此说明依据本会话开工时的工作区观测，不把 `3a95922` 描述为完整需求快照。没有实施前的独立需求提交可供仅凭 Git 重建；也不伪造该提交或回退用户整理。此次审核修复保持 ROADMAP 不变。

## 独立真实模型核对

使用官方 Ultralytics yolo11n / yolov8n 权重，在仓库外导出 ONNX：Python 3.12.8、ultralytics 8.4.158、torch 2.14.0+cpu、onnx 1.23.0，`imgsz=640, opset=17, simplify=False`。模型和 Python 环境不入库。

`scripts/verify-onnx-graph.py` 调用与宿主命令相同的 Rust parser，再与 Python ONNX protobuf 独立解析结果逐项比对节点名称/类型/域/输入输出、每条边、initializer 名称/形状/类型/字节数及元数据。

| 模型 | 节点 | 边 | initializer | 对比形状 | 展示推导形状 | 未知形状 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| yolo11n | 355 | 668 | 175 | 367 | 365 | 0 |
| yolov8n | 263 | 495 | 127 | 272 | 270 | 0 |

以上形状与 `onnx.shape_inference.infer_shapes(strict_mode=True)` 的所有确定维度一致。每个模型有 9 个张量的部分维度在参考推导中仍为符号，而本实现能通过小型常量计算得出确定值；另外使用 Python onnxruntime 1.24.3 CPU 执行这些输出，实际形状全部一致。Python Runtime 只用于开发核对，不是查看器依赖。

模型 SHA-256：

```text
yolo11n.onnx 057e2106f48e3c1f16928963189120c8d7646af565a1376220d06d9e90881a4d
yolov8n.onnx f67c88dd016ecb7ebfb300d6433df581ef29136677bb38c2ab8eaa2d89fc784e
```

额外执行真实模型 Rust 测试 `graph_io_agrees_with_existing_official_model_metadata`：两个模型的输入宽高、输出类别维度与原有 `inspect_onnx_model` 所用元数据解析一致。原有 `inspects_official_ultralytics_model_when_fixture_is_available` 也通过。

复跑命令（使用自己导出的模型路径；Python 工具只装在开发环境）：

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --features onnx-graph-dev --bin inspect_onnx_graph
python scripts/verify-onnx-graph.py C:/models/yolo11n.onnx C:/models/yolov8n.onnx
$env:MY_LABEL_TOOL_YOLO_ONNX = 'C:/models/yolo11n.onnx'
$env:MY_LABEL_TOOL_YOLOV8_ONNX = 'C:/models/yolov8n.onnx'
cargo test --manifest-path src-tauri/Cargo.toml graph_io_agrees_with_existing_official_model_metadata -- --ignored
cargo test --manifest-path src-tauri/Cargo.toml inspects_official_ultralytics_model_when_fixture_is_available -- --ignored
```

审核修复后，上述核对仅按需手动运行，不再接入常态 CI 或在 CI 安装 Python onnxruntime。开发 CLI 及其 Rust re-export 仅在显式开启 `onnx-graph-dev` 时构建，默认应用构建不暴露此接缝。原有官方模型 CI 只补充共享解码器 `onnx_wire.rs` 的路径触发，继续检查已有元数据/推理回归。本地导出环境版本如上，未声称本次已运行远端 CI。

## 自动化与界面验收

- `npm run typecheck`、`npm run lint`、`npm run build` 通过。
- `npm run test:coverage`：87 个测试文件，509 项通过；行覆盖率 95.73%，分支覆盖率 90.71%。
- `cargo clippy --manifest-path src-tauri/Cargo.toml` 通过。
- Rust 全量结果见同目录测试记录；外部模型测试另外显式运行，结果如上。
- 新增测试覆盖截断/损坏文件、缺失算子、悬空边、重复生产者、拓扑顺序、循环图、权重概要、符号维度、常见算子、错误形状、动态与自定义域、精度超出安全范围的常量。
- 前端测试覆盖 1,000 节点无丢失/无重叠、缩放锚点不变、详情与三种来源、错误重试、过期请求忽略、拖拽不误选、下一次点击可选、Esc 关闭。

首次实现的浏览器实测使用开发回放页渲染同一个 `OnnxGraphDialog` 组件，IPC 替身返回上述 CLI 生成的真实 JSON。审核修复移除了 `scripts/onnx-graph-preview.html/.tsx` 及专属应用文案，以免维护位于类型检查范围外的页面。原回放代码保留在 Git 提交 `7f658a8` 中供核查；当前复核使用组件测试与显式开发 CLI，不再提供该开发页面入口。以下浏览器观察属于首次实现记录，不声称是审核修复后的重新手测。

实测两个模型分别渲染 355 / 263 个 SVG 节点；已验证滚轮缩放、拖拽改变相机位置、直接点击节点、下拉定位、恢复适应视图、输入输出/权重/属性详情、来源颜色及 Esc 关闭。窄窗口（425 × 611）发现的详情裁切问题已修复并复查。未进行 FPS 基准测试。

原生 Tauri 窗口确认未安装 ONNX Runtime 时仍可进入模型库并打开文件选择器；该机器的原生文件选择器自动化焦点不稳定，未完成“原生选择文件到展示”的完整自动化链路。真实文件解析由同源 Rust CLI 和测试验证，结构视图交互由真实数据回放与组件测试验证；不将回放当作原生端到端通过证据。

首次默认并发 Rust 全量测试出现 3 项既有时序测试失败（下载取消、文件代理提交取消及超时 worker 计数）。完整串行复跑通过，最终提交前再次使用 `--test-threads=1` 验证。没有修改这些测试或跳过失败项。

## 首次实现的插件边界正式审查（7f658a8）

使用项目 `plugin-review` 技能做只读审查，依据 AGENTS.md §10、CONTEXT.md 和 ADR 0003–0006。审查期间未修改实现或规范。结论：通过；阻断 0 / 严重 0 / 一般 0 / 建议 0。未发现本次范围内需修改的规范缺陷。

| 维度 | 结果 | 证据与约束引用 |
| --- | --- | --- |
| 契约与 Schema | 通过 | `src/types/onnx-graph.ts:1` 与 `src-tauri/src/media/onnx_graph/types.rs:7` 字段对应；新增结构为宿主内部 DTO，插件及核心交换 Schema 无差异。AGENTS.md §10 契约先行、边界影响评估。 |
| ID 与版本分层 | 通过 | 未添加插件 ID 或能力版本；`src-tauri/src/plugins/versioning.rs:4` 起的各版本常量均无差异，主程序版本也未改变。AGENTS.md §10 稳定唯一 ID、版本分层及独立维护。 |
| 能力声明 | 通过 | `src-tauri/src/plugins/protocol.rs:588` 的能力结构与握手无差异，没有隐式新增插件能力。AGENTS.md §10 能力声明优先，ADR 0003、0004。 |
| 向后兼容 | 通过 | `src-tauri/src/media/onnx_metadata.rs:1` 改为共享解码器；既有 summary 字段、项目配置、预打标及导出契约无差异。`shapes.rs:121` 不覆盖磁盘已有形状。AGENTS.md §10 向后兼容优先，ADR 0004、0006。 |
| 权限与隔离 | 通过 | `src-tauri/src/commands/onnx_graph.rs:9` 仅执行阻塞文件解析；`src-tauri/src/plugins/permissions.rs:339` 代理仍仅分派 fs.read/fs.write，未暴露新命令。插件权限、AppContainer、超时及安全模式路径无差异。AGENTS.md §10 权限最小化、故障隔离，ADR 0003、0005。 |
| 目录与工程约定 | 通过 | `src/lib/tauri-api.ts:243` 统一 invoke，command 薄封装、处理位于 media，DTO 位于 types，文案集中 i18n；未引入依赖。AGENTS.md §6、§10 目录归属。 |
| 测试 | 通过 | `src-tauri/src/media/onnx_graph/tests.rs:74` 错误分支，`:141` 真实元数据一致性；`src/components/settings/OnnxGraphDialog.test.tsx:82` 起覆盖 UI/失败/手势。既有插件 conformance 随全量 Rust 测试验证；无新增插件错误码或协议行为。AGENTS.md §7、§10，ADR 0003–0006。 |

本次只在 AGENTS.md 命令清单增加宿主命令说明，未改变 §10 约束，因此项目技能无需同步修改。

## 审核意见修复结果

编号 S1–S9 对应 Standards 表顺序，P1–P6 对应 Spec 表顺序。共 15 项：完全采纳 8、部分采纳 5、不采纳 2。修复未改变 ROADMAP 内容或任务位置，未重启开发进程。

| 编号 | 决策 | 核实、改动及保留理由 |
| --- | --- | --- |
| S1 错误上下文 i18n | 完全采纳 | 词元原为诊断协议名称，现统一到 `src-tauri/src/i18n/zh_cn.rs:908` 起的常量，并补中文说明；media 仅引用常量。 |
| S2 重复 norm | 完全采纳 | `src-tauri/src/media/onnx_graph/shapes.rs:167` 提取 `clamp_position`，Shape 形状、常量计算与正向 Slice 共用；测试覆盖负边界、极值和空区间。 |
| S3 shape-environment | 不采纳 | `shapes.rs:466` 的 spatial 只需 Shapes，`:532` 的 Slice 只需 Constants；并非所有规则都需要完整参数组。保留显式最小输入，避免仅为缩短参数列表将依赖扩成共同环境；不改变推导行为。 |
| S4 重复查权重 | 完全采纳 | `shapes.rs:472` 一次取得权重，同时获取 kernel 和输出通道。 |
| S5 枚举魔法数 | 完全采纳 | `src-tauri/src/media/onnx_graph/proto_types.rs:3`、`:45` 集中命名 TensorProto/AttributeProto 类型，并用于字节数和常量解码；ID 与本机 ONNX 官方 proto 文件核对，不改变 wire 值。 |
| S6 开发 re-export | 部分采纳 | `src-tauri/src/lib.rs:5` 与 `src-tauri/Cargo.toml:15` 用显式 `onnx-graph-dev` 门控 API/CLI；保留一次性核对与应用使用同一解析器的必要性，不复制实现或完全移除复核能力。 |
| S7 scripts TSX 漏检 | 完全采纳 | 删除开发回放 HTML/TSX，剩余新增 TS/TSX 均在 src 内受类型检查；AGENTS.md §4 scripts 描述同步包含一次性核对脚本。 |
| S8 查看入口互斥 | 完全采纳 | `PrelabelSettings.tsx:127`、`:556`、`:602` 禁用冲突入口，文件选择返回再次判定；`OnnxGraphDialog.tsx:45` 持有模型资源直至宿主读取结束。测试覆盖更新/保存/选择器竞争/关闭/StrictMode。 |
| S9 回放文案 | 完全采纳 | 随回放页面删除 previewTitle、previewMissing；应用 i18n 仅保留实际功能文案。 |
| P1 规格与实现同提交 | 部分采纳 | 采纳 Git 需求溯源不独立的问题，在本文「需求来源与 Git 基线」记录限制；不采纳由此推定实施后编写/修剪规格。会话开工时已读到用户未提交的未勾选任务，不能凭 merge-base 覆盖工作区事实，不伪造早期提交。 |
| P2 opset 静默不推导 | 部分采纳 | `shapes.rs:13` 返回版本/范围/支持状态，`OnnxGraphDialog.tsx:143` 常显停用原因；保留 11–23 的保守限制，不以删除限制的方式对未经支持的版本套用规则。 |
| P3 算子分布折叠 | 完全采纳 | `OnnxGraphDialog.tsx:166` 默认展开分布；保留用户收起能力与顶部滚动上限。 |
| P4 无关任务迁移 | 不采纳 | 十二项迁移在实施前已经存在于用户工作区；本次 ROADMAP 无 diff。回退这些迁移会撤销用户编辑，原提交正文「保留既有整理」符合会话事实。 |
| P5 开发/CI 超范围 | 部分采纳 | 删除开发页面及 CI Python 核对/安装步骤和图专属路径触发；保留显式 feature 门控的 CLI、一次性脚本和历史证据。既有元数据 CI 仍跟踪共享解码器，以防抽取模块后丢失回归覆盖。 |
| P6 元数据一致性 | 部分采纳 | `src-tauri/src/media/onnx_wire.rs:133` 共享确定/符号/缺失维度解码，增加非 ignore 的双路径测试 `onnx_graph/tests.rs:168`。保留导入中的 0 哨兵与查看器中的符号名称，明确是不同用途的投影，避免信息损失或改变原导入契约。 |

附注中的节点定位与元数据展开器保留：分别服务数百节点定位和已要求返回的模型元数据查看，没有引入额外运行依赖。

### 修复后验证

- typecheck、lint、生产构建均通过；构建仍有主 bundle 大于 500 kB 的提示。
- 前端 87 个文件 / 515 项测试通过，行覆盖率保持 95.73%，分支覆盖率保持 90.71%。
- `cargo clippy --all-targets --features onnx-graph-dev` 通过；只有 `prelabel/pipeline.rs:548/549/560/564` 的四条既有 identity_op 警告，该文件未修改。
- Rust 全量串行：261 项通过、14 项外部夹具测试默认忽略；插件 conformance 通过。真实图/元数据夹具测试另外显式执行。
- 重新构建 feature 门控 CLI 后，两个真实模型的 protobuf/形状比对结果与本文上方表格一致。
- 修复后的原始自动化结果附在 `onnx-graph-tests.txt` 的 review-fix 段。本轮未声称完成新的原生 GUI 手测。

### 修复后插件边界正式复核

按 plugin-review 的七维做只读复核，结论通过（阻断 0 / 严重 0 / 一般 0 / 建议 0），未发现本次范围内的规范缺陷。

| 维度 | 结论与证据 | 约束 |
| --- | --- | --- |
| 契约与 Schema | 通过。`src/types/onnx-graph.ts:29` 与 `onnx_graph/types.rs:12` 对应宿主推导状态；对外插件 Schema 无差异。 | AGENTS.md §10 契约先行、边界影响评估 |
| ID 与版本 | 通过。`src-tauri/src/plugins/versioning.rs:4` 起常量及插件 ID 均未改变。 | AGENTS.md §10 稳定 ID、版本分层 |
| 能力声明 | 通过。`src-tauri/src/plugins/protocol.rs:588` 握手能力未改变，无新增隐式能力。 | AGENTS.md §10 能力声明，ADR 0003、0004 |
| 向后兼容 | 通过。`src-tauri/src/media/onnx_metadata.rs:91` 保留动态尺寸 0 投影；项目/导出/预打标交换字段无差异。 | AGENTS.md §10 向后兼容，ADR 0004、0006 |
| 权限与隔离 | 通过。`src-tauri/src/plugins/permissions.rs:339` 仍仅代理文件读写；`src-tauri/src/lib.rs:5` 默认构建不导出开发接缝。 | AGENTS.md §10 权限、隔离，ADR 0003、0005 |
| 目录与工程约定 | 通过。脚本 TSX 已删除；`src-tauri/src/i18n/zh_cn.rs:908` 集中错误上下文，`src/lib/tauri-api.ts:242` 保持唯一调用封装。 | AGENTS.md §6、§10 |
| 测试 | 通过。`onnx_graph/tests.rs:168`、`shapes_tests.rs:280`、`OnnxGraphDialog.test.tsx:174` 分别覆盖维度、版本、互斥；完整插件 conformance 通过。 | AGENTS.md §7、§10，ADR 0010 |
