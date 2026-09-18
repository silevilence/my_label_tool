# 独立项目设置与 FPS 抽帧验收（2026-09-18）

范围：基于 `8045684`，按用户四项后续要求调整项目设置入口、持久化位置、批量抽帧和采样模式。
结论：完成；需求、代码质量、工程规范与插件边界复审通过，无未解决阻塞项。

## 需求核对

| 要求 | 实现与验证 |
| --- | --- |
| 项目设置与应用设置分离 | 独立 ProjectSettingsDialog，应用设置只保留快捷键/显示设置；配置保存到当前 my-label-tool.project.json 的可选 settings 字段。 |
| 缩小撤销/重做，右侧放项目设置 | 撤销/重做改为紧凑的 40×36 按钮，右侧为项目设置；没有已加载/成功保存的项目文件时禁用。App 集成用例验证禁用及入口。 |
| 批量抽帧迁入项目设置 | 主菜单移除旧入口；项目设置中显示未准备视频数，使用已保存设置串行处理。App 集成用例验证两段视频及原图片保留。 |
| 默认 5 FPS，可切换固定帧间隔 | 共享表单用于项目默认值和单次抽帧；新增、批量、重新抽帧均支持两种模式。模式切换保留各自数值，旧间隔配置兼容。 |

## 实现与复审修复

- ProjectConfig 新增可选 settings，解析器和项目 Schema 同步；后续标注保存保留设置、标签、导出路径、预打标映射与插件配置。
- 旧独立设置文件仅作兼容读取；保存设置时并入项目文件，不再写独立文件。没有项目文件时不允许保存配置。
- FPS 以首帧为零按时间桶选取源帧，空桶不补帧、不重复源帧。使用整数 PTS 和 time_base 避免时间文本舍入；保留真实源帧号与时间戳。
- FFmpeg select 的变量依据 [官方文档](https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect)，用真实解码和像素比对验证行为。
- 视频元数据增加可选 targetFps；缺失时仍按既有 frameInterval 校验，FPS 模式以 frames 内的实际索引为准。
- 复审修复：项目配置文件写入失败时不提前激活配置；项目设置弹窗位于禁用的工作区之外，避免拦截弹窗输入；Tab 焦点顺序、模式切换和设置写入失败均有回归用例。
- 抽取 ProjectVideoDialogs，App.tsx 保持在 1000 行以内；新增用户文案集中 i18n，默认值集中 defaults/video.ts。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| npm run typecheck / npm run lint | 通过 |
| npm run test:coverage | 49 个文件、326 项通过；行覆盖率 94.69%，函数 98.77%，分支 88.91% |
| npm run build | 通过；现有主包超过 500 kB 的非阻塞提示仍在 |
| cargo clippy --manifest-path src-tauri/Cargo.toml | 通过 |
| cargo test --manifest-path src-tauri/Cargo.toml | 231 项通过、13 项隔离；插件 conformance 1 项通过 |
| real_video_extract_reload_cancel_and_failure_cleanup（显式执行隔离用例） | 通过：10 FPS → 5 FPS、24 FPS → 5 FPS、采样 FPS 高于源帧率、可变帧率、重载、取消/失败清理；可变帧率抽帧图片与完整源帧逐张像素比对一致 |
| real_ffmpeg_reextract_recycles_old_frame_directory（显式执行隔离用例） | 通过：由间隔抽帧切换至 5 FPS 重抽，回收旧帧并成功重载新帧，保留源视频 |

真实媒体用例只生成临时测试视频，不启动 GUI。复跑命令：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml real_video_extract_reload_cancel_and_failure_cleanup -- --ignored --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml real_ffmpeg_reextract_recycles_old_frame_directory -- --ignored --test-threads=1
```

## 插件边界正式审核

结论：通过（阻断 0 / 严重 0 / 一般 0 / 建议 0）。依据 AGENTS.md §10、CONTEXT.md 与 ADR 0003–0006；无规范缺陷。

| 维度 | 结论与证据 | 约束 |
| --- | --- | --- |
| 契约与 Schema | 通过：[ProjectConfig](../../src/lib/importers.ts) 可选 settings 与 [Schema](../project-config.schema.json) 同步；[VideoProject](../../src/types/video.ts) 与 Rust models/video.rs 的可选 targetFps 对应，视频 Schema 与测试同步。插件 ExportData/预打标载荷未变。 | §10 契约先行、边界影响评估；ADR 0004 |
| ID 与版本分层 | 通过：仅宿主可选字段扩展；插件 ID、版本、API/能力版本、协议版本均未修改。 | §10 稳定唯一 ID、版本分层、独立维护 |
| 能力声明 | 通过：没有增加插件能力或修改 manifest/握手。FPS 参数仅由宿主 UI 调用。 | §10 能力声明优先；ADR 0003 |
| 向后兼容 | 通过：settings、targetFps 均可选；旧 ProjectConfig、独立设置文件和间隔模式帧目录可读取。现有插件配置在保存时保留。 | §10 向后兼容；ADR 0006 |
| 权限与隔离 | 通过：[视频命令](../../src-tauri/src/commands/video.rs) 保持宿主专用；无新增插件入口、文件权限或网络能力。既有路径校验、回收事务、超时/取消保持；AppContainer 和协议代理未变。 | §10 权限最小化、故障隔离；ADR 0003、0005 |
| 目录与工程约定 | 通过：命令经 tauri-api 封装，抽帧逻辑在 media/video.rs；组件复用共享表单，文案和默认值集中，类型检查/lint/clippy 通过。 | §10 目录归属；AGENTS.md §6 |
| 测试 | 通过：项目 Schema/解析、配置保留/失败、入口状态、批量流程、双模式、视频 Schema、真实媒体及插件 conformance 通过。没有新增插件协议消息或错误码。 | AGENTS.md §7、§10 契约先行 |

按用户要求未使用 Computer Use，未进行实际桌面标注交互验收。
