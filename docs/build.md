# 打包与发布说明

本文档记录 `my_label_tool` 在 Windows 上的打包流程。项目目标是离线、轻量、双击可用；发布包不应依赖用户安装 Node.js、Rust 或前端开发环境。

## 支持系统

- 推荐并承诺支持：Windows 10 1803 及以上、Windows 11。
- 暂不承诺支持：Windows 7 / 8 / 8.1，除非后续在真实机器或虚拟机上单独验证。
- Windows 10 1803+ 通常已带 WebView2；更老或精简系统可能需要安装器补装 WebView2 Runtime。参考 Tauri 官方说明：[WebView2](https://v2.tauri.app/start/prerequisites/#webview2)。

## 打包前准备

打包机需要安装：

- Node.js 与 npm
- Rust stable toolchain
- Microsoft C++ Build Tools / Visual Studio 生成工具
- 项目依赖：`npm install`

PowerShell 命令统一使用 `-NoProfile`，避免本机 profile 干扰：

```powershell
powershell -NoProfile -Command "npm.cmd install"
```

如果当前机器禁止执行 `npm.ps1`，使用 `npm.cmd`，不要修改系统执行策略。

## 打包前检查

提交或发布前必须跑完：

```powershell
powershell -NoProfile -Command "npm.cmd run typecheck"
powershell -NoProfile -Command "npm.cmd run lint"
powershell -NoProfile -Command "cargo clippy --manifest-path src-tauri/Cargo.toml"
```

任一失败都不要发布。

## 生产打包

```powershell
powershell -NoProfile -Command "npm.cmd run tauri build"
```

该命令会先执行 `npm run build`，再由 Tauri 生成 Windows 安装包/可执行产物。

常见产物位置：

- `src-tauri/target/release/bundle/nsis/*.exe`
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/my_label_tool.exe`

实际产物以本机 `src-tauri/target/release/bundle/` 下生成内容为准。

## 发布前手动验证

至少验证一次：

1. 在开发机运行安装包或 release exe。
2. 打开一个图片文件夹，确认 JPG / PNG / BMP 能加载。
3. 绘制、选中、拖拽、缩放矩形框。
4. 修改标签并保存项目配置，确认项目配置里的模板为 `项目临时配置`，不污染常驻模板。
5. 导出 JSON / YOLO / VOC / COCO 中本次发布涉及的格式。
6. 在无 Node.js、Rust 的 Windows 10/11 机器或虚拟机上安装运行。

## 已知问题

- 未签名安装包可能触发 Windows SmartScreen 提示；正式分发前需要代码签名。
- 首次打包会下载或编译较多 Rust 依赖，耗时正常。
- 如果 `npm run tauri build` 找不到 npm 脚本，改用 `npm.cmd run tauri build`。
- 产物体积和启动速度尚未系统记录；完成 M4 验证后再补充实测数据。
