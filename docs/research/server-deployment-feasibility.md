# 需求 1 可行性研究：去 Tauri 化 —— 单租户局域网服务器模式

- **状态**：研究笔记（不构成架构决策；决策应另立 ADR）
- **日期**：2026-09-21
- **读者**：本仓库架构决策者
- **要回答的三个问题**：是否需要 HostBridge 抽象层？能否复用现有 Rust 命令层？Docker 交付形态是否可行？
- **方法**：只采信一手来源（官方文档、规范原文、上游仓库源码 / issue）。每条结论后附 URL；无法验证的点集中列在第 9 节，不得当作结论使用。
- **本轮未做**：未跑构建 / 测试 / lint / 格式化，未做实验，未修改除本文件以外的任何文件。

引用约定：`[一手]` = 官方文档或规范正文；`[源码]` = 上游仓库源码（含本仓库）；`[INFERENCE]` = 由一手材料推导、但无直接表述的推断。

---

## 0. 已核对的仓库现状（后文各节的落点）

| 事实 | 位置 |
| --- | --- |
| 前端后端调用的唯一出口 | `src/lib/tauri-api.ts` |
| 非测试文件中直接 `import "@tauri-apps/*"` 的只有 3 个 | `src/lib/tauri-api.ts`、`src/lib/updater.ts`、`src/hooks/useAppUpdate.ts`（类型） |
| Rust 侧注册 **55** 个 `#[tauri::command]` | `src-tauri/src/lib.rs:20-76` |
| 项目文档是**单个 JSON 文件** `my-label-tool.project.json`，整文件覆盖写（无版本检查 / 无锁 / 非原子替换） | `src/lib/importers.ts:17`、`src-tauri/src/commands/mod.rs:57-60` |
| 图片经 `convertFileSrc` → `asset:` 协议暴露；`assetProtocol.scope = ["**"]`、`csp: null` | `src/lib/tauri-api.ts:137-139`、`src-tauri/tauri.conf.json` |
| 进度回调用 `tauri::ipc::Channel<T>`（6 个命令） | `src-tauri/src/commands/plugin.rs:101,134`、`prelabel_conversion.rs:36`、`prelabel_inference.rs:26`、`prelabel_model.rs:21`、`prelabel_runtime.rs:37` |
| 插件隔离用 AppContainer（Windows） | `src-tauri/src/process_control/app_container.rs` |
| 预打标用 `ort` 动态加载 onnxruntime + DirectML EP | `src-tauri/Cargo.toml`、`src-tauri/src/media/prelabel/inference.rs:69` |
| 图片删除走 Windows 回收站 | `src-tauri/src/media/image_recycle_windows.rs` |

---

## 1. Tauri 2 是否存在受支持的 headless / server 模式

**结论**：**没有。** Tauri 2 不存在官方支持的「无窗口、无 webview」运行方式：窗口可以「不显示」，但窗口系统（tao/GTK）与事件循环仍必须存在，官方的 headless 做法是在假显示（`xvfb-run`）下跑正常 GUI 程序。`tauri::command` / `tauri::State` / `tauri::Channel` / `Manager::emit` 这四类 API 全部以 webview 为唯一接收端，脱离 webview 后没有可用传输层；Tauri **没有**内置的「命令 HTTP 服务器」。`tauri::webview::InvokeRequest` 与 `Context::new` 虽然公开存在，但被官方文档明确标注为**非稳定 API**。
**对架构的含义**：命令层的 Rust 业务逻辑可以整体复用，但必须由新的 HTTP 层驱动，而不是由 Tauri IPC 驱动 —— 这正是 HostBridge 抽象层存在的理由。

**证据**

1. wry（Tauri 的 webview 层）明确要求事件循环与窗口句柄 `[一手]`：
   > "The webview requires a running event loop and a window type that implements [`HasWindowHandle`], or a gtk container widget if you need to support X11 and Wayland."
   — https://docs.rs/wry/latest/wry/

2. 官方 v2 文档把「headless」定义为「假显示下跑正常程序」`[一手]`：
   > "we run it through `xvfb-run` (the dependency we installed earlier) to have a fake display server which allows our application to run headless without any changes to the code"
   — https://v2.tauri.app/develop/tests/webdriver/ci/

3. 「不显示窗口」≠ headless，维护者原话 `[一手]`：
   > "Not spawning a window just comes down to not defining one in tauri.conf.json, but you'll have to explicitly keep the event loop running in rust so that the app doesn't exit"
   — https://github.com/orgs/tauri-apps/discussions/7051

4. 「Headless Tauri」issue 被以 **windowless** 结案，提问者总结 `[一手]`：
   > "So, no, theres no Headless Tauri, just some \"windowless\" Tauri..."
   — https://github.com/tauri-apps/tauri/issues/1061

5. 构建 / 运行入口只有 `Context` 版本，无「无窗口」变体 `[一手]`：
   - `Builder::build(Self, context: Context<R>) -> crate::Result<App<R>>`、`Builder::run(Self, context: Context<R>) -> crate::Result<()>` — https://docs.rs/tauri/latest/tauri/struct.Builder.html
   - `App::run` / `run_return` / `run_iteration`（`run_iteration` 可单步跑事件循环，但仍需 runtime） — https://docs.rs/tauri/latest/tauri/struct.App.html
   - `Runtime::new`：「Creates a new webview runtime. Must be used on the main thread.」 — https://docs.rs/tauri-runtime/latest/tauri_runtime/trait.Runtime.html

6. `Context` 只能由 `generate_context!` 正规产出，手工构造属于不稳定 API `[一手]`：
   > "This is the output of the [`generate_context`] macro, and is not considered part of the stable API. Unless you know what you are doing and are prepared for this type to have breaking changes, do not create it yourself."
   — https://docs.rs/tauri/latest/tauri/struct.Context.html
   （`Context::new(config, assets, ...)` 签名公开存在，但落在同一段 stability 警告之下；`generate_context!` 有同样的 warning — https://docs.rs/tauri/latest/tauri/macro.generate_context.html）

7. 各类 API 对 webview 的依赖 `[一手]`：
   - `tauri::ipc` 模块自述：「Types and functions related to Inter Procedure Call(IPC). **This module includes utilities to send messages to the JS layer of the webview.**」 — https://docs.rs/tauri/latest/tauri/ipc/index.html
   - `Channel::send` 的实现就是向 webview 注入 JS（`webview.eval(...)` 与一次 `window.__TAURI_INTERNALS__.invoke(FETCH_CHANNEL_DATA_COMMAND, ...)`）`[源码]` — https://docs.rs/tauri/2.11.6/src/tauri/ipc/channel.rs.html
   - `State`：`impl CommandArg`，只能从命令调用中取得 — https://docs.rs/tauri/latest/tauri/struct.State.html
   - `Emitter::emit`：「Emits an event to all [targets](EventTarget).」而 target 是 window / webview 实体 — https://docs.rs/tauri/latest/tauri/trait.Emitter.html
   - `#[tauri::command]` 宏输出同样标注「managed internally by Tauri ... may have breaking changes」 — https://docs.rs/tauri/latest/tauri/attr.command.html

8. **本仓库已有一手证据表明 `Channel` 可脱离 webview 构造**（但**不**代表可脱离 webview 送达）：`Channel::new(on_message: F) -> Self`，仓库自己的测试用 `tauri::ipc::Channel::new(|_message| Ok(()))` 构造空通道 `[源码]` — `src-tauri/src/media/prelabel/model_download.rs:348,381`。
   实测 API 形状（docs.rs）：`new` / `id() -> u32` / `send(data) -> crate::Result<()>` — https://docs.rs/tauri/latest/tauri/ipc/struct.Channel.html
   工程含义：`Channel` 类型可以保留在命令签名里不动，只要 HostBridge 换掉 `on_event` 的消费者；但默认送达路径必须被替换。

9. `Builder::channel_interceptor` 存在，文档描述为「Registers a channel interceptor that can **overwrite the default channel implementation**」`[一手]` — https://docs.rs/tauri/latest/tauri/struct.Builder.html
   工程含义：这是官方留出的、把 Channel 送达改接到别处（例如 SSE / WebSocket）的挂点。**其稳定性未在文档声明，也不在 capability 体系内**，需实测（见第 9 节）。

