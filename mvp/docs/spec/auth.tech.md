---
doc_type: TECH-Spec
id: TECH-AUTH-001
title: 鉴权域（登录签发 token + token 校验中间件替换 header mock + 登出吊销）Tech-Spec
prd_ref: PRD-AUTH-001
status: ready
owner: tech-lead@team
created: 2026-07-02
---

# TECH-AUTH-001 · 鉴权域 Tech-Spec

> 派生自 PRD-AUTH-001（status=decided，13 个 BLOCKING 决策已锁定）。
> 本 Spec 阶段只改 contracts + errors.ts + 本文档；service/repo/domain/router/server.ts 改动为 impl-writer 阶段（§6/§7 描述为 [advisory] 实现提示，非本阶段落地）。
> Ctx 接口（context.ts）绝对不变 —— ARCH-001 闭合核心（§8）。

## 1. 覆盖范围与既有端点核验（R10 S-2 教训闭合）

R10 S-2 教训：Spec 须核验既有路由表，确认新增端点非覆盖既有路由。本节核验 `apps/api/src/server.ts` routes 数组（L189~L325）。

既有路由清单（method + pattern 全集，逐条核验无 `/v1/auth/*`）：
- user：`GET /v1/users`、`POST /v1/users`、`PATCH /v1/users/:id/status`、`POST /v1/users/:userId/transfer`
- role：`GET /v1/roles`、`POST /v1/roles`、`GET /v1/roles/:id`、`DELETE /v1/roles/:id`、`GET/POST/DELETE /v1/users/:userId/roles/:roleId`、`POST/DELETE /v1/roles/:roleId/parent`、`GET /v1/roles/:roleId/inheritance-chain`、`GET /v1/users/:userId/effective-permissions`
- dept：`GET /v1/departments/tree`、`POST /v1/departments`、`DELETE /v1/departments/:id`、`POST /v1/departments/:departmentId/users/:userId`
- audit：`GET /v1/audit-logs`
- report：`GET /v1/reports/operations`
- notification：`GET /v1/notifications`、`POST /v1/notifications`、`GET /v1/notifications/:id`、`PATCH /v1/notifications/:id`、`POST /v1/notifications/:id/send`、`POST /v1/notifications/:id/read`、`DELETE /v1/notifications/:id`
- 工程：`GET /health`、`GET /`

核验结论：**`POST /v1/auth/login` 与 `POST /v1/auth/logout` 均为新增端点，不覆盖任何既有路由**（路径前缀 `/v1/auth/*` 在既有路由表中不存在）。R10 S-2 教训闭合。

本期覆盖范围（PRD F1~F5）：
- F1 登录签发：`POST /v1/auth/login`（新增，auth:'public'）
- F2 token 校验中间件：server.ts `buildCtx` 来源从 `X-User-Id/X-User-Role` header mock → `Authorization: Bearer <token>` 验签
- F3 密码哈希存储：User 追加 `password_hash`（scrypt salt:hash），输出不含（SEC-003a）
- F4 登出吊销：`POST /v1/auth/logout`（新增，auth:'admin'），token 入内存黑名单
- F5 内置 admin seed：server.ts 启动 seed admin@example.com/admin123（幂等）

## 2. 决策清单（D1~D13）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程）或 `[advisory]`（允许偏离，须反向同步 Spec）。

### D1 · token 结构（HMAC-SHA256 不透明 token）`[约束]`
- token = `base64url(payload_json)` + `.` + `base64url(HMAC-SHA256(payload_json, AUTH_SECRET))`
- payload = `{ sub: user.id, role: 'admin'|'user', iat: 签发秒(unix), exp: iat + 3600 }`（PRD Q2 决策①、Q6 决策①）
- 不透明指客户端不解析 payload；服务端用 HMAC 验签防伪造。语义对齐 JWT 但不引入 JWT 库（PRD Q2：零新依赖，node:crypto 原生 HMAC）
- 算法：`node:crypto.createHmac('sha256', AUTH_SECRET).update(payloadB64).digest('base64url')`
- 编码：payload 与 signature 均用 `base64url`（`Buffer.toString('base64url')`，node 原生支持，无 padding）

### D2 · 密码哈希格式（scrypt salt:hash）`[约束]`
- 存储格式：`<salt_b64>.<hash_b64>`（用 `.` 分隔，salt 与 hash 均 base64；不用 `$` 避免与系统 crypt 冲突）
  - [advisory] 分隔符 `.` vs `:`：PRD 草图写 `salt:hash`，本 Spec 调整为 `salt.hash`（理由：`:` 在 HTTP header / URL 中语义敏感，`.` 更中性；纯存储字段无 HTTP 语义但统一用 `.` 避免歧义）。此为 advisory 偏离，impl-writer 可回退 `:` 须反向同步。
