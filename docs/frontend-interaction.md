# 前端交互架构：遮罩、快捷键、操作、选择、手势与帧导航

本文定稿六个前端模块的接口与接缝，供分批实现。设计语言沿用「模块 / 接口 / 实现 / 接缝 / 深 / 浅」：每个模块用一个尽量小的接口承载尽量多的行为，**这个接口同时是它的测试面**——调用方与测试跨过同一道接缝。

相关决策记录：ADR 0008（遮罩分层与输入门禁单一裁决）、ADR 0009（选择与作用域归属）、ADR 0010（操作注册表与资源互斥）。实现顺序与 ROADMAP「前端交互架构」条目一致。

---

## 1. 遮罩模块（Overlay）

**接口**

```tsx
<Overlay
  open
  onClose
  kind="blocking" | "light"
  canDismiss={boolean | (() => boolean)}   // 例：删除中禁止 Esc
  labelledBy
  size="sm" | "md" | "lg" | "xl" | "wide"
/>
```

```ts
useOverlayStore → { hasBlocking(): boolean; hasLight(): boolean; depth(): number }
```

**实现**

- 组件在挂载时把自身注册进栈、卸载时出栈——**调用方无从遗忘登记**，这是本模块存在的首要理由。
- 模块负责：背板、按栈深度推导的 `z-index`、仅栈顶响应 `Esc`、打开时把焦点移入并在关闭时归还到打开前的元素、视口高度上限（`max-h` 百分比 + 内部滚动槽）、`role=dialog` / `aria-modal` / `aria-labelledby`。
- 面板内容与视觉留在各遮罩自身；本模块不做标题栏与按钮排布的统一（见「非目标」）。
- 非模态菜单与浮层用 `kind="light"`：它们同样进栈（从而获得 Esc 归属与 z-index），但只吞掉画布写操作类快捷键。

**迁移清单**（17 个遮罩）

- 已具备完整行为、作为行为样板：`DeleteImageDialog.tsx`（捕获阶段按键封锁、焦点陷阱与归还、`role=alertdialog`、高度上限）；其适配器 `VideoReextractDialog.tsx` 保留。
- 转为 `blocking`：`ProjectSettingsDialog`、`VideoImportDialog`、`VideoBatchDialog`、`PtConversionDialog`（嵌套在 `PrelabelSettings` 之上）、`PrelabelExecutionDialog`、`PluginSettings` 与其 `PermissionDialog`、`LabelSettings` 的管理弹窗、`ShortcutSettings`、`PrelabelSettings`、`DeleteAnnotationDialog`。
- 转为 `light`：`CanvasContextMenu`、`ImageListContextMenu`、侧栏主菜单、`ImageSearchDialog`（打开时统一阻断 canvas 类快捷键）。
- 删除各文件内的 `fixed inset-0` 背板与散落的 `z-*`（迁移前分散为 50/60/65/85/90/95/100 七个值）。

**测试面**：渲染 → `Esc` 只在栈顶生效且 `canDismiss=false` 时不生效；`Tab` 不出面板、关闭后焦点回到触发元素；矮视口下（如 320px 高）面板不超过视口且关闭控件可达；打开 blocking 遮罩时全局快捷键不触发画布改动。

---

## 2. 快捷键动作表（Shortcut Table）

**接口**

```ts
// 静态元数据：设置界面、迁移、提示浮层读它
type ShortcutActionMeta = {
  id: string;
  label: string;
  defaultKey: string;
  scope: "canvas" | "global";   // light 遮罩只吞 canvas 类
  rebindable: boolean;          // Ctrl+Z/Y/S、Delete（删除标注框）为 false，设置面板固定行展示
  priority?: number;            // 同层内的显式次序，缺省按 id 稳定排序
};
```

```ts
useShortcut(id, handler)                       // 功能模块挂载时注册行为；未注册 = 该动作「不可用」
resolveShortcut(event, ctx) → actionId | null  // 纯函数：匹配 · 优先级 · 门禁 · 冲突
```

