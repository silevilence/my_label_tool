# 图片删除验收记录

日期：2026-09-17。平台：Windows。任务：列表右键 / 画布右键 / 可配置快捷键删除源图片。

## 行为与边界

- 三个入口共用 `useImageDeletion` 与 `DeleteImageDialog`。默认快捷键 F8；Delete 仍只删除选中标注。旧配置已占用 F8 时，新动作保留为「未绑定」，避免接管既有操作。
- 显示文件名、完整路径、标注数量、回收站及标注不可撤销提示。等待完整 3 秒；确认只接受鼠标点击，Enter / Space 无效，Esc / 取消按钮退出。弹窗捕获键盘事件，阻断画布快捷键。
- 只在回收站操作成功后更新列表、当前图片、标注和历史。删除非当前图片保留其画布与选择；删除当前图片优先下一张，其次新的最后一张，删空则无当前图片。删除不进入历史，移除两个历史栈中该图片的记录及残留选择引用。
- 保存、插件导出、预打标执行期间拒绝发起删除，防止异步结果回写；重复确认只执行一次。失败保留列表、当前图片、标注与历史，并在弹窗中说明原因，支持重试。
- 原生实现使用 Windows `IFileOperation`，指定回收站模式，并在 `PreDeleteItem` 否决永久删除路径。校验绝对路径、所选目录的直接子文件、图片扩展名，拒绝目录、链接及 reparse point。无永久删除后备逻辑；其他系统返回不支持错误。
- 删除后可继续保存空项目。既有磁盘导出文件不会因点击删除而被主动清扫；保存 / 另存为使用更新后的图片集合，原生 JSON 覆盖保存已验证。

实现依据：[Windows Shell 操作标志](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags)、[PreDeleteItem 否决机制](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-predeleteitem)。

## 自动化结果与复跑

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run test:coverage` | 29 文件、227 项通过；行 94.05%，语句 94%，函数 98.57%，分支 87.30% |
| `npm run build` | 通过；Vite 提示主 chunk 超过 500 kB，无构建错误 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 219 单元测试与 1 协议集成测试通过；11 个需外部环境的测试默认忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib recycle_and_restore_real_file -- --ignored --nocapture` | 通过；临时中文文件移入真实回收站，Shell 枚举确认并恢复，字节内容一致 |

新增可复跑证据：

- `src/components/image-deletion.acceptance.test.tsx`：倒计时、键盘确认拦截、画布快捷键屏蔽、取消、失败重试、单次提交、改绑、输入框、背景任务互斥、当前 / 非当前 / 最后一张 / 空状态。
- `src/components/image-deletion.entries.test.tsx`：真实 App 的列表右键与 F8 接线、画布菜单按钮、设置冲突拒绝、F9 改绑立即生效。Konva 绘制与原生 IPC 使用测试替身，原生操作另行验证。
- `src/store/useAnnotationStore.test.ts`：删图后两个历史栈、跨图片选择引用、其他图片的历史保留、撤销重做无复活。
- `src/lib/app-utils.test.ts`：旧快捷键配置迁移与 F8 冲突保护。
- `src-tauri/src/media/image_deletion.rs`：非法路径、非图片、目录、目录外图片、锁定文件不被删除、真实回收恢复。
- `src-tauri/src/media/image_recycle_windows.rs`：拒绝非回收操作回调。

## 桌面交互验收

用本次构建的 exe 和独立临时目录 `src-tauri/target/image-deletion-ui` 验证，未操作用户图片。目录含 a / b / c 三张 640×400 PNG，每张有一个与图中矩形重叠的标注。步骤及结果：

1. 打开临时项目，缩小图片：标注与底图矩形保持对齐。
2. 当前为 a，列表右键 b：菜单打开且 a 保持选中；弹窗显示 b、1 个标注和 3 秒禁用按钮。
3. 倒计时结束后按 Enter、Space：弹窗保留，文件未删除；鼠标确认后只移除 b，a 的画布及缩放保持不变。
4. 画布右键「删除当前图片」：同一弹窗显示 a。按 Esc 取消，列表与标注不变。
5. F8 再次打开 a 的确认弹窗，鼠标确认：切换到 c，并加载 c 的标注。
6. Ctrl+S 保存：用 PowerShell `ConvertFrom-Json` 解析 `annotations.json`，断言仅剩 c 和其标注；磁盘 PNG 也仅剩 c。
7. 画布右键删除 c：列表 0/0、画布清空。Ctrl+S 后断言导出 `images=[]`。
8. 用 Shell 回收站枚举按本次临时目录和精确文件名筛选，确认 a / b / c 全部存在；恢复三张图片，并确认三个文件重新出现。
9. 关闭验收进程。快捷键设置改绑及冲突使用真实设置组件的自动化测试验证，避免修改用户已有快捷键配置。

文件被占用的真实失败路径由 Rust 测试验证；前端 IPC 失败后的所有状态不变由自动化验收验证。不支持回收站的磁盘没有实际设备可测，永久删除回调拒绝已单独测试。

## 插件边界评估

新增 `recycle_image_file(folderPath, imagePath) -> Result<(), String>` 仅供宿主 UI 调用，经 `lib/tauri-api.ts` 封装和 Tauri 注册。插件无法通过 stdio 协议调用该命令。标注模型、ProjectConfig、导出 / 预打标数据格式、manifest、能力协商、标准错误码均未变更；无需改 Schema、宿主 API 版本、业务能力版本或协议版本。AGENTS.md 命令清单已同步，§10 约束与项目技能无需调整。
