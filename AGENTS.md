# AGENTS.md

本文档定义本项目（图片/视频标注工具，代号 `my_label_tool`）的技术约定与协作规范，供人类开发者与 AI 编码助手共同遵循。

---

## 1. 项目定位

一个可离线运行、Windows 下双击即用的图片/视频标注桌面工具，用于替代 Label Studio（部署重）、DarkLabel（不可扩展）、Labelme（功能过简）等现有方案。

**核心诉求（优先级从高到低）：**

1. 本地离线运行，无需网络、无需安装依赖
2. 启动快、体积小
3. 标签体系与导出格式可配置（预置常用模板，同时支持自定义）
4. 交互流畅：缩放、快速切图、快捷键均可配置
5. 图片标注先行，架构预留视频标注（逐帧 + 时间轴）扩展能力

---

## 2. 技术栈

| 层               | 技术                                                  | 说明                                                                               |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 应用框架         | **Tauri 2.x**                                         | Rust 后端 + Web 前端，产出原生级体积/启动速度的 Windows 桌面程序                   |
| 前端框架         | **React 18 + TypeScript**                             | 严禁使用纯 JS 新建文件                                                             |
| 状态管理         | **Zustand**                                           | 轻量、无 boilerplate，适合标注状态（图片列表/标注框/标签配置）管理                 |
| 画布/图形层      | **Konva.js + react-konva**                            | 处理矩形框、多边形、关键点的绘制、拖拽、变换                                       |
| 样式             | **Tailwind CSS 3.x**                                  | 禁止裸写大段自定义 CSS，优先 utility class                                         |
| 构建工具         | **Vite 7**                                            | 前端打包，开发服务器端口固定 1420                                                  |
| 后端逻辑（Rust） | **Tauri commands**                                    | 负责文件系统读写、导出格式序列化、视频抽帧（后期，通过 `ffmpeg` sidecar 或 crate） |
| 配置持久化       | 本地 JSON/TOML 文件（标签模板、快捷键配置、导出模板） | 不引入数据库，保持轻量                                                             |

**明确不使用：** Python 相关打包工具（PyInstaller/Nuitka）、Electron（体积/启动速度不达标）、任何需要联网才能运行的组件。

---

## 3. 项目管理与命令

- **前端依赖管理**：`npm`（不用 yarn/pnpm，保持统一）
- **Rust 依赖管理**：`cargo`

常用命令：

```bash
# 安装依赖
npm install

# 开发模式（同时起前端+Tauri窗口）
npm run tauri dev

# 生产构建（生成 Windows exe）
npm run tauri build

# 仅前端类型检查
npm run typecheck

# 仅前端 lint
npm run lint

# Rust 端检查
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

**AI 助手在提交代码前必须执行**：`npm run typecheck`、`npm run lint`、`cargo clippy`，三者任一报错不得视为任务完成。

---

## 4. 目录结构

```
my_label_tool/
├── src/                            # React 前端
│   ├── components/                 # UI 组件
│   │   ├── canvas/                 # Konva 画布（CanvasChrome）、几何计算（geometry）、交互类型
│   │   ├── settings/               # 导出面板、标签设置（弹窗）、快捷键设置
│   │   ├── sidebar/                # 侧边栏（预留，当前仅 .gitkeep）
│   │   └── toolbar/                # 工具栏（预留，当前仅 .gitkeep）
│   ├── store/                      # Zustand 状态（标注数据+撤销重做、全局状态）
│   ├── types/                      # 核心类型（annotation、export）
│   ├── lib/                        # tauri-api 封装、导入导出、工具函数
│   │   ├── defaults/               # 导出模板、标签、快捷键默认值
│   │   ├── exporters/              # COCO / VOC / YOLO / 自定义导出
│   │   ├── importers.ts            # 多格式导入 + 项目配置（ProjectConfig）解析
│   │   ├── tauri-api.ts            # 所有 Tauri command 调用封装
│   │   └── app-utils.ts            # 路径、图片尺寸、项目配置等工具函数
│   └── hooks/                      # useLabelActions、useProjectActions
├── src-tauri/                      # Rust 后端
│   ├── src/                        # 入口、commands、models
│   ├── capabilities/               # Tauri 权限（core:default + dialog:default）
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/workflows/              # GitHub Actions 发布工作流（release.yml）
├── docs/                           # 文档（build.md：Windows 打包与发布说明）
├── ROADMAP.md                      # 产品路线图
├── AGENTS.md
└── package.json
```

**原则**：标注数据结构（`AnnotationShape`、`LabelConfig`、`LabelTemplate` 等）必须在 `src/types/` 中先定义清楚，Rust 端 `models/` 保持字段一一对应，避免前后端数据结构漂移。

**Tauri 命令清单**（`src-tauri/src/commands/mod.rs`，前端经 `lib/tauri-api.ts` 调用，组件内禁止直接 `invoke`）：

| 命令 | 作用 |
| --- | --- |
| `list_image_files` | 列出文件夹下可加载图片（校验扩展名 + 文件头签名，跳过空文件） |
| `export_annotations_json` | 将标注数据写入指定 JSON 文件 |
| `export_text_files` | 批量写入文本文件（VOC XML / YOLO txt），路径需为相对安全路径 |
| `read_text_file` | 读取单个文本文件内容（导入用） |
| `list_text_files` | 按扩展名列出文件夹下文本文件（导入用） |
| `load_label_configs` / `save_label_configs` | 标签配置持久化（app data 目录 `labels.json`） |
| `load_label_templates` / `save_label_templates` | 标签模板持久化（`label-templates.json`） |
| `load_shortcuts` / `save_shortcuts` | 快捷键配置持久化（`shortcuts.json`） |

---

## 5. 核心数据模型（设计约定）

以下结构是项目的核心契约，新增功能前先确认是否需要扩展这些模型，而不是另起一套。

```typescript
// src/types/annotation.ts — 实际代码中的类型定义

