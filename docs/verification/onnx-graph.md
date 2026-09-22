# ONNX 图结构与形状推导验收

日期：2026-09-22。范围：ROADMAP「开发中」的宿主解析、应用内结构视图、展示用形状推导三项任务。

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
cargo build --manifest-path src-tauri/Cargo.toml --bin inspect_onnx_graph
python scripts/verify-onnx-graph.py C:/models/yolo11n.onnx C:/models/yolov8n.onnx
$env:MY_LABEL_TOOL_YOLO_ONNX = 'C:/models/yolo11n.onnx'
$env:MY_LABEL_TOOL_YOLOV8_ONNX = 'C:/models/yolov8n.onnx'
cargo test --manifest-path src-tauri/Cargo.toml graph_io_agrees_with_existing_official_model_metadata -- --ignored
cargo test --manifest-path src-tauri/Cargo.toml inspects_official_ultralytics_model_when_fixture_is_available -- --ignored
```

官方模型 CI 工作流已增加共享解码器/图解析器路径触发和上述核对。CI 使用工作流既有固定版本的导出工具；本地导出环境版本如上，未声称本次已运行远端 CI。

## 自动化与界面验收

- `npm run typecheck`、`npm run lint`、`npm run build` 通过。
- `npm run test:coverage`：87 个测试文件，509 项通过；行覆盖率 95.73%，分支覆盖率 90.71%。
- `cargo clippy --manifest-path src-tauri/Cargo.toml` 通过。
- Rust 全量结果见同目录测试记录；外部模型测试另外显式运行，结果如上。
- 新增测试覆盖截断/损坏文件、缺失算子、悬空边、重复生产者、拓扑顺序、循环图、权重概要、符号维度、常见算子、错误形状、动态与自定义域、精度超出安全范围的常量。
- 前端测试覆盖 1,000 节点无丢失/无重叠、缩放锚点不变、详情与三种来源、错误重试、过期请求忽略、拖拽不误选、下一次点击可选、Esc 关闭。

浏览器实测使用 `scripts/onnx-graph-preview.html`，渲染同一个 `OnnxGraphDialog` 组件，IPC 替身返回上述 CLI 生成的真实 JSON。将脚本产出的两个 `.graph.json` 复制到已忽略的 `.local-models/` 后运行 `npm run dev`，打开 `http://localhost:1420/scripts/onnx-graph-preview.html` 即可复跑。该入口不进入生产构建。

实测两个模型分别渲染 355 / 263 个 SVG 节点；已验证滚轮缩放、拖拽改变相机位置、直接点击节点、下拉定位、恢复适应视图、输入输出/权重/属性详情、来源颜色及 Esc 关闭。窄窗口（425 × 611）发现的详情裁切问题已修复并复查。未进行 FPS 基准测试。

原生 Tauri 窗口确认未安装 ONNX Runtime 时仍可进入模型库并打开文件选择器；该机器的原生文件选择器自动化焦点不稳定，未完成“原生选择文件到展示”的完整自动化链路。真实文件解析由同源 Rust CLI 和测试验证，结构视图交互由真实数据回放与组件测试验证；不将回放当作原生端到端通过证据。

首次默认并发 Rust 全量测试出现 3 项既有时序测试失败（下载取消、文件代理提交取消及超时 worker 计数）。完整串行复跑通过，最终提交前再次使用 `--test-threads=1` 验证。没有修改这些测试或跳过失败项。

## 插件边界正式审查

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
