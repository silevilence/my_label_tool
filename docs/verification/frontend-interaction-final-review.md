# 前端交互①—⑥完整审核与修复报告

日期：2026-09-20。基线：`d3e062a5499d70ecb727b35a5212ff930afc6f39`。范围：六项实现提交及本次审核修复。依据：ROADMAP 原条目、docs/frontend-interaction.md、ADR 0008—0010、AGENTS.md；插件部分按 plugin-review 七维复核。

## 总览

| 任务 | 需求满足 | 验证 | 结论 |
|---|---|---|---|
| ① 遮罩 | 自注册、分层、焦点、Esc、短视口；主菜单补入轻量栈 | 嵌套/StrictMode/隐藏焦点/菜单集成与浏览器 | 可标记完成 |
| ② 快捷键 | 元数据、统一解析/冲突、固定键、注册生命周期 | 解析矩阵、重绑、注册和门禁 | 可标记完成 |
| ③ 操作 | 资源互斥、归属消息、进度、取消与更新器入口 | 注册表、异步预打标取消、模型取消失败重试 | 可标记完成 |
| ④ 选择 | store 切片、原子删除、scope 栈、范围条、行滚动 | 失效路径/首尾删除、scope 导航、行组件 | 可标记完成 |
| ⑤ 手势 | 统一解析、草稿提交取消、坐标适配 | 分类矩阵、草稿、Esc、锚点与真实 Konva 页面 | 可标记完成 |
| ⑥ 视频 | 同一摘要/映射/关键帧语义，统一导航 | 空/单帧/稀疏/缺失路径、跨视图分布与资源锁 | 可标记完成 |

原条目均已原地勾选，未移动到别的分区。①至⑥分别提交：425f5e8、5a56870、36e7289、8bc2b7c、6ef4372、faa1b3e。

## 审核发现与逐条处理