10. 「用外部传输驱动 invoke」在 API 层面可达，但明确不稳定 `[一手]`：
    > "The IPC invoke request. # Stability This struct is **NOT** part of the public stable API and is only meant to be used by internal code and external testing/fuzzing tools or **custom invoke systems**."
    — https://docs.rs/tauri/latest/tauri/webview/struct.InvokeRequest.html
    配套 `App::invoke_key()`：「Gets the invoke key that must be referenced when using [`crate::webview::InvokeRequest`]」 — https://docs.rs/tauri/latest/tauri/struct.App.html
    `tauri::ipc::Invoke`：「This struct is used internally by macros and is explicitly **NOT** stable.」 — https://docs.rs/tauri/latest/tauri/ipc/struct.Invoke.html

11. Tauri 没有命令 HTTP 服务器；唯一的 localhost 插件只服务**静态资源** `[一手]`：
    > "Expose your app's assets through a localhost server instead of the default custom protocol."
    — https://v2.tauri.app/plugin/localhost/

12. 维护者对「把 Tauri 当服务器」的立场（GitHub discussion，非正式文档）`[一手]`：
    > "Tauri is defenitely not designed to be some kind of server and any of the assets and invoke calls can not be accessed from anywhere outside of the webview ... unless of course you want them all to open the frontend in a browser at what point **a dedicated server would for sure be a better choice**."
    — https://github.com/orgs/tauri-apps/discussions/7857
    「build for the web」被列为远景：维护者称「more like v4 or v5 if ever」 — https://github.com/tauri-apps/tauri/issues/8248

---

## 2. 桌面专属设施在浏览器客户端的替代

**结论**：五类设施里**四类有标准 Web 等价物**，都能用「HTTP 端点 + 规范条文」精确表达；唯独 `plugin-updater` 与 `plugin-process` 属于**桌面进程控制**，浏览器侧没有等价物 —— 它们对应的动作（自我更新、重启进程）迁移后被部署编排承担，浏览器端只剩「刷新页面」。整体判断：前端需要替换的只有 **5 个调用点**，且已集中在 `src/lib/tauri-api.ts` 与 `src/lib/updater.ts`。

### 2.1 asset 协议 → 带 Range 的 HTTP 文件端点

- Tauri 侧 `[一手]`：
  > "Convert a device file path to a URL that can be loaded by the webview. The asset protocol must be enabled and the files you want to expose must be included in its scope. The protocol origins must also be allowed by the relevant app.security.csp directive."
  — https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc
  > "You must set `enable` to `true` and define a `scope` that lists which filesystem paths may be exposed. Paths resolved at runtime must match that scope, or the WebView will refuse the load"
  — https://v2.tauri.app/security/asset-protocol/
- Web 侧等价物：`GET /files/{id}` 返回字节流，配 `Content-Type`（RFC 9110 §8.3）、`Accept-Ranges: bytes`（§14.3）、`Range` → `206 Partial Content` + `Content-Range`（§14.2 / §14.4 / §15.3.7）。小节号与原文见第 3 节。
- 本仓库落点：`src/lib/tauri-api.ts:137` 的 `imageFileSrc()` 是唯一出口，换成 `/files/...` 即可；`src/lib/app-utils.ts:33` 的 `loadImageSize()` 用 `<img src>`，天然兼容。

### 2.2 `Channel<T>` → SSE（或 WebSocket）

- Tauri 侧 `[一手]`：
  > "Channels are designed to be fast and deliver ordered data. They are used internally for streaming operations such as download progress, child process output and WebSocket messages."
  > "The event system is not designed for low latency or high throughput situations."
  — https://v2.tauri.app/develop/calling-frontend/#channels
- Web 侧等价物（择一）：
  - **SSE**（单向、有序、文本）：`EventSource` + `text/event-stream`；规范明确「Event streams are always decoded as UTF-8.」并定义 `Last-Event-ID` 用于断线续传 — https://html.spec.whatwg.org/multipage/server-sent-events.html
  - **WebSocket**（双向或需二进制）：RFC 6455，数据帧 opcode 0x1(Text) / 0x2(Binary) — https://www.rfc-editor.org/rfc/rfc6455
- 选型依据：本仓库 6 个 Channel 用途全是**单向进度**（`PluginExportEvent`、`PluginPrelabelEvent`、`ModelDownloadEvent`、`RuntimeDownloadEvent`、`PrelabelProgressEvent`、`PtConversionEvent`），事件体为 JSON `[源码]` —— SSE 足够，不需要 WebSocket。唯一待确认项：事件体是否含二进制（当前均为 `serde_json::Value` 或结构体，未见二进制）。

### 2.3 `plugin-dialog` open/save → 上传 / 服务端目录白名单

- Tauri 侧返回**真实文件系统路径**，Rust 侧随后直接读 `[一手]`：
  > "const file = await open({ multiple: false, directory: false }); console.log(file); // Prints file path or URI"
  — https://v2.tauri.app/plugin/dialog/
- Web 侧：`<input type="file">` 只给出字节 + 被 `fakepath` 混淆的名字（规范原文：「This "fakepath" requirement is a sad accident of history.」）`[一手]` — https://html.spec.whatwg.org/multipage/input.html#file-upload-state-(type=file)；或 File System Access API（需瞬态激活，否则抛 `SecurityError`）`[一手]` — https://wicg.github.io/file-system-access/
- **迁移要点（语义变化最大的一处）**：桌面上「选一个目录 → 得到绝对路径 → Rust 扫描该目录」的模型在浏览器里不可行，必须改成「服务端持有项目根目录 → 浏览器从服务端列举受白名单约束的子路径 → 或上传文件字节」。仓库现有的 `%PROJECT%` / `%MODELS%` / `%APP_DATA%` 占位符权限模型（`src-tauri/src/plugins/permissions.rs:809-890`）已经是「服务端路径白名单」的雏形，可直接升级为服务端目录浏览的授权根。

### 2.4 `plugin-updater` → 无等价物（服务端重新部署）

- Tauri 侧下载并就地应用**签名安装包**，且签名校验不可关闭 `[一手]`：
  > "Tauri's updater needs a signature to verify that the update is from a trusted source. **This cannot be disabled.**"
  — https://v2.tauri.app/plugin/updater/
- Web 侧：浏览器页面没有自我更新机制；页面自身资源刷新最多由 Service Worker 的 `update()` / `updateViaCache` 算法驱动 `[一手]` — https://w3c.github.io/ServiceWorker/#service-worker-registration-update。**注意这是 [INFERENCE]（规范未明写「页面不能自我更新」）。**
- 服务端替换：容器重启策略 `restart: no|always|on-failure|unless-stopped` — https://docs.docker.com/reference/compose-file/services/#restart
- 本仓库旁证：`updater` 是唯一被 `#[cfg(desktop)]` 包住的插件（`src-tauri/src/lib.rs:14-16`），代码里已承认它是桌面专属 `[源码]`。

### 2.5 `plugin-process` relaunch → 编排器重启 / `location.reload()`

- Tauri 侧 `[一手]`：「await exit(0); // exits the app with the given status code ... await relaunch(); // restarts the app」 — https://v2.tauri.app/plugin/process/
- Web 侧：页面的 `location.reload()` — https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-reload；进程重启交给 Docker：「Docker provides restart policies to control whether your containers start automatically when they exit」 — https://docs.docker.com/engine/containers/start-containers-automatically/

### 2.6 汇总

| 桌面设施 | Tauri 官方文档 | Web 等价物 | 服务端需要新增 |
| --- | --- | --- | --- |
| asset 协议 / `convertFileSrc` | https://v2.tauri.app/security/asset-protocol/ | HTTP 文件端点 + Range（RFC 9110 §14.2/§14.4/§15.3.7） | 按用户 / 项目授权的文件路由 |
| `Channel<T>` | https://v2.tauri.app/develop/calling-frontend/#channels | SSE（WHATWG HTML）或 WebSocket（RFC 6455） | 事件汇（task id → 订阅者） |
| `plugin-dialog` | https://v2.tauri.app/plugin/dialog/ | `<input type=file>` / File System Access API | 目录列举白名单端点 |
| `plugin-updater` | https://v2.tauri.app/plugin/updater/ | 无（服务端重新部署） | 部署流程 |
| `plugin-process` | https://v2.tauri.app/plugin/process/ | `location.reload()` | 编排器重启策略 |