- 算法：`node:crypto.scryptSync(password, salt, 64)`（同步，PRD Q3 决策①，OWASP 推荐）；salt = `crypto.randomBytes(16)`
- 参数：keylen=64，默认 N/r/p（node 默认 N=16384/r=8/p=1，MVP 不调参）
- 校验：login 时 `scryptSync(inputPassword, storedSalt, 64)` 与 storedHash 常量时间比对（`crypto.timingSafeEqual`）
- [advisory] scrypt 同步 vs 异步：`scryptSync` 阻塞事件循环（MVP 单机可接受）；生产高并发应改 `scrypt` 异步 + Promise 包装。本期用同步（impl 简化），偏离记 §10。

### D3 · Ctx 来源切换（header mock → Bearer 验签），Ctx 接口不变 `[约束]`
- server.ts `buildCtx(req)` 来源从 `req.headers['x-user-id'/'x-user-role']` 切换为 `req.headers['authorization']` → 解析 `Bearer <token>` → 验签 → 解析 payload → 构造 `Ctx = { user: { id: payload.sub, role: payload.role } }`
- **Ctx 接口（context.ts）绝对不变**：`{ user: { id: string; role: 'admin'|'user' } }`（PRD Q11 决策，ARCH-001 闭合关键）
- 废弃 `X-User-Id` / `X-User-Role` header（PRD Q7 决策②，彻底替换避免测试旁路变生产后门）
- public 路由（auth:'public'）跳过 token 校验，直接构造匿名 Ctx 或跳过 buildCtx（见 D8）

### D4 · 黑名单（内存 Set，logout 加入，进程重启清空）`[约束]`
- 存储：`new Set<string>()`（token 字符串去重），server.ts 模块级单例
- logout 成功 → `blacklist.add(token)`；token 校验时 `blacklist.has(token)` → TOKEN_REVOKED
- 进程重启清空（MVP 可接受，PRD Q8 决策①；持久化为未来方向，Out of scope）
- [advisory] 黑名单无 TTL：过期 token 不会被主动清理，理论上内存增长；MVP 短时可接受。impl-writer 可加定时清理（exp < now 的条目移除），偏离记 §10。

### D5 · userSchema 拆分（userEntitySchema 含 password_hash / userSchema 输出不变）`[约束]`
- **核心设计**：拆分存储实体 schema 与输出 schema：
  - `userSchema`（输出，**保持完全不变**）：`.strict()`，不含 password_hash；`User` 类型不变 → 既有 user 响应测试零变更
  - `userEntitySchema`（存储/内部，新增）：`userSchema.extend({ password_hash: z.string().min(1) }).strict()`；`UserEntity` 类型供 repository/service 内部用
- **禁止**在 userSchema 内 optional password_hash（PRD AC-F3-1 要求 `.strict()` 拒绝多余字段；optional 会被 .strict() 拒绝但语义混乱，且 User 类型会被污染）
- **禁止**用单一 userSchema 既做存储又做输出（SEC-003a 要求输出 schema 1:1 不含敏感字段）
- repository 内部存取 UserEntity；HTTP 响应输出前须经 userSchema 投影剥离 password_hash（impl-writer 阶段落地，本阶段只定义 schema）

### D6 · createUserInputSchema 追加 password optional `[约束]`
- `createUserInputSchema` 追加 `password: z.string().min(8).optional()`（PRD Q12 决策①最低 8 位）
- 缺省时 service 层生成临时密码（记审计日志 `action='create'` + 临时密码生成事件），用户可用临时密码登录（PRD F3-3）
- `.strict()` 仍拒绝多余字段；既有 `{email, name}` 样本因 password optional 仍合法 → 既有 createUser 测试零变更

### D7 · login 流程守卫顺序 `[约束]`
```
B1 schema 校验（loginInputSchema.safeParse：email 格式 + password min(8)）→ 失败 VALIDATION_ERROR(400)
B2 用户存在（findByEmail）→ 不存在 → INVALID_CREDENTIALS(401)（与 B3 同码同 message，防账号枚举 PRD Q9）
B3 密码校验（scrypt 比对）→ 不匹配 → INVALID_CREDENTIALS(401)（同 B2，防账号枚举）
B4 签发 token（payload iat/exp + HMAC 签名）→ 返回 { token, expires_at }
```
- B2/B3 须返回**相同 message**（如"邮箱或密码错误"），不区分"邮箱不存在"与"密码错"
- 审计日志可记录真实原因（login_failed + reason=email_not_found/password_mismatch），但响应不区分（PRD Q9）
- B1 在 server.ts safeParse 阶段（public 路由仍走 safeParse），B2~B4 在 AuthService.login