// 单个标注图形
interface AnnotationShape {
  id: string;
  type: "rect";                              // 当前仅实现 rect，后续扩展 "polygon" | "point" | "polyline"
  labelId: string;                           // 关联 LabelConfig.id
  points: number[];                          // 原图像素坐标 [x, y, width, height]
  attributes?: Record<string, string | number | boolean>;
  frameIndex?: number;                       // 视频标注预留，图片标注阶段恒为 0
}

// 标签配置
interface LabelConfig {
  id: string;
  name: string;
  color: string;                             // hex 色值，如 "#38bdf8"
  shortcut?: string;                         // 单键快捷键，如 "1" "q"（仅限 [a-z0-9] 单字符）
  shapeType: AnnotationShape["type"];         // 当前恒为 "rect"
}

// 标签模板（一组 LabelConfig 的集合）
interface LabelTemplate {
  id: string;
  name: string;                              // 如 "通用目标检测" "道路交通"
  labels: LabelConfig[];
}
```

**坐标约定**：`points` 存储原图像素坐标，不使用归一化坐标。矩形格式为 `[x, y, width, height]`。画布渲染时通过 `imageLayout.scale` 缩放到屏幕坐标。

**视频标注扩展预留**：`AnnotationShape.frameIndex` 字段现在就加上，即使图片阶段用不到，避免后期做视频标注时重构数据结构。

**项目配置（ProjectConfig）**：导入与项目复用的核心契约，定义在 `lib/importers.ts`。包含 `schemaVersion`（当前恒为 1）、`format`（导入来源格式）、`annotationPath`、`imageFolder`、`exportedAt`、标签快照 `labels`、项目专用模板 `template`（id 固定为 `project-config`，名称「项目临时配置」）与 `exportOptions`。项目配置文件名固定为 `my-label-tool.project.json`，保存在图片目录下；打开图片目录时若存在该文件则提示自动加载。新增导入来源或修改导入流程时，必须同步更新 `ProjectConfig` 与 `parseProjectConfig` 校验逻辑，不得破坏已有配置的兼容性。

---

## 6. 编码规范

### 前端（React/TypeScript）

- 组件用函数组件 + Hooks，禁止 class component。
- 禁止 `any`，确需动态类型时用 `unknown` 并做类型收窄。
- 所有 Tauri command 调用必须封装在 `lib/tauri-api.ts`，组件内不得直接 `invoke(...)`。
- 状态分层：标注业务数据（标注列表、选中图形 id、撤销/重做栈）放入 Zustand store（`useAnnotationStore`）；画布交互状态（缩放级别、绘制中的临时图形、交互模式、平移状态）保留在 `App.tsx` 的本地 `useState`，不进 store；全局就绪标志放入 `useAppStore`。新增状态时按此归属判断，不要把瞬时交互态塞进 store。

### Rust

- 所有 `#[tauri::command]` 函数返回 `Result<T, String>`（或自定义 Error 类型 + `impl Serialize`），禁止 `unwrap()`/`expect()` 出现在 command 函数体内，必须走错误处理。
- 文件路径处理统一用 `std::path::PathBuf`，不手动拼接字符串路径。
- 图像/视频处理逻辑（后期）独立成 `src-tauri/src/media/` 模块，不要塞进 `commands/` 里。

### 通用

- 快捷键、标签、导出模板的默认值放在 `src/lib/defaults/` 或对应 Rust 端常量文件中，禁止散落在组件代码里硬编码。
- 所有用户可见文案（按钮、提示）先留出 i18n 结构（哪怕暂时只有中文一种语言），避免后期国际化时大改。
- 无特殊情况下，单文件代码禁止超过 1000 行；超过时优先按功能模块拆分到不同文件。
- 如确实需要单文件超过 1000 行，必须在文件开头用注释说明原因和理由。