---

## 3. 本地图片经 HTTP 提供给浏览器

**结论**：**可行，且工作量不大** —— 因为 Tauri 的 asset 协议**本身就是按 HTTP 语义实现的**：上游 `crates/tauri/src/protocol/asset.rs` 已实现 `Accept-Ranges`、单范围 `206` + `Content-Range`、多范围 `multipart/byteranges`，越界路径返回 `403`。换成真正的 HTTP 端点，等于把同一套语义从「进程内自定义协议处理器」搬到网络栈上。**唯一必须重新设计的是授权**：Tauri 的 `scope` 是应用内的静态 glob 白名单，而服务器面对多个互不信任的浏览器用户，需要按用户/项目授权，而不是全局 `**`（本仓库当前正是 `scope: ["**"]`）。

**证据**

1. Tauri 的 scope 是**应用内**白名单，不是网络 ACL `[一手]`：
   > "Whether a path is allowed is controlled by `app.security.assetProtocol` in `tauri.conf.json`. You must set `enable` to `true` and define a `scope` that lists which filesystem paths may be exposed."
   > "`deny` takes precedence over `allow` when both match."
   — https://v2.tauri.app/security/asset-protocol/
   默认值 `enable: false` / `scope: []`：「The access scope for the asset protocol. **Default**: `[]`」 — https://v2.tauri.app/reference/config/#assetprotocolconfig
   越界时的上游实现 `[源码]`：
   ```rust
   if !scope.is_allowed(&path) {
     log::error!("asset protocol not configured to allow the path: {path}");
     return resp.status(403).body(Vec::new().into())...
   }
   ```
   — https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/protocol/asset.rs
   该处理器通过 `register_uri_scheme_protocol("asset", ...)` 注册在 webview 上（进程内回调），无监听端口 `[源码]` — 同上文件与 https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/manager/webview.rs

2. **既有 Range 实现可直接照抄语义**（上游 `asset.rs`）`[源码]`：对 range 请求总是回 `Accept-Ranges: bytes`；单范围回 `206 Partial Content` + `Content-Range: bytes start-end/len`；多范围才回 `multipart/byteranges`；单次上限 `const MAX_LEN: u64 = 1000 * 1024;`
   — https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri/src/protocol/asset.rs

3. RFC 9110 权威小节（已直接核对 RFC 正文标题）`[一手]`：
   - `14.1. Range Units`、`14.1.1. Range Specifiers`、`14.1.2. Byte Ranges`
   - `14.2. Range`：「The "Range" header field on a GET request modifies the method semantics to request transfer of only one or more subranges of the selected representation data」；同节明确「A server MAY ignore the Range header field.」与「For this specification, GET is the only method for which range handling is defined.」
   - `14.3. Accept-Ranges`：「indicates whether an upstream server supports range requests for the target resource」
   - `14.4. Content-Range`：「sent in a single part 206 (Partial Content) response to indicate the partial range of the selected representation enclosed as the message content」
   - `15.3.7. 206 Partial Content`
   - `14.6. Media Type multipart/byteranges`
   — https://www.rfc-editor.org/rfc/rfc9110.txt ；HTML 锚点 https://www.rfc-editor.org/rfc/rfc9110.html#section-14.2 、#section-14.3 、#section-14.4 、#section-15.3.7 、#section-14.6
   历史规范 RFC 7233（小节号不同：3.1 Range / 2.3 Accept-Ranges / 4.2 Content-Range）— https://www.rfc-editor.org/rfc/rfc7233.txt

4. 为什么「单范围 206」是最小实现 `[一手]`：§15.3.7.1 只要求一个 `Content-Range` 头 + 范围字节，其官方示例本身就是局部图片：
   > "HTTP/1.1 206 Partial Content ... Content-Range: bytes 21010-47021/47022 ... Content-Type: image/gif"
   不需要 boundary 框架、不需要 multipart 解析器。多范围才有强制要求（§15.3.7.2）：
   > "If multiple parts are being transferred, the server generating the 206 response MUST generate "multipart/byteranges" content ... a server MUST NOT generate a Content-Range header field in the HTTP header section of a multiple part response"
   且客户端若无法处理多范围则不得请求它（§14.6）：「A client that cannot process a "multipart/byteranges" response MUST NOT generate a request that asks for multiple ranges.」

5. 附带耦合（与第 7 节相关）`[一手]`：Range 与 `If-Range` 要求**强校验器** —— §8.8.1「Strong validators are usable for all conditional requests, including cache validation, partial content ranges, and "lost update" avoidance. Weak validators are only usable when the client does not require exact equality」；§13.1.5「A client MUST NOT generate an If-Range header field containing an entity tag that is marked as weak.」

---

## 4. ONNX Runtime 在 Linux x64 容器内的可用性

**结论**：**可用，但只能走 CPU（或 CUDA / OpenVINO 等）**；**DirectML 在 Linux 上不存在** —— 官方把它直接标为 "Windows - DirectML"、基于 DirectX 12、构建需要 Visual Studio 工具链 + Windows 10 SDK，上游 Linux 发布物里没有 DirectML 变体。对本仓库而言这是**部署与打包改动，不是算法重写**：`ort` 已用 `load-dynamic`（`ort::init_from(path)`），Linux 上同一 API 加载 `libonnxruntime.so`；EP 是会话级配置，且 `Auto` 策略**本来就带 CPU 回退**（`inference.rs:51-58`），GPU 不可用时行为已经是「静默回退 CPU」。

**证据**

1. EP 总览 `[一手]`（注意该表**不标注操作系统**，需逐个 EP 页面确认）：CPU 列 = Default CPU / Intel DNNL / TVM(preview) / Intel OpenVINO / XNNPACK / AMD ROCm(deprecated)；GPU 列 = NVIDIA CUDA / NVIDIA TensorRT / **DirectML** / AMD MIGraphX / Intel OpenVINO / Qualcomm QNN / WebGPU。
   > "ONNX Runtime works with different hardware acceleration libraries through its extensible Execution Providers (EP) framework to optimally execute the ONNX models on the hardware platform."
   — https://onnxruntime.ai/docs/execution-providers/

2. DirectML 是 Windows 专属（多重一手确认）`[一手]`：
   > 页面标题：「Windows - DirectML」
   > "DirectML is a high-performance, hardware-accelerated DirectX 12 library for machine learning **on Windows**."
   > "The DirectML execution provider requires a **DirectX 12 capable device**."
   > "Requirements for building the DirectML execution provider: 1. Visual Studio 2017 toolchain 2. The Windows 10 SDK"
   > "**Note: DirectML is in sustained engineering.** ... new feature development has moved to WinML"
   — https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html
   C API 入门页产物表把 `Microsoft.ML.OnnxRuntime.DirectML` 的平台写作 **"Windows 10 1709+"** — https://onnxruntime.ai/docs/get-started/with-c.html
   上游 v1.30.0 发布物只有 `onnxruntime-linux-x64-*.tgz` / `-aarch64` / `-x64-gpu_cuda12` / `-x64-gpu_cuda13`，**无任何 Linux DirectML 包** — https://github.com/microsoft/onnxruntime/releases/tag/v1.30.0

3. Linux x64 有**官方上游**构建（不只是社区）`[一手]`：
   > "Linux * Tested with CentOS 7 * Should be compatible with distributions supported by .NET Core"；编译器基线 "Linux: gcc>=4.8"
   — https://onnxruntime.ai/docs/reference/compatibility.html
   发布物 `onnxruntime-linux-x64-<ver>.tgz`，取 `include/` 头 + `libonnxruntime.so` — https://onnxruntime.ai/docs/get-started/with-c.html
   Python 官方轮子 `pip install onnxruntime` / `onnxruntime-gpu`（默认 CUDA 12.x） — https://onnxruntime.ai/docs/install/
   容器相关约束：**"All builds require the English language package with `en_US.UTF-8` locale"** — 同上（基础镜像必须设置 locale）。

