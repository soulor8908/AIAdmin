---
doc_type: PRD-Spec
id: PRD-AUTH-001
title: 鉴权域（登录签发 token + token 校验中间件替换 header mock + 登出吊销）
status: decided
# Q&A 决策结果：Q1=②login+verify+logout / Q2=①HMAC不透明token / Q3=①scrypt零依赖 / Q4=②password_hash不输出 / Q5=①seed admin / Q6=①1小时 / Q7=②Bearer替换header / Q8=①黑名单 / Q9=认可 / Q10=认可 / Q11=认可 / Q12=①8位 / Q13=②无限速
owner: ba@team
created: 2026-07-02
extends: PRD-ETAG-CACHING-001
prd_ref: RETRO-ROUND10-001
---

# 鉴权域（登录签发 token + token 校验中间件替换 header mock + 登出吊销）

## 背景
前十轮演练（RETRO-ROUND10-001）已覆盖 CRUD / 审计埋点 / 报表聚合 / 事务补偿 / 递归继承 / HTTP 条件请求（If-Match 写条件 + ETag 读条件）。但整套系统的**鉴权始终是 mock**——[context.ts](file:///workspace/mvp/apps/api/src/context.ts) 从 `X-User-Id` / `X-User-Role` header 注入 `Ctx.user`，缺省为 admin，[server.ts](file:///workspace/mvp/apps/api/src/server.ts) 的路由分发据此构造调用上下文。这是生产可用性的最大阻断项：任何人发个 `X-User-Role: admin` header 即可越权全部写操作。

同时，规则体系里 SEC-001（路由默认受保护，声明式 auth 元数据）已要求每个 procedure 声明 `auth: 'admin' | 'public'`，但 `public` 至今**从未真正使用过**——所有路由都是 admin，因为没有"无需登录即可访问"的端点。SEC-002（service 层 requireAdmin）也只在 mock 之上运行。这意味着三条安全规则（SEC-001/002/003）从未在真实鉴权链路下端到端验证。

本期引入**鉴权域**验证以下未覆盖的工作流边界：

1. **登录签发 token**：用 email + password 换取签名 token，这是首个 `auth: 'public'` 路由，验证 SEC-001 的 public 声明机制真正生效。这是新业务域（非既有域扩展），须验证 spec-first 工作流对"安全域"的适应性。
2. **token 校验中间件替换 header mock**：server.ts 的 Ctx 构造来源从 `X-User-Role` header 切换为 `Authorization: Bearer <token>` 验签。这是运行时入口层的鉴权来源替换，须验证 ARCH-001 分层在"换鉴权来源不动 service/repo/domain"下的闭合性——Ctx 接口不变，只换来源。
3. **密码哈希存储**：User 实体追加 `password_hash` 字段（scrypt），响应不输出（SEC-003a）。这是 PII/敏感字段首次进入实体，须验证 SEC-003a（响应不返回未声明 PII）在密码字段下的闭合。
4. **登出吊销**：logout 将 token 加入黑名单，校验时检查。这是有状态会话管理首次引入，须验证 token 状态机（有效/过期/吊销）的校验编排。
5. **AI-007 端到端验收**：鉴权是跨层行为（HTTP Authorization header 解析 → token 验签 → Ctx 构造 → service requireAdmin → 响应），须端到端验收（无 token → 401、伪造 token → 401、过期 token → 401、有效 token → 200、logout 后再用 → 401）。

本期作为**新业务域**（auth）落地，是 R5 以来首个全新领域（前六轮为 CRUD 域扩展，R7-R10 为既有域的协议/事务扩展）。鉴权 = 登录签发 + token 校验中间件 + 登出吊销，是"安全域 + 运行时入口层替换 + 敏感字段管理"的最小完整场景。

## 业务目标
- **目标1（登录签发）**：`POST /v1/auth/login` 接受 `{email, password}`，校验密码后签发签名 token（含 sub/role/iat/exp），返回 `{token, expires_at}`。该路由 `auth: 'public'`，是首个真正落地的 public 路由。
- **目标2（token 校验中间件）**：server.ts 的 Ctx 构造从 `X-User-Id/X-User-Role` header 切换为 `Authorization: Bearer <token>` 验签；缺失/伪造/过期/吊销 → 401（UNAUTHORIZED / TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_REVOKED）。Ctx 接口不变，service/repo/domain/router 零变更。
- **目标3（密码哈希存储）**：User 实体追加 `password_hash` 字段（scrypt salt+hash），createUser 接受可选 password（缺省生成临时密码）；userSchema 输出不含 password_hash（SEC-003a `.strict()` 拒绝）。
- **目标4（登出吊销）**：`POST /v1/auth/logout` 将当前 token 加入内存黑名单，后续该 token 校验 → TOKEN_REVOKED。
- **目标5（内置 admin seed）**：server.ts 启动时若 admin 用户不存在则 seed（email `admin@example.com` / 默认密码 `admin123`），保证系统首次可登录。
- **目标6（验证工作流适应性）**：验证 SEC-001（public 路由首落地）、SEC-002（真实 token 驱动的 requireAdmin）、SEC-003a（password_hash 不输出）、ARCH-001（换鉴权来源不动四层）、AI-006（②类端到端测试改 Bearer）、AI-007（端到端验收 401 全链路）在安全域下是否闭合。

## 用户故事
- 作为管理员，我希望用邮箱+密码登录换取 token，后续请求携带 token 即可访问受保护资源，不再依赖可伪造的 X-User-Role header。
- 作为系统负责人，我希望密码以 scrypt 哈希存储，即使数据库泄漏攻击者也无法还原明文密码。
- 作为管理员，我希望登出后 token 立即失效，防止 token 被盗用后持续可用。
- 作为系统负责人，我希望系统首次启动时有一个内置 admin 账号可登录，避免"无任何账号可用"的冷启动死锁。
- 作为管理员，我希望登录失败时返回模糊错误（不暴露"邮箱存在但密码错" vs "邮箱不存在"），防止账号枚举攻击。
- 作为系统负责人，我希望受保护路由在 token 缺失/伪造/过期/吊销时分别返回明确的 401 错误码，便于客户端区分"未登录 / token 无效 / token 过期 / token 已吊销"。

## 功能点清单
- [ ] F1：登录签发 token（`POST /v1/auth/login`，`{email, password}` → `{token, expires_at}`，auth:'public'，密码错返回 INVALID_CREDENTIALS 401 模糊错误）
- [ ] F2：token 校验中间件（server.ts Ctx 构造从 header mock → Bearer 验签；缺失→UNAUTHORIZED、伪造→TOKEN_INVALID、过期→TOKEN_EXPIRED、吊销→TOKEN_REVOKED）
- [ ] F3：密码哈希存储（User 追加 `password_hash`，scrypt salt+hash；createUser 接受可选 password 缺省生成；userSchema 输出不含 password_hash）
- [ ] F4：登出吊销（`POST /v1/auth/logout`，当前 token 入黑名单，auth:'admin'；后续该 token → TOKEN_REVOKED）
- [ ] F5：内置 admin seed（server.ts 启动 seed admin@example.com/admin123，已存在则跳过）

## 数据实体草图
- **User 扩展字段**：`password_hash: z.string().min(1)`（scrypt 输出 `salt:hash` 格式，base64）。该字段为敏感字段，**仅写入存储，不在任何响应输出**（userSchema/userListResultSchema 不含此字段，SEC-003a）。
- **createUserInputSchema 扩展**：追加 `password: z.string().min(8).optional()`（缺省时 service 层生成临时密码并记审计日志，Q12 决策最低 8 位）。
- **Token payload（不透明，但语义对齐 JWT）**：
  - 结构：`base64url({ sub, role, iat, exp })` + `.` + `base64url(HMAC-SHA256(payload, SECRET))`
  - sub = 用户 id，role = 'admin'|'user'，iat = 签发秒，exp = iat + 3600（1 小时，Q6）
  - SECRET 来自环境变量 `AUTH_SECRET`，缺省为开发用固定值（生产必须覆盖，server.ts 启动告警）
- **Token 黑名单**：内存 `Set<string>`（token 字符串去重），logout 加入，校验时 `has(token)` → TOKEN_REVOKED。进程重启清空（MVP 可接受，持久化为未来方向）。
- **新增错误码（contracts 联动）**：
  - `INVALID_CREDENTIALS`：邮箱不存在或密码错（401，模糊错误不区分，防账号枚举）
  - `TOKEN_INVALID`：token 伪造/格式错（401）
  - `TOKEN_EXPIRED`：token 已过期（401）
  - `TOKEN_REVOKED`：token 已登出吊销（401）
- **既有错误码复用**：
  - `UNAUTHORIZED`：受保护路由缺失 Authorization header（401）
  - `VALIDATION_ERROR`：login body schema 校验失败（如 password 短于 8 位）
- **Ctx 接口不变**：`{ user: { id, role } }`，来源从 header mock 切换为 token 验签解析。service/repo/domain/router 零变更（ARCH-001 闭合关键）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

### F1 登录签发 token
- **AC-F1-1 正确凭据登录成功**：GIVEN seed 的 admin 用户（admin@example.com/admin123）/ WHEN POST /v1/auth/login `{email, password}` / THEN 200，响应体含 `token`（非空字符串）+ `expires_at`（未来时间）。
- **AC-F1-2 邮箱不存在**：GIVEN 无该邮箱用户 / WHEN login / THEN 401 INVALID_CREDENTIALS（message 不区分"邮箱不存在"与"密码错"）。
- **AC-F1-3 密码错误**：GIVEN admin 用户存在 / WHEN login 密码错 / THEN 401 INVALID_CREDENTIALS（与 AC-F1-2 相同错误码+message，防账号枚举）。
- **AC-F1-4 密码短于 8 位**：GIVEN 任意 / WHEN login password="123" / THEN 400 VALIDATION_ERROR（schema 层拒绝，非 INVALID_CREDENTIALS）。
- **AC-F1-5 login 路由 auth:'public'**：GIVEN 任意 / WHEN 不携带任何 token 访问 /v1/auth/login / THEN 进入 login 流程（非 401 UNAUTHORIZED，验证 SEC-001 public 生效）。
- **AC-F1-6 登录成功记审计**：GIVEN admin 用户 / WHEN login 成功 / THEN audit_log 落库一条 `entityType='auth' action='login'` 记录；登录失败也落库 `action='login_failed'`（防暴力破解审计依据）。

### F2 token 校验中间件
- **AC-F2-1 缺失 Authorization**：GIVEN 任意受保护路由（如 GET /v1/users）/ WHEN 不携带 Authorization header / THEN 401 UNAUTHORIZED。
- **AC-F2-2 非 Bearer scheme**：GIVEN 任意受保护路由 / WHEN Authorization: Basic xxx / THEN 401 TOKEN_INVALID（scheme 非 Bearer）。
- **AC-F2-3 伪造 token**：GIVEN 任意受保护路由 / WHEN Authorization: Bearer <随机字符串> / THEN 401 TOKEN_INVALID（验签失败）。
- **AC-F2-4 过期 token**：GIVEN 1 小时前签发的 token / WHEN 携带访问 / THEN 401 TOKEN_EXPIRED。
- **AC-F2-5 有效 token**：GIVEN 刚 login 的 token / WHEN 携带访问 GET /v1/users / THEN 200（Ctx.user 从 token 解析，role=admin 通过 SEC-002）。
- **AC-F2-6 Ctx 来源切换不破坏 service**：GIVEN 有效 token / WHEN 访问任意受保护路由 / THEN service 层收到 Ctx.user.id/role 与 token payload 一致（service 代码零变更，ARCH-001 闭合）。

### F3 密码哈希存储
- **AC-F3-1 password_hash 不出现在响应**：GIVEN 任意 user / WHEN GET /v1/users 返回 / THEN 响应体不含 `password_hash` 字段（SEC-003a，userSchema.strict() 拒绝）。
- **AC-F3-2 scrypt 哈希存储**：GIVEN createUser 带 password / WHEN 创建成功 / THEN 存储的 password_hash 为 `salt:hash` 格式，非明文。
- **AC-F3-3 createUser 缺省 password**：GIVEN createUser 不带 password / WHEN 创建成功 / THEN service 生成临时密码（记审计日志），用户可用临时密码登录。
- **AC-F3-4 密码校验**：GIVEN scrypt 哈希 / WHEN login 传入正确密码 / THEN 校验通过；传入错误密码 / THEN 校验失败。

### F4 登出吊销
- **AC-F4-1 logout 成功**：GIVEN 有效 token / WHEN POST /v1/auth/logout / THEN 200，token 入黑名单。
- **AC-F4-2 logout 后 token 失效**：GIVEN 已 logout 的 token / WHEN 携带访问任意受保护路由 / THEN 401 TOKEN_REVOKED。
- **AC-F4-3 logout 记审计**：GIVEN 有效 token / WHEN logout / THEN audit_log 落库 `entityType='auth' action='logout'`。
- **AC-F4-4 logout 需鉴权**：GIVEN 无 token / WHEN POST /v1/auth/logout / THEN 401 UNAUTHORIZED（logout 路由 auth:'admin'，非 public）。

### F5 内置 admin seed
- **AC-F5-1 首次启动 seed**：GIVEN 空库 / WHEN server.ts 启动 / THEN admin 用户被 seed（email=admin@example.com, role=admin, status=active）。
- **AC-F5-2 重复启动不重复 seed**：GIVEN admin 已存在 / WHEN server.ts 再次启动 / THEN 不重复创建 admin（幂等）。
- **AC-F5-3 seed 后可登录**：GIVEN 首次启动 seed 完成 / WHEN login admin@example.com/admin123 / THEN 200 返回 token。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · 鉴权域范围？**
BLOCKING。方案①仅 login + verify（最小）；方案②login + verify + logout（含吊销）；方案③login + verify + logout + refresh（完整会话）。本期选哪个？推荐②（logout 验证有状态会话管理，token 状态机更完整；refresh 引入双 token 复杂度，为未来方向）。

**Q2 · token 机制？**
BLOCKING。方案①HMAC-SHA256 签名的不透明 token（payload+signature，零新依赖 node:crypto，语义对齐 JWT 但不用 JWT 库）；方案②引入 jsonwebtoken 库（标准 JWT）；方案③随机 token + 服务端存储（无签名）。本期选哪个？推荐①（项目精神"零新依赖"，node:crypto 原生 HMAC 足够；不透明指客户端不解析 payload，但服务端用 HMAC 验签防伪造）。

**Q3 · 密码哈希算法？**
BLOCKING。方案①scrypt（node:crypto 内置，零依赖，现代推荐）；方案②bcrypt（引入依赖）；方案③argon2（引入原生依赖）。本期选哪个？推荐①（零新依赖，scrypt 是 OWASP 推荐的现代算法，node 原生支持）。

**Q4 · password_hash 字段处理？**
BLOCKING。方案①单独 credential 表（user 不加字段，关联 password_hash）；方案②User 加 password_hash 字段但不输出（SEC-003a）。本期选哪个？推荐②（MVP 简化，单表；SEC-003a .strict() 保证不泄漏；credential 表为未来拆分方向）。

**Q5 · 内置 admin seed？**
BLOCKING。方案①seed admin@example.com/admin123（首次启动可登录，避免冷启动死锁）；方案②不 seed（须手动创建首个账号）。本期选哪个？推荐①（避免"无任何账号可用"死锁；默认密码可在审计日志告警提示修改，但 MVP 不强制）。

**Q6 · token 有效期？**
BLOCKING。方案①1 小时（短时，安全性高）；方案②24 小时（长时，用户体验好）；方案③7 天。本期选哪个？推荐①（短时，配合 logout 吊销已足够；refresh 为未来方向）。

**Q7 · 现有 header mock 如何处理？**
BLOCKING。方案①保留 X-User-Role 作为测试旁路（生产禁用）；方案②完全替换为 Bearer token，废弃 X-User-Role。本期选哪个？推荐②（彻底替换，避免"测试旁路变生产后门"风险；既有端到端测试改为先 login 拿 token 再带 Bearer，AI-006 ②类影响=5 个 embedding 测试文件）。

**Q8 · logout 吊销机制？**
BLOCKING。方案①内存黑名单 Set（MVP，进程重启清空）；方案②持久化黑名单（DB）；方案③token 短时+不吊销（依赖过期）。本期选哪个？推荐①（MVP 简化，内存 Set 足够验证吊销语义；持久化为未来方向）。

**Q9 · login 错误模糊性（防账号枚举）？**
BLOCKING。邮箱不存在与密码错返回相同 INVALID_CREDENTIALS + 相同 message（不区分"邮箱不存在"），防账号枚举攻击。审计日志可记录真实原因（login_failed + reason），但响应不区分。是否认可？

**Q10 · 新增错误码与 HTTP 映射？**
BLOCKING。`INVALID_CREDENTIALS`(401)、`TOKEN_INVALID`(401)、`TOKEN_EXPIRED`(401)、`TOKEN_REVOKED`(401)。复用 `UNAUTHORIZED`(401，缺失 header)。errors.ts 补齐 4 码映射。是否认可？

**Q11 · Ctx 接口是否变更？**
BLOCKING。Ctx 接口不变（`{ user: { id, role } }`），只换来源（header mock → token 验签）。service/repo/domain/router 零变更。这是 ARCH-001 闭合的关键设计——鉴权来源是运行时入口层职责，不污染四层。是否认可？

**Q12 · 密码强度策略？**
BLOCKING。方案①最低 8 位（基础）；方案②8位+含字母数字（中等）；方案③8位+大小写+数字+符号（强）。本期选哪个？推荐①（MVP 基础，schema 层 min(8) 拒绝；强密码策略为未来方向）。

**Q13 · 登录限速？**
BLOCKING。方案①限速（如 5 次/分钟/IP）；方案②不限速（MVP，靠审计日志观测）。本期选哪个？推荐②（限速为工程化方向，本期靠 login_failed 审计日志观测；限速中间件为未来方向）。

## Out of scope
- refresh token / 双 token 机制 —— 本期仅 access token，refresh 为未来会话管理方向（Q1 决策）。
- 注册（register/self-service signup）—— 本期用户由 admin 创建，注册为未来方向。
- 密码重置 / 忘记密码 —— 本期不涉及，为未来方向。
- 持久化 token 黑名单 —— 本期内存 Set，进程重启清空，DB 持久化为未来方向（Q8 决策）。
- 登录限速中间件 —— 本期靠审计日志观测，限速为未来工程化方向（Q13 决策）。
- OAuth / SSO / 第三方登录 —— 本期仅本地账号，第三方为未来方向。
- RBAC 细粒度权限（role:'user' 的具体权限）—— 本期 role 仅区分 admin/user，细粒度权限复用 R8 role-inheritance。
- AUTH_SECRET 轮换 / 密钥管理 —— 本期固定 SECRET，轮换为未来运维方向。
- OpenAPI yaml 同步（auth.openapi.yaml）—— 记为遗留同步项，沿用既有先例（R5 起各轮均未同步 yaml）。