### D8 · token 校验守卫顺序（受保护路由中间件）`[约束]`
```
受保护路由（auth:'admin'）请求进入 → buildCtx(req)：
G1 Authorization header 存在？→ 缺失 → UNAUTHORIZED(401)
G2 scheme === 'Bearer'？→ 非 Bearer（如 Basic）→ TOKEN_INVALID(401)
G3 签名验证（HMAC 比对）→ 失败/格式错 → TOKEN_INVALID(401)
G4 exp > now？→ exp ≤ now → TOKEN_EXPIRED(401)
G5 blacklist.has(token)？→ 命中 → TOKEN_REVOKED(401)
G6 通过 → 构造 Ctx = { user: { id: payload.sub, role: payload.role } }，进入 handler
```
- public 路由（auth:'public'）**跳过 G1~G6**，直接进入 handler（不构造鉴权 Ctx；login/logout 自身不需要 Ctx.user，logout 例外见 D11）
- 守卫顺序不可调换：G3（验签）必须在 G4/G5 之前（否则伪造 token 可设 exp=future 绕过过期、设任意 sub 绕过黑名单）

### D9 · 错误码判定顺序（TOKEN_INVALID/EXPIRED/REVOKED 区分）`[约束]`
- 判定优先级（与 D8 G1~G6 一一对应）：
  1. UNAUTHORIZED：缺失 Authorization header（G1）
  2. TOKEN_INVALID：scheme 非 Bearer 或 签名失败/格式错（G2+G3，合并为单码）
  3. TOKEN_EXPIRED：签名有效但 exp ≤ now（G4）
  4. TOKEN_REVOKED：签名有效 + 未过期但命中黑名单（G5）
- 过期+吊销同时成立时：G4 先于 G5 → 返回 TOKEN_EXPIRED（token 已无效，无需查黑名单；可接受，AC-F2-4/F4-2 分立测试不覆盖此组合）
- TOKEN_INVALID 合并 scheme 错与签名错（PRD Q10：单码覆盖"伪造/格式错"，不细分）

### D10 · AUTH_SECRET 缺省与告警 `[约束]` + `[advisory]`
- `[约束]` AUTH_SECRET 来自 `process.env.AUTH_SECRET`；未设置时缺省为固定开发值 `'dev-auth-secret-do-not-use-in-prod'`（保证本地/测试可启动，避免冷启动死锁）
- `[advisory]` 缺省值字符串本身为 advisory（impl-writer 可选其他固定串，须反向同步）；server.ts 启动时若使用缺省值，`console.warn('[auth] AUTH_SECRET 未设置，使用开发缺省值，生产必须覆盖')`
- `[advisory]` 缺省值不用于生产（无运行时阻断，靠告警 + 运维流程；PRD Out of scope 不做密钥管理）

### D11 · seed admin（启动 seed，幂等）`[约束]`
- server.ts 启动时 `findByEmail('admin@example.com')`：不存在 → insert admin（email=admin@example.com, role=admin, status=active, password_hash=scrypt('admin123')）；已存在 → 跳过（幂等，AC-F5-2）
- 既有 `seedDemoData()` 的 ADMIN_USER_ID seed 须补 password_hash（admin@example.com/admin123）；DEMO_USER_ID（alice）是否补密码为 [advisory]（alice 非 admin，本期无 login alice 场景，可不补或补随机密码）
- seed 后可 login（AC-F5-3）：POST /v1/auth/login admin@example.com/admin123 → 200 token

### D12 · errorCodeSchema + errors.ts 追加 4 码 `[约束]`
- errorCodeSchema（user.ts）追加 4 码：`INVALID_CREDENTIALS`、`TOKEN_INVALID`、`TOKEN_EXPIRED`、`TOKEN_REVOKED`
- errors.ts `errorCodeToHttpStatus`（Record<ErrorCode, number> 穷举）补 4 码映射，**全 401**（PRD Q10）
- errorResponseSchema **不变**（current_version optional 已存在，auth 4 码无新响应字段需求）
- tsc 结构性保证：ErrorCode 枚举扩展后，Record<ErrorCode> 缺任一码即编译错误 → 强制穷举映射补齐

