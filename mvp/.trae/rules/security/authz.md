---
alwaysApply: true
---
# 鉴权与越权（复盘补强：SEC-001 机器化 + SEC-003 拆出到 pii.md）

## SEC-001 · 路由默认受保护（声明式 auth 元数据）
- 触发条件：新增 router procedure 时。
- 期望行为：
  - `Procedure` 类型必须含 `auth: 'admin' | 'public'` 字段。
  - 默认所有 procedure `auth: 'admin'`；公开路由必须显式 `auth: 'public'` 并在 procedure 上方注释说明理由。
  - 禁止省略 auth 字段（省略即"裸奔"）。
- 校验方式：`scripts/check-rules.mjs` 扫描 `apps/api/src/router/**/*.ts` 中 `Procedure` 字面量与 `createXxxRouter` 返回值，每个 procedure 对象必须含 `auth` 键；缺 `auth` 报 SEC-001 违规。public 路由需上方紧邻注释含 `// public:` 理由说明，否则 suggestion。

## SEC-002 · 越权校验在 service 层
- 触发条件：service 方法读取/写入资源时。
- 期望行为：必须校验调用者权限；禁止仅依赖前端隐藏按钮；用 `requireAdmin(ctx)` 或更细粒度 `requirePermission(ctx, 'xxx')` 守卫。
- 校验方式：`scripts/check-rules.mjs` 扫描 `apps/api/src/service/**/*.ts` 中每个 class 方法（public 方法），方法体必须出现 `requireAdmin` 或 `requirePermission` 调用，否则报 SEC-002 违规；例外：明显非业务方法（如构造函数、私有方法 `private`/`#`）豁免。