4. `ort` crate 的二进制获取方式（三种，均为一手文档）`[一手]` — https://ort.pyke.io/setup/linking
   - 默认 `download-binaries`：从 pyke CDN 下载预构建静态库
   - 静态链接自建库：`ORT_LIB_PATH` / `ORT_LIB_PROFILE`
   - 动态链接：`load-dynamic`（运行时 dlopen）或编译期动态链接 `ORT_PREFER_DYNAMIC_LINK=1`
   运行时路径由 `ort::init_from(dylib_path)` 或环境变量 `ORT_DYLIB_PATH` 指定，跨平台文件名不同：
   > "// - on Windows: C:\Program Files\...\onnxruntime.dll // - on Linux: /etc/.../libonnxruntime.so // - on macOS: /.../libonnxruntime.dylib"
   `init_from` 文档：「dynamically loading ONNX Runtime from the library file (`.dll`/`.so`/`.dylib`)」 — https://docs.rs/ort/latest/ort/
   预构建二进制覆盖 Linux x86-64（x86-64-v3 基线，Clang + libc++ 编译），且 **DirectML 只在 Windows 构建里**：
   > "All Windows builds come with the DirectML EP enabled."
   — https://ort.pyke.io/misc/prebuilt-binaries
   本仓库现状：`load-dynamic` + `ort::init_from(dll_path)` `[源码]` — `src-tauri/Cargo.toml`、`src-tauri/src/media/prelabel/runtime.rs:153-178`

5. EP 是**会话级**注册、按优先级回退，切 EP 只改会话配置 `[一手]`：
   > "Registering predefined providers and set the priority order. ... The order of registration indicates the preference order as well."（C API）
   — https://onnxruntime.ai/docs/get-started/with-c.html
   > "ort will register all EPs specified, in order. If an EP does not support a certain operator in a graph, it will fall back to the next successfully registered EP, or to the CPU if all else fails."
   — https://ort.pyke.io/perf/execution-providers
   `ort::ep::DirectML` 文档描述为「for DirectX 12-enabled hardware on Windows」，且是**普通类型、非 `cfg` 门控** — https://docs.rs/ort/latest/ort/ep/struct.DirectML.html
   本仓库对应代码 `inference.rs:69` 没有 `#[cfg(windows)]` 门控（见第 8.4 节），因此 Linux 构建会编译通过、但 DML 注册会在运行期失败 —— **恰好落入已有的 `DmlPolicy::Fallback` / `Auto` 回退分支**。
   仅当代码用到 DirectML 专属 API（`ep::directml::DMLSessionBuilderExt` / `resource_from_d3d` / `OrtDmlApi`）才是真正的代码级依赖 — https://docs.rs/ort/latest/ort/ep/directml/index.html
   **额外风险**：DirectML EP 不支持同一 session 上多线程 `Run`：
   > "as the DirectML execution provider does not support parallel execution, it does not support multi-threaded calls to `Run` on the same inference session"
   — https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html （对「多人在服务器上同时预打标」需单独设计并发模型，见第 9 节）

---

## 5. Docker 内的 ffmpeg 抽帧

**结论**：技术路径清晰（基础镜像 `apt-get install ffmpeg`，或使用第三方 ffmpeg 镜像），但 **FFmpeg 项目自己只发布源码，没有官方 Docker 镜像** —— 所有现成镜像都是第三方。许可方面：FFmpeg 默认 LGPL-2.1+，一旦启用 GPL 组件（`--enable-gpl`）则**整个 FFmpeg 变成 GPL**；Debian 的默认 ffmpeg 包官方自述即为 **GPL v2+**，而 GPLv2 §3 要求以目标码形式分发时须同时提供对应源码（或以书面承诺 / 随附信息替代）。本仓库是**进程调用** ffmpeg（不链接 libav\*），且打包脚本已随附 `LICENSE-FFmpeg.txt`；但「仅调用可执行文件」场景的具体义务与 FFmpeg 官方那份**面向 LGPL 链接**的清单并不一一对应，需法务确认（见第 9 节）。

**证据**

1. 官方只有源码 `[一手]`：
   > "**FFmpeg only provides source code.** Below are some links that provide it already compiled and ready to go."
   Linux 渠道被列为 Debian / Ubuntu / Fedora & RHEL(RPMFusion) 的发行版包，以及第三方静态构建（BtbN 的 GitHub Builds）；Windows 为 gyan.dev / BtbN。
   — https://ffmpeg.org/download.html

2. 第三方镜像示例（**不是** FFmpeg 官方）`[一手]`：
   > "Unlike most of our container library this image is meant to be run **ephemerally** from the command line parsing user input for a custom FFmpeg command."
   支持 amd64/arm64；官方示例直接使用 `-c:v libx264`（即启用 GPL 组件）
   — https://docs.linuxserver.io/images/docker-ffmpeg/
   **判断**：`linuxserver/ffmpeg` 定位是「一次性 CLI 调用」，与服务器「常驻进程反复抽帧」的用法不同；**更推荐在自有镜像里安装发行版 ffmpeg 包**。

3. 抽帧参数（FFmpeg 官方手册源文档）`[一手]`：
   - `-ss`（输入/输出选项）：「When used as an input option (before `-i`), seeks in this input file to `position`. ... `ffmpeg` will seek to the closest seek point before `position`.」 — https://ffmpeg.org/ffmpeg.html
   - `-frames:v`：`-vframes` 是「an **obsolete alias** for `-frames:v`, which you should use instead」
   - `fps` 滤镜：「Convert the video to specified constant frame rate by duplicating or dropping frames as necessary.」 — https://ffmpeg.org/ffmpeg-filters.html
   - `select` 滤镜：「Select frames to pass in output.」
   > **顺手的清理项**：本仓库当前用 `-ss` + 抽帧间隔逻辑（`src-tauri/src/media/video.rs`）；迁移时值得统一到 `-frames:v`。

4. 许可 `[一手]`：
   > "FFmpeg is licensed under the GNU Lesser General Public License (LGPL) version 2.1 or later. However, FFmpeg incorporates several optional parts and optimizations that are covered by the GNU General Public License (GPL) version 2 or later. **If those parts get used the GPL applies to all of FFmpeg.**"
   > "Note that FFmpeg is not available under any other licensing terms, especially not proprietary/commercial ones, not even in exchange for payment."
   合规清单第 1、2、18 条（面向 **LGPL 链接**场景）：「Compile FFmpeg **without** `--enable-gpl`」「Use dynamic linking ... for linking with FFmpeg libraries」「Make sure your program is not using any GPL libraries (notably libx264)」。
   — https://ffmpeg.org/legal.html

5. 发行版包的许可事实（Debian 一手）`[一手]`：
   > "For building the default Debian packages some of the GPL licensed files are used, so the resulting binaries are licensed under **GPL v2+**."
   — https://sources.debian.org/data/main/f/ffmpeg/7%3A9.0.2-1/debian/copyright
   对应构建参数（同版本）`[源码]`：
   ```
   # Most possible features, compatible with effective licensing of GPLv2+
   CONFIG := \
       ...
       --enable-gpl \
   ```
   — https://sources.debian.org/data/main/f/ffmpeg/7%3A9.0.2-1/debian/rules
   推论 `[INFERENCE]`：以 Debian/Ubuntu 基础镜像分发含 ffmpeg 的 Docker 镜像 = 分发 GPL 二进制，须满足 GPLv2 §3。

6. GPLv2 §3 对二进制分发的要求（要点）`[一手]`：以目标码 / 可执行形式分发时，须同时 (a) 附上完整对应源码，或 (b) 附上至少三年有效的书面承诺，或 (c) 附上你收到的关于源码分发承诺的信息（**仅限非商业分发**）。
   — https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

7. 本仓库现状 `[源码]`：ffmpeg/ffprobe 作为**外部进程**调用，路径来自 `resource_dir/video-tools/`（`src-tauri/src/media/video.rs:67-84`）；Windows 打包脚本 `scripts/prepare-video-tools.ps1` 复制二进制并强制要求随附 `LICENSE`（`if (-not (Test-Path -LiteralPath $license)) { throw ... }`），另生成 `checksums.json`。
   → 迁移到 Linux 容器时「随附许可文件 + 校验和」的既有做法可以保留（例如把 ffmpeg 的 `copyright` 与源码链接打进镜像）。