### D13 · 新增 auth schema（contracts）`[约束]`
- 新增 `packages/contracts/src/schemas/auth.ts`，导出 4 schema + type：
  - `loginInputSchema` = `z.object({ email: z.string().email(), password: z.string().min(8) }).strict()`
  - `loginResultSchema` = `z.object({ token: z.string().min(1), expires_at: z.string().datetime() }).strict()`
  - `logoutResultSchema` = `z.object({ success: z.literal(true) }).strict()`
  - `tokenPayloadSchema` = `z.object({ sub: z.string().uuid(), role: z.enum(['admin','user']), iat: z.number().int(), exp: z.number().int() }).strict()`（内部验签用，非 HTTP 输入输出）
- 全部 `.strict()`（SEC-003a 精神 + CODE-004 Schema 后缀）；type 经 `z.infer` 派生（ARCH-002）
- index.ts 追加 `export * from './schemas/auth.js'`
- auth.ts **不重复定义 errorCodeSchema**（跨域共享 user.ts 单一枚举，避免 export * 重名冲突，沿用既有先例）

## 3. 状态机

### 3.1 Token 状态机
```
       签发(login)         exp 到期
[未存在] ────────→ [有效] ────────→ [过期]（终态，不可恢复）
                      │
                      │ logout（黑名单 add）
                      ↓
                   [吊销]（终态，进程重启清空黑名单后回到"未存在"）
```
- 有效 → 过期：时间驱动（exp ≤ now），不可逆
- 有效 → 吊销：logout 主动驱动，不可逆（进程生命周期内）
- 过期/吊销均 → 401（TOKEN_EXPIRED / TOKEN_REVOKED，判定见 D9）
- 无"吊销→有效"回退（无 refresh，PRD Out of scope）

### 3.2 login 流程守卫顺序（D7）
```
POST /v1/auth/login {email, password}
  │
  ├─ B1 loginInputSchema.safeParse 失败 → 400 VALIDATION_ERROR
  ├─ B2 findByEmail 不存在 → 401 INVALID_CREDENTIALS（模糊）
  ├─ B3 scrypt 比对失败 → 401 INVALID_CREDENTIALS（模糊，同 B2）
  └─ B4 签发 token → 200 { token, expires_at }（+ audit login）
```

### 3.3 token 校验守卫顺序（D8，受保护路由）
```
Authorization: Bearer <token>
  │
  ├─ G1 缺失 header → 401 UNAUTHORIZED
  ├─ G2 scheme ≠ Bearer → 401 TOKEN_INVALID
  ├─ G3 签名失败 → 401 TOKEN_INVALID
  ├─ G4 exp ≤ now → 401 TOKEN_EXPIRED
  ├─ G5 blacklist.has → 401 TOKEN_REVOKED
  └─ G6 通过 → Ctx = { user: { id: sub, role } } → handler
```

## 4. 边界与异常（错误码 → HTTP 映射，对齐 errors.ts）

| 错误码 | HTTP | 触发条件 | 触发位置 |
|--------|------|----------|----------|
| VALIDATION_ERROR | 400 | login body schema 失败（password < 8 / email 格式错） | server.ts safeParse（B1） |
| UNAUTHORIZED | 401 | 受保护路由缺失 Authorization header | server.ts buildCtx（G1） |
| INVALID_CREDENTIALS | 401 | 邮箱不存在（B2）或密码错（B3），模糊不区分 | AuthService.login |
| TOKEN_INVALID | 401 | scheme 非 Bearer（G2）或签名失败/格式错（G3） | server.ts buildCtx |
| TOKEN_EXPIRED | 401 | 签名有效但 exp ≤ now（G4） | server.ts buildCtx |
| TOKEN_REVOKED | 401 | 签名有效 + 未过期但命中黑名单（G5） | server.ts buildCtx |
| FORBIDDEN | 403 | 有效 token 但 role ≠ admin 访问 admin 路由（SEC-002 既有，复用） | service requireAdmin |

补充：
- login 路由（public）缺失 token 不触发 UNAUTHORIZED（AC-F1-5：进入 login 流程）
- logout 路由（admin）缺失 token → UNAUTHORIZED（AC-F4-4）；logout 本身不抛 TOKEN_REVOKED（logout 是把当前 token 加入黑名单的动作，不是被黑名单拦截）
- 既有错误码（USER_NOT_FOUND 等）不受影响

