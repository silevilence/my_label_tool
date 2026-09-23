# 预打标模型来源与本地设置反馈验收

日期：2026-09-23。本文只记录最终实现与当前可重复执行的验证，不沿用各轮历史失败数字或过期行号。

## 最终行为

- 执行窗口列出模型库全部模型，摘要包含格式、类别数和有效输入尺寸；动态尺寸按「动态」显示。默认跟随库当前模型，显式选择保留整个应用会话，不写回模型库。
- 单图和批量执行使用所选模型及其 ID 对应的映射。执行期间改变模型库或所选模型后，已提交分块保留，后续分块拒绝合并，并提示已保留张数。
- 所选来源消失时回退到库当前模型或列表首项（可能是禁用插件）；仍存在但被禁用的来源不自动切换。相同内容的插件来源刷新不使在途执行失效。
- 本地模型和映射保存使用本地忙碌状态，不产生下载完成卡片。真实下载、转换和校验仍经操作注册表管理；取消更新确认产生「已取消」警告状态，不报告下载成功。
- 设置失败聚合计数并绑定具体重试动作。重试读取最新表单和持久化回调，复用字段校验；关闭或切换编辑对象后只提示上下文失效，不再登记无法成功的重试。
- 资源冲突只显示独立忙提示，释放资源后自动清除；原失败原因、计数和重试绑定保留。重试按钮置灰且回调再次检查资源与失败记录。
- 同标签完成卡片只保留最近一张；运行中、失败及其他标签卡片不参与去重，五秒自动收起行为保留。

## 最后一轮意见处理

| 意见 | 决策 | 修改与可复核依据 |
| --- | --- | --- |
| A1 | 完全采纳 | 将新增 hook、来源验收测试和本文纳入版本控制；新增 hook 单测也一并提交。提交前检查暂存清单和必需文件的 `git ls-files` 输出 |
| B1 | 完全采纳 | `usePrelabelLibraryMutation` 的 `reportBusy` / `busyNotice` 与失败状态分离；设置组件所有资源冲突入口改用忙提示。设置测试覆盖下载、Runtime 两种占用，并断言原失败对象与重试保留、释放后可重试 |
| B2 | 完全采纳 | `updateModelFromUrl` 确认取消分支显式完成为 warning；`releases the lock without downloading when confirmation is declined` 断言未下载与取消终态 |
| B3 | 部分采纳 | `isContextCurrent` 比较来源描述内容，允许无语义变化的刷新；保留模型库引用检查，避免漏掉同 ID 下的配置变化。`accepts the next plugin run when the previous refresh returns identical source contents` 覆盖跨两次执行的刷新竞态 |
| B4 | 完全采纳 | 新 hook 单独加入 coverage include，覆盖重入、资源获取失败与下载失败；模型逻辑单测断言 IoU、宽度、更新地址各自的字段错误文案 |
| B5 | 完全采纳 | 无效更新地址归「模型下载」失败是本变更集引入的归属变化；正常 UI 已禁用无效表单的更新按钮，该分支保留为下载动作内部的防御守卫。此前写作「既有取舍」不准确 |
| C1 | 部分采纳 | 增加禁用按钮 title 断言。缓存 DOM 按钮仍受 disabled 限制，因此改为直接调用占用前捕获的 hook 重试回调，验证点击期资源守卫，避免禁用点击自证 |
| C2 | 完全采纳 | replace/dismiss 用例先断言重试入口存在，再改变失败卡片 |
| C3 | 完全采纳 | 删除输入对象上的恒真断言；真实 `usePrelabelModels` 与执行对话框组合测试断言运行所选模型、不调用 `savePrelabelModelLibrary` 且库当前模型保持不变 |
| C4 | 完全采纳 | 模型 b 添加独立映射，切换前后未匹配类数分别断言 1 和 2 |
| C5 | 完全采纳 | 补充 METHOD_NOT_FOUND 后逐张回退、回退中途取消保留已完成图片、动态尺寸摘要测试 |
| C6 | 完全采纳 | 守卫单测断言 `PrelabelModelContextChangedError` 类型，字段错误断言不是该类型；设置测试另验证修正字段后重试成功 |
| D1 | 完全采纳 | ROADMAP 改为已提交分块保留、后续拒绝并报告数量；`retains the first committed chunk when the library changes during the second chunk` 验证保留 8/10 张 |
| D2 | 完全采纳 | 交互文档明确列表首项可能禁用，以及仍存在但禁用时不自动切换 |
| D3 / F | 完全采纳 | 本文以符号和用例名定位；移除不可从当前树复现的各轮历史失败数字，不将过程性审查声明作为验证证据 |
| E | 留待后续 | 报告明确列为既有问题；本轮不扩展到无消费者返回值、其他英文错误路径、其他死键或 Rust exporter 拆分 |
| G | 范围说明 | 非修复意见；当前检查范围和未验证项见下文 |

