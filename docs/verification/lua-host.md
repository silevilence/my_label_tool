# Lua 宿主原型与隔离验收

选择标准 Lua 5.4（mlua 0.12，vendored 静态编译），无需用户安装解释器。
未选择 Luau：进程上限已经覆盖 Lua 堆、Rust 快照及结果缓冲，不需要换方言获得这一约束。
mlua 内存和文本 chunk 接口依据 [官方 API](https://docs.rs/mlua/0.12.1/mlua/struct.Lua.html)。

可复跑：`cargo test --manifest-path src-tauri/script-host/Cargo.toml`。

- `vm::tests`：三个真实脚本、io/os/require/debug/dofile/load、字节码、巨量 Lua 分配、死循环、捕获命令错误仍整体失败。
- `tests/host.rs`：真实二进制通过 NDJSON 处理四图；分块大小 1 与 4 的输出完全一致。
- 相同进程测试发送 150 个 1 MiB 快照项，配置 64 MiB，在执行 Lua 前以 125 退出，验证快照也受内存限制。
- 无限 pcall 循环在 2 秒总时限以 124 退出，避免 Lua 捕获 hook 错误绕过时限。

Windows 使用 Job Object 的 ProcessMemoryLimit（提交内存）；Unix 使用 RLIMIT_AS（地址空间，包含映射）。
Rust 分配失败无额外分配地以 125 退出；Lua 堆预算为进程预算的一半，分配失败返回 MEMORY_LIMIT。
总时限覆盖收快照、执行和发结果，runner 另有独立看门狗与取消。
上限是拒绝执行/终止，绝不截断快照或部分写回。

Windows 原型上述测试通过。默认采用 256 MiB / 30 秒：64 MiB 已通过小样例，256 MiB 为解析和双份数据留余量；它不是项目规模承诺。
可配置范围 64–4096 MiB、1–3600 秒；具体可处理规模取决于标注数与脚本分配，失败时增加上限或缩小作用域。
Linux 容器的同组验证随双形态交付执行并记录。