---

## 6. 同类工具的服务器形态先例

**结论**：三个产品都收敛到同一形态 —— **一个 HTTP API 进程 + 边缘反代（nginx / traefik）+ 关系型数据库 + 对象存储**，并且都为「桌面应用免费获得的能力」补了**两层显式设施**：**后台任务层**（CVAT：每个域一个 RQ worker 容器；Label Studio：RQ low/default/high/critical；Xtreme1：Redis Streams 消费者组跑在 JVM 内）与**共享/授权层**（CVAT：organization + 角色 + OPA；Label Studio：工作区 / RBAC **仅企业版**；Xtreme1：**完全没有**）。许可证都允许参考其设计：MIT（CVAT）、Apache-2.0（Label Studio、Xtreme1），**没有 AGPL**。

### 6.1 Label Studio（Apache-2.0）

- 后端 Django + DRF（uWSGI/nginx），依赖里已含 `django-rq` / `rq` / `redis` / `psycopg` `[源码]` — https://raw.githubusercontent.com/HumanSignal/label-studio/develop/pyproject.toml
- 官方镜像 `heartexlabs/label-studio`；官方 compose 只有 3 个服务：nginx、app(`label-studio-uwsgi`)、db(PostgreSQL 17) `[源码]` — https://raw.githubusercontent.com/HumanSignal/label-studio/develop/docker-compose.yml
- 存储：默认单文件 SQLite，规模化换 PostgreSQL（**单库共享，无 per-project 库**）`[一手]`：
  > "Label Studio uses SQLite by default." / "If you want to label more than 100,000 tasks with 5 or more concurrent users, consider using PostgreSQL"
  — https://labelstud.io/guide/storedata
- **用户隔离** `[一手]`：
  > "In Label Studio Community Edition, all users have access to the same functionality and **can see all projects**."
  — https://labelstud.io/guide/signup
  工作区 / RBAC / 项目成员 / 任务指派在对比表中对 Community 全部标 ❌ — https://labelstud.io/guide/label_studio_compare
  → **对「单租户局域网、多人同一份项目」这一需求，Community 的扁平模型恰好就是所需形态**，不需要额外做租户隔离。
- 后台任务 `[源码]`：
  > "Start job async with redis or sync if redis is not connected."（`label_studio/core/redis.py`）
  — https://raw.githubusercontent.com/HumanSignal/label-studio/develop/label_studio/core/redis.py
  批量导入显式入 `high` 队列 — https://raw.githubusercontent.com/HumanSignal/label-studio/develop/label_studio/data_import/api.py
  Enterprise 用 4 个队列、`default` 队列 4 副本 — https://docs.humansignal.com/guide/install_enterprise_k8s
- 并发建议（运营性而非事务性）：每个项目约 10 万任务、导入间隔 ≥30 秒 — https://labelstud.io/guide/tasks
- 许可：Apache-2.0 — https://raw.githubusercontent.com/HumanSignal/label-studio/develop/LICENSE

### 6.2 CVAT（MIT）

- 后端 Django 5.2 + DRF + django-rq + allauth/LDAP；前端 React 18 SPA，用 nginx 镜像托管静态资源 `[源码]` — https://raw.githubusercontent.com/cvat-ai/cvat/develop/cvat/requirements/base.txt、https://raw.githubusercontent.com/cvat-ai/cvat/develop/Dockerfile.ui
- 部署：单条 `docker compose up -d`；顶层 compose 服务为 `cvat_db(postgres:15)`、`cvat_redis_inmem`、`cvat_redis_ondisk(kvrocks)`、`cvat_server`、**8 个** `cvat_worker_*`、`cvat_ui`、`traefik:v3.6`(8080)、`cvat_opa`、`cvat_clickhouse`、`cvat_vector`、`cvat_grafana` `[源码]` — https://raw.githubusercontent.com/cvat-ai/cvat/develop/docker-compose.yml
  （补充：仓库**没有** `docker-compose/` 目录；可选叠加是根目录的 `docker-compose.dev.yml` / `.https.yml` / `.external_db.yml` / `.ci.yml`。）
- 队列：`CVAT_QUEUES` 列到 import/export/annotation/webhooks/notifications/quality_reports/cleaning/chunks/consensus，逐队列 RQ 超时 25s–24h；每用户并发限制开关 `ONE_RUNNING_JOB_IN_QUEUE_PER_USER` `[源码]` — https://raw.githubusercontent.com/cvat-ai/cvat/develop/cvat/settings/base.py
- **多人协作同一任务**：organization + 角色（Owner/Maintainer/Supervisor/Worker）+ 任务拆成 job 并带 Assignee/Stage（标注/验证/验收）；自托管可用 `.rego` 替换角色规则 `[一手]`：
  > "**Organization** is a feature for teams of several users who work together on projects and share tasks."
  — https://docs.cvat.ai/docs/account_management/organization/、https://docs.cvat.ai/docs/account_management/user-roles/
- 许可：MIT — https://raw.githubusercontent.com/cvat-ai/cvat/develop/LICENSE

### 6.3 Xtreme1（Apache-2.0，LF AI & Data）

- 后端 Spring Boot 2.6.6 / Java 11（Spring Security + Spring Data Redis + MyBatis-Plus），前端 Vue 3 + TS + Vite（**不是 React**）`[源码]` — https://raw.githubusercontent.com/xtreme1-io/xtreme1/main/backend/pom.xml
- compose：nginx:1.22、mysql:5.7、redis:6.2、minio、backend、frontend（+ 3 个可选模型/可视化服务，走 `profiles: model`）`[源码]` — https://raw.githubusercontent.com/xtreme1-io/xtreme1/main/docker-compose.yml
- 队列：**无外部 broker**，用 Redis Streams 消费者组 + 线程池在 JVM 内做后台作业，调用方凭流水号轮询进度 `[源码]` — https://raw.githubusercontent.com/xtreme1-io/xtreme1/main/backend/src/main/java/ai/basic/x1/adapter/api/config/JobConfig.java、https://docs.xtreme1.io/xtreme1-docs/developer-reference/api-document.md
- **用户隔离：几乎没有** —— 表清单里没有 org/team/role；安全配置是 `.anyRequest().authenticated()`（无 role/scope 规则）；只有 `data_annotation_record` 的唯一键 `uk_dataset_id_created_by (dataset_id, created_by)` 体现「每人一份标注记录」`[源码]` — https://raw.githubusercontent.com/xtreme1-io/xtreme1/main/deploy/mysql/migration/V1__Create_tables.sql、https://raw.githubusercontent.com/xtreme1-io/xtreme1/main/backend/src/main/java/ai/basic/x1/adapter/api/config/SecurityConfig.java
- 许可：Apache-2.0（"Xtreme1 is a trademark of LF AI & Data Foundation."）— https://raw.githubusercontent.com/xtreme1-io/xtreme1/main/LICENSE.txt

### 6.4 对本项目的启示

- 「单租户、局域网、所有人看到同一份项目」**不是简化版** —— 它是 Label Studio Community 与 Xtreme1 的既有形态，先例充分；不需要设计租户隔离。
- **真正必须新增的是后台任务层**：本仓库的预打标推理、视频抽帧、插件导出都是长任务，桌面上靠「一个进程 + 一个静态 `BUSY` 标志」串行化（`src-tauri/src/media/video.rs:19` 的 `static BUSY: AtomicBool`），服务器上必须换成显式任务注册表 + 跨用户可见的取消语义。
- 三家里的**分析/可观测**组件（ClickHouse + Vector + Grafana / Grafana）对本项目规模属于过度设计，**可不引入**。

---

## 7. 同一份 JSON 项目文档被多个浏览器用户并发修改

