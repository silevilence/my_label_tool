# 使用 Lua 脚本处理标注

在侧栏点击「Lua 脚本」。脚本处理当前作用域：项目序、搜索结果或视频帧范围。
应用不会自动发现或运行项目中的脚本。项目配置不保存脚本；脚本库只保存在本机应用数据目录的 `scripts/`。

1. 打开图片项目，检查当前标签与作用域。
2. 点击「新建脚本」或「从文件打开」，编辑 Lua 文本。默认示例给所有图形连续编号。
3. 可选「带入图片尺寸」；读取尺寸需要逐图加载，默认关闭，随脚本保存。
4. 点击「运行脚本」。未保存的文本也能运行，未提交的图片保持原样。
5. 需要先核对时开启「先看差异再应用」（默认关闭），运行后选择图片比较前后数据，再应用或取消。
6. 完成报告列出图片数、图形增删改和跳过数。「撤销本轮脚本」一次回退全部变化；普通重做可整轮恢复。
7. 通过原有「保存项目」入口落盘。脚本不会自动保存或导出标注。

一次运行只执行一遍，处理整份作用域快照。提交结果是该图完整的标注表；重复提交同一图取最后一次。
任何脚本错误、非法结果、超时或取消都会丢弃全部结果，不保留已处理图片的修改。
预览期间仍占用项目标注资源，与预打标、保存和导出互斥。应用时发现标签、作用域或标注已变化，会要求重新运行。

## 命令速查

所有调用使用 `annotool.call("命令", 参数表)`，版本常量 `annotool.API_VERSION` 当前为 1。

| 命令 | 示例 | 返回 |
| --- | --- | --- |
| images | `annotool.call("images")` | 有序图片数组（path、name） |
| label | `annotool.call("label", {name="车辆"})` | 当前标签配置，含 id 和 name；也可按 `{id=查询所得id}` 查询 |
| annotations | `annotool.call("annotations", {imagePath=image.path})` | 原始快照标注数组 |
| submit | `annotool.call("submit", {imagePath=image.path, annotations=shapes})` | 登记覆盖结果，尚不写回 |
| size | `annotool.call("size", {imagePath=image.path})` | width、height；必须先开启带入尺寸 |
| progress | `annotool.call("progress", {completed=i, total=#images})` | 更新进度 |
| log | `annotool.call("log", {message="处理完成"})` | 面板日志 |

参数不含导出格式、解析模式或归一化开关。标注使用当前标签体系，坐标为原图像素：
矩形 `[x,y,width,height]`、多边形顶点序列、点 `[x,y]`。Lua 表数组从 1 开始。
新图形可省略 id；主程序自动生成。已有图形保留 id 才会计为修改。
标签名必须唯一；不要硬编码标签 id，持有 label 查询结果的 id。

## 可直接使用的示例

- [按标签名改派](../examples/scripts/reassign.lua)：项目需有唯一的「车辆」「汽车」两个标签。
- [坐标修正](../examples/scripts/coordinates.lua)：将坐标改为非负值。
- [跨图编号](../examples/scripts/numbering.lua)：按作用域顺序写入 `attributes.sequence`，传输分块不重置计数。

Lua 5.4 内置数学、字符串、表、UTF-8 库；不提供 io、os、package、debug、require、load、loadfile、dofile。
只能运行文本，不能执行二进制字节码；不能访问图片像素、磁盘或网络，也不能调用保存、导出、预打标。

## 资源上限与失败

展开「脚本资源上限」，修改后点击「保存上限」。下一次运行立即使用保存值。
默认进程预算 256 MiB、总时限 30 秒；范围 64–4096 MiB、1–3600 秒，可恢复默认。
预算覆盖快照、Lua 和结果缓冲；Lua 堆额外限制为进程预算的一半，为数据传输留出空间。
Windows 限制提交内存，Linux 限制地址空间。分块不等于内存上限；没有单图超时。

| 错误 | 处理方式 |
| --- | --- |
| LABEL_NOT_FOUND / LABEL_AMBIGUOUS | 核对名称，消除重名后重试 |
| DIMENSIONS_UNAVAILABLE | 开启「带入图片尺寸」 |
| INVALID_ARGUMENT / INVALID_ANNOTATION | 检查参数、标签、图形类型、点数与有限数值 |
| SCRIPT_ERROR | 按 Lua 错误中的行号修正脚本 |
| MEMORY_LIMIT / TIMEOUT | 缩小作用域、修正无限循环，或提高机器级上限 |
| LINE_LIMIT | 单图/单条消息过大（8 MiB），缩小输出规模 |
| HOST_UNAVAILABLE / PROTOCOL_ERROR | 检查是否完整安装且宿主未被移走，重新安装匹配版本 |

命令错误即使被 Lua `pcall` 捕获也会让本轮失败。图片错误尽可能按图片路径汇总；整段 Lua 错误没有可靠的图片归属时只显示脚本行号。

## 桌面与容器交付

桌面开发 `npm run tauri dev` 自动先编译调试版宿主；生产 `npm run tauri build` 自动编译并将宿主放进 `script-tools/` 资源目录。
源码验收：

```powershell
cargo test --manifest-path src-tauri/script-host/Cargo.toml
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-script-host.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-script-host.ps1
```

容器交付的是独立 NDJSON 脚本宿主，可以供后续服务端 runner 复用。**完整服务端 HTTP/UI 仍在 ROADMAP 计划区，本次没有宣称已经可用的服务端标注应用。**
普通浏览器中未连接宿主时，面板明确显示不可用并禁用运行。

```powershell
podman build -f containers/script-host.Dockerfile -t localhost/label-script-host:qa .
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-script-host.ps1 -Container
```

也可将 Podman 换成 Docker：build 使用同一 Dockerfile，验证脚本传 `-Engine docker -Image <构建的镜像名>`。
构建需要下载依赖；运行不需要网络、解释器安装或项目目录挂载。运行时 stdin/stdout 协议见 [内部协议](script-protocol.md)。

脚本库文件内容的读写复用 `read_text_file` / `export_text_files`。计划中的受控文本读取适配器落地时，必须继续在该入口收口；目前没有虚构尚不存在的读取模式。