## 5. contracts 联动

### 5.1 userSchema 拆分（D5 落地）
- `userSchema`（输出）：**保持完全不变**（id/name/email/status/department_id/created_at/updated_at/version，.strict()）→ `User` 类型不变
- `userEntitySchema`（存储，新增）：`userSchema.extend({ password_hash: z.string().min(1) }).strict()` → `UserEntity` 类型
- 既有引用 userSchema 的测试（user.test.ts / dept.test.ts / etag-caching.test.ts）零变更（userSchema 不变）
- 新增断言（③类 auth.test.ts）：userEntitySchema 含 password_hash、userSchema 拒绝 password_hash（.strict）

### 5.2 createUserInputSchema 扩展（D6 落地）
- 追加 `password: z.string().min(8).optional()`
- 既有 `{email, name}` 样本仍合法（optional）→ 既有 createUser 测试零变更
- 新增断言（③类）：createUserInputSchema 接受带 password 样本、拒绝 password < 8

### 5.3 errorCodeSchema 追加 4 码（D12 落地）
- 追加 `INVALID_CREDENTIALS` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_REVOKED`
- 既有 `[...errorCodeSchema.options]` SSOT 派生断言（notification/report/role-inheritance/optimistic-locking.test.ts）自动覆盖新码，且这些断言为 containment（含 X 码）非 equality（恰好 N 码）→ 零变更
- 新增断言（③类）：errorCodeSchema 含 4 个 AUTH 相关码（SSOT 派生）

### 5.4 errorResponseSchema 不变
- current_version optional 已存在，auth 4 码无新响应字段 → errorResponseSchema 零改动
- 既有 errorResponseSchema 断言（optimistic-locking.test.ts）零变更

### 5.5 新增 auth schema（D13 落地）
- `auth.ts` 导出 loginInputSchema / loginResultSchema / logoutResultSchema / tokenPayloadSchema + 4 type
- 全部 .strict()；type 经 z.infer 派生
- index.ts 追加 export

## 6. server.ts 改动（impl-writer 阶段，本节为 [advisory] 实现提示）

> 本阶段不改 server.ts（仅 contracts + errors.ts + Spec）。以下为实现指引，impl-writer 据此落地。

### 6.1 Ctx 构造来源替换（D3）
- `buildCtx(req)` 从读 `x-user-id`/`x-user-role` 改为读 `authorization` header → 解析 Bearer → 验签 → 解析 payload → 构造 Ctx
- 删除 `X-User-Id` / `X-User-Role` 读取与 ADMIN_USER_ID 缺省逻辑
- public 路由跳过 buildCtx（或构造匿名 Ctx，login/logout handler 不依赖 Ctx.user）

### 6.2 login/logout 路由注册（D1 D7 D11）
- routes 数组新增：
  - `defineRoute('POST', '/v1/auth/login', (m) => m.body, authRouter.login)` —— auth:'public'
  - `defineRoute('POST', '/v1/auth/logout', (m) => m.body ?? {}, authRouter.logout)` —— auth:'admin'，需从 Authorization header 提取 token 加入黑名单
- defineRoute 须支持 public 路由跳过 token 校验（在 handle() 内按 route.auth 分支：public → 跳过 buildCtx 鉴权）

### 6.3 AUTH_SECRET 读取与告警（D10）
- 模块级 `const AUTH_SECRET = process.env.AUTH_SECRET ?? 'dev-auth-secret-do-not-use-in-prod'`
- 启动时 `if (!process.env.AUTH_SECRET) console.warn('[auth] AUTH_SECRET 未设置，使用开发缺省值，生产必须覆盖')`
- 启动 banner 的 `auth_hint` 从 "X-User-Id / X-User-Role header" 改为 "Authorization: Bearer <token>"

### 6.4 seed 逻辑（D11）
- `seedDemoData()` 的 admin seed 追加 `password_hash: scryptHash('admin123')`
- seed 前查 `findByEmail('admin@example.com')` 幂等（已存在跳过）
- alice seed 是否补 password_hash 为 [advisory]（本期无 login alice 场景）

### 6.5 黑名单单例（D4）
- 模块级 `const tokenBlacklist = new Set<string>()`
- buildCtx G5 检查 `tokenBlacklist.has(token)`；logout handler 调 `tokenBlacklist.add(token)`

## 7. 实现提示（domain/service/repository/router，impl-writer 阶段，全 `[advisory]`）

> 本阶段不改 domain/service/repository/router。以下为 impl-writer 实现指引。

### 7.1 domain/auth.ts（纯函数，ARCH-001 合规）
- `signToken(payload: TokenPayload, secret: string): string` —— payload → JSON → base64url + HMAC-SHA256 签名
- `verifyToken(token: string, secret: string): { ok: true; payload: TokenPayload } | { ok: false; errorCode: 'TOKEN_INVALID' }` —— 拆分 payload/signature，HMAC 比对，tokenPayloadSchema 解析
- `hashPassword(password: string): string` —— scryptSync + randomBytes(16) salt → `salt.hash` 格式
- `verifyPassword(password: string, stored: string): boolean` —— 拆 salt/hash，scryptSync 比对（timingSafeEqual）
- 纯函数无 IO，与 domain/version.ts / domain/user.ts 同模式

### 7.2 repository
- `UserRepository`：insert/findByEmail 接受/返回 UserEntity（含 password_hash）；findById/listAll 返回时投影剥离 password_hash（返回 User）—— 或由 service 层投影（impl-writer 决定，[advisory]）
- 新增 `findByEmail(email: string): UserEntity | null`（login 用）
- 新增 `TokenBlacklistRepository`（可选，[advisory]）：封装 Set 操作；或 server.ts 直接用模块级 Set（MVP 简化，D4）

### 7.3 service/auth.ts
- `AuthService.login(input: LoginInput, ctx: Ctx): Promise<LoginResult>` —— B2~B4 + audit login
- `AuthService.logout(token: string, ctx: Ctx): Promise<LogoutResult>` —— blacklist.add + audit logout
- SEC-002：logout 须 requireAdmin(ctx)（auth:'admin'）；login 为 public 路由，service 层不调 requireAdmin（login 是获取凭据的入口，SEC-002-exempt: public login endpoint）

### 7.4 router/auth.ts
- `createAuthRouter(service: AuthService, auditService?: AuditLogService)` —— 返回 `{ login: Procedure, logout: Procedure }`
- login procedure `auth: 'public'`（上方注释 `// public: 登录入口，无需 token 即可访问`，SEC-001）
- logout procedure `auth: 'admin'`

