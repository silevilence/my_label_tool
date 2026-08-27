# 插件配置存储与迁移验证记录

复跑命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-plugin-config-migration.ps1
```

覆盖范围：

- 无 `pluginConfigs` 的旧项目兼容加载
- 不透明插件配置解析、重复插件 ID 与非法版本拒绝
- v1 → v2 → v3 逐级迁移及每步参数
- 迁移超时/失败/非法响应时保留原配置并进入「待迁移」
- 未声明配置迁移能力与项目配置版本较新时不发起调用
- 已卸载插件配置原样保留并标记为不可用
- 「待迁移」注册状态持久化、能力调用门禁与重试恢复
- 后台迁移结果不会跨项目覆盖当前内存状态
- ProjectConfig、TypeScript 类型、NDJSON 协议 Schema 的字段同步

2026-08-27 本地结果：前端相关测试 36 项通过；Rust 配置编排测试 4 项通过；
Rust 迁移契约/状态/门禁测试 4 项通过。