`ctx` 至少包含：`hasBlockingOverlay` / `hasLightOverlay`（来自 §1）、`isEditableTarget`、`busy`（来自 §3）、用户键位表与标签键位表。修饰键由键盘事件解析；多边形撤点通过草稿状态决定是否注册，避免保留未参与裁决的 mode 字段。

**实现**

- 优先级由 `scope` 推导：`blocking > light > canvas > global`，同层再比 `priority`；标签快捷键永远最低。
- 一次按键至多命中一个动作，命中即 `preventDefault`；标签键与固定动作或可改绑动作冲突时，冲突必须被**报告**而不是按书写顺序静默取胜，由统一冲突判定给出实际执行动作。
- 冲突判定只有一份 `detectConflicts(shortcuts, labelShortcuts)`，设置面板、标签编辑器与运行时都消费它；重绑时阻止、运行时给解释。
- 新增动作 = 表里加一项 + 拥有该行为的模块调 `useShortcut`，不再需要修改 `App.tsx` 的交换机与 `AppLayout` 的属性表。
- 迁移名单（`mergeShortcuts`）改由表推导，新增默认键不再需要手写「别抢已有用户键」的例外。

**测试面**：纯函数覆盖优先级（blocking/light/canvas/global 四层）、门禁（可编辑焦点、遮罩、忙碌）、冲突裁决与解释文案；组件级用现有 `react-dom/client + act` 直接派发 `keydown`（无需新增依赖）。

---

## 3. 操作注册表（Operation Registry）

**接口**

```ts
useOperations() → {
  begin(op: { label: string; resource: OperationResource; cancel?: () => void }): OperationHandle;
  canStart(resource: OperationResource, intent?: "operation" | "annotation-edit"): boolean; // 唯一裁决处
  canEditAnnotations(): boolean;                    // 委托 canStart(project-annotations, annotation-edit)
  operations: OperationView[];                      // { id, label, kind, message, percent, canCancel, status }
}
// OperationHandle: { id, progress(percent, message?), complete(message?), fail(error), cancelRequested }
```

`OperationResource` 取值（首批）：`project-annotations`、`export-dir`、`video-frames`、`model-download`、`onnx-runtime`、`app-update`。操作可同时占用多项资源；图片删除和视频重抽帧同时占用项目标注、导出目录与视频帧，插件导出仅占用导出目录。

更新器取消受当前 Tauri updater API 限制：取消请求阻止安装与重启，当前下载传输结束后才释放资源；界面明确展示此语义，不承诺立即停止网络传输。

**实现**

- 允许并发；占用同一资源的操作互斥，裁决只在 `canStart` 一处。工作区禁用、键盘门禁、图片删除与视频导入入口统一读取注册表资源占用。
- `canStart` 默认按长操作裁决，不能用手工编辑意图启动操作；`begin` 始终使用默认意图。快照型脚本可声明 `allowAnnotationEditing`，仅放行 `project-annotations` 的手工编辑；保存、导出、预打标及其他资源仍互斥。手工输入门禁 `canEditAnnotations` 仅委托同一裁决，不自行扫描注册表。脚本应用前严格检查作用域、标签及标注快照，变化时整轮拒绝覆盖。
- 消息按操作归属并带 `kind`（`success | warning | error`）：成功不再穿错误配色，两条提示通道（5 秒红框 / 2.2 秒琥珀条）按 kind 分流，不再是「后写覆盖前写」。
- 同名操作的完成卡片仅保留最近完成的一次；正在执行的操作与失败卡片不参与完成去重，失败继续聚合计数。完成卡片五秒后自动收起。
- 模型库的选择、配置和映射保存属于本地设置，不登记模型下载资源或完成卡片；失败归属「预打标模型设置」，面板提供就地重试。下载、转换与校验沿用操作注册表。
- 模型表单保存失败后，重试读取最新表单和保存回调，并复用表单校验；已关闭或切换的待保存模型不能被旧重试恢复。
- 设置重试仅绑定产生它的具体失败记录；该记录被清除、关闭或替换后，旧动作立即失效。独立模型下载期间保留原设置失败与重试，执行中禁用重试，下载结束后恢复。
- 其他操作占用模型下载资源时，设置重试置灰并保留原失败原因与计数，资源释放后恢复；模型编辑上下文已关闭或切换的错误仅提示重新选择，不再次登记重试。
- 资源被占用时，设置入口的忙提示独立展示，不改写已有失败卡片、失败计数或重试绑定；资源释放后忙提示消失。
- 预打标执行来源初始跟随模型库当前模型；用户显式选择后，在当前应用会话内保留选择（关闭再打开执行窗口亦保留），不回写模型库当前模型。所选来源从列表消失时，回退到当前模型或列表首项（可能为被禁用的插件来源）；来源仍存在但被禁用时不自动切换。
- 取消是操作的属性：界面上「哪里能取消」不再由各组件自行判断（更新下载通过操作卡片取消安装）。
- 更新提示与操作卡片位于同一个正常布局状态区，按内容滚动；状态区在画布区域外占据空间，不覆盖画布角落帮助或彼此的取消入口。
- 状态区增减和窗口尺寸变化保留当前缩放/平移；仅新图片首次取得可用画布尺寸或用户手动重置时重新适配。
- 各界面（`ExportPanel`、`PrelabelExecutionDialog`、`VideoBatchDialog`、`DeleteImageDialog`、`AppLayout` 的保存遮罩与更新面板）退化为薄适配器。

