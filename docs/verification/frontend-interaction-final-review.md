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

本轮开始前用户已将原条目从计划中移入开发中；实现时在开发中原地勾选，未再移动分区。①至⑥分别提交：425f5e8、5a56870、36e7289、8bc2b7c、6ef4372、faa1b3e。

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

当轮自审结论为无遗留阻塞项；后续外部审核发现 7 项 Important 回归，本报告不替代后续审核与修复结果。没有不采纳或部分采纳条目。

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

当轮结论：六项保持完成标记；后续审核另有回归修复，不能据此视为所有行为均已覆盖；以上端到端环境边界与打包体积提示不属于已发现的功能阻塞。


## 外部审核反馈修复（基于 8013a13）

本节处理用户提供的 `remotes/origin/master → master` 审核报告。重复意见合并后共 35 项：完全采纳 31 项，部分采纳 4 项，不采纳 0 项。7 项 Important 均已修复。没有新建平行审核文档，也未修改 ROADMAP 的完成状态。

| 编号 | 等级 | 决策 | 核实、改动与验证依据 |
|---|---|---|---|
| Q1 | 🟠 Important | 完全采纳 | Stage 将 Transformer anchor 当作形状命中，确实会重新拾取邻近点。[useCanvasInteractions](../../src/hooks/useCanvasInteractions.ts#L308) 恢复非标注模式的背景拾取边界；真实 hook 回归验证 anchor 不选点、Shift+背景仍选点。 |
| Q2 | 🟠 Important | 完全采纳 | 候选 effect 与行点击写入编辑选择。[ImageSearchDialog](../../src/components/sidebar/ImageSearchDialog.tsx#L40) 改为仅持有面板候选序号，确认后才提交 search scope/选择；测试验证查询、Esc 保持原视频作用域，Enter 才切图。未恢复第二个编辑路径游标。 |
| Q3 | 🟠 Important | 完全采纳 | 后端以拒绝 Promise 表示抽帧中断，旧 catch 先 fail。[useVideoImport](../../src/hooks/useVideoImport.ts#L122) 对已请求取消的拒绝记 warning；取消接口失败恢复标志供重试。新增拒绝型 fixture，验证无红色错误、资源在抽帧终态后释放。 |
| Q4 | 🟠 Important | 完全采纳 | Overlay 捕获 Esc 早于录制器。[ShortcutSettings](../../src/components/settings/ShortcutSettings.tsx#L89) 在 canDismiss 中先取消录制并阻止关闭；嵌套遮罩测试及浏览器两次 Esc 实测通过。 |
| Q5 | 🟠 Important | 完全采纳 | 错误关闭与更新面板位于禁用容器内。[AppLayout](../../src/components/AppLayout.tsx#L635) 将反馈/更新面板移到工作区禁用容器之外；App 集成测试在资源占用时点击两类关闭入口。 |
| Q6 | 🟠 Important | 完全采纳 | 分段 i/N 与播放头 i/(N-1) 不一致。[VideoTimeline](../../src/components/video/VideoTimeline.tsx#L47) 使用每段中心 (i+0.5)/N；300 帧测试验证首帧、第二帧、中间与末帧中心落在对应段内。 |
| Q7 | 🟠 Important | 完全采纳 | 保存完成恒 false，最短显示与自动收起缺失。[useSaveFeedback](../../src/hooks/useSaveFeedback.ts#L10) 由注册表时间戳派生 500ms 最短显示与 2200ms 成功提示；不延长资源占用。[OperationStatus](../../src/components/operations/OperationStatus.tsx#L11) 完成卡片 5 秒收起，错误保留，运行优先且结果按新到旧排列；假时钟验证。 |
| Q8 | 🟡 Minor | 完全采纳 | pointerOnly 拦截修饰键 keyup。[Overlay](../../src/components/overlay/Overlay.tsx) 允许修饰键释放传递，其他键盘激活仍阻止；事件测试通过。 |
| Q9 | 🟡 Minor | 部分采纳 | 无草稿也消费撤点键成立；[App](../../src/App.tsx) 仅 polygon 草稿注册撤点动作。不采纳“标签绑定 Backspace”的正常路径推断：AGENTS §5 及标签校验仅接受单个 a-z/0-9。 |
| Q10 | 🟡 Minor | 完全采纳 | [ShortcutContext](../../src/lib/shortcuts.ts) 的 mode 未参与裁决，删除并同步设计文档；修饰键由事件解析，草稿相关动作以注册可用性表达。 |
| Q11 | 🟡 Minor | 完全采纳 | [selectAdjacent](../../src/store/useAnnotationStore.ts) 失效游标一律落首项。改为向后取末项、向前取首项；补充负向边界断言。 |
| Q12 | 🟡 Minor | 完全采纳 | TouchEvent 无 button，拖动守卫确会拒绝。[CanvasChrome](../../src/components/canvas/CanvasChrome.tsx#L604) 仅对有 touches 的事件归为主指针；组件事件测试验证触摸允许、中键/修饰键拖动拒绝。 |
| Q13 | 🟡 Minor | 完全采纳 | [toCanvasRect](../../src/components/canvas/geometry.ts) 重建三次相同 transform。改为一次，坐标测试通过。 |
| Q14 | 🟡 Minor | 完全采纳 | 原时间轴 fixture 全部未标注。[VideoTimeline.test](../../src/components/video/VideoTimeline.test.tsx) 补充密度、关键帧子标记、图例与播放头验证。 |
| Q15 | 🟡 规范项 | 完全采纳 | [快捷键元数据](../../src/lib/defaults/shortcuts.ts) 剩余 8 行中文 label/description 移至 i18n；固定按钮只显示“固定”，避免重复整句说明。已有视频/删除文案继续复用各自 i18n。 |
| Q16 | 🟡 Minor | 完全采纳 | [useKeyboardShortcuts](../../src/hooks/useKeyboardShortcuts.ts) 的 enabled 无调用者传入，移除多余开关，继续使用注册表/遮罩门禁。 |
| Q17 | 🟡 Minor | 完全采纳 | [PluginExportProgressState](../../src/hooks/useProjectActions.ts) 的 exportId 无 UI 读取，删除宿主 UI 字段及测试 fixture；后端协议调用 ID 保留。 |
| Q18 | 🟡 Minor | 部分采纳 | [Overlay.test](../../src/components/overlay/Overlay.test.tsx) 类名断言确实不能证明布局，删除并改为焦点行为测试；不在 jsdom 伪造 CSS 布局证明，改用真实浏览器 320px 视口测量，另以测量桩测试菜单定位算法。 |
| Q19 | 🟡 Minor | 完全采纳 | [useOperations.test](../../src/store/useOperations.test.ts) 在 dismiss 后补查条目实际移除，另有 OperationStatus 点击关闭测试。 |
| Q20 | 🟡 Minor | 完全采纳 | [App.project-labels.test](../../src/App.project-labels.test.tsx) 拆开 error/message 输出；失败明确断言 error，且瞬时消息为空。 |
| Q21 | 🟡 Minor | 完全采纳 | [ImageListRow.test](../../src/components/sidebar/ImageListRow.test.tsx) 增加未选中行，并断言仅调用一次、调用对象为选中行。 |
| Q22 | 🟡 Minor | 完全采纳 | [selection.test](../../src/store/selection.test.ts) 补空 scope 导航后仍空、双层 scope 选择外部图片后连续弹出断言。 |
| Q23 | 🟡 文档项 | 完全采纳 | [设计说明](../frontend-interaction.md) 修正旧的“矩形不能 Esc”“更新没有取消入口”，补 frames 返回值，说明搜索候选的临时性。 |
| Q24 | 🟡 Minor | 完全采纳 | [mergeShortcuts](../../src/lib/app-utils.ts) 保存键位及默认冲突检查均使用单键规范化；新增 R/r 冲突回归，使原快捷键验证说明与实现一致。 |
| Q25 | 🟡 文档项 | 部分采纳 | 原“不移动分区”缺少比较起点，已修正文案。不采纳由开发擅自迁移的隐含归因：开始任务时用户已有计划中→开发中的未提交变更，开发只在该位置勾选，首个实现提交包含既有变更。 |
| Q26 | 🟡 Minor | 完全采纳 | [useOperations](../../src/store/useOperations.ts) 取消失败统一提取 Error.message，补无 Error: 前缀断言。 |
| Q27 | 🟡 Minor | 部分采纳 | 卡片可能遮挡右下角帮助，移到右侧上部。不将卡片抬到模态遮罩之上：ADR 0008 的阻塞输入边界与焦点约束仍须遵守；弹窗内保留自己的取消入口。 |
| Q28 | 🟡 Minor | 完全采纳 | [DeleteImageDialog](../../src/components/DeleteImageDialog.tsx) 将描述通过 Overlay describedBy 关联到实际 alertdialog；Overlay ARIA 测试通过。 |
| Q29 | 🟡 Minor | 完全采纳 | [Overlay](../../src/components/overlay/Overlay.tsx) 外层背景也 preventDefault contextmenu；事件测试覆盖。 |
| Q30 | 🟡 规范项 | 完全采纳 | [AppSidebar](../../src/components/sidebar/AppSidebar.tsx) 主菜单改用适配 Tab 按钮导航的轻量 dialog，不冒充 menu/menuitem；title 复用 i18n。 |
| Q31 | 🟡 Minor | 完全采纳 | [Overlay](../../src/components/overlay/Overlay.tsx) 删除固定半屏夹取，按面板实测尺寸限制边界并观察尺寸变化；测试验证下半屏有空间时保持指针位置，溢出时贴底。 |
| Q32 | 🟡 Minor | 完全采纳 | [ShortcutSettings](../../src/components/settings/ShortcutSettings.tsx) 标签冲突使用“标签快捷键 + 键名”，不再称为“标签管理”。 |
| Q33 | 🟡 Minor | 完全采纳 | [usePrelabelExecution](../../src/hooks/usePrelabelExecution.ts#L540) 内置/插件取消失败分别使用对应文案，新增内置 i18n。 |
| Q34 | 🟡 Minor | 完全采纳 | [updater](../../src/lib/updater.ts) 下载拒绝时关闭更新句柄，已请求取消则返回取消，否则传播真实失败；补两种拒绝路径回归。 |
| Q35 | 🟡 Minor | 完全采纳 | [useDraftKeyboard](../../src/hooks/useDraftKeyboard.ts) 通过 ref 读取最新草稿和回调，仅登记一次监听器；原键盘 hook 回归通过。 |

### 本轮验证

- `npm run typecheck`、`npm run lint`、`cargo clippy --manifest-path src-tauri/Cargo.toml`、`npm run build` 全部通过。
- `npm run test:coverage -- --maxWorkers=4`：66 文件 / 377 测试全通过；行覆盖率 95.35% → 95.42%，语句 95.32%、分支 90.72%、函数 99%。
- 构建主 JS chunk 639.75 kB，仍有既有 >500 kB 非阻塞提示，未扩展为拆包工作。
- 浏览器 1000×320 实测：主菜单 top=8、bottom=312、可视高 304、scrollHeight=535；设置 top=16、bottom=304、高 288。录制第一次 Esc 取消录制但设置保留，第二次 Esc 关闭并归还菜单按钮焦点。临时视口已恢复。
- 本轮没有运行 Windows 原生打包应用、实际回收站/模型/网络取消或外部标准导出工具；Transformer 修复以 hook 拾取回归验证，触摸拖动以组件事件回归验证，未将其表述为真实设备触摸/拖拽实测。
- `git diff --check` 通过；所有 src 的 TS/TSX 文件均不超过 1000 行。

### 插件正式复核

本轮在停止修改代码后按 plugin-review 复核，结论通过，阻断/严重/一般/建议均 0；没有约束文档缺陷或新增对外能力。

| 维度 | 结果 | 依据 |
|---|---|---|
| 契约与 Schema | 通过 | 核心 annotation/export/prelabel/plugin 类型、ProjectConfig、tauri-api 及 Rust 与修复基线无差异，UI progress 字段删除不涉及协议。AGENTS §10 契约先行。 |
| ID 与版本分层 | 通过 | 未修改 ID、manifest、API/协议/能力版本。AGENTS §10；ADR 0007。 |
| 能力声明 | 通过 | supportsCancel/supportsProgress 与原握手保持一致。ADR 0003/0004。 |
| 向后兼容 | 通过 | 只变更宿主 UI 与控制流程；对外字段和像素坐标语义不变。AGENTS §5/§10。 |
| 权限与隔离 | 通过 | 未新增系统能力或绕过 tauri-api；进程、权限、超时及自动禁用不变。ADR 0003/0005。 |
| 目录与工程 | 通过 | UI 内部类型留在原宿主 hook，新文案入 i18n，无 any/组件 invoke。AGENTS §6/§10。 |
| 测试 | 通过 | 插件契约与 UI 测试包含在 377 项全量回归；无新增协议行为，无需修改 conformance。ADR 0006；AGENTS §7/§10。 |