**结论**：本仓库当前**没有任何并发控制** —— `export_annotations_json` 是 `fs::write(output_path, json)` **整文件覆盖**（`src-tauri/src/commands/mod.rs:57-60`），项目文档是单个 `my-label-tool.project.json`（`src/lib/importers.ts:17`）。多浏览器并发下必然出现 **lost update（静默丢失）**。权威解法有两个家族：**(i) HTTP 前置条件 ETag / If-Match**（RFC 9110 §8.8.3 / §13.1.1，冲突回 412）；**(ii) 文档内携带版本令牌**（CouchDB `_rev`、Kubernetes `resourceVersion`，冲突回 409）。两者都是**整文档粒度**，客户端必须实现「重新加载 + 合并 / 重试」；要做到字段级自动合并只能上 CRDT/OT，代价是项目文件不再是普通的可序列化 JSON。
**对本需求的推荐**：先做 (i) 或 (ii) 的整文档乐观锁（成本低、语义明确、能防静默丢失），字段级合并留作后续。

**证据**

1. RFC 9110 精确小节与措辞（已核对正文）`[一手]`：
   - `8.8.3. ETag`：
     > "The "ETag" field in a response provides the current entity tag for the selected representation, as determined at the conclusion of handling the request."
     并规定「strong being the default」，非强校验器**必须**加 `W/` 前缀（「the origin server MUST mark the entity tag as weak by prefixing its opaque value with "W/"」）。
   - `13.1.1. If-Match`：
     > "An origin server MUST use the strong comparison function when comparing entity tags for If-Match"
     > "If-Match is most often used with state-changing methods (e.g., POST, PUT, DELETE) to prevent accidental overwrites when multiple user agents might be acting in parallel on the same resource (i.e., to prevent the **"lost update"** problem)."
     > "An origin server that evaluates an If-Match condition **MUST NOT** perform the requested method if the condition evaluates to false. Instead, the origin server **MAY** indicate that the conditional request failed by responding with a 412 (Precondition Failed) status code."
   - `13.1.2. If-None-Match`（弱比较；`*` 用于「不存在才创建」）：
     > "An origin server that evaluates an If-None-Match condition MUST NOT perform the requested method if the condition evaluates to false; instead, the origin server **MUST** respond with either a) the 304 (Not Modified) status code if the request method is GET or HEAD or b) the **412** (Precondition Failed) status code for all other request methods."
   - `15.5.13. 412 Precondition Failed`：
     > "indicates that one or more conditions given in the request header fields evaluated to false when tested on the server (Section 13)"
   — https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3 、#section-13.1.1 、#section-13.1.2 、#section-15.5.13

   > **措辞漂移警告（重要）**：常见引文「MUST respond with either a) the 412 (Precondition Failed) status code or b) one of the 2xx ...」是 **RFC 7232 §3.1** 的旧措辞；RFC 7232 已被 RFC 9110 废弃（元数据：「Obsoleted by: RFC9110」）。**引用时必须用 RFC 9110。** — https://www.rfc-editor.org/rfc/rfc7232.html#section-3.1

2. 强校验器怎么生成 `[一手]`：§8.8.1「Strong validators are usable for all conditional requests, including cache validation, partial content ranges, and "lost update" avoidance. Weak validators are only usable when the client does not require exact equality with previously obtained representation data」；§8.8.3.1 给出实现自由度与推荐（内部修订号、内容抗碰撞哈希、多重文件属性、亚秒级时间戳；「The best are based on strict revision control」）— 同上 RFC 文本。
   → 对本项目：用**单调递增修订号**（或内容哈希）生成**不带 `W/` 的强 ETag**，不要用 `Last-Modified` 粒度的时间戳（与第 3 节的 Range 要求耦合）。

3. 真实实现 A —— **CouchDB**（文档内令牌 + 409）`[一手]`：
   > "When updating an existing document, the current document revision must be included in the document (i.e. the request body), as the rev query parameter, or in the If-Match request header."
   > "ETag – Double quoted document's revision token" / "409 Conflict – Document with the specified ID already exists or specified revision is not latest for target document"
   — https://docs.couchdb.org/en/stable/api/document/common.html
   它明确警告「直接覆盖」的后果，并要求应用自己实现重试策略：
   > "just overwrite it with the document being saved before (which is not advisable, as user1's changes will be **silently lost**)"
   > "your application still has to be able to handle these conflicts and have a suitable retry strategy"
   — https://docs.couchdb.org/en/stable/replication/conflicts.html

4. 真实实现 B —— **Kubernetes**（body 内 `resourceVersion` + 409）`[一手]`：
   > "every Kubernetes object has a `resourceVersion` field representing the version of that resource as stored in the underlying persistence layer."
   > "For a PUT request, it is the client's responsibility to specify the resourceVersion ... Kubernetes uses that resourceVersion information so that the API server can detect lost updates and reject requests made by a client that is out of date ... the API server returns a **409 Conflict** error response."
   > "Clients that need effective detection of lost updates should consider making their request conditional on the existing resourceVersion ... and then handle any retries that are needed in case there is a conflict."
   — https://kubernetes.io/docs/reference/using-api/api-concepts/
   附带的设计提示（字段级意图）：「you can increment a counter without reading it if the existing value matches what you expect. You can do this with no lost update risk」

5. 真实实现 C —— **Microsoft Graph**（HTTP 条件请求 + 412）`[一手]`：
   > "if-match | String. If this request header is included and the eTag (or cTag) provided doesn't match the current eTag on the folder, a **412 Precondition Failed** response is returned."
   — https://learn.microsoft.com/en-us/graph/api/driveitem-update?view=graph-rest-1.0
   > "412 | Precondition Failed | A precondition provided in the request (such as an if-match header) doesn't match the resource's current state."
   — https://learn.microsoft.com/en-us/graph/errors

6. **反例（不要误引）** —— GitHub REST API 只在 GET 上做 ETag 缓存校验 `[一手]`：
   > "Most endpoints return an etag header ... Making a conditional request does not count against your primary rate limit if a 304 response is returned..."
   > "Conditional requests for unsafe methods, such as POST, PUT, PATCH, and DELETE are **not supported** unless otherwise noted in the documentation for a specific endpoint."
   — https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

7. 三家族对比（落到本项目）：

| | (i) HTTP ETag / If-Match | (ii) body 内版本令牌 | (iii) CRDT / OT |
| --- | --- | --- | --- |
| 粒度 | 整个 HTTP 资源（= 整个项目 JSON） | 整个文档（K8s 额外支持 test-conditions 表达字段级意图） | 字段 / 字符级，自动合并 |
| 冲突信号 | 412（If-Match 在 RFC 9110 下是 **MAY**；If-None-Match 下是 **MUST**） | 409（CouchDB、K8s 的约定） | 无冲突（收敛） |
| 客户端义务 | 重新加载 + 重试 / 合并 UI | 同左 | 换数据模型 |
| 对本项目的代价 | **低**：1 个版本号 + 1 个前置条件检查 | 中：需把 rev 写进 project.json（并与插件 `configVersion` 共存） | 高：项目文件不再是普通 JSON |

---

## 8. 本仓库的 Windows 专属代码盘点

**结论**：Windows 专属性集中在四个簇 —— **进程与沙箱**（`process_control*`、`plugins/runtime*`、`plugins/exporter.rs`）、**文件系统路径与重解析点**（`permissions.rs`、`video_reextract.rs`、前端 `app-utils.ts`）、**回收站删除**（`media/image_*`）、**ONNX / DirectML 运行时与 ffmpeg 打包**（`media/prelabel/runtime_download.rs`、`scripts/prepare-video-tools.ps1`）。
好消息：**插件运行时与进程控制已有 `#[cfg(unix)]` 分支**（`process_group(0)` + `kill`），说明代码里已为「非 Windows」留了位置。
坏消息：**Unix 分支没有沙箱**，且**「删除图片」在非 Windows 上是刻意 fail-closed 的硬失败**。

### 8.1 进程与沙箱