**测试面**：注册表的归约（并发登记、资源互斥、终态与消息归属、取消传播）可纯函数化测试；界面只断言「读同一份状态」。

---

## 4. 选择与作用域（Selection & Scope）

**接口**（`useAnnotationStore` 新增切片）

```ts
selectedPath: string
scopeStack: Scope[]              // 栈底恒为 { kind: "project" }
select(path: string): void
pushScope(scope: { kind: "search" | "video"; ids: string[]; label: string }): void
popScope(): void
selectAdjacent(delta: 1 | -1): void        // 在栈顶作用域内移动
selectUnannotated(delta: 1 | -1): void
removeImages(paths: string[]): void        // 删除 + 接续 + 标注清理 + 历史裁剪，一次原子更新
```

**实现**

- 删除与接续由 store 原子完成：一起更新图片、标注、历史与作用域；失效选择回退到有效邻项，避免画布误清空。
- 作用域栈顶决定「上一张 / 下一张 / 下一个未标注」：项目序（图片与视频帧按项目序合并）→ 搜索结果 → 单个视频的帧序。`←/→`（全项目序）、`PageUp/PageDown`（当前视频帧序）与确认后的搜索结果使用同一模型。搜索面板仅保存临时候选序号，确认前不修改编辑对象或作用域。
- 作用域必须**常驻可见、可退出**（侧栏作用域条，如「搜索结果：含 person 的 37 张 ✕」）；`ProjectMediaList` 的 `remembered` 影子游标与 `ImageSearchDialog` 的 `candidatePath` 随之删除。
- 列表行模块自己持有 ref 并在选中时滚入视口，App 不再向多个渲染器传递共享 selectedImageButtonRef。

**测试面**：索引数学与夹取（越界、首尾、删除末张、删除当前张）、作用域 push/pop 后「下一张」的落点、搜索结果集内相邻、视频帧序内相邻。

---

## 5. 画布手势（Gesture）

**接口**

```ts
resolveGesture(event, { mode, shapeType, hit, spacePan? }) →
  "draw-rect" | "draw-polygon" | "draw-point" | "select" | "pan" | "context" | null
```

```ts
useDraftGesture() → { state: "idle" | "rect" | "polygon" | "point" | "pan",
                      start(intent, point), update(point), commit(), cancel() }
```

**实现**

