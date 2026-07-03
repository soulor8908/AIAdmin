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
- 校验方式：`scripts/check-rules.mjs` SEC-001 分支扫描 `apps/api/src/router/**/*.ts` 中 `Procedure` 字面量与 `createXxxRouter` 返回值，每个 procedure 对象必须含 `auth` 键；缺 `auth` 报 SEC-001 违规。public 路由需上方紧邻注释含 `// public:` 理由说明，否则 suggestion。

## SEC-002 · 越权校验在 service 层
- 触发条件：service 方法读取/写入资源时。
- 期望行为：必须校验调用者权限；禁止仅依赖前端隐藏按钮；用 `requireAdmin(ctx)` 或更细粒度 `requirePermission(ctx, 'xxx')` 守卫。
- 校验方式：`scripts/check-rules.mjs` SEC-002 分支扫描 `apps/api/src/service/**/*.ts` 中每个 class 方法（public 方法），方法体必须出现 `requireAdmin` 或 `requirePermission` 调用，否则报 SEC-002 违规；例外：明显非业务方法（如构造函数、私有方法 `private`/`#`）豁免。
- 豁免标记（TECH-NOTIFICATION-001 §3.3 D5 引入）：合法例外不调 `requireAdmin`，改用其他守卫或由调用方负责鉴权。两类：
  - 自服务方法（如 `NotificationService.markRead` 收件人自服务，PRD Q4b）：改用资源所有权守卫（`ctx.user.id === notification.recipient_id`）。
  - 框架内部旁路方法（如 `AuditLogService.record`）：由 withAudit 在被审计 service 方法已通过自身鉴权后调用，operator_id 取真实操作者（admin 或自服务收件人 F2-5）；此处若 requireAdmin 会阻断 markRead 自服务埋点（收件人非 admin → FORBIDDEN 被吞 → 日志不入库），使 F2-5 不可达。被审计操作的鉴权由对应 service 方法负责。
  - 标记格式：方法声明行上方 1~2 行或行尾注释 `// SEC-002-exempt: <reason>`（如 `// SEC-002-exempt: recipient self-service (PRD Q4b); guard via ctx.user.id === recipient_id`）。
  - 识别逻辑：SEC-002 分支在方法 requireAdmin 检查前，回溯声明行上方 1~2 行 + 行尾注释，命中 `SEC-002-exempt:` 则跳过检查并 push 一条 info（`SEC-002 豁免：<file>:<line> <name>() — <reason>`）供 Reviewer 逐条核对豁免合理性。
  - 非新增 markEnforcement 分支（落在既有 SEC-002 循环内，META-003 合规）；Reviewer 须逐条核对豁免合理性，滥用豁免记 blocker。本期豁免标记两处：markRead（自服务）+ record（旁路日志）。
  - 扫描器方法边界盲区（RETRO-ROUND11-001 S-1 反推）：check-rules.mjs SEC-002 分支按方法声明 break 收集 body（最多 40 行），但复杂 class 结构（多方法密集排列）可能存在边界 case——同 class 内一个方法调 requireAdmin 可能让扫描器误判同文件其他方法也合规。**Reviewer 须逐个 public 方法独立核对**是否调 requireAdmin 或标 SEC-002-exempt，不依赖扫描器 exit 0 作为唯一判据。R11 首次出现 public 路由 handler（AuthService.login）不调 requireAdmin 的合法场景，须标 SEC-002-exempt + Reviewer 逐方法核对。
