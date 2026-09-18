# 视频标注开发与验收记录

## 任务 4：跨帧插值

快速审核：通过，无阻塞项。计算阶段不写 store，应用前检查快照未过期；保留其它目标，
拒绝重复轨迹、人工中间标注和不兼容端点，人工修改自动插值后提升为关键帧。
252 项前端测试通过（含分段插值、三种图形、无效坐标、预览/应用 DOM 流程与撤销重做），
行覆盖率 94.36%；typecheck、lint、cargo clippy 通过。
插件检查沿用任务 1 七维度：全部通过；新增信息位于既有 attributes 扩展字典，
无需改插件 Schema、能力声明、ID、API/协议版本、权限或配置迁移。

## 任务 3：单帧标注与帧关联

快速审核及插件边界检查：通过，无阻塞项；沿用已存在的 frameIndex，不改变 Schema、API 或协议。
store 对当前视频帧绑定统一作用于手绘、编辑、预打标批量合并、导入和撤销/重做。
矩形、多边形、点的原图坐标及不同帧的数据隔离、原生 JSON 保存恢复均有回归测试。
快速切帧的过期图片回调不会覆盖新帧；解码缓存按最近使用顺序淘汰，最多 8 张/128 MiB。
typecheck、lint、coverage（244 项，行覆盖率 94.19%）、cargo clippy 均通过。

## 任务 2：时间轴

快速审核：通过，无阻塞项。时间轴按抽取帧导航，界面源帧从 1 显示，文件源帧从 0 保存。
当前帧来自同一 selectedPath，列表、快捷切帧和时间轴无独立选中状态。
自动化覆盖首/尾跳转、实际时间戳、单帧、无选中项和禁用状态。
typecheck、lint、coverage（236 项，行覆盖率 94.07%）、cargo clippy 均通过。

按用户要求仅采用自动化测试，没有使用 Computer Use 或实际人工标注验收。

## 任务 1：视频导入与抽帧

快速审核：通过，无阻塞项。固定源帧间隔、真实时间戳、帧列表复用、重开校验、
取消/失败回滚、独占任务、进程超时、离线安装包资源均有实现。

- `npm run typecheck`、`npm run lint`、`cargo clippy --manifest-path src-tauri/Cargo.toml`：通过。
- `npm run test:coverage`：233 项通过，行覆盖率 94.07%；`video-images.ts` 全部语句/分支命中。
- `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=4`：221 项通过、12 项隔离；conformance 1 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml real_video_extract_reload_cancel_and_failure_cleanup -- --ignored`：通过。自动生成 64×48 / 10 帧视频，间隔 3 得到源帧 0/3/6/9，末帧时间 0.9 秒；覆盖中文路径、元数据重开、缺帧拒绝、取消、损坏输入与失败清理。
- `scripts/prepare-video-tools.ps1`：本地 FFmpeg 7.1.1 资源复制、LICENSE、版本、SHA-256 清单生成通过。

已修复测试阻塞：模拟 API 补充视频查询；快捷键测试等待实际 lazy import；
Rust 响应头超时夹具保持连接但不无限读取可能未发送的请求。生产下载逻辑未修改。

插件快速审查（依据 AGENTS.md §10、ADR 0003–0007）：

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 契约与 Schema | 通过 | 独立宿主 VideoProject，不修改插件结构 |
| ID 与版本分层 | 通过 | 插件 ID/API/协议版本保持原值 |
| 能力声明 | 通过 | 无新增插件能力 |
| 向后兼容 | 通过 | 普通目录返回 null，既有图片项目测试通过 |
| 权限与隔离 | 通过 | 视频 commands 仅宿主调用，插件代理不变 |
| 目录与工程约定 | 通过 | media/video、models/video、tauri-api、i18n 分层 |
| 测试 | 通过 | 前后端回归、真实 FFmpeg 与 conformance 均通过 |
