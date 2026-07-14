# my_label_tool

离线图片标注桌面工具——打开文件夹、画矩形框、绑定标签、导出 JSON。

## 功能

- **打开图片文件夹**：支持 JPG / PNG / BMP，自动跳过损坏或空文件
- **矩形框标注**：在图片上绘制、选中、拖拽、缩放矩形框
- **标签体系**：内置"通用目标检测"和"道路交通"两套标签模板，支持自定义增删改标签（名称、颜色、快捷键）
- **标签模板管理**：新建、保存、另存为、删除自定义模板，内置模板不可删除
- **快捷键切标签**：按下标签绑定的单键（如 `1` / `2` / `3`）可快速切换当前标签，已有选中框时同步切换其标签
- **导出 JSON**：将所有图片的标注数据导出为结构化 JSON 文件

## 环境要求

| 项目 | 版本 |
| --- | --- |
| Node.js | ≥ 18 |
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
│   ├── App.tsx                     # 主组件（画布 + 侧边栏 + 标注逻辑）
│   ├── main.tsx                    # 入口
│   ├── components/
│   │   ├── canvas/                 # 画布组件（待实现）
│   │   ├── toolbar/                # 工具栏（待实现）
│   │   ├── sidebar/                # 图片列表面板（待实现）
│   │   └── settings/
│   │       └── LabelSettings.tsx   # 标签配置面板
│   ├── store/
│   │   ├── useAnnotationStore.ts   # 标注数据状态（Zustand）
│   │   └── useAppStore.ts          # 应用全局状态（Zustand）
│   ├── types/
│   │   └── annotation.ts           # 核心类型定义
│   ├── lib/
│   │   ├── tauri-api.ts            # Tauri command 调用封装
│   │   ├── defaults/
│   │   │   └── labels.ts           # 内置标签模板与默认颜色
│   │   └── exporters/              # 导出格式实现（待实现）
│   └── hooks/                      # 自定义 hooks（待实现）
├── src-tauri/                      # Rust 后端
│   ├── src/
│   │   ├── main.rs                 # 入口
│   │   ├── lib.rs                  # Tauri Builder 配置
│   │   ├── commands/
│   │   │   └── mod.rs              # Tauri commands
│   │   └── models/
│   │       ├── annotation.rs       # Rust 端数据结构
│   │       └── mod.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                           # 文档（待补充）
├── ROADMAP.md                      # 产品路线图
├── AGENTS.md                       # AI 开发指南
└── package.json
```

## 技术栈

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 应用框架 | Tauri 2.x | Rust 后端 + Web 前端，产出原生桌面程序 |
| 前端框架 | React 18 + TypeScript | 函数组件 + Hooks |
| 状态管理 | Zustand | 按领域拆分 store |
| 画布 / 图形层 | Konva.js + react-konva | 矩形框绘制、拖拽、变换 |
| 样式 | Tailwind CSS | utility-first CSS |
| 构建工具 | Vite 7 | 前端打包 |
| 后端 | Rust + Tauri commands | 文件系统读写、JSON 导出、标签配置持久化 |
| 配置持久化 | 本地 JSON 文件 | 标签模板、标签配置保存在 app data 目录 |
