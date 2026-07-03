# 项目上下文快照（自动生成，勿手改）
> 生成时间 2026-07-03 · 由 `scripts/gen-context-snapshot.mjs` 扫描源码生成 · 目标 ≤8KB。
> 供 spec-first 五角色 subagent 作为最小公共上下文，按需循"完整定义见"读取明细。

## 架构概览
后端四层（apps/api/src）：router→service→repository→domain，单向依赖（ARCH-001）。contracts 纯净层（ARCH-002，只导出 Zod schema + z.infer 类型）。前端跨层只经契约（ARCH-003）。HTTP 入口 server.ts 声明式路由表 + Bearer 鉴权 + 乐观锁/ETag 中间件。SQLite 持久化（node:sqlite，PRAGMA foreign_keys=ON）。Ctx 接口 {user:{id,role}}。
完整定义见 apps/api/src/、packages/contracts/src/index.ts、apps/web/src/。

## 规则速查表
| ID | 一句话 | 校验方式 |
|---|---|---|
| AI-001 | 先读 Spec 再写码 | Reviewer |
| AI-002 | 测试先行（复盘拆分 + tsc 自检） | CI/tsc/vitest |
| AI-003 | 禁止越界发挥（复盘细化：advisory 偏… | Reviewer |
| AI-004 | 每次改动必跑三件套 | check-rules.mjs |
| AI-005 | 禁止硬编码跨域可变数据（复盘 RETRO-R… | check-rules.mjs |
| AI-006 | Tech Lead 须产出受影响测试清单（复… | Reviewer |
| AI-007 | 端到端验收测试 + Reviewer PRD… | Reviewer |
| ARCH-001 | 单向依赖（复盘扩面：覆盖全部四层，不限于 d… | check-rules.mjs |
| ARCH-002 | 契约层纯净 | check-rules.mjs |
| ARCH-003 | 跨层只经契约 | check-rules.mjs |
| CODE-001 | 禁止 any | check-rules.mjs |
| CODE-002 | 禁止吞错 | check-rules.mjs |
| CODE-003 | 禁止 eval 与动态执行 | check-rules.mjs |
| CODE-004 | 命名约定 | check-rules.mjs |
| META-001 | 无校验不立规 | Reviewer |
| META-002 | 规则 PR 准入 | check-rules.mjs |
| META-003 | 声明即实现（无声明漂移） | check-rules.mjs |
| META-004 | 实现即声明（无反向缺口） | check-rules.mjs |
| SEC-001 | 路由默认受保护（声明式 auth 元数据） | check-rules.mjs |
| SEC-002 | 越权校验在 service 层 | check-rules.mjs |
| SEC-003a | 响应不返回未声明 PII | check-rules.mjs |
| SEC-003b | 错误消息与日志的 PII 边界 | Reviewer |
完整定义见 .trae/rules/。

## Contracts 速查表
按域分组（packages/contracts/src/schemas/）：
- audit: auditLogEntityTypeSchema, auditLogActionSchema, changeFieldValueSchema, changeFieldSchema, piiFieldRegistrySchema, auditLogSchema, redactedEmailSchema, redactedAuditLogSchema, listAuditLogQuerySchema, auditLogListResultSchema
- auth: loginInputSchema, loginResultSchema, logoutResultSchema, tokenPayloadSchema
- dept: departmentSchema, createDepartmentInputSchema, departmentTreeQuerySchema, departmentTreeNodeSchema, departmentTreeResultSchema, assignUserDepartmentInputSchema
- notification: notificationStatusSchema, notificationSchema, createNotificationInputSchema, updateNotificationInputSchema, notificationTransitionSchema, listNotificationQuerySchema, notificationListResultSchema
- report: reportGroupByDimSchema, reportQuerySchema, reportAggItemSchema, reportResultSchema
- role-inheritance: setParentInputSchema, unsetParentInputSchema, inheritanceChainInputSchema, inheritanceChainResultSchema, effectivePermissionsInputSchema, effectivePermissionsResultSchema
- role: permissionCodeSchema, roleSchema, createRoleInputSchema, listRoleQuerySchema, roleListResultSchema, assignRoleInputSchema, userRoleSchema
- transfer: transferInputSchema
- user: userStatusSchema, userSchema, userEntitySchema, createUserInputSchema, updateUserStatusInputSchema, listUserQuerySchema, userListResultSchema, errorCodeSchema, errorResponseSchema

