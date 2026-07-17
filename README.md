# my_label_tool

离线图片标注桌面工具--打开文件夹、画矩形框、绑定标签，支持多格式导入导出与外部数据集建项，Windows 双击即用。

## 功能

**图片浏览**

- **打开图片文件夹**：支持 JPG / PNG / BMP，自动跳过损坏或空文件
- **方向键切换**：上一张 / 下一张图片；切换时后台预加载下一张，减少空白等待
- **图片列表搜索**：按 `Ctrl+F` 或点击放大镜按钮，按文件名普通文本或正则表达式搜索并跳转，结果带小图预览
- **标注进度统计**：实时显示已标注、未标注与总图片数量，并附完成进度条；可一键跳转下一张 / 上一张未标注图片

**多种标注图形**

- **矩形框标注**：在图片上绘制、选中、拖拽、缩放矩形框；缩放时可自由调整宽高比，不再锁定比例
- **多边形标注**：适用于不规则形状，逐个点击添加顶点，双击完成绘制；绘制时显示跟随鼠标的预览连线，按 `Backspace` 撤销最近一个顶点
- **关键点标注**：在图片上标记单个关键点位置，适用于特征点定位
- **工具切换**：顶部支持矩形 / 多边形 / 关键点三种工具切换，默认快捷键 `R` / `P` / `K`
- **交互模式**：按住 Shift 进入强制选择模式（左键仅选择），按住 Ctrl 进入强制标注模式（左键直接绘制）

**标签体系**

- **内置模板**：开箱即用「通用目标检测」和「道路交通」两套标签模板
- **自定义标签**：自由增删改标签的名称、颜色、单键快捷键、适用图形类型（通用 / 矩形 / 多边形 / 关键点）；切换工具时自动选中兼容的标签
- **标签模板管理**：标签与模板管理整合为独立弹窗，支持新建、保存、另存为、删除自定义模板（内置模板不可删除）
- **项目专用模板**：项目配置中保存专属标签模板，修改时提供变更保护与影响摘要；删除已被使用的标签需二次确认，并支持「保存并更新标注」一键同步已有标注的标签引用
- **快捷键切标签**：按下标签绑定的单键（如 `1` / `2` / `3`）快速切换当前标签，已有选中框同步切换其标签
- **标签速查面板**：画布默认模式下可显示标签快捷键速查（如 `1：人`），并高亮当前新建标注将使用的标签

**画布体验**

- **画布缩放与平移**：滚轮以鼠标位置为中心缩放，Ctrl+滚轮微调；Ctrl+右键或中键拖动平移画布
- **十字光标与辅助线**：绘制标注时鼠标显示十字光标，并显示随鼠标移动的水平/垂直辅助线，便于精确对齐；两者均可在设置中单独开关
- **大图优化**：针对大图片优化了标注与渲染流畅度

**导入与导出**

- **多格式导出**：支持原始 JSON、COCO JSON、VOC XML、YOLO TXT、自定义字段映射 JSON 五种导出格式
- **标注导入**：支持导入原生 JSON、COCO、VOC、YOLO 标注；打开文件夹时若存在项目配置文件会提示自动加载
- **从外部数据集创建项目**：手上只有 YOLO 格式的图片和标注目录时，无需本工具项目文件即可直接导入并生成项目；自动读取 `classes.txt` 生成标签，导入后保存项目配置，再次打开该目录自动按本项目加载

**操作与效率**

- **撤销 / 重做**：标注的新增、删除、移动、调整均可撤销重做（默认 `Ctrl+Z` / `Ctrl+Y`）
- **快速保存**：按 `Ctrl+S` 快速保存当前项目，保存时显示进度与完成提示
- **删除与清空**：选中标注按 `Delete` 删除；提供「清空当前图片所有标注」按钮（需二次确认）
- **快捷键配置**：切图、缩放、工具切换等通用快捷键可在配置面板中自定义并持久化保存
- **自动检查更新**：应用启动后自动检查更新，也可在菜单中手动检查；发现新版本可一键下载安装并自动重启

## 环境要求

