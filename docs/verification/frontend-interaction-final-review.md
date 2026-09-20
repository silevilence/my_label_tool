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

本节保留首次修复的历史结论；二审发现 Q1 的模式守卫与 Q27 的卡片位置引入回归，以下「二审反馈修复」替代这两项的最终实现与验收结论。

| 编号 | 等级 | 决策 | 核实、改动与验证依据 |
|---|---|---|---|
| Q1 | 🟠 Important | 完全采纳 | Stage 将 Transformer anchor 当作形状命中，确实会重新拾取邻近点。[useCanvasInteractions](../../src/hooks/useCanvasInteractions.ts#L308) 恢复非标注模式的背景拾取边界；真实 hook 回归验证 anchor 不选点、Shift+背景仍选点。 |
| Q2 | 🟠 Important | 完全采纳 | 候选 effect 与行点击写入编辑选择。[ImageSearchDialog](../../src/components/sidebar/ImageSearchDialog.tsx#L40) 改为仅持有面板候选序号，确认后才提交 search scope/选择；测试验证查询、Esc 保持原视频作用域，Enter 才切图。未恢复第二个编辑路径游标。 |
| Q3 | 🟠 Important | 完全采纳 | 后端以拒绝 Promise 表示抽帧中断，旧 catch 先 fail。[useVideoImport](../../src/hooks/useVideoImport.ts#L124) 对已请求取消的拒绝记 warning；取消接口失败恢复标志供重试。新增拒绝型 fixture，验证无红色错误、资源在抽帧终态后释放。 |
| Q4 | 🟠 Important | 完全采纳 | Overlay 捕获 Esc 早于录制器。[ShortcutSettings](../../src/components/settings/ShortcutSettings.tsx#L89) 在 canDismiss 中先取消录制并阻止关闭；嵌套遮罩测试及浏览器两次 Esc 实测通过。 |
| Q5 | 🟠 Important | 完全采纳 | 错误关闭与更新面板位于禁用容器内。[AppLayout](../../src/components/AppLayout.tsx#L635) 将反馈/更新面板移到工作区禁用容器之外；App 集成测试在资源占用时点击两类关闭入口。 |
| Q6 | 🟠 Important | 完全采纳 | 分段 i/N 与播放头 i/(N-1) 不一致。[VideoTimeline](../../src/components/video/VideoTimeline.tsx#L47) 使用每段中心 (i+0.5)/N；300 帧测试验证首帧、第二帧、中间与末帧中心落在对应段内。 |
| Q7 | 🟠 Important | 完全采纳 | 保存完成恒 false，最短显示与自动收起缺失。[useSaveFeedback](../../src/hooks/useSaveFeedback.ts#L10) 由注册表时间戳派生 500ms 最短显示与 2200ms 成功提示；不延长资源占用。[OperationStatus](../../src/components/operations/OperationStatus.tsx#L11) 完成卡片 5 秒收起，错误保留，运行优先且结果按新到旧排列；假时钟验证。 |
| Q8 | 🟡 Minor | 完全采纳 | pointerOnly 拦截修饰键 keyup。[Overlay](../../src/components/overlay/Overlay.tsx) 允许修饰键释放传递，其他键盘激活仍阻止；事件测试通过。 |
| Q9 | 🟡 Minor | 部分采纳 | 无草稿也消费撤点键成立；[App](../../src/App.tsx) 仅 polygon 草稿注册撤点动作。标签编辑与插件路径仅接受单个 a-z/0-9；工程配置导入目前只校验 shortcut 为字符串，因此不能将该限制泛化为全部入口。 |
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

## 二审反馈修复（基于 5646a32）

将二审的两项 Important、Minor 及测试/文档子项拆为 12 项：完全采纳 11 项，部分采纳 1 项，不采纳 0 项。两项阻塞均已修复，无待用户决策项。ROADMAP 完成状态保持不变。

| 编号 | 等级 | 决策 | 核实、改动与验证依据 |
|---|---|---|---|
| R1 | 🟠 Important | 完全采纳 | 非背景守卫同时拦截 Shift 选择模式。[useCanvasInteractions](../../src/hooks/useCanvasInteractions.ts) 将守卫限定为 default；真实 hook 覆盖命中图形、背景拾取与空白清选，浏览器确认 Shift 选中关键点、矩形控点拖动不抢选重叠点。 |
| R2 | 🟠 Important | 完全采纳 | 固定在右上方的更新面板与操作卡片确实重叠。[AppLayout](../../src/components/AppLayout.tsx) 和 [OperationStatus](../../src/components/operations/OperationStatus.tsx) 改为画布外的共用正常布局状态区，限制高度并允许滚动；更新提示与卡片不叠放，也不覆盖画布帮助，不提高模态之上的层级。组件验证取消回调，浏览器验证真实更新 UI 的取消入口可点击。 |
| R3 | 🟡 Minor | 完全采纳 | 2px 播放头在密集首末帧会越界。[VideoTimeline](../../src/components/video/VideoTimeline.tsx) 在分段中心基础上夹取至条内，垂直高度与条一致；300 帧窄条首末位置经真实浏览器测量均完整可见。 |
| R4 | 🟡 Minor | 完全采纳 | annotated/keyframe 同源 fixture 无法发现错误绑定。[VideoTimeline.test](../../src/components/video/VideoTimeline.test.tsx) 加入已标注但非关键帧，独立断言密度颜色、两个数据标志及无关键帧子标记。 |
| R5 | 🟡 Minor | 完全采纳 | 录制器 Escape 分支已被 Overlay 捕获阻断。[ShortcutSettings](../../src/components/settings/ShortcutSettings.tsx) 删除死分支，保留 canDismiss 先取消录制、再次 Esc 关闭的唯一路径；既有嵌套遮罩回归通过。 |
| R6 | 🟡 Minor | 完全采纳 | 重抽帧中断仍走 fail。[useProjectVideoActions](../../src/hooks/useProjectVideoActions.ts) 对已请求取消的拒绝记 completed/warning 并关闭确认框；新增拒绝型异步回归，验证保留原图片/标注、终态前锁仍占用、终态后释放且无红色错误。 |
| R7 | 🟡 Minor | 完全采纳 | anchored 面板 resize 只更新高度。[Overlay](../../src/components/overlay/Overlay.tsx) 每次定位先同步 maxWidth/maxHeight，再测量和夹取；测试缩小到 180px 后 maxWidth 为 164px。 |
| R8 | 🟡 Minor | 完全采纳 | pointerOnly 缺普通键负向断言。[Overlay.test](../../src/components/overlay/Overlay.test.tsx) 同时验证 Enter keydown/keyup 被阻止且未冒泡，Control keyup 仍放行。 |
| R9 | 🟡 测试项 | 完全采纳 | Backspace 条件注册缺回归。[image-deletion.entries.test](../../src/components/image-deletion.entries.test.tsx) 在真实 App 与真实草稿 hook 上验证无草稿不消费、多边形草稿撤点、撤空后再次按键不消费；未复制条件注册逻辑到测试替身。 |
| R10 | 🟡 测试项 | 完全采纳 | 搜索行点击路径缺回归。[ImageSearchDialog.test](../../src/components/sidebar/ImageSearchDialog.test.tsx) 验证首次点击仅预览且保持原选择/视频作用域，再次点击才确认并进入搜索作用域。 |
| R11 | 🟡 文档项 | 完全采纳 | [设计说明](../frontend-interaction.md) 的旧行为描述与实现不符，已移除 notifyConfigConflict 和相关“今天”描述，同步状态区、快捷键门禁、原子删除及行滚动职责；本报告 Q3 引用改为 useVideoImport.ts:124。 |
| R12 | 🟡 文档项 | 部分采纳 | 采纳缩小 Q9 表述与评估导入路径：[importers.ts:476](../../src/lib/importers.ts#L476) 的确仅检查字符串，而编辑与插件路径校验单个 a-z/0-9。保留当前导入兼容行为，不在本轮追加硬性拒绝或静默丢弃：这会改变既有 ProjectConfig 接受范围，与 AGENTS §5/§10 的兼容要求冲突。Backspace 问题已由动作可用性修复并有 R9 回归；这不表示全部导入快捷键已符合编辑校验。若以后收紧导入，应明确旧配置迁移规则并同步契约测试。 |

### 二审修复验证

- `npm run typecheck`、`npm run lint`、`cargo clippy --manifest-path src-tauri/Cargo.toml`、`npm run build` 全部通过。
- `npm run test:coverage -- --maxWorkers=4`：66 文件 / 381 测试全通过（较上轮新增 4 个测试，另增强既有断言）；行覆盖率 95.42% → 95.42%，语句 95.32%、分支 90.72%、函数 99%，未改变统计排除规则。
- 初次全量验证发现 jsdom 丢弃嵌套 clamp 的 style.left，已将分段中心存为 CSS 自定义属性并让逻辑断言读取它；真实 CSS 夹取另由浏览器测量确认。修正后已重跑全量并通过。
- 浏览器真实 App/React/Konva、临时宿主 I/O：Shift 点击命中关键点；在与关键点重叠的矩形左上控点拖动后，仍选中 rectangle，矩形由 `[100,100,200,100]` 变为约 `[116.28,113.48,183.83,86.70]`。
- 1000×320 下载态：状态区 top=192、bottom=320；取消按钮 top=218、bottom=238，中心点命中“取消”；右上帮助 bottom=110，与状态区无交集。点击取消后显示取消安装，模拟下载传输结束后正常释放，未执行安装/重启。
- 300 帧窄时间轴：首帧条边界 x=16..81.40625、播放头 x=16..18；末帧条边界 x=16..144、播放头 x=142..144；两次播放头与条均 y=61..69，首末均未裁切。布局随时间标签宽度略有变化，两种宽度均已验证。
- 浏览器临时视口已恢复，测试页面已关闭，临时 fixture 已删除。没有运行 Windows 打包应用、真实网络更新/视频抽帧取消；这类原生端到端行为不冒充浏览器验证结果。
- 构建主 JS chunk 640.09 kB，保留既有 >500 kB 非阻塞提示。无 Rust 逻辑或依赖改动，未重跑 Rust 全量测试。
- 此轮变更仅涉及宿主 UI、内部控制流、测试与记录；未改 ProjectConfig/核心数据结构、插件 Schema、Tauri API、Rust、插件 ID 或各层版本号，不引入对外契约变化。

最终复核：两项 Important 已闭环，其余反馈按上述决策处理；无已知遗留阻塞项。