| 编号 | 发现时等级 | 判断 | 修复与复验 |
|---|---|---|---|
| F1 | 🔴 Critical | 完全采纳 | 登记预打标取消回调时捕获启动前的 isRunning，导致取消不生效。改读运行 ref 并 await 后端；失败传播回注册表允许重试。见 [usePrelabelExecution.ts](../../src/hooks/usePrelabelExecution.ts#L518)，新增真实 hook 的延迟 Promise 回归测试。 |
| F2 | 🟠 Important | 完全采纳 | Runtime/模型取消异常被吞掉，注册表永久停在 cancelling。现传播异常、恢复重试；Runtime 仅以后端终态判定是否取消。见 [PrelabelSettings.ts](../../src/components/settings/PrelabelSettings.tsx#L291)，模型取消失败重试测试通过。 |
| F3 | 🟠 Important | 完全采纳 | 隐藏按钮与折叠 details 内控件会进入 Tab 循环。过滤隐藏/inert/折叠控件，补充 summary 与空面板处理。见 [Overlay.tsx](../../src/components/overlay/Overlay.tsx#L16)，组件测试通过。 |
| F4 | 🟠 Important | 完全采纳 | 侧栏原生 details 主菜单没有登记，打开时仍能触发画布快捷键。迁移至 light Overlay；支持 Esc、焦点归还和点击外部关闭。见 [AppSidebar.tsx](../../src/components/sidebar/AppSidebar.tsx#L195)，浏览器与集成测试通过。 |
| F5 | 🟠 Important | 完全采纳 | ONNX 检查失败只显示错误，操作却被标为成功；PT 取消不在注册表内且被标为失败。检查失败明确 fail，PT 登记取消句柄，取消终态用 warning。见 [PrelabelSettings.tsx](../../src/components/settings/PrelabelSettings.tsx#L154)。 |
| F6 | 🟡 Minor | 完全采纳 | 快捷键冲突只报碰撞，未解释赢家；标签键大小写匹配不一致。统一正规化并显示本次执行动作，无图片时取消注册缩放动作。见 [useKeyboardShortcuts.ts](../../src/hooks/useKeyboardShortcuts.ts#L102)。 |
| F7 | 🟠 Important | 完全采纳 | Konva 可在中键按住后准备拖动，与中键取消冲突。拖动开始也经统一解析器检查 buttons，拒绝非左键拖动。见 [CanvasChrome.tsx](../../src/components/canvas/CanvasChrome.tsx#L600)，矩阵补测。 |
| F8 | 🟡 Minor | 完全采纳 | 忙碌时导航虽然不修改图片，却返回成功/可步进。返回真实布尔结果并让 canStep 读资源锁。见 [useVideoFrameNavigation.ts](../../src/hooks/useVideoFrameNavigation.ts#L14)，跨视图测试补测。 |
| F9 | 🟡 Minor | 完全采纳 | 终态晚到的取消句柄可能残留；取消文件选择被记为成功；末帧播放头被边缘裁切。增加终态保护，选择取消记 warning，并向内夹取播放头。注册表和全套回归通过。 |

同时修正遮罩打开期间松开修饰键后模式可能残留的问题；运行中的操作排在状态列表前面，避免取消入口被旧结果淹没。

复核后：未解决 Critical/Important 为 0，无交付阻塞项。没有不采纳或部分采纳条目。

## 代码规范与插件正式审查

| 插件维度 | 结论 | 证据与依据 |
|---|---|---|
| 契约与 Schema | 通过 | 与基线比较，annotation/export/prelabel/plugin 类型、ProjectConfig、tauri-api、Rust 均无差异；只重构宿主前端编排。AGENTS §10 契约先行/边界影响评估。 |
| ID 与版本分层 | 通过 | 未改插件 ID、manifest 或 API/协议/能力版本，也未联动 bump 主程序版本。AGENTS §10 版本分层；ADR 0007。 |
| 能力声明 | 通过 | 取消/进度仍遵守原有 supportsCancel/supportsProgress，未按版本推导能力。useProjectActions/usePrelabelExecution；ADR 0003、0004。 |
| 向后兼容 | 通过 | 没有修改对外字段语义或结构；关键帧仍使用既有 attributes，坐标仍为原图像素。AGENTS §5/§10。 |
| 权限与隔离 | 通过 | 所有宿主调用沿用 tauri-api；未修改进程/权限/网络/AppContainer、超时、安全模式和故障策略。ADR 0003、0005。 |
| 目录与工程 | 通过 | store/纯模型/hooks/UI 按层组织；新增文案进入 i18n；无 any/组件直接 invoke。既有超长 PrelabelSettings 保留文件头职责说明。AGENTS §4/§6。 |
| 测试 | 通过 | 插件 Schema/契约/UI 测试在全套 362 测试中通过；未新增协议行为，因此无 conformance 变更要求。ADR 0006；AGENTS §7/§10。 |

插件结论：通过（阻断 0 / 严重 0 / 一般 0 / 建议 0）。规范缺陷：无。AGENTS §6 按已接受的 ADR 0009 修订；插件技能未记载被调整的选择状态细节，无需改动其约束。

## 测试与覆盖率

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run test:coverage -- --maxWorkers=4`：61 个文件，362 项测试全部通过。
- 总体覆盖率：语句 95.26%，分支 90.69%，函数 99%，行 95.35%。
- 新纯模块 transform/draft-gesture/gestures/shortcuts/video-frames/video-keyframes、operations/shortcut store：语句与函数均 100%。
- `npm run build`：通过；主 JS chunk 637.54 kB，Vite 给出超过 500 kB 的非阻塞体积提示。本次未扩展为打包拆分任务。
- `cargo clippy --manifest-path src-tauri/Cargo.toml`：通过。无 Rust 源码或依赖变更，本轮未重跑 Rust 全量测试或真实模型推理。

覆盖率中尚未命中的 5 个函数均为已有分支内匿名回调：label-template-sync.ts:110、117；plugin-label-presets.ts:37；exporters/custom.ts:5；useAnnotationStore.ts:281。它们各为 0 次命中；本次新纯模型无未覆盖函数。总体达到仓库阈值，未为提高数字改动覆盖率排除规则（仅新增 transform.ts 的统计）。

## 浏览器与手动验证边界

- 真实 App/React/Konva，临时测试宿主 I/O：矩形拖绘、缩放对齐、切图恢复、多边形 Esc 已实测。fixture 已删除。
- 320px 高视口：标签弹窗可滚动，关闭可达；主菜单 top=58、height=246、bottom=304，scrollHeight=535，Esc 后焦点回到“打开菜单”。
- 设置里的固定快捷键禁用行可见；菜单转设置后 Esc 正确归还焦点。
- 矩形保持鼠标按下时 Esc 由真实键盘 hook 组件回归覆盖；浏览器工具不能跨调用保持鼠标按下。
- 没有声称运行 Windows 打包应用的全部手动清单。原生回收站、实际模型/网络取消、外部标准工具解析真实导出文件未做端到端验证；对应逻辑与现有导出测试通过。

结论：六项可保持完成标记，审核修复闭环已完成；以上端到端环境边界与打包体积提示不属于已发现的功能阻塞。