| 项目 | 版本 |
| --- | --- |
| Node.js | ≥ 20（Vite 7 要求） |
| Rust | stable（建议通过 [rustup](https://rustup.rs/) 安装） |
| 操作系统 | Windows（主要目标平台）；macOS / Linux 可编译但未充分测试 |

## 快速开始

```bash
# 1. 安装前端依赖
npm install

# 2. 启动开发模式（同时启动前端 dev server 和 Tauri 窗口）
npm run tauri dev
```

启动后会自动打开一个原生窗口，点击左上角「打开图片文件夹」即可开始标注。

## 构建发布版

```bash
npm run tauri build
```

产物位于 `src-tauri/target/release/`，生成的 Windows 安装包可在无开发环境的机器上直接运行。

## 常用开发命令

```bash
npm run typecheck          # 前端 TypeScript 类型检查
npm run lint               # 前端 ESLint 检查（0 warnings 通过）
npm run format             # Prettier 格式化
npm run format:check       # Prettier 格式检查
cargo check --manifest-path src-tauri/Cargo.toml   # Rust 编译检查
cargo clippy --manifest-path src-tauri/Cargo.toml  # Rust lint
```

## 测试

```bash
# Rust 后端单元测试（覆盖图片识别、JSON 导出、文本文件导出/列举等）
cargo test --manifest-path src-tauri/Cargo.toml

# 前端单元测试（Vitest，覆盖导入/导出、store、几何计算、标签模板同步等纯逻辑层）
npm test

# 前端测试 + 覆盖率（行/函数/语句覆盖率门槛 90%，分支 75%）
npm run test:coverage
```

画布交互暂无自动化测试，相关改动需按 `AGENTS.md` 中的手动验证清单核对。详细的打包与发布流程见 [docs/build.md](docs/build.md)。

## 发布

项目通过 GitHub Actions 自动发布 Windows 安装包。推送形如 `V0.2.0` / `v0.2.0` 的版本 Tag 时，[release.yml](.github/workflows/release.yml) 工作流会自动触发：

1. 从 `changelog.md` 读取对应版本章节作为 Release 说明
2. 执行前端构建与 Tauri 打包，生成 Windows 安装包（NSIS `.exe` / MSI）
3. 将安装包上传并发布到对应的 GitHub Release

发布前需确保 `changelog.md` 中已有该 Tag 对应的版本章节，且 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处版本号已同步。

## 项目结构

```
my_label_tool/
├── src/                            # React 前端
│   ├── components/                 # 画布、设置面板、侧边栏、工具栏组件
│   │   ├── canvas/                 # Konva 画布、几何计算、交互类型
│   │   ├── settings/               # 导出面板、标签设置、快捷键设置
│   │   └── sidebar/                # 应用侧边栏、图片搜索弹窗
│   ├── store/                      # Zustand 状态管理（标注数据 + 全局状态）
│   ├── types/                      # 核心类型定义（annotation、export）
│   ├── lib/                        # Tauri API 封装、导入导出、默认配置
│   │   ├── defaults/               # 导出模板、标签、快捷键默认值
│   │   └── exporters/              # COCO / VOC / YOLO / 自定义导出
│   └── hooks/                      # useLabelActions、useProjectActions
├── src-tauri/                      # Rust 后端
│   ├── src/                        # 入口、commands、models
│   ├── capabilities/               # Tauri 权限配置
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/workflows/              # GitHub Actions 发布工作流
├── docs/                           # 文档（build.md：Windows 打包与发布说明）
├── ROADMAP.md                      # 产品路线图
├── AGENTS.md                       # AI 开发指南
└── package.json
```

## 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 应用框架 | Tauri 2.x | Rust 后端 + Web 前端，产出原生桌面程序 |
| 前端框架 | React 18 + TypeScript | 函数组件 + Hooks |
| 状态管理 | Zustand | 按领域拆分 store（标注数据 + 全局状态） |
| 画布 / 图形层 | Konva.js + react-konva | 矩形 / 多边形 / 关键点绘制、拖拽、变换 |
| 样式 | Tailwind CSS 3.x | utility-first CSS |
| 构建工具 | Vite 7 | 前端打包，开发端口固定 1420 |
| 后端 | Rust + Tauri commands | 文件系统读写、JSON 导出、标签/模板/快捷键持久化 |
| 配置持久化 | 本地 JSON 文件 | 保存在 app data 目录，不引入数据库 |