## 8. ARCH-001 闭合论证

**论点**：Ctx 接口（context.ts）不变 → service/repo/domain/router 零变更，仅 server.ts 层换鉴权来源。

**论证**：
- `Ctx = { user: { id: string; role: 'admin'|'user' } }` 接口签名零变更（PRD Q11，D3 [约束]）
- service 层所有方法签名 `(input, ctx: Ctx) => Promise<...>` 不变 —— service 收到的 Ctx.user.id/role 与 token payload 一致（AC-F2-6），service 代码无感知来源是 header 还是 token
- repository 层存取 UserEntity（含 password_hash）是新增字段扩散，但 UserEntity 是 userSchema.extend 派生，既有 User 类型消费者（service 返回值、router 透传）零变更（D5 拆分保证）
- domain 层纯函数（signToken/verifyToken/hashPassword/verifyPassword）新增模块，不反向 import 上层
- router 层新增 authRouter（login/logout procedure），既有 router 零变更；procedure 类型 `Procedure<I, Ctx>` 复用
- **唯一变更层**：server.ts（buildCtx 来源替换 + login/logout 路由注册 + seed + 黑名单单例）—— 工程脚手架层，layerOf 返回 null，不受 ARCH-001 四层反向依赖约束

**结论**：ARCH-001 闭合 —— 鉴权来源是运行时入口层职责，不污染 domain/repository/service/router 四层。Ctx 接口不变是闭合的契约锚点。

## 9. 受影响测试清单（AI-006 两类标注）

> 严格遵守 AI-006：①类 grep 命中 + ②类手动分析，缺一记 blocker。
> grep 命令：`rg "userSchema|createUserInputSchema|errorCodeSchema|errorResponseSchema" apps/api/test/` 与 `rg "spawn\(|fetch\(|x-user-id|X-User-Id" apps/api/test/`

### ① 类：contracts 联动驱动（grep 命中，7 文件）

