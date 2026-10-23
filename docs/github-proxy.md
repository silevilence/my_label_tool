# GitHub 代理与软件更新

在「设置 → GitHub 代理」填写资源代理入口并点击「保存代理设置」。默认留空，表示不使用此代理。设置保存在本机应用数据目录的 `github-proxy.json`，重启后保留，不随项目保存、导出或切换。

入口支持 HTTP/HTTPS 和路径前缀，例如 `http://proxy.example:8080/github`。它替换资源地址的 `https://github.com` 前缀：`https://github.com/owner/repo/releases/download/tag/file` 对应 `http://proxy.example:8080/github/owner/repo/releases/download/tag/file`。此处填写资源代理入口，不是 HTTP CONNECT/SOCKS 系统代理地址。保存时去掉首尾空格和末尾斜杠，不接受用户名、密码、查询参数、片段或非 HTTP/HTTPS 协议。

配置读写失败会明确提示；无效输入不会覆盖原设置。保存或清空后，后续请求采用新配置，在途下载保持原连接。代理不可用时报告失败，不自动回退直连。

代理覆盖更新清单、清单中的安装包、ONNX Runtime 与 GitHub 模型资源。`raw.githubusercontent.com/owner/repo/ref/path` 会转换为 `代理入口/owner/repo/raw/ref/path`；GitHub API 和非 GitHub 的自定义模型源保持原地址，不作为通用网页代理。GitHub 资源的查询参数保留，是否支持这些参数取决于代理服务。

代理服务须自行处理上游 GitHub/CDN 重定向，向客户端返回资源；代理响应跳转到其他源时会明确失败，避免绕过代理直接连接外网。更新器允许用户保存 HTTP 代理入口，因此启用了 HTTP 传输支持；默认更新源仍为 HTTPS，TLS 证书检查、更新安装包签名验证和 Runtime SHA-256 校验均保留。预打标模型仍须通过 ONNX 内容校验，才能写入受管模型目录。

发布工作流在草稿发布期间执行 `scripts/normalize-update-manifest.ts`，将 `latest.json` 中所有平台的安装包地址按本次 Release 的资源元数据转换为 `browser_download_url`（`https://github.com/owner/repo/releases/download/tag/file`），保留签名、版本与更新说明。转换或上传失败时不发布该草稿，避免 API 安装包地址绕过资源代理；此清单也兼容已安装的旧客户端。未配置代理时，标准 GitHub 下载地址可正常跟随 CDN 跳转；客户端同时兼容旧清单中 `api.github.com` 的直连下载跳转。旧清单中的 API 地址仍不走资源代理，要让无法直连 GitHub API 的环境更新，须提供上述标准下载地址的清单。

检查更新后修改或清空代理，从「更新到 Vxxx」发起下载时即采用最新设置，不需要重新获取清单；原始下载地址不会被代理前缀覆盖。每次下载持有独立资源，失败或取消后释放该次下载数据，缓存版本仍可重试。Runtime 整组 DLL 在任务启动时读取一次设置，运行中的整组下载使用同一配置。

发现软件新版本后，更新确认弹窗显示目标版本、当前版本与更新说明；长说明独立滚动，底部按钮始终可见。「稍后」、关闭按钮和 Esc 只关闭弹窗，不启动下载。本次运行期间可从「检查更新」下方的「更新到 Vxxx」重新打开缓存的弹窗，无需再次检查。检查失败、下载失败或取消不清除已发现的版本；退出软件后缓存清除。点击「立即更新」进入操作进度卡片中的下载和安装流程，安装后重启；下载期间取消沿用原语义，等待当前传输结束后放弃安装。

宿主设置命令仅供桌面前端调用，经 `src/lib/tauri-api.ts` 封装；不向 MCP HTTP、插件或 Lua 开放，不改变标注、项目配置、插件权限与任何插件版本面。

更新日志支持 Markdown 标题、有序/无序列表、粗体、行内代码及段落换行。链接与 HTML 保留为不可执行的原文，不加载外部图片；此处不是完整 Markdown 浏览器。

验证用例：`src/hooks/useAppUpdate.test.tsx`、`src/components/settings/GitHubProxySettings.test.tsx`、`src/lib/updater.test.ts`、`src-tauri/src/app_update/tests.rs`、`src-tauri/src/github_proxy/` 的测试以及 Runtime/模型下载测试。`scripts/normalize-update-manifest.test.ts` 覆盖发布清单的全部平台地址转换、签名保留、版本与资源匹配，以及 CLI 失败时保留原文件。HTTP 测试使用回环服务器，更新器测试通过测试公钥验证固定签名样本，并拒绝被篡改的数据；不安装测试样本，不依赖真实 GitHub 服务。签名样本由 `.gitattributes` 固定原始字节，测试私钥不入库。Windows 测试程序嵌入 Common Controls v6 依赖清单，确保 Tauri 模拟应用能在测试入口之前正常加载。
