# 保存遵从所选导出格式验收（2026-09-18）

范围：基于 `2d03125`，修复视频项目选择 YOLO TXT 后保存仍写原生 JSON、以及重复 YOLO 导出入口的问题。
结论：通过；需求、实现及插件边界复审无未解决阻塞项。

## 复现与修复

- 先执行回归用例：`npx vitest run src/hooks/video-yolo-export.test.tsx -t 'selected YOLO format'`，修复前失败：预期调用 exportTextFiles 一次，实际零次。
- 根因：saveProjectExport 对含视频的项目直接进入 JSON 分支，忽略下拉框；独立 exportYoloAnnotations 又形成第二条入口。
- 删除独立 YOLO 按钮及回调。保存、另存为和快捷键共用所选格式；首次保存或切换格式时选择目标，同格式后续保存复用目标，另存为重新选择。
- 内置格式成功保存后更新项目配置的格式与目标路径，保留项目设置。选择 YOLO 写 TXT 标注；项目配置仍以 JSON 保存，不另写原生 JSON 标注。
- 同步修复标准格式的项目重载：按视频子目录读取 YOLO/VOC，COCO/VOC 保留相对帧路径并还原项目标签 ID，避免多个视频的同名帧冲突。
- 保留格式自身的限制：YOLO 不保存轨迹和关键帧属性，完整编辑元数据使用项目 JSON。已在视频文档说明。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| npm run typecheck / npm run lint | 通过 |
| npm run test:coverage | 49 个文件、332 项通过；行覆盖率 94.69% |
| npm run build | 通过；现有主包超过 500 kB 的非阻塞提示仍在 |
| cargo clippy --manifest-path src-tauri/Cargo.toml | 通过 |
| git diff --check | 通过 |

回归覆盖下拉框切换、首次保存、目录复用、另存为、取消、非矩形拒绝、配置写入失败、设置保留、空帧与未抽帧视频，以及 YOLO/VOC/COCO 多视频保存后重新读取。测试使用真实导出/解析逻辑，文件对话框与文件系统接口由测试替身隔离。

本次没有修改 Rust 逻辑，因此未重复执行 Rust 测试。按用户要求未使用 Computer Use，也未进行桌面实际标注验收。

## 插件边界正式审核

结论：通过（阻断 0 / 严重 0 / 一般 0 / 建议 0）。依据 AGENTS.md §10、CONTEXT.md 和 ADR 0003–0006；无规范缺陷。审核完成后由编码流程记录本报告。

| 维度 | 结果与依据 | 约束引用 |
| --- | --- | --- |
| 契约与 Schema | 通过：仅调整 useProjectActions 的格式路由与项目导入匹配；ProjectConfig 字段、ExportData、插件请求/结果和 Tauri commands 均未变，无需修改 Schema。 | §10 契约先行、边界影响评估；ADR 0004 |
| ID 与版本分层 | 通过：未修改插件 ID、主程序版本、宿主 API/能力版本或协议版本；没有公开契约变更。 | §10 稳定唯一 ID、版本分层、独立维护 |
| 能力声明 | 通过：ExportPanel 的保存入口复用现有导出器路由；禁用插件仍禁用按钮，未增加能力或修改握手。 | §10 能力声明优先；ADR 0003 |
| 向后兼容 | 通过：COCO/VOC 的 preservePaths 参数默认 false，外部导入维持原行为；项目保存保留原有设置、映射与插件配置。 | §10 向后兼容；ADR 0006 |
| 权限与隔离 | 通过：文件读写继续经 tauri-api，未新增插件入口或权限；协议代理、AppContainer、超时与故障隔离未修改。 | §10 权限最小化、故障隔离；ADR 0003、0005 |
| 目录与工程约定 | 通过：业务流程在 hooks/importers，UI 只转发操作，移除无用 i18n 文案；无新增直接 invoke 或 any，类型/lint/clippy 通过。 | §10 目录归属；AGENTS.md §6 |
| 测试 | 通过：video-yolo-export.test.tsx 覆盖输出及多视频重载，完整前端测试和覆盖率达标；未新增协议消息或错误码，无需新增 conformance 用例。 | AGENTS.md §7、§10 契约先行 |