| # | 文件 | 引用符号 | 命中行 | 影响判定 | 同步方向 |
|---|------|----------|--------|----------|----------|
| 1 | `user.test.ts` | userSchema（parse 断言）、createUserInputSchema（safeParse）、ErrorCode（type） | L11,13,136-139,144-152,172,175,178,374,393,402 | **零修改**：userSchema 不变（D5 拆分保留输出 schema 不变）+ createUserInputSchema password optional 不破坏 `{email,name}` 样本 | 新增断言（③类 auth.test.ts）：createUserInputSchema 接受 password、userEntitySchema 含 password_hash、userSchema 拒绝 password_hash |
| 2 | `dept.test.ts` | userSchema（parse 断言，assign 出参） | L46,365,373,378,388,390,874,882 | **零修改**：userSchema 不变 | 无 |
| 3 | `etag-caching.test.ts` | userSchema.shape.version | L22,652,654 | **零修改**：userSchema 不变（version 仍在） | 无 |
| 4 | `notification.test.ts` | errorCodeSchema（[...options] SSOT 派生，含 4 NOTIFICATION_* 码） | L36,884,885 | **零修改**：errorCodeSchema 加 4 auth 码，containment 断言（含 NOTIFICATION_*）仍通过 | 无（SSOT 派生自动覆盖） |
| 5 | `report.test.ts` | errorCodeSchema（[...options]，含 REPORT_* 码） | L37,960,961 | **零修改**：同上，containment 断言 | 无 |
| 6 | `role-inheritance.test.ts` | errorCodeSchema（动态 import，[...options]，含 4 ROLE_INHERITANCE_* 码） | L674,676,677,678,679 | **零修改**：同上，containment 断言 | 无 |
| 7 | `optimistic-locking.test.ts` | errorCodeSchema（[...options]）、errorResponseSchema（parse current_version） | L23,452,454-456,464,466,474,476,483,485 | **零修改**：errorCodeSchema containment 断言 + errorResponseSchema 不变（current_version optional 仍在） | 无 |

①类小结：7 文件全部**零修改**。根因：D5 拆分（userSchema 输出不变）+ D6 password optional 不破坏既有样本 + D12 errorCodeSchema containment 派生断言 + errorResponseSchema 不变。新断言全部落在 ③类 auth.test.ts。

### ② 类：既有签名/行为变更驱动（手动分析，server.ts Ctx 来源 header mock → token）

**②-A 受影响（spawn 真实 server + fetch + X-User header，须改 login→Bearer）—— 2 文件：**

| # | 文件 | 命中证据 | 影响判定 | 需改的点 |
|---|------|----------|----------|----------|
| 1 | `etag-caching-embedding.test.ts` | `spawn('npx', ['tsx', 'apps/api/src/server.ts'])` L39；`'X-User-Id'/'X-User-Role'` headers L30-31；`fetch(BASE_URL+path, {headers})` L125 | **须改**：server.ts buildCtx 不再读 X-User-*，请求会 401 UNAUTHORIZED | beforeAll/beforeEach 改为先 `POST /v1/auth/login {email:'admin@example.com',password:'admin123'}` 拿 token，fetch headers 改为 `Authorization: Bearer <token>`，移除 X-User-Id/X-User-Role |
| 2 | `optimistic-locking-embedding.test.ts` | `spawn(...)` L33；`'X-User-Id'/'X-User-Role'` L24-25；`fetch(...)` L78 | **须改**：同上 | 同上：先 login 拿 token 再带 Bearer，移除 X-User headers |

**②-B 零影响（in-process 构造 Ctx，不经 server.ts，显式声明）—— 4 文件 + 全部 service 层测试：**

| # | 文件 | 证据 | 影响判定 | 同步方向 |
|---|------|------|----------|----------|
| 3 | `audit-embedding.test.ts` | 构造 `adminCtx: Ctx = { user: { id, role: 'admin' } }` 直接传 router handler，无 spawn/fetch | **零修改**：不经过 server.ts buildCtx，Ctx 直接构造 | 显式声明零影响 |
| 4 | `notification-embedding.test.ts` | 同上 in-process 模式 | **零修改** | 显式声明零影响 |
| 5 | `role-inheritance-embedding.test.ts` | 同上 in-process 模式 | **零修改** | 显式声明零影响 |
| 6 | `transfer-embedding.test.ts` | 同上 in-process 模式 | **零修改** | 显式声明零影响 |
| — | service 层单测（user/role/dept/notification/report/role-inheritance/transfer/optimistic-locking/etag-caching/audit.test.ts） | 均 `const adminCtx: Ctx = {...}` 直接构造，调 service/router handler | **零修改**：service 层测试直接构造 Ctx，不依赖 server.ts 鉴权来源 | 显式声明零影响 |

②类小结：**2 文件须改**（spawn+fetch+X-User → login→Bearer）+ **4 embedding 文件 + 10 service 层测试零影响**（in-process Ctx 构造，显式声明）。