## 7. 测试要求

- **当前状态**：Rust 端已有单元测试（`src-tauri/src/commands/mod.rs` 的 `#[cfg(test)]` 模块，覆盖图片识别、JSON 导出、文本文件导出/列举等）。前端使用 Vitest 覆盖导入/导出、store、几何计算、标签模板同步等纯逻辑。
- **覆盖率目标**：前端可黑盒测试的纯逻辑层（导入/导出、store、几何计算、配置解析等）通过 `npm run test:coverage` 保持 90% 以上行覆盖率；Tauri API 封装、更新器、UI 组件、纯默认配置等特殊文件可在覆盖率配置中排除，但新增复杂逻辑时必须补测。
- 新功能必须补充相关测试；问题修复尽可能补充回归测试，避免只修当前手动路径。
- 任务完成前必须运行测试并通过：改动较小时可跑新增/相关测试，提交前至少跑 `npm run typecheck`、`npm run lint`、`npm run test:coverage`、`cargo clippy --manifest-path src-tauri/Cargo.toml`；涉及 Rust 逻辑时同时跑 `cargo test --manifest-path src-tauri/Cargo.toml`。
- Rust 端：核心导出逻辑（`exporters` 对应的 Rust 序列化部分）必须有单元测试，覆盖至少一个真实标注样例的输入输出。
- 前端：标注数据的增删改（store actions）需要有基本的单元测试（Vitest），画布交互允许暂缓自动化测试，但需手动验证清单（见下）。
- **手动验证清单**（每次涉及画布交互改动后必须过一遍）：
  - [ ] 缩放后标注框位置是否仍准确对齐图片
  - [ ] 切换图片后是否正确加载/保存当前图片的标注
  - [ ] 快捷键改绑后是否立即生效，且不与系统/浏览器默认快捷键冲突
  - [ ] 导出文件用对应格式的标准工具（如 pycocotools）能否正确解析

---

## 8. Git 提交规范

### 格式

```
<emoji> <type>(<scope>): <subject>

<body>

<footer>
```

- **emoji**：视觉分类标识，必须使用
- **type**：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `style` / `perf`
- **scope**：可选，如 `(opds)`、`(spider)`、`(api)`、`(web)`
- **subject**：中文标题，概括变更内容，首字无需空格
- **body**：英文或中英文混排，每行为一个 `- ` 开头的条目，描述具体变更
- **footer**：可选的 `Refs:` 或 `BREAKING CHANGE:`

### Emoji 对照表

| Type       | Emoji | 含义                                    |
| ---------- | ----- | --------------------------------------- |
| `feat`     | ✨    | 新功能                                  |
| `fix`      | 🐛    | Bug 修复                                |
| `refactor` | ♻️    | 代码重构                                |
| `docs`     | 📚    | 文档变更                                |
| `test`     | 🧪    | 测试相关                                |
| `chore`    | 🔧    | 工程化/依赖/配置                        |
| `style`    | 🎨    | 代码格式/样式                           |
| `perf`     | ⚡    | 性能优化                                |
| `wip`      | 🚧    | 进行中（仅临时使用，合并前必须 squash） |

### 示例

```
✨ feat(opds): 实现 OPDS 基础层——可见性控制与 EPUB 制品生命周期

- DB: add opds_visible, content_updated_at, epub_compiled_at columns
- Repository: add OPDS CRUD methods
- OpdsCompilationService: new cron-based scheduler

Refs: ROADMAP OPDS 书源服务构建与分发
```

```
🐛 fix(api): 修复定时更新策略变更后调度器未正确重载的并发问题
```

```
📚 docs: 添加 OPDS 书源服务任务到路线图
```

### 约定

- 多条变更在同一提交中时，`subject` 概括主要变更，`body` 逐条列举
- 每行 body 以 `- ` 开头，长度不超过 72 字符（英文）或适当截断
- **禁止**仅重复文件列表而无语义描述的提交
- **禁止**在提交消息中包含内部指令或占位符（如 "TODO"、"TBD"）

---

## 9. 禁止事项

- 禁止引入需要联网才能使用的第三方服务/SDK 作为核心功能依赖。
- 禁止为了"看起来完整"而使用占位符/mock 数据替代真实实现后不做标记；如确需占位，必须在代码中用 `// TODO(annotool):` 标记并说明原因。
- 禁止跳过 `npm run lint` / `cargo clippy` 直接提交。
- `AnnotationShape.points` 使用**原图像素坐标**，格式 `[x, y, width, height]`。新增坐标计算功能时必须遵守此约定，不得引入归一化坐标。