前几轮修复均保留：最新表单重试、失败记录绑定、上下文错误分类、摘要可访问名称、纯校验助手归属 lib、无引用文案清理以及会话选择说明。对应断言保留在设置、模型逻辑、来源与操作注册表测试中。

## 可重复执行的验证

```powershell
npx vitest run src/hooks/usePrelabelLibraryMutation.test.tsx src/hooks/usePrelabelExecution.sources.test.tsx src/components/settings/prelabel-model-update.test.tsx src/lib/prelabel-models.test.ts --maxWorkers=2 --sequence.shuffle --sequence.seed=23
npm run typecheck
npm run lint
npm run test:coverage -- --maxWorkers=2
cargo clippy --manifest-path src-tauri/Cargo.toml
git diff --cached --check
```

| 检查 | 本次结果 |
| --- | --- |
| 定向乱序测试（seed 23） | 4 文件 / 65 项通过 |
| 完整前端测试与覆盖率 | 89 文件 / 556 项通过 |
| 行 / 语句 / 分支 / 函数覆盖率 | 95.98% / 95.93% / 91.18% / 99.12%，达到项目阈值 |
| typecheck / lint / cargo clippy | 全部通过 |
| 设置组件行数 | 999，未超 1000 行 |
| 暂存与空白检查 | 必需新增文件均在暂存清单，无未跟踪文件；`git diff --cached --check` 通过 |

## 边界与限制

`usePrelabelExecution` 的 `builtinSourceId` 仅构造宿主 UI 选择键；模型映射仍按模型 ID，插件映射仍按插件来源键。推理继续经现有 Tauri 封装调用，插件能力仍来自来源声明。类型、ProjectConfig、插件 Schema、Rust 插件框架和 Tauri 命令没有修改，因此无需调整插件 API 或协议版本。可通过本次提交的文件清单与 diff 核对此边界。

按项目 plugin-review 检查本次前端变更，结论通过（阻断 0 / 严重 0 / 一般 0 / 建议 0）。下表限定为代码边界检查，不代替真实环境验证。

| 维度 | 结果与证据 | 约束依据 |
| --- | --- | --- |
| 契约与 Schema | 通过；类型、Schema、ProjectConfig、Tauri 封装无 diff；新增 UI 选择键不进入推理载荷 | AGENTS.md §10 契约先行、边界影响评估 |
| ID 与版本分层 | 通过；`builtinSourceId` 只区分内置模型，插件来源仍沿用 selectionId；版本文件无 diff | AGENTS.md §10 稳定唯一 ID、版本分层；ADR 0007 |
| 能力声明 | 通过；来源描述仍取插件声明的 supportsCancel，METHOD_NOT_FOUND 回退调用路径不变且增加回归 | AGENTS.md §10 能力声明优先 |
| 向后兼容 | 通过；`usePrelabelExecution` 的映射键仍是模型 ID / 插件来源键，持久化格式未变 | AGENTS.md §10 向后兼容优先；ADR 0006 |
| 权限与隔离 | 通过（本次差异）；`runPluginPrelabel` 仍调用现有宿主封装，无新增直接文件、网络或进程访问；Rust 运行时无 diff | AGENTS.md §10 权限最小化、故障隔离；ADR 0003–0005 |
| 目录与工程约定 | 通过；状态编排在 hooks，纯校验在 lib，文案在 i18n；设置组件 999 行 | AGENTS.md §6、§10 目录归属 |
| 测试 | 通过；来源、映射、上下文、回退/取消、重试与资源冲突见上述测试文件；协议行为未改，不新增 conformance 用例 | AGENTS.md §7、§10 契约先行 |

前端测试模拟 Tauri 返回值，验证编排、持久化调用边界和状态行为；它们不证明真实 ONNX 推理、Windows 原生对话框或 AppContainer 隔离正确。本轮未执行这三类手动/真实环境验收，也未修改 Rust 逻辑。