| 文件 | Windows 专属内容 | 迁移到 Linux 服务器需要什么 |
| --- | --- | --- |
| `src-tauri/src/process_control.rs`（20 处 `#[cfg(windows)]`） | `SuspendedJobProcess`（Job Object + `CREATE_SUSPENDED` + 可继承句柄启动）、`create_kill_on_close_job`（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）、`taskkill /PID /T /F`、`windows_command_line` 参数转义、`resolve_windows_executable`（含 Python 解析）、环境块白/黑名单 | 已有 `#[cfg(unix)]` 对应实现：`configure_process_group`（`command.process_group(0)`，见 `process_control.rs:48-52`）+ `terminate_process_tree`（`kill -KILL -<pgid>`，见 `:73-`）。**需审计语义差异**：Job Object 能保证「父进程死则子进程群死」，进程组只能尽力而为 |
| `src-tauri/src/process_control/app_container.rs` | `CreateAppContainerProfile` / `DeriveAppContainerSidFromAppContainerName` / `DeleteAppContainerProfile`、`SECURITY_CAPABILITIES` + ACL 授予与撤销（`update_path_access`） | **Windows 独有机制，Linux 无对应**。需换成 namespace / cgroup，或（更现实）以独立低权限 OS 用户 + `systemd-run` / 容器运行插件进程，并**重新定义「插件只读某目录」的授予 / 撤销语义** |
| `src-tauri/src/process_control/piped.rs` | Windows 管道 + 可继承句柄 + Job Object 的 `PipedJobProcess`（插件 stdio 会话） | 已有 `#[cfg(unix)] struct RuntimeProcess { child: Child, ... }`（`plugins/runtime.rs:1248-1330`）覆盖同等职责 |
| `src-tauri/src/plugins/runtime.rs`（23 处）、`runtime_probe.rs`（13 处） | 通过 AppContainer / Job Object 启动与探活插件进程；大量 `#[cfg(windows)] #[test]` | Unix 分支已存在；**需确认能力协商、超时、崩溃自动禁用、文件代理等逻辑在 Unix 分支的测试覆盖是否等同**（当前大量测试是 Windows-only） |
| `src-tauri/src/plugins/exporter.rs`（3 处） | 打开文件时 `FILE_FLAG_OPEN_REPARSE_POINT` + `share_mode(0)`，并用 `FILE_ATTRIBUTE_REPARSE_POINT` 判重解析点 | Linux 用 `O_NOFOLLOW` + `symlink_metadata().file_type().is_symlink()`（`video_reextract.rs:31-36` 已有同样的 Unix 思路） |

### 8.2 文件系统路径与重解析点

| 文件 | Windows 专属内容 | 迁移到 Linux 服务器需要什么 |
| --- | --- | --- |
| `src-tauri/src/plugins/permissions.rs`（7 处） | `is_local_proxy_path`（`GetDriveTypeW` / `GetVolumePathNameW` 判本地盘 vs 网络盘）、`opened_file_path`（`GetFinalPathNameByHandleW` 取规范路径）、路径比较**大小写不敏感** | 已有 `#[cfg(unix)] fn is_local_proxy_path(_: &Path) -> bool { true }`（`permissions.rs:637-640`）。Linux 需**重新定义**「本地 / 网络」判定（挂载点 / 文件系统类型），并把**路径比较改为大小写敏感** —— 这是安全相关语义，**不能照抄** |
| `src-tauri/src/media/video_reextract.rs`（1 处） | `FILE_ATTRIBUTE_REPARSE_POINT`（`0x400`）判定 | 用 `symlink_metadata` 即可（同文件非 Windows 分支已在做） |
| `src-tauri/src/media/pt_conversion.rs`（1 处） | 剥掉 `\\?\UNC\` 前缀 | 纯 Windows 路径处理；但需确认 uvx / 转换命令在 Linux 下的等价路径处理 |
| `src/lib/app-utils.ts:98-108` | `portablePath` 处理 `\\?\UNC\` 与 `\\?\` 前缀；`normalizePath` 一律 `toLowerCase()` | **前端也有 Windows 假设**：`normalizePath` 全部转小写，在大小写敏感的 Linux 文件系统上会把两个不同文件判为同一个。需按平台开关，或改为「Rust 侧提供规范化路径」 |

### 8.3 回收站删除（Linux 上目前是死功能）

| 文件 | Windows 专属内容 | 迁移到 Linux 服务器需要什么 |
| --- | --- | --- |
| `src-tauri/src/media/image_recycle_windows.rs` | `IFileOperation` COM（自建 STA 线程 + `CoInitializeEx(COINIT_APARTMENTTHREADED)`）、`TSF_DELETE_RECYCLE_IF_POSSIBLE` 校验 —— `ensure_recycle(flags)` 在 flag 缺失时返回 `E_ABORT`，即**拒绝一切永久删除回调** | 需等价实现。Linux 无系统回收站：选项是 `trash` crate（XDG Trash 规范，只对桌面会话有意义）或 **项目内 `.trash/` 目录 + 保留策略**。**现有实现的核心不变量是「绝不永久删除」，迁移时必须保留**，否则是数据丢失 / 安全回归 |
| `src-tauri/src/media/image_deletion.rs:18-32` | 非 Windows 分支直接 `Err(text::IMAGE_DELETE_UNSUPPORTED)` | **这就是 Linux 上的现状：删除图片直接报错**。注意文案本身也是 `#[cfg(not(windows))]` 的（`src-tauri/src/i18n/zh_cn.rs:5-6`：「当前系统暂不支持安全移入回收站，未删除文件」）—— 即这是**刻意 fail-closed 的占位**，不是遗漏；需求 1 必须补齐这一分支 |

### 8.4 ONNX Runtime 与 ffmpeg

| 文件 | Windows 专属内容 | 迁移到 Linux 服务器需要什么 |
| --- | --- | --- |
| `src-tauri/src/media/prelabel/runtime_download.rs` | `RUNTIME_VERSION = "1.24.3-dml"`（`:31`）、三个文件名 `onnxruntime.dll` / `onnxruntime_providers_shared.dll` / `DirectML.dll`（`:32-34`）及各自 SHA-256、`gpu_available` 由「存在 `DirectML.dll`」推断（`:314-316`）；安装目录 `app_data_dir/onnxruntime/<version>`（`:154-158`） | 换成官方 `onnxruntime-linux-x64-*.tgz` 里的 `libonnxruntime.so`（见第 4 节）；`gpu_available` 语义需重定义（Linux 上会是 CPU 或 CUDA，不存在 DirectML） |
| `src-tauri/src/media/prelabel/runtime.rs:153-178` | `ort::init_from(dll_path)` + `LOADED_RUNTIME` 单例 | **逻辑不变**，只是载入文件从 `.dll` 变成 `.so`（`ort` 官方文档明示同一 API 支持 `.dll`/`.so`/`.dylib`） |
| `src-tauri/src/media/prelabel/inference.rs:69` | `ort::ep::DirectML::default().build()`，**无 `#[cfg(windows)]` 门控** | 需加平台门控或把 EP 选择抽成配置：Linux 上 DML 注册必然失败。当前行为**是安全的**（`Auto` 有 CPU 回退 `:51-58`，`Gpu` 返回明确错误 `prelabel_gpu_unavailable()`），但 **UI 上需隐藏 / 禁用 GPU 选项** |
| `src-tauri/src/media/video.rs:67-96` | `resource_dir/video-tools/ffmpeg{EXE_SUFFIX}`；`#[cfg(windows)] command.creation_flags(0x08000000)`（`CREATE_NO_WINDOW`） | Linux 侧改为容器内 PATH 上的 `ffmpeg` / `ffprobe`（发行版包）；`EXE_SUFFIX` 会自然为空 |
| `scripts/prepare-video-tools.ps1`（被 `src-tauri/tauri.conf.json` 的 `build.beforeBuildCommand` 以 `powershell ...` 调用） | 复制 `ffmpeg.exe` / `ffprobe.exe`、强制随附 `LICENSE`、生成 `checksums.json` | Linux 构建需替换为等价脚本（或直接在镜像里 `apt-get install ffmpeg`），并保留「随附许可 + 校验和」的做法 |

### 8.5 配置与其他

