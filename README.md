# my_label_tool

离线图片标注桌面工具——打开文件夹、画矩形框、绑定标签、导出 JSON。

## 功能

- **打开图片文件夹**：支持 JPG / PNG / BMP，自动跳过损坏或空文件
- **矩形框标注**：在图片上绘制、选中、拖拽、缩放矩形框
- **标签体系**：内置"通用目标检测"和"道路交通"两套标签模板，支持自定义增删改标签（名称、颜色、快捷键）
- **标签模板管理**：新建、保存、另存为、删除自定义模板，内置模板不可删除
- **快捷键切标签**：按下标签绑定的单键（如 `1` / `2` / `3`）可快速切换当前标签，已有选中框时同步切换其标签
- **多格式导出**：支持原始 JSON、COCO JSON、VOC XML、YOLO TXT、自定义字段映射 JSON 五种导出格式
- **标注导入**：支持导入原生 JSON、COCO、VOC、YOLO 标注；打开文件夹时若存在项目配置文件会提示自动加载
- **画布缩放与平移**：滚轮以鼠标位置为中心缩放，Ctrl+滚轮微调；Ctrl+右键或中键拖动平移画布
- **撤销 / 重做**：标注的新增、删除、移动、调整均可撤销重做（默认 `Ctrl+Z` / `Ctrl+Y`）
- **删除与清空**：选中标注框按 `Delete` 删除；提供"清空当前图片所有标注"按钮（需二次确认）
- **交互模式**：按住 Shift 进入强制选择模式（左键仅选择），按住 Ctrl 进入强制标注模式（左键直接绘制）
- **快捷键配置**：切图、缩放等通用快捷键可在配置面板中自定义并持久化保存

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

## 项目结构

```
my_label_tool/
├── src/                            # React 前端
│   ├── components/                 # 画布、设置面板、侧边栏、工具栏组件
│   ├── store/                      # Zustand 状态管理（标注数据 + 全局状态）
│   ├── types/                      # 核心类型定义
│   ├── lib/                        # Tauri API 封装、导入导出、默认配置
│   └── hooks/                      # 自定义 hooks
├── src-tauri/                      # Rust 后端
│   ├── src/                        # commands、models
│   ├── capabilities/               # Tauri 权限配置
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                           # 文档
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
| 画布 / 图形层 | Konva.js + react-konva | 矩形框绘制、拖拽、变换（多边形/关键点待实现） |
| 样式 | Tailwind CSS 3.x | utility-first CSS |
| 构建工具 | Vite 7 | 前端打包，开发端口固定 1420 |
| 后端 | Rust + Tauri commands | 文件系统读写、JSON 导出、标签/模板/快捷键持久化 |
| 配置持久化 | 本地 JSON 文件 | 保存在 app data 目录，不引入数据库 |