> ⚠️ 与 PRD Q7 估算的差异：PRD Q7 写"AI-006 ②类影响=5 个 embedding 测试文件"。本 Spec 精确 grep + 手动分析显示：6 个 *-embedding.test.ts 中仅 2 个真正 spawn 真实 server + fetch + X-User header（etag-caching-embedding / optimistic-locking-embedding），其余 4 个 embedding 为 in-process Ctx 构造（不经 server.ts）。差异原因：PRD 估算时未区分"spawn 真实 server"与"in-process router 调用"两种 embedding 模式。本 Spec 以精确分析为准（AI-006 要求 test-writer 反向核实清单完整性）。记入 §10 advisory 偏离预判。

### ③ 类：新增测试（auth.test.ts + auth-embedding.test.ts，impl/test-writer 阶段）
- `auth.test.ts`（单测 + 契约测 + 行为）：
  - 契约：loginInputSchema 合法/非法、loginResultSchema/logoutResultSchema/tokenPayloadSchema .strict、userEntitySchema 含 password_hash、userSchema 拒绝 password_hash、createUserInputSchema 接受/拒绝 password、errorCodeSchema 含 4 AUTH 码（SSOT 派生）
  - domain 单测：signToken/verifyToken 往返、verifyToken 伪造→TOKEN_INVALID、hashPassword/verifyPassword 正确/错误、scrypt 格式 salt.hash
  - service 行为：login 成功签发、login 邮箱不存在→INVALID_CREDENTIALS、login 密码错→INVALID_CREDENTIALS（同码同 message 防枚举）、login password<8→VALIDATION_ERROR、logout 加黑名单
- `auth-embedding.test.ts`（端到端 AI-007 验收）：spawn 真实 server，覆盖 PRD AC 全链路：
  - AC-F1-1~F1-6（login 签发 + 审计）
  - AC-F2-1~F2-6（token 校验中间件 401 全链路：缺失/非Bearer/伪造/过期/有效/Ctx 一致）
  - AC-F3-1~F3-4（password_hash 不输出 + scrypt + 缺省密码 + 校验）
  - AC-F4-1~F4-4（logout 吊销 + TOKEN_REVOKED + 审计 + 需鉴权）
  - AC-F5-1~F5-3（seed 幂等 + 可登录）

## 10. advisory 偏离预判（参考 R9 S-1 ZodEffects 教训 + R10 S-2 路由覆盖教训）

> 提前标注可能偏离项，impl-writer 偏离时按 AI-003 流程反向同步。

1. **scrypt 同步 vs 异步**（D2 [advisory]）：`scryptSync` 阻塞事件循环。MVP 用同步（impl 简化）；若 impl-writer 改异步须 Promise 包装 + 反向同步 Spec。预判偏离概率：中（性能敏感场景可能触发）。
2. **AUTH_SECRET 缺省值字符串**（D10 [advisory]）：本 Spec 定 `'dev-auth-secret-do-not-use-in-prod'`，impl-writer 可选其他固定串。预判偏离概率：低。
3. **password_hash 分隔符 `.` vs `:`**（D2 [advisory]）：PRD 草图写 `salt:hash`，本 Spec 调整为 `salt.hash`。impl-writer 可回退 `:` 须反向同步。预判偏离概率：低。
4. **alice seed 是否补 password_hash**（D11 [advisory]）：本期无 login alice 场景，可不补或补随机密码。预判偏离概率：低。
5. **TokenBlacklistRepository 抽象 vs server.ts 模块级 Set**（D4/§7.2 [advisory]）：MVP 可直接用 Set；若 impl-writer 抽象 Repository 须同步。预判偏离概率：低。
6. **黑名单 TTL 清理**（D4 [advisory]）：过期 token 不主动清理，内存增长。impl-writer 可加定时清理。预判偏离概率：低。
7. **PRD Q7 "5 个 embedding 文件"估算与精确分析差异**（§9 ②类）：精确 grep 显示 2 个 spawn-based + 4 个 in-process。非偏离，仅估算口径差异，本 Spec 以精确分析为准。预判影响：test-writer 须按本 Spec 精确清单（2 改 + 4 声明）执行，勿按 PRD 估算盲改 5 个。
8. **过期+吊销同时成立返回码**（D9）：本 Spec 定 G4（过期）先于 G5（吊销）→ TOKEN_EXPIRED。impl-writer 若改 G5 先于 G4 须反向同步（影响 AC 组合场景，但 AC-F2-4/F4-2 分立测试不覆盖此组合）。预判偏离概率：低。