| 位置 | 内容 | 迁移影响 |
| --- | --- | --- |
| `src-tauri/tauri.conf.json` | `app.security.assetProtocol.scope = ["**"]`（全局放行）、`csp: null`、`bundle.resources = ["video-tools/"]`、`plugins.updater.windows.installMode = "passive"`、`beforeBuildCommand` 走 PowerShell | 服务器形态下 `bundle` / `updater` 整块失去意义；`assetProtocol` 换成 HTTP 端点后**需要真正的按用户 / 项目授权**（当前 `**` 在服务器上等价于任意文件读取） |
| `src-tauri/src/lib.rs` | `dialog` / `process` 插件无条件注册、`updater` 仅 `#[cfg(desktop)]`（`:15-17`）；55 个命令注册（`:11-70`）；`RunEvent::Exit / ExitRequested` 里做全局清理（取消转换 / 预打标 / 下载、关闭插件进程） | 「进程退出时清理」的钩子在服务器上不存在（进程长期驻留）→ 需改为**显式关闭 / 超时回收**，否则长任务与插件进程会无限累积 |
| `src-tauri/Cargo.toml` | `[target.'cfg(windows)'.dependencies] windows = "0.61.3"`（含 `Win32_Security_Isolation`、`Win32_UI_Shell`、`Win32_System_JobObjects` 等）+ `windows-core` + `dunce`；`[target.'cfg(unix)'.dependencies] libc`；`crate-type = ["staticlib","cdylib","rlib"]` | Windows 依赖整块可条件化移除；`staticlib`/`cdylib` 是 Tauri（移动端）需要，纯服务端可退化为 `rlib`（非必须） |
| `src-tauri/src/i18n/zh_cn.rs` | 文案含 AppContainer / DirectML / `onnxruntime.dll` 等 Windows 专属提示（`plugin_sandbox_*_failed`、`prelabel_gpu_unavailable`、`RUNTIME_SELECT_DLL`）；`IMAGE_DELETE_UNSUPPORTED` 本身就带 `#[cfg(not(windows))]`（`:5-6`） | 需要按平台分化文案 |
| `src-tauri/src/main.rs` | `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` | 纯 Windows；服务器二进制不需要该属性 |

**汇总计数**（`grep -c '#[cfg(windows)]'`，`src-tauri/src`）：`plugins/runtime.rs` 23、`process_control.rs` 20、`plugins/runtime_probe.rs` 13、`plugins/permissions.rs` 7、`media/image_deletion.rs` 5、`media/pt_conversion_tests.rs` 4、`plugins/exporter.rs` 3，其余（`registry.rs`、`registry_tests.rs`、`prelabel.rs`、`video.rs`、`video_reextract.rs`、`video_reextract_tests.rs`、`pt_conversion.rs`、`commands/prelabel.rs`）各 1。
含 `windows::` 直接调用的文件：`process_control.rs`、`process_control/app_container.rs`、`process_control/piped.rs`、`media/image_recycle_windows.rs`、`plugins/permissions.rs`、`plugins/exporter.rs`。

---

## 9. 未知 / 需实测

以下各点在本轮**未能**由一手来源证实，**不得当作结论使用**：

1. **零窗口 Tauri 应用是否被官方支持**：只有维护者在 discussion #7051 的非正式指引；官方文档无此说明，`Builder::run` 在零窗口下的确切行为也未在源码层面核实。
2. **`tauri::Context::new` 是否实际可调用**：其参数类型（`Pattern`、`RuntimeAuthority`、`Assets` impl）的公开可构造性未逐一核实；文档只给「不稳定」警告。
3. **外部传输驱动 invoke 是否仍受 ACL 管辖**：`tauri::ipc::Invoke` / `InvokeHandler` / `webview::InvokeRequest` 被标为不稳定；官方无任何「脱离 webview 驱动 invoke」的示例，`RuntimeAuthority` / capabilities 在该路径上是否生效**无文档**。**这是 HostBridge 方案最大的未知。**
4. **`Builder::channel_interceptor` 的稳定性与语义**：文档只有一句话，且不在 capability 体系内；能否把 Channel 送达稳定地改接到 SSE 未验证。
5. **`Channel` 的投递契约**：`send()` 是否阻塞、是否缓冲、通道关闭时是丢弃还是报错、有无背压，docs.rs 无描述（只有「ordered」这一句散文）。SSE 替代方案需不需要背压取决于此。
6. **asset 协议是否被文档承诺「不监听端口」**：第 3 节的「无网络服务器」是由上游源码（自定义协议处理器注册 + `core.js` 的 URL 拼接）推出的 `[INFERENCE]`，官方文档没有一句明说。
7. **浏览器实际发出的 Range 请求形态**：未对 Chromium / Firefox 抓包验证「图片 / 视频 seek 时只发单范围」。「单范围 206 足够」由 RFC 9110 §14.2/§14.6/§15.3.7.1、WHATWG media 算法与 Tauri 自身实现共同支持，但**未实证**。
8. **服务端 HTTP 框架选型的 Range 实现质量**：本轮完全没有研究 Node/Express 或 Rust HTTP 框架的静态文件 Range 支持（是否默认 `Accept-Ranges`、是否支持多范围与 `If-Range`），也未研究 npm 交付形态下的进程守护方案。
9. **ffmpeg「仅作为外部进程调用」时的具体许可义务**：FFmpeg 官方合规清单面向 **LGPL 链接**场景，与「调用可执行文件」并不一一对应；GPLv2 §3 对目标码分发的要求明确，但**本项目 Docker 镜像究竟需要做哪些具体动作**（随附源码 tarball？书面承诺？仅附许可文本与源码链接？）需法务判断。
10. **第三方 ffmpeg 镜像 / 静态构建的构建参数**：只核实了 `linuxserver/ffmpeg` 的用法与发行说明（发行说明含 x265 / libx264，属间接线索），未逐一核实其 `--enable-gpl` 开关。
11. **ONNX Runtime 多用户并发推理**：DirectML EP 明确不支持同一 session 多线程 `Run`；CPU EP 在多用户并发预打标下的线程 / 内存占用，以及是否需要「每用户一个 session」或「推理队列」，本轮未研究。
12. **服务器形态下的任务模型**：本仓库当前用进程内静态 `BUSY` 标志串行化视频导入（`media/video.rs:19`），插件进程用 `TaskRegistry`。这些语义（谁的任务、谁能取消、断线后怎么办）在 HTTP / 多客户端下需重新定义，本轮未做设计。
13. **Xtreme1 的并发语义**：只核实到「每人一条标注记录」的表结构；官方文档没有说明同一数据项被两人同时编辑时的合并规则。
14. **Label Studio Community 是否必须 Redis**：上游代码呈现「有 Redis 用队列、没有则同步执行」的推断；官方文档没有明确表述，且官方 compose 里没有 worker / redis 服务。
15. **`generate_context!` 对前端产物的编译期绑定可否整体绕过**：该宏会读取 `tauri.conf.json` 并把配置（含 `frontendDist`）编入 `Context`；服务器形态下前端产物由 HTTP 服务提供，这部分绑定能否整体绕过未验证。
16. **插件沙箱的 Linux 等价方案**：本轮只确认「Unix 分支没有沙箱」，未研究 Linux 上可用的替代隔离机制（bubblewrap / landlock / seccomp / 独立用户）及其与现有权限模型（`%PROJECT%` 等占位符、文件代理）如何对接。

---

## 10. 对后续架构决策的三点直接输入

1. **HostBridge 抽象层是必需的，而且落点很小**：前端只有 5 个原语需要抽象（`invoke`、`convertFileSrc`、`Channel`、dialog、updater/process），其中 4 个已在 `src/lib/tauri-api.ts` 收口。Rust 侧 55 个命令的业务逻辑（视频抽帧、缩略图、导出、插件编排、ONNX 推理）与 Tauri 的耦合点只有 `AppHandle`（取 `app_data_dir` / `resource_dir`）与 `Channel`，两者都能在 Bridge 层用「一个路径解析 + 一个事件汇」替掉。依据见第 1、2 节。
2. **Docker 形态可行，但有三个具体障碍**：DirectML（第 4 节）、回收站（第 8.3 节，目前非 Windows 直接报错）、ffmpeg 许可与随附（第 5 节）。前两个是代码改动，第三个是流程改动。
3. **并发控制必须在需求 1 里就定**：项目文档是单文件整覆写（第 7 节），上线即丢数据。建议采用 RFC 9110 的 ETag / If-Match（或 body 内 `rev` + 409），并在本期就明确「冲突时的用户可见行为」（重新加载 / 合并 / 拒绝）。