- Stage 用 `resolveGesture` 统一分类；Konva 保留拖拽与 `Transformer` 变换（不自实现），三个图形渲染器只向同一解析器询问「当前模式下我能否被拖动 / 被选中」，删除各自的按钮与模式守卫。
- 解析器把中键归为 pan（拖拽平移；无位移的单击经 pan 开始/结束路径等效取消草稿），按住空格时左键/中键同样归为 pan。空格门禁（`shouldPanWithSpace`）检查四项：遮罩栈深度、可编辑焦点、操作互斥，以及需用空格激活的交互控件焦点；前三项与草稿键盘/快捷键共用，第四项保留按钮等控件的默认键盘行为。未支持的按钮归为 null；拖拽阶段仅允许默认模式左键命中图形。滚轮缩放不再要求指针位于图片矩形内，锚点夹取到图片范围。
- 草稿状态机统一开始 / 更新 / 提交 / 取消：`Esc` 处处可用（矩形和多边形均支持），取消语义与中键一致。
- 屏幕 ↔ 原图坐标转换收成一个 adapter（`createTransform(layout)`），供画布交互、缩放、多边形草稿与插值预览共用（替代原先 5 处重复变换）。
- 交互状态仍留在组件本地（见 ADR 0009 对 `AGENTS.md §6` 的修订范围）。

**测试面**：`resolveGesture` 的分类矩阵（按钮 × 模式 × 命中/背景）、草稿状态机的转移与取消、坐标往返一致性与缩放锚点不变量。

---

## 6. 视频帧模型（Video Frames）

**接口**

```ts
// 纯模型（lib/video-frames.ts）
frameSummaries(video, annotations, framePaths) → Array<{ index, frameIndex, timestampSeconds, name, path, annotated: boolean, keyframe: boolean }>
```

```ts
useVideoFrameNavigation(video, images, selectedPath) → { frames, currentIndex, select, step(delta), canStep(delta) }
```

**实现**

- index 是可用抽取帧序号，frameIndex 是源视频解码帧号；缺失路径不进入导航，插值仍拒绝不完整序列。不可变输入快照通过弱引用缓存让各视图共享摘要。
- 帧 ↔ 路径映射、每帧是否已标注、关键帧集合只算一次，供时间轴、侧栏帧列表、键盘步进与插值浮窗共用；删除以字符串名字互相翻译的两个索引空间（`video.frames.findIndex` 与 `selectedVideo.images.findIndex`）。
- `VideoTimeline` 保持薄：渲染刻度、标注密度、关键帧标记与播放头，回调只有 `onSelectFrame`。
- 关键帧语义沿用 `lib/video-interpolation.ts` 的纯函数，不新增第二套判定。
- 播放（时间轴拖动播放）不在本次范围，但当前帧的归属从此有唯一落点。

**测试面**：纯模型的摘要计算（空视频、单帧、无标注、部分标注、关键帧稀疏）+ 接缝的边界行为（首尾步进、跳转到不存在的路径）。

---

## 批次与验收

| 批次 | 模块 | 独立验收 |
|---|---|---|
| ① | 遮罩模块 | 17 个遮罩迁移完成；矮视口与 Esc / 焦点契约测试通过；`App.tsx` 的 9 项门禁与运算删除 |
| ② | 快捷键动作表 | 纯函数覆盖四层优先级与冲突；固定键以不可改绑行出现在设置面板；新增动作不再改动 `App.tsx` / `AppLayout.tsx` |
| ③ | 操作注册表 | 并发登记与资源互斥测试；消息按操作归属；`workspaceDisabled` 与三处重复锁表达式删除 |
| ④ | 选择与作用域 | 删除接续、作用域栈、滚入视口测试；`AGENTS.md §6` 措辞随之修订 |
| ⑤ | 画布手势 | 分类矩阵与草稿状态机测试；矩形绘制中 `Esc` 可用；逆变换 adapter 落地 |
| ⑥ | 视频帧模型 | 纯模型与边界测试；时间轴显示标注密度与关键帧；侧栏与键盘读同一份 |

每批独立可交付，独立通过 `npm run typecheck`、`npm run lint`、`npm run test:coverage`；触及 Rust 时加 `cargo clippy --manifest-path src-tauri/Cargo.toml`。

## 非目标

- 不统一遮罩的标题栏、关闭按钮与按钮排布（视觉一致性不是本轮的接缝问题）。
- 不做按键级输入所有权（每个动作声明可用遮罩层）；`blocking` / `light` 两类已覆盖现有全部场景。
- 不实现视频播放，不引入 `@testing-library/react`（现有 `react-dom/client` + `act` 足够）。
- 不引入新的状态管理库；新增状态按 `AGENTS.md §6` 修订后的分层归属。