关键枚举：
- auditLogEntityType: user|role|dept|notification|auth
- auditLogAction: create|update|delete|login|login_failed|logout
- notificationStatus: draft|sent|read
- reportGroupByDim: operator_id|entity_type|action|date
- permissionCode: user:read|user:write|role:read|role:write|dept:read|dept:write|audit:read|report:read|notification:read|notification:write|transfer:write
- userStatus: active|disabled
完整定义见 packages/contracts/src/schemas/。

## 路由表
| method | path | ver | cache |
|---|---|---|---|
| POST | /v1/auth/login | - | - |
| POST | /v1/auth/logout | - | - |
| GET | /v1/users | - | ✓ |
| POST | /v1/users | - | - |
| PATCH | /v1/users/:id/status | ✓ | - |
| POST | /v1/users/:userId/transfer | - | - |
| GET | /v1/roles | - | ✓ |
| POST | /v1/roles | - | - |
| GET | /v1/roles/:id | - | ✓ |
| DELETE | /v1/roles/:id | ✓ | - |
| GET | /v1/users/:userId/roles | - | - |
| POST | /v1/users/:userId/roles/:roleId | - | - |
| DELETE | /v1/users/:userId/roles/:roleId | - | - |
| POST | /v1/roles/:roleId/parent | ✓ | - |
| DELETE | /v1/roles/:roleId/parent | ✓ | - |
| GET | /v1/roles/:roleId/inheritance-chain | - | - |
| GET | /v1/users/:userId/effective-permissions | - | - |
| GET | /v1/departments/tree | - | - |
| POST | /v1/departments | - | - |
| DELETE | /v1/departments/:id | - | - |
| POST | /v1/departments/:departmentId/users/:userId | - | - |
| GET | /v1/audit-logs | - | - |
| GET | /v1/reports/operations | - | - |
| GET | /v1/notifications | - | ✓ |
| POST | /v1/notifications | - | - |
| GET | /v1/notifications/:id | - | ✓ |
| PATCH | /v1/notifications/:id | ✓ | - |
| POST | /v1/notifications/:id/send | ✓ | - |
| POST | /v1/notifications/:id/read | ✓ | - |
| DELETE | /v1/notifications/:id | ✓ | - |
完整定义见 apps/api/src/server.ts。

## 前端基础设施摘要
分层目录：api / auth / components / lib / pages。
api 模块：audit-logs.ts, auth.ts, client.ts, departments.ts, roles.ts, users.ts（统一 request<T> 封装 fetch，401 拦截清 token 跳 /login、409 VERSION_CONFLICT 重试 1 次、wire 适配 error→code）。
auth：AuthContext（login/logout action）+ RouteGuard（白名单 /login）+ tokenStore（localStorage）。
零新依赖（原生 fetch + react-router-dom + Context，无 axios/Redux/UI 框架）。
ARCH-003：仅 import @admin/contracts，禁连 apps/api/src/** 与 @admin/api。
完整定义见 apps/web/src/。

## 关键约定速查（跨域复用决策）
| 决策 | 约定 |
|---|---|
| 乐观锁 | 写路由 versioned=true，safeParse 前解析 If-Match→expected_version；缺失→VERSION_REQUIRED(400)，不匹配→VERSION_CONFLICT(409)+current_version |
| ETag | 读路由 cacheable=true，200+ETag header；If-None-Match 匹配→304(空体) |
| 鉴权 | Bearer token 五守卫：G1 缺 header→UNAUTHORIZED G2 非 Bearer→TOKEN_INVALID G3 验签失败→TOKEN_INVALID G4 过期→TOKEN_EXPIRED G5 黑名单→TOKEN_REVOKED；public 路由跳验签 |
| 输出 schema | 响应输出 schema 须 .strict() 拒绝多余字段（SEC-003a），与响应体 1:1 |
| SSOT 派生 | 跨域枚举断言用 [...schema.options].toContain()，禁硬编码全集（AI-005），枚举扩展断言自动跟随 |
| PII 脱敏 | 查询返回审计日志用 redactedAuditLogSchema（脱敏态），邮箱脱敏 ab***@domain，禁用存储态 auditLogSchema 输出（SEC-003b） |
| 审计 | audit_logs append-only（不可改不可删）；写操作经 withAudit 埋点，before/after 仅含实际变更字段 |
| 错误码 | errorCodeSchema 全局 SSOT（user.ts 定义一次），errors.ts Record<ErrorCode,number> 穷举 HTTP 映射，新增码须四处处同步 |
完整定义见 docs/spec/*.tech.md。
