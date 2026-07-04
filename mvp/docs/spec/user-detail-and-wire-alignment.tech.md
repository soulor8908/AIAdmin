---
doc_type: Tech-Spec
id: TECH-USER-DETAIL-WIRE-001
title: 用户详情端点补齐 + 错误响应 wire 字段名对齐 Tech-Spec（消除 R12 D10/D19 两项 advisory 偏离）
prd_ref: PRD-USER-DETAIL-WIRE-001
status: decided
owner: tech-lead@team
created: 2026-07-03
extends: TECH-WEB-AUTH-USER-001
aligns: [TECH-USER-001, TECH-OPTIMISTIC-LOCKING-001, TECH-ETAG-CACHING-001, TECH-AUTH-001]
---

# TECH-USER-DETAIL-WIRE-001 · 用户详情端点补齐 + 错误响应 wire 字段名对齐 Tech-Spec

> 派生自 PRD-USER-DETAIL-WIRE-001（status=decided，24 条 AC + 8 条 BLOCKING Q&A 全拍板）。
> 本轮承接 R12 复盘遗留的两项 advisory 偏离消除：
> - **D10 [advisory] 消除**（R12 §1.2）：后端 server.ts wire 响应体字段名 `error` 对齐 contracts `errorResponseSchema.code`，前端 client 删除 wire 适配层。
> - **D19 [advisory] 消除**（R12 §1.3）：补 `GET /v1/users/:id` 单条详情端点，闭合 user 域 detail gap。
> **contracts 本轮零变更**（Q2 不扩 errorCodeSchema + Q8 复用 userSchema）；**errors.ts 零变更**（USER_NOT_FOUND 已映射 404）。
> 本阶段只产本文档；server.ts / router / service / client.ts 改动均由 impl-writer 阶段落地（§4/§5 描述为设计 + 实现提示）。

## 1. 概述 + 既有路由表核验（R10 S-2 教训闭合）

### 1.1 轮次定位

R12（前端首轮）复盘 `docs/retro/round12-retro.md` §6「剩余改进项」显式列出两项后续消除方向：③后端对齐 wire 字段名消除 D10 适配；④补 `GET /v1/users/:id` 端点消除 D19 不 GET 偏离。本轮（R18）承接这两项消除，合并为单轮（PRD Q5 决策：同源 R12 retro + 同 user 域 + wire 测试耦合 + 规模可控）。

两项改动虽分属"对齐"与"补齐"，但 D10 字段名对齐的影响面天然包含 D19 新端点的错误响应（404 USER_NOT_FOUND / 400 VALIDATION_ERROR 须用新 `code` 字段），测试相互交织，合并一轮避免跨 PRD 测试依赖。

### 1.2 既有路由表核验（R10 S-2 教训：Spec 须核验既有路由表）

R10 S-2 教训：BA/Tech Lead 涉及端点改动须 grep server.ts routes 确认非覆盖既有。本节核验 `apps/api/src/server.ts` routes 数组（L221-374）。

**核验一：GET /v1/users/:id 是否已存在**

grep `defineRoute(`/`/v1/users` 命中结果（L240-249）：

| 行 | 路由 | method | 段数 | auth | versioned | cacheable |
|----|------|--------|------|------|-----------|-----------|
| L240 | `/v1/users` | GET | 2 | admin | false | true（listEtag） |
| L241 | `/v1/users` | POST | 2 | admin | false | false |
| L242-246 | `/v1/users/:id/status` | PATCH | 4 | admin | true | false |
| L249-261 | `/v1/users/:userId/transfer` | POST | 4 | admin | true | false |

**结论**：user 域仅 4 端点，**无 `GET /v1/users/:id`（3 段）单条详情端点**。与 PRD §1.2 + R12 retro §1.3 + web-auth-user.tech.md §1.2 核验一致。R10 S-2 教训闭合——本轮新增非覆盖既有。

**核验二：新增是否与既有路由冲突（AC-G10）**

`matchRoute` 按 method + 段数匹配。`GET /v1/users/:id`（3 段）与：

| 既有路由 | method | 段数 | 冲突判定 |
|----------|--------|------|----------|
| `GET /v1/users`（列表） | GET | 2 | 段数不同 → 不冲突 |
| `PATCH /v1/users/:id/status` | PATCH | 4 | method + 段数不同 → 不冲突 |
| `POST /v1/users/:userId/transfer` | POST | 4 | method + 段数不同 → 不冲突 |
| `GET /v1/users/:userId/roles`（L276） | GET | 4 | 段数不同（3 vs 4）→ 不冲突 |
| `GET /v1/users/:userId/effective-permissions`（L311） | GET | 4 | 段数不同（3 vs 4）→ 不冲突 |

**结论**：`GET /v1/users/:id`（3 段 GET）与全部既有 user 域路由 method + 段数均不同，无 matchPattern 冲突（AC-G10）。

**核验三：wire 字段名现状**

grep `error:` 命中 7 处（L532/552/554/563/594/602/611），均为 `{ error: <code>, message, ... }` wire 格式。contracts `errorResponseSchema`（user.ts L218-224）字段名 `code`。**二者不一致**（D10 待消除）。详见 §4.1 改动清单。

**核验四：detail 端点参考模式 + 复用资产**

| 资产 | 位置 | 复用结论 |
|------|------|----------|
| GET /v1/roles/:id（detail 参考） | server.ts L266-270 | `cacheable=true + detailEtag + roleRouter.detail` 模式，user detail 对齐 |
| GET /v1/notifications/:id（detail 参考） | server.ts L349-353 | 同上 |
| `detailEtag` helper | src/etag.ts L21-25 | 已导出，基于实体 `version` 生成 `"N"`，user detail 直接复用 |
| `parseIfNoneMatch` helper | src/etag.ts L56-62 | 已导出（宽容解析），handle() 已调用 |
| handle() cacheable 304 分支 | server.ts L578-588 | 既有逻辑，GET detail 复用，无需改 handle() |
| `repository.findById(id)` | repository/user.ts L103-106 | **已存在**，返回 `UserEntity \| undefined`（R10 D3 注预测正确），service 直接复用 |
| `toUserOutput` 投影 | domain/user.ts | 剥离 password_hash（SEC-003a），与 list/create/updateStatus 同模式 |
| `errorCodeSchema` 含 USER_NOT_FOUND | contracts/user.ts L127 | 已在枚举，无需扩 |
| `errorCodeToHttpStatus.USER_NOT_FOUND` | errors.ts L27 | 已映射 404，无需改 |

**结论**：GET detail 端点补齐所需的协议层（ETag/304）、数据层（findById）、契约层（userSchema/USER_NOT_FOUND）资产全部就绪，本轮仅新增 router procedure + service 方法 + server.ts 路由注册，零协议层/契约层改动。

## 2. 架构决策（D1-D10）

> 每个决策显式标注 `[约束]`（默认禁止偏离，偏离须经 AI-003 流程 + Reviewer 确认）或 `[advisory]`（允许偏离，须反向同步 §8）。本节为本轮新增决策；既有 D8/D9/D10/D19/D21（来自 TECH-WEB-AUTH-USER-001）的处置在对应决策中声明。

### D1 · wire 字段名对齐 error→code（消除既有 D10）`[约束]`

server.ts 全部 7 处错误响应体字段名由 `error` 改为 `code`，与 contracts `errorResponseSchema.code` 对齐（Q1 接受 breaking change，MVP 无外部消费者，前端 + 测试本轮同步）。

改动点（详见 §4.1）：L532 NOT_FOUND / L552 VERSION_REQUIRED / L554 VALIDATION_ERROR（If-Match 格式）/ L563 VALIDATION_ERROR（safeParse，含 D21 issues 保留）/ L594 AppError catch（`error: e.code` → `code: e.code`，meta 合并不变）/ L602 INTERNAL_ERROR / L611 INTERNAL_ERROR（fatal）。

**消除既有 D10**：TECH-WEB-AUTH-USER-001 §4.6 + D10 [advisory] 标注的反向同步移除（详见 §11）。前端 client `parseErrorResponse` 删除读 `raw.error` 的 wire 适配，改读 `raw.code`（D8）。

### D2 · 补 GET /v1/users/:id detail 端点（消除既有 D19）`[约束]`

新增 `GET /v1/users/:id` 端点，返回单条 User（对齐 contracts `userSchema`，不含 password_hash，SEC-003a）+ 404 USER_NOT_FOUND + ETag cacheable（D5）。路由注册位置在 `GET /v1/users` 之后、`PATCH /v1/users/:id/status` 之前（user 域读端点聚拢，AC-G11）。

**消除既有 D19**：TECH-WEB-AUTH-USER-001 §1.2 + D19 [advisory] 标注的反向同步移除（详见 §11）。端点 gap 闭合后，前端 future 轮次可消费 `getUser(id)`（AC-G13 future-ready，本轮不强制实现）。

### D3 · 既有 D9 重分类为 `[约束]`（409 current_version 重试链保留）`[约束]`

R12 D9（409 VERSION_CONFLICT 响应体 `current_version` 重试 PATCH 1 次）原记为 [advisory]-adjacent（因 GET 端点缺失而改用 409 body 重试的临时妥协）。本轮 D19 端点 gap 闭合后，D9 不再是"因端点缺失的临时偏离"，而是**client 设计选择 409-retry 的正式决策**（Q6 决策①）：

- D9 无额外 round trip（409 body 已含 current_version，直接重试）；
- 已测试且工作（R12 §1.4 组合副作用 #1/#3 验证）；
- GET-retry 多一次 round trip 且须处理 GET 也 409 的边缘场景，复杂度更高。

故 D9 **重分类为 `[约束]`**（client 重试策略固定为 409-retry，不切换为 GET-retry）。本轮 client 重试逻辑**不变**（仅 wire 字段名 error→code），409 重试用例不断言发 GET（AC-W9）。补 GET 端点的价值在于闭合 D19 gap + future 用户详情页消费 + 提供 GET-retry 可选项，非强制切换重试策略。

### D4 · GET detail 鉴权与权限 = admin + user:read（SEC-002 service 层）`[约束]`

GET /v1/users/:id 采用 admin 鉴权 + `user:read` 权限（Q3 决策①），与 GET /v1/users（列表）一致（同为 user 域读操作）。

**SEC-002 落地模式（本 MVP 现状对齐）**：本 MVP 的 SEC-002 越权校验在 service 层实现为 `requireAdmin(ctx)`（判 `ctx.user.role !== 'admin'`，非 admin 抛 FORBIDDEN 403）。user 域 list/create/updateStatus 与 role 域 list/getById/create 均沿用此模式。`permissionCodeSchema` 已含 `user:read`（contracts），admin 角色授予全部权限码（含 user:read）——故 `requireAdmin` 即 `user:read` 权限的强制点（admin = 持 user:read）。**新 `getById` 镜像既有 `requireAdmin` 模式**（与 roleService.getById L56-64 一致），不引入新的 permission-code 细粒度校验机制（避免越界引入新鉴权模式）。AC-G6 越权（role ≠ admin）→ service 抛 FORBIDDEN 403，与 GET /v1/users 越权行为一致。

**鉴权守卫执行顺序**：buildCtx（L541，Bearer 验签 G1-G5）→ safeParse → handler（含 requireAdmin）。无 token / token 无效 / 过期 / 吊销 → buildCtx 抛 401 系列（AC-G4/G5）；role ≠ admin → service requireAdmin 抛 FORBIDDEN 403（AC-G6）；id 不存在 → service 抛 USER_NOT_FOUND 404（AC-G2）。先到先返，不叠加。

### D5 · GET detail ETag 必选（cacheable=true + detailEtag 基于 version）`[约束]`

GET /v1/users/:id 标记 `cacheable=true + buildEtag=detailEtag`（Q4 决策①），对齐 R10 detail 端点模式（GET /v1/roles/:id L266-270 + GET /v1/notifications/:id L349-353）。

- **ETag 生成**：`detailEtag(result)` 基于 User.version，格式 `"${version}"`（RFC 7232 强 ETag，复用 src/etag.ts L21-25）。
- **If-None-Match 协商**：复用既有 handle() cacheable 分支（server.ts L578-588）。匹配 → 304 空体 + ETag header（AC-G8）；不匹配/缺失/非法格式 → 200 + 最新 User body + 新 ETag header（AC-G9，parseIfNoneMatch 宽容解析）。
- **ETag 是 HTTP 层语义**（ARCH-001 不污染领域层）：service 不感知 ETag，server.ts 声明式注入。userSchema 已含 version 字段，detailEtag 直接提取。
- **路由元数据**：`versioned=false`（读操作无 If-Match）+ `cacheable=true` + `buildEtag=detailEtag`。

### D6 · GET detail 响应复用既有 userSchema（不新增 userResponseSchema，Q8）`[约束]`

GET /v1/users/:id 成功响应直接复用 contracts `userSchema`（Q8 决策），**不新增 `userResponseSchema` 别名**。理由：

- GET /v1/roles/:id 复用 `roleSchema`、GET /v1/notifications/:id 复用 `notificationSchema`，均无独立 `*ResponseSchema` 别名（R10 模式）；
- user detail 响应与 GET /v1/users 列表 `items[]` 元素、PATCH /v1/users/:id/status 成功响应同 schema（均 `userSchema`）；
- 新增别名徒增 contracts 表面积且违背 ARCH-002 纯净层（无业务意义的别名）。

**响应类型**：`User = z.infer<typeof userSchema>`（含 id/name/email/status/department_id/created_at/updated_at/version，**不含 password_hash** SEC-003a）。

### D7 · 非 contracts 码（NOT_FOUND/INTERNAL_ERROR）保持 client fallback，不扩 errorCodeSchema（Q2）`[约束]`

server.ts 的 `NOT_FOUND`（通用 404 无路由）与 `INTERNAL_ERROR`（500）**不在 contracts `errorCodeSchema` 枚举内**。本轮 D1 字段名对齐后，client `parseErrorResponse` 仍走 `errorCodeSchema.safeParse(raw.code)` + fallback：

- `INTERNAL_ERROR` round-trip 正确：server 发 `{ code: 'INTERNAL_ERROR' }` → client safeParse 失败（非枚举）→ fallback `INTERNAL_ERROR`（前端本地码 `LocalErrorCode`），值一致；
- `NOT_FOUND`（通用 404）降级 `INTERNAL_ERROR`（SPA 仅调已知端点，无路由 404 是边缘场景），行为不变无回归（AC-W8）。

**不扩 errorCodeSchema**（Q2 决策②）：本轮目标是消除 D10（wire 字段名适配），非"使所有错误码入 contracts"。扩 contracts 触发跨域 ①类隐式 impact（`[...errorCodeSchema.options]` containment 断言失效，涉及 notification/report/role-inheritance/optimistic-locking 多域测试），违背"最小 churn 消除 D10"原则。`INTERNAL_ERROR`/`NOT_FOUND` 入 errorCodeSchema 列为 future advisory（与 D21 issues 同类，未来"contracts 完整化"轮处理，§12）。

### D8 · client parseErrorResponse 删除 wire 适配，改读 raw.code（保留手动读字段，D21 issues 仍丢弃，Q7）`[约束]`

前端 `apps/web/src/api/client.ts` `parseErrorResponse`（L74-87）：

- **删除 wire 适配**：`raw.error` → `raw.code`（L76），注释移除"wire 适配 error→code（D10 [advisory]）"措辞（L6, L12-14, L33, L68-72）；
- **保留 safeParse + fallback**：`errorCodeSchema.safeParse(raw.code)` 成功 → contracts ErrorCode；失败 → `INTERNAL_ERROR`（非 contracts 码 fallback，D7）；
- **保留手动读字段**（不 `errorResponseSchema.parse(body)` 直校）：因 D21 issues 仍存在（Q7 不本轮消除），`errorResponseSchema` 的 `.strict()` 会拒绝含 issues 的 body。故继续手动读 `raw.code` / `raw.message` / `raw.current_version`，issues 丢弃；
- **`message`/`current_version` 字段名**：wire 与 contracts 一致，无需重命名；
- **401 拦截链（既有 D8）+ 409 重试链（既有 D9）**：仅字段名 error→code，分支逻辑不变（AC-W9/W10）。

### D9 · 路由注册位置与无冲突（AC-G10/G11）`[约束]`

`GET /v1/users/:id` 注册于 routes 数组 `GET /v1/users`（L240）之后、`PATCH /v1/users/:id/status`（L242）之前——user 域读端点聚拢（GET list + GET detail 相邻）。与既有 4 个 user 域路由 + 2 个 user 子资源路由（`GET /v1/users/:userId/roles` / `GET /v1/users/:userId/effective-permissions`）均无 method + 段数冲突（详见 §1.2 核验二）。

### D10 · advisory 偏离反向同步（D10/D19 移除标注，web-auth-user.tech.md 同步）`[约束]`

本轮消除两项 advisory 偏离，须反向同步既有 Spec（AI-003）：

- **D10 [advisory] 移除**：TECH-WEB-AUTH-USER-001 §4.6 + D10 标注移除（或改为"R18 已消除"历史记录）；client.ts 注释移除"wire 适配 error→code（D10 [advisory]）"措辞；
- **D19 [advisory] 移除**：TECH-WEB-AUTH-USER-001 §1.2 + D19 标注移除（端点 gap 已闭合）；D9 重分类为 `[约束]`（D3）。

详见 §11 反向同步清单。

## 3. contracts 联动（零变更声明 + 理由）

### 3.1 零变更声明

`packages/contracts/src/schemas/user.ts` **本轮零变更**：

| 资产 | 现状 | 本轮处置 | 理由 |
|------|------|----------|------|
| `errorResponseSchema` | 字段名 `code`（L220） | 零变更 | 已与 D1 对齐目标一致，无需改 |
| `errorCodeSchema` | 含 USER_NOT_FOUND（L127），不含 NOT_FOUND/INTERNAL_ERROR | 零变更（Q2 不扩） | 扩枚举触发跨域 ①类隐式 impact，违背最小 churn（D7） |
| `userSchema` | 含 version + 不含 password_hash（L24-37） | 零变更（Q8 复用） | GET detail 响应直接复用，不新增 userResponseSchema（D6） |
| `userEntitySchema` | 含 password_hash（L50-54） | 零变更 | 存储实体，service 投影剥离 password_hash 后输出 userSchema |

`apps/api/src/errors.ts` **零变更**：`errorCodeToHttpStatus.USER_NOT_FOUND` 已映射 404（L27），无需新增码或改映射。

### 3.2 零变更理由（Q2 + Q8 决策落地）

**Q2 不扩 errorCodeSchema**：本轮目标是消除 D10（wire 字段名适配），非"使所有错误码入 contracts"。NOT_FOUND（通用 404）/INTERNAL_ERROR（500）保持 client fallback（D7）。扩 contracts 会使 `[...errorCodeSchema.options]` containment 断言失效（notification/report/role-inheritance/optimistic-locking 多域测试的 ①类隐式影响），违背最小 churn 原则。故 errorCodeSchema 枚举值不变 → ①类隐式影响 = 0（详见 §7）。

**Q8 复用 userSchema**：GET detail 响应与列表/状态更新成功响应同 schema（均 userSchema），新增 `userResponseSchema` 别名徒增表面积且违背 ARCH-002 纯净层（D6）。GET /v1/roles/:id 复用 `roleSchema`、GET /v1/notifications/:id 复用 `notificationSchema` 均无别名，user detail 对齐此模式。

**ARCH-002 闭合**：contracts 纯净层（只 Zod schema + z.infer），本轮无业务逻辑注入、无新 schema、无枚举扩展。三层联动（contracts + server + client）仅 server/client 改动，contracts 冻结。

## 4. 后端设计

### 4.1 server.ts wire 字段名对齐（D1，7 处 error→code）

| 行 | 触发场景 | 改动前 | 改动后 | AC |
|----|----------|--------|--------|----|
| L532 | 404 无路由匹配 | `{ error: 'NOT_FOUND', message }` | `{ code: 'NOT_FOUND', message }` | AC-W5 |
| L552 | 400 缺 If-Match | `{ error: 'VERSION_REQUIRED', message }` | `{ code: 'VERSION_REQUIRED', message }` | AC-W3 |
| L554 | 400 If-Match 格式非法 | `{ error: 'VALIDATION_ERROR', message }` | `{ code: 'VALIDATION_ERROR', message }` | AC-W4 |
| L563 | 400 safeParse 失败 | `{ error: 'VALIDATION_ERROR', message, issues }` | `{ code: 'VALIDATION_ERROR', message, issues }`（issues 保留 D21，Q7 不消除） | AC-W2 |
| L594 | AppError catch | `{ error: e.code, message: e.message, ...meta }` | `{ code: e.code, message: e.message, ...meta }`（meta 合并不变，VERSION_CONFLICT 的 current_version 仍填充） | AC-W1 |
| L602 | 500 未捕获 | `{ error: 'INTERNAL_ERROR', message }` | `{ code: 'INTERNAL_ERROR', message }` | AC-W6 |
| L611 | 500 fatal | `{ error: 'INTERNAL_ERROR', message }` | `{ code: 'INTERNAL_ERROR', message }` | AC-W6 |

**关键不变项**：
- L594 `e.meta` 合并逻辑不变（VERSION_CONFLICT 409 仍携带 `current_version`，D9 重试链不破坏，AC-W9）；
- L563 `issues` 字段保留（D21 [advisory] 不本轮消除，Q7）；
- L532 `NOT_FOUND` / L602/L611 `INTERNAL_ERROR` 仍为非 contracts 码（client fallback 不变，D7）。

### 4.2 server.ts 新增 GET /v1/users/:id 路由（D2/D5/D9）

routes 数组新增（注册位置：`GET /v1/users` L240 之后、`PATCH /v1/users/:id/status` L242 之前）：

```ts
// ---- user detail（TECH-USER-DETAIL-WIRE-001 D2，消除 D19 端点 gap）----
defineRoute('GET', '/v1/users/:id', (m) => ({ id: m.path.id }), {
  input: userDetailProcedureInputSchema,
  handler: userRouter.detail.handler,
  auth: userRouter.detail.auth,
}, false, true, detailEtag),
```

- `buildInput`：`(m) => ({ id: m.path.id })`（path 参数 id，与 GET /v1/roles/:id L266 同模式）；
- `procedure`：内联 `{ input, handler, auth }` 引用 `userRouter.detail`（§4.3）；
- `versioned=false`（读操作无 If-Match）+ `cacheable=true` + `buildEtag=detailEtag`（D5，对齐 GET /v1/roles/:id L270）；
- `detailEtag` 已 import（server.ts 顶部，与 GET /v1/roles/:id 共用）。

**handle() 复用既有 ETag 304 分支**（server.ts L578-588）：cacheable=true 路由 handler 成功后生成 ETag + 比对 If-None-Match，匹配 → 304 空体 + ETag header（AC-G8），不匹配/缺失/非法 → 200 + body + ETag header（AC-G9）。**无需改 handle()**（R10 协议层已就绪）。

### 4.3 buildCtx 鉴权守卫（D4，复用既有）

`buildCtx(req, route.auth)`（L541）在 buildInput/safeParse 之前执行 Bearer 验签（G1-G5，TECH-AUTH-001 D3/D8）：

- `auth='admin'`（GET detail 非 public）→ 验签失败抛 AppError（401 系列：UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED），由 catch 块（L590-597）转 HTTP 响应（AC-G4/G5）；
- 验签成功 → 构造 `Ctx { user: { id, role } }` → 传 handler。

**GET detail 复用既有 buildCtx**，无需新增守卫逻辑。鉴权先于 safeParse 确保 AC-G4（无 token → 401 UNAUTHORIZED，非 400）。

### 4.4 router/user.ts 新增 detail procedure（D2）

`apps/api/src/router/user.ts` 新增：

```ts
// detail procedure 入参 = path id (uuid)（读操作，无 expected_version）。
// 对齐 roleDetailProcedureInputSchema（router/role.ts L31-33）模式。
// [约束] 演进（R18 反向同步，AI-003 [约束] 项偏离处理流程闭合）：
//   原始声明不带 .strict()；test-writer 在 AC-G3 单测（user-detail.test.ts L219-221）
//   扩展断言"多余字段 → 拒绝"，impl-writer 依据 AI-002 添加 .strict() 满足测试。
//   理由成立：加性安全（更严格非更弱，拒绝未知入参符合最小信任原则）+ 验收对齐
//   （AC-G3 单测 + 端到端 AC-G1~G11 全绿）+ 三件套全绿。Reviewer G6 验收非阻断。
export const userDetailProcedureInputSchema = z.object({
  id: z.string().uuid(),
}).strict();
```

`UserRouter` 类型新增 `detail: Procedure<z.infer<typeof userDetailProcedureInputSchema>, User>`。

`createUserRouter` 新增 `detail` procedure（不经 withAudit——读操作不埋审计，沿用 GET /v1/users / GET /v1/roles/:id 不埋点惯例）：

```ts
detail: {
  input: userDetailProcedureInputSchema,
  handler: (input, ctx) => service.getById(input.id, ctx),
  auth: 'admin',
},
```

### 4.5 service/user.ts 新增 getById（D2/D4）

`UserService` 新增 `getById` 方法（镜像 roleService.getById L56-64）：

```ts
/**
 * GET /v1/users/:id 单条详情（TECH-USER-DETAIL-WIRE-001 D2，消除 D19）。
 * 守卫顺序：B3 鉴权（SEC-002 requireAdmin）→ B5 用户存在（USER_NOT_FOUND）。
 * [约束] SEC-002：service 入口 requireAdmin(ctx)（admin = 持 user:read，D4）。
 * [约束] SEC-003a：经 toUserOutput 剥离 password_hash 后返回（userSchema 1:1）。
 */
async getById(id: string, ctx: Ctx): Promise<User> {
  this.requireAdmin(ctx);
  // B5: 目标不存在
  const target = this.repo.findById(id);
  if (!target) {
    throw new AppError('USER_NOT_FOUND', `用户不存在: ${id}`);
  }
  // TECH-AUTH-001 D5：剥离 password_hash（SEC-003a 输出 schema 1:1）
  return toUserOutput(target);
}
```

- `requireAdmin(ctx)`：SEC-002 越权校验（D4），role ≠ admin → FORBIDDEN 403（AC-G6）；
- `repo.findById(id)`：复用既有方法（repository/user.ts L103-106，返回 `UserEntity | undefined`）；
- 不存在 → `USER_NOT_FOUND` 404（AC-G2）；
- `toUserOutput`：剥离 password_hash（SEC-003a，与 list/create/updateStatus 同模式，AC-G1 不含 password_hash）；
- 不经 withAudit：读操作不埋审计（沿用 GET /v1/users 惯例）。

### 4.6 repository findById 复用（D2，零新增）

`UserRepository.findById(id)`（repository/user.ts L103-106）已存在，返回 `UserEntity | undefined`：

```ts
findById(id: string): UserEntity | undefined {
  const row = this.findByIdStmt.get(id) as UserRow | undefined;
  return row ? rowToEntity(row) : undefined;
}
```

R10 etag-caching.tech.md D3 注"repository 已提供 findById"预测正确。**service.getById 直接复用，repository 零新增方法**。

## 5. 前端设计

### 5.1 client.ts parseErrorResponse 删除 wire 适配（D8）

`apps/web/src/api/client.ts` `parseErrorResponse`（L74-87）改动：

```ts
function parseErrorResponse(body: unknown): ParsedError {
  const raw = (body ?? {}) as Record<string, unknown>;
  const wireCode = raw.code;   // D1/D8：删除 wire 适配，直接读 raw.code（原 raw.error）
  const codeParse = errorCodeSchema.safeParse(wireCode);
  const code: ErrorCode | 'INTERNAL_ERROR' = codeParse.success ? codeParse.data : 'INTERNAL_ERROR';
  const resp: ParsedError = {
    code,
    message: typeof raw.message === 'string' ? raw.message : '操作失败',
  };
  if (typeof raw.current_version === 'number') {
    resp.current_version = raw.current_version;
  }
  return resp;
}
```

**改动点**：
- L76：`raw.error` → `raw.code`（仅字段名，逻辑不变）；
- 注释（L6, L12-14, L33, L68-72）：移除"wire 适配 error→code（D10 [advisory]）"措辞，改为"对齐 contracts errorResponseSchema.code（D10 已消除）"；
- 保留 `errorCodeSchema.safeParse` + fallback `INTERNAL_ERROR`（D7，非 contracts 码 NOT_FOUND/INTERNAL_ERROR 仍降级）；
- 保留手动读字段（不 `errorResponseSchema.parse(body)` 直校），因 D21 issues 仍存在（Q7），`.strict()` 会拒绝含 issues 的 body；
- `message`/`current_version` 字段名 wire 与 contracts 一致，无需重命名。

**对外契约不变**：`ApiError`（contracts ErrorResponse 派生 + LocalErrorCode 兜底）类型不变，前端业务代码（pages/components）零感知（ARCH-003 类型来自 contracts）。

### 5.2 401 拦截链 + 409 重试链不变（既有 D8/D9）

- **401 拦截**（client.ts L192-205）：`parseErrorResponse` 取 code → 判 `INVALID_CREDENTIALS`（原样抛登录页）vs 鉴权类 4 码（UNAUTHORIZED/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED，清 token 跳 /login）。仅字段名 error→code，分支逻辑不变（AC-W10）。
- **409 重试**（client.ts L208-217）：VERSION_CONFLICT + `current_version` + 未重试 → 用 `current_version` 重试 1 次（D9 [约束]，D3 重分类）。仅字段名 error→code，重试链不破坏（AC-W9）。重试响应再走 401/409 分支（401 仍拦截终止，409 不再重试）。

### 5.3 用户详情页消费 GET（future-ready，非本轮强制）

AC-G13 future-ready：`GET /v1/users/:id` 端点存在后，前端 `apps/web/src/api/users.ts` 可新增 `getUser(id)` 封装（`request<User>('GET', \`/v1/users/${id}\`)`）。**本轮不强制实现**（PRD §6.2 标注"本轮不强制"），端点须可被 fetch 调用即可。前端 detail page 消费列为 future 轮次（§12）。

`errorMapping.ts` **零变更**：`USER_NOT_FOUND` 已映射"用户不存在"（errorMapping.ts L25），全码映射收尾不变（§8 ②项）。

## 6. 错误矩阵（§11 惯例，对齐 PRD AC-W/AC-G）

> 对齐 contracts `errorCodeSchema` SSOT + 非 contracts 码 fallback。本轮 errorCodeSchema 零扩展（D7），矩阵码全集不变。

### 6.1 改动点 1 wire 对齐后统一错误响应格式

```jsonc
{ "code": "<ErrorCode>", "message": "<string>", "current_version"?: <number> }
// code: 对齐 contracts errorResponseSchema.code（errorCodeSchema 枚举）
// message: 字符串
// current_version: 仅 VERSION_CONFLICT(409) 时填充（D13，meta 合并）
// 例外（非 contracts 码，保持现状不扩 errorCodeSchema，D7）：
//   - 通用 404 无路由匹配：{ "code": "NOT_FOUND", "message": "无路由匹配: ..." }
//   - 500 未捕获/fatal：{ "code": "INTERNAL_ERROR", "message": "..." }
//   以上两码 client 仍走 fallback（行为不变，AC-W8）
// D21 例外（issues 保留，Q7 不消除）：
//   - 400 safeParse 失败：{ "code": "VALIDATION_ERROR", "message", "issues": [...] }
```

### 6.2 GET /v1/users/:id 错误响应矩阵（AC-G2~G6）

| HTTP | code | 触发场景 | 守卫层 | client 行为 | AC |
|------|------|----------|--------|-------------|----|
| 404 | USER_NOT_FOUND | id 合法 uuid 但无记录 | service B5（findById 返回 undefined） | 抛 ApiError，前端提示"用户不存在" | AC-G2 |
| 400 | VALIDATION_ERROR | id 非法 uuid（如 "abc"） | server.ts safeParse 失败（L561-568） | 抛 ApiError（含 issues，D21 丢弃） | AC-G3 |
| 401 | UNAUTHORIZED | 无 Authorization header | buildCtx G1（admin 路由非 public） | 清 token + 跳 /login | AC-G4 |
| 401 | TOKEN_INVALID | token 伪造/格式错 | buildCtx G3 | 清 token + 跳 /login | AC-G5 |
| 401 | TOKEN_EXPIRED | token 已过期 | buildCtx G4 | 清 token + 跳 /login | AC-G5 |
| 401 | TOKEN_REVOKED | token 已登出吊销 | buildCtx G5 | 清 token + 跳 /login | AC-G5 |
| 403 | FORBIDDEN | role ≠ admin（无 user:read） | service requireAdmin（SEC-002，D4） | 抛 ApiError，前端提示"无权限执行此操作" | AC-G6 |

### 6.3 wire 对齐错误响应矩阵（AC-W1~W11）

| HTTP | code | 触发场景 | 改动 | AC |
|------|------|----------|------|----|
| 404 | NOT_FOUND（非 contracts） | 无路由匹配 | error→code（L532），client fallback INTERNAL_ERROR | AC-W5/W8 |
| 400 | VERSION_REQUIRED | versioned 写缺 If-Match | error→code（L552） | AC-W3 |
| 400 | VALIDATION_ERROR | If-Match 格式非法 | error→code（L554） | AC-W4 |
| 400 | VALIDATION_ERROR | safeParse 失败（含 issues） | error→code（L563），issues 保留 D21 | AC-W2 |
| 4xx/5xx | AppError.code（如 USER_NOT_FOUND） | service 抛 AppError | error→code（L594），meta 合并不变 | AC-W1 |
| 500 | INTERNAL_ERROR（非 contracts） | 未捕获/fatal | error→code（L602/L611），client fallback INTERNAL_ERROR | AC-W6/W8 |
| 409 | VERSION_CONFLICT | If-Match version 不匹配 | error→code（L594），current_version 仍填充，重试链不破坏 | AC-W9 |
| 401 | UNAUTHORIZED/TOKEN_*/INVALID_CREDENTIALS | 鉴权守卫 | error→code，401 拦截链不变 | AC-W10 |

### 6.4 非 contracts 码 fallback 边界（D7）

| 码 | 来源 | 是否入 errorCodeSchema | client 处理 | round-trip |
|----|------|------------------------|-------------|------------|
| INTERNAL_ERROR | server.ts L602/L611 | 否（D7 不扩） | safeParse 失败 → fallback INTERNAL_ERROR | 正确（server 发 INTERNAL_ERROR → client code=INTERNAL_ERROR） |
| NOT_FOUND | server.ts L532 | 否（D7 不扩） | safeParse 失败 → fallback INTERNAL_ERROR | 降级（SPA 仅调已知端点，无路由 404 边缘场景，行为不变） |
| NETWORK_ERROR | client 本地（fetch 抛错） | 否（前端本地码） | 直接抛 | N/A（前端兜底） |

## 7. 受影响测试清单（AI-006 两类标注）

> 严格遵守 AI-006：①类分显式 + 隐式两个子类 + ②类签名/行为变更 + ③类新增。**①类隐式影响子类本次为空，须显式声明**（D7 errorCodeSchema 零扩展）。

### 7.1 ①类：contracts 联动驱动

**①-A 显式影响（grep 符号引用）—— 0 文件：**

grep 命令：`rg "errorResponseSchema|errorCodeSchema" apps/api/test/ apps/web/test/`。判定依据：本轮 contracts 零变更（§3），`errorResponseSchema`/`errorCodeSchema` schema 定义与导出不变。既有测试引用这两个 schema 的位置（契约测）其 safeParse 行为不变（errorCodeSchema 枚举值不变，USER_NOT_FOUND 已在枚举）。**零显式影响。**

**①-B 隐式影响（全集断言依赖枚举值，R11 S-2）—— 0 文件：**

既有 SSOT 派生断言（`[...errorCodeSchema.options]` containment）位于 `notification.test.ts` / `report.test.ts` / `role-inheritance.test.ts` / `optimistic-locking.test.ts`（详见 TECH-WEB-AUTH-USER-001 §9 ①-B 清单）+ 前端 `error-mapping.test.ts`（`ERROR_MESSAGES` 键全集 SSOT 派生）。判定依据：**本轮 errorCodeSchema 零扩展**（Q2/D7，枚举值不变，NOT_FOUND/INTERNAL_ERROR 不入枚举）→ 既有 containment 断言不失效。**零隐式影响。**

> **显式声明（G3 自检）**：①类隐式影响子类本次为 **0 文件**。根因：Q2 决策不扩 errorCodeSchema（D7），枚举值不变，`[...errorCodeSchema.options]` 全集断言不失效。若未来扩 errorCodeSchema（如 INTERNAL_ERROR/NOT_FOUND 入枚举），须重新评估 ①-B 隐式影响（届时 containment 断言失效，涉及 notification/report/role-inheritance/optimistic-locking/error-mapping 多域测试）。

①类小结：**0 文件受影响**（显式 0 + 隐式 0）。根因：contracts 冻结 + errorCodeSchema 零扩展。

### 7.2 ②类：既有签名/行为变更驱动 —— 10 文件

**改动点 1 wire 字段名 error→code（行为变更驱动，AI-002 边界：字段名变属合法 ②类签名驱动更新，matcher 不变仅字段名变）**：

| # | 文件 | 影响类型 | 改动 | AC |
|---|------|----------|------|----|
| 1 | `apps/api/test/auth-embedding.test.ts` | ②类 assertion 更新 | 11 处 `expect(body.error)` → `expect(body.code)`（L169/170/179/190/198/206/215/235/261/279/293） | AC-W1~W6 |
| 2 | `apps/api/test/persist-embedding.test.ts` | ②类 assertion 更新 | 1 处 `create2.body.error` → `create2.body.code`（L221） | AC-W1 |
| 3 | `apps/api/test/optimistic-locking-embedding.test.ts` | ②类 assertion 更新 | 7 处 `res.body.error` → `res.body.code`（L170/180/190/231/262/280/322） | AC-W1/W9 |
| 4 | `apps/web/test/api-client.test.ts` | ②类 mock 更新 | mock fetch 响应 `{ error: ... }` → `{ code: ... }`（L112/130/151/166/168）；"wire 适配"测试名/注释更新为"D10 已消除" | AC-W7/W8/W9/W10 |
| 5 | `apps/web/test/api-notifications.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L224/241/258/274/290/315/330/344） | AC-W7 |
| 6 | `apps/web/test/api-departments.test.ts` | ②类 mock 更新 | mock 响应 `{ error: 'DEPT_HAS_CHILDREN' }` → `{ code: ... }`（L131） | AC-W7 |
| 7 | `apps/web/test/api-role-inheritance.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L109/124/138/151/182/276/289/299） | AC-W7 |
| 8 | `apps/web/test/api-reports.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L211/226） | AC-W7 |
| 9 | `apps/web/test/api-roles.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L143/158/224/241） | AC-W7 |
| 10 | `apps/web/test/api-transfer.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L123/136/148/160/172/184/196/208/220） | AC-W7 |

> ②类 assertion 更新边界（AI-002）：wire 字段名 `error→code` 是行为变更，test-writer 将既有 `body.error`/mock `{ error: }` 更新为 `body.code`/mock `{ code: }` 属合法 ②类签名驱动更新（非静默弱化断言），matcher 不变（`.toBe`），仅字段名变。impl-writer 阶段使 server.ts 对齐后转绿。

②类小结：**10 文件**（api 3 + web 7），均为 wire 字段名 error→code 驱动。**无 service 签名变更驱动**（getById 是 ③类新增方法，不改既有 service 签名）。

### 7.3 ③类：新增测试 —— 2 文件

| # | 文件 | 类型 | 覆盖 AC |
|---|------|------|---------|
| 1 | `apps/api/test/user-detail.test.ts`（新增） | ③类 单测+行为+契约 | AC-G1~G9（成功/404/400/鉴权 G4G5/越权 G6/ETag G7/304 G8/200 不匹配 G9）+ AC-G10（路由无冲突断言）+ AC-G11（路由表含 GET /v1/users/:id） |
| 2 | `apps/api/test/user-detail-embedding.test.ts`（新增，spawn 真实 server + fetch） | ③类 端到端 | AC-G1/G2/G4/G5/G7/G8/G10/G11（端到端 HTTP 全链路）+ AC-W1~W6（wire 字段名端到端验证，新端点错误响应用 code 字段） |

③类小结：**2 新增测试文件**，覆盖改动点 2 全部 AC + 改动点 1 端到端 wire 验证。

### 7.4 AI-006 反向核实声明

- **①类显式**：0 文件（contracts 冻结，grep `errorResponseSchema|errorCodeSchema` 引用位置 safeParse 行为不变）；
- **①类隐式**：0 文件（errorCodeSchema 零扩展，枚举值不变，containment 断言不失效——**显式声明为空**）；
- **②类**：10 文件（wire 字段名 error→code 驱动，3 api + 7 web）；
- **③类**：2 新增文件（user-detail 单测 + embedding 端到端）。

test-writer 反向核实：若发现清单外影响点（如遗漏的 `body.error` 引用），须显式列出（AI-006）。

## 8. 组合副作用预判（§10 惯例，含 R16 S-17~S-20 四项增项）

> 提前标注多约束组合 + 全集定义 + 常量复用 + 测试工具 workaround 的潜在副作用，impl-writer 实现时须规避，偏离按 AI-003 反向同步。

### 8.1 多 [约束] 组合副作用（R11/R12 范式，S-17 增项）

1. **「wire 对齐（D1）+ 409 重试（D3 既有 D9）」组合**：409 VERSION_CONFLICT 响应体字段名 error→code，client `parseErrorResponse` 读 `raw.code` 取 VERSION_CONFLICT + `raw.current_version` 重试。须保证字段名改动后 `current_version` 仍正确读取（meta 合并逻辑不变，L594 `Object.assign(respBody, e.meta)` 不动）。重试链不破坏（AC-W9）。impl-writer 须保证 L594 仅 `error→code`，meta 合并逻辑零改动。
2. **「wire 对齐（D1）+ 401 拦截（既有 D8）」组合**：401 响应体字段名 error→code，client 读 `raw.code` 判鉴权类 4 码 + INVALID_CREDENTIALS。须保证 401 解析失败（非 JSON/缺 code）仍降级 UNAUTHORIZED 行为跳登录（不白屏），与 R12 §1.4 组合 #2 一致。impl-writer 须保证 `parseErrorResponse` fallback 路径不变（safeParse 失败 → INTERNAL_ERROR → 401 分支视 INTERNAL_ERROR 为鉴权失败跳登录，client.ts L200）。
3. **「GET detail（D2）+ ETag（D5）+ 鉴权（D4）」组合**：buildCtx 验签（G1-G5）→ safeParse（id uuid）→ handler（requireAdmin + findById）。鉴权失败（401/403）在 handler/buildCtx 抛 AppError 走 catch（L590-597），**不进 ETag 分支**（L578 cacheable 分支仅在 handler 成功后执行）。故 401/403/404/400 响应无 ETag header（仅 200 + 304 含 ETag）。impl-writer 须保证 ETag 生成不阻断错误响应（cacheable 分支在 result !== undefined 且无异常时才执行）。
4. **「wire 对齐（D1）+ 非 contracts 码 fallback（D7）」组合**：INTERNAL_ERROR/NOT_FOUND 字段名也改 code，client `errorCodeSchema.safeParse('INTERNAL_ERROR')` 失败 → fallback INTERNAL_ERROR。须保证 INTERNAL_ERROR round-trip 正确（server 发 INTERNAL_ERROR → client code=INTERNAL_ERROR，值一致，AC-W8）。impl-writer 须保证 L602/L611 仅 `error→code`，client fallback 路径不变。
5. **「GET detail（D2）+ 路由匹配（D9）」组合**：`GET /v1/users/:id`（3 段）与 `GET /v1/users/:userId/roles`（4 段）/ `GET /v1/users/:userId/effective-permissions`（4 段）同为 GET，但段数不同。须保证 matchRoute 按 method + 段数匹配，`/v1/users/abc`（3 段）不误匹配 `/v1/users/:userId/roles`（4 段）。impl-writer 须确认 matchRoute 段数判定（既有逻辑，R10 已验证 GET /v1/roles/:id 不与 GET /v1/roles/:roleId/inheritance-chain 冲突，同模式）。

### 8.2 全码映射收尾全集定义（R16 S-18 增项）

`errorMapping.ts` 全码映射的"全集"定义须明确为**"前端可能触发的域码全集"**而非"errorCodeSchema 枚举全集"。

本轮判定：
- **errorCodeSchema 零扩展**（Q2/D7），`SPECIFIC_MESSAGES` 表无新增码需求；
- `USER_NOT_FOUND` 已在 SPECIFIC_MESSAGES（errorMapping.ts L25，"用户不存在"），GET detail 触发该码时前端提示已就绪；
- **本轮 errorMapping.ts 零变更**，全码映射收尾状态不变（R16 已完成全码映射收尾）；
- 未来若扩 errorCodeSchema（如 INTERNAL_ERROR/NOT_FOUND 入枚举），须重新评估全码映射收尾（届时新码须加入 SPECIFIC_MESSAGES 或显式标注 [advisory] 沿用 FALLBACK）。

结论：本轮无全码映射收尾动作，状态维持 R16 收尾后的稳态。

### 8.3 简单常量跨组件复用边界（R16 S-19 增项）

简单常量（如 UUID_RE 正则、单字段 schema）跨组件复用边界：≤3 处使用场景且常量简单可 [advisory] 沿用重复定义；≥4 处使用场景或常量复杂须提取 lib/ 共享。

本轮判定：
- `userDetailProcedureInputSchema = z.object({ id: z.string().uuid() })`（§4.4）与既有 `roleDetailProcedureInputSchema`（router/role.ts L31-33）结构完全相同（均 `{ id: uuid }`）；
- 使用场景：role detail（L267）+ user detail（新增）= **2 处**；
- 常量简单（单字段 z.string().uuid()）；
- **按 S-19 可 [advisory] 沿用重复定义**（各自声明 `userDetailProcedureInputSchema` / `roleDetailProcedureInputSchema`），不强制提取共享 `idPathSchema`。

[advisory] 决策：本轮沿用重复定义（2 处，简单常量，符合 S-19 阈值）。若未来 detail 端点增至 ≥4 处（如 notification/department/user 四域均有 detail），须提取 `packages/contracts/src/schemas/common.ts` 共享 `idPathSchema`。impl-writer 据此沿用重复定义，不提取共享（避免过度抽象）。

### 8.4 测试工具限制 workaround（R16 S-20 增项）

测试工具限制 workaround：如 user-event v14.6.1 selectOptions 自动过滤 disabled option，测试"前端 disabled 防误选"场景须绕过 user-event 直接测 option.disabled + 服务端兜底文案。

本轮判定：
- **本轮测试无 select disabled 场景**（GET detail 是后端端点测试 + 前端 client mock 测试，无前端 select 组件交互）；
- wire 字段名测试须注意：mock fetch 响应须用 `{ code: ... }` 而非 `{ error: ... }`（②类 mock 更新，§7.2）；
- embedding 测试 spawn 真实 server 自动用新字段名（D1 改动后 server 输出 `code`）；
- ETag 304 测试须注意：304 响应空体，断言 `res.body` 为空（非 JSON parse 失败），须用 `res.status === 304` + `res.headers.get('etag')` 断言。

[advisory] 本轮无 user-event selectOptions workaround 需求（无前端 select 场景）。ETag 304 空体断言沿用 R10 etag-caching-embedding.test.ts 模式（既有验证）。

## 9. 测试矩阵（test-writer 据此产出）

> 对齐 PRD §6.3：②类 10 文件更新 + ③类 2 新增。test-writer 据本节 + PRD 24 条 AC 产出测试，AC↔测试用例覆盖矩阵自检（R12 S-3）。

### 9.1 ②类既有测试更新（10 文件，断言级红由 impl 阶段转绿）

| 文件 | 更新点 | 覆盖 AC |
|------|--------|---------|
| apps/api/test/auth-embedding.test.ts | 11 处 `body.error` → `body.code` | AC-W1~W6 |
| apps/api/test/persist-embedding.test.ts | 1 处 `body.error` → `body.code` | AC-W1 |
| apps/api/test/optimistic-locking-embedding.test.ts | 7 处 `body.error` → `body.code` | AC-W1/W9 |
| apps/web/test/api-client.test.ts | mock `{ error }` → `{ code }` + 测试名/注释更新 | AC-W7~W10 |
| apps/web/test/api-notifications.test.ts | mock `{ error }` → `{ code }` | AC-W7 |
| apps/web/test/api-departments.test.ts | mock `{ error }` → `{ code }` | AC-W7 |
| apps/web/test/api-role-inheritance.test.ts | mock `{ error }` → `{ code }` | AC-W7 |
| apps/web/test/api-reports.test.ts | mock `{ error }` → `{ code }` | AC-W7 |
| apps/web/test/api-roles.test.ts | mock `{ error }` → `{ code }` | AC-W7 |
| apps/web/test/api-transfer.test.ts | mock `{ error }` → `{ code }` | AC-W7 |

### 9.2 ③类新增测试（2 文件）

**`apps/api/test/user-detail.test.ts`（单测+行为+契约）**：

| 用例组 | 覆盖 AC | 断言要点 |
|--------|---------|----------|
| 查询成功 | AC-G1 | admin + 有效 id → 200 + User（对齐 userSchema，断言含 version + 不含 password_hash，SEC-003a `.strict()` 拒绝多余字段） |
| 用户不存在 | AC-G2 | id 合法 uuid 无记录 → 404 + `{ code: 'USER_NOT_FOUND' }` |
| id 非法 uuid | AC-G3 | id="abc" → 400 + `{ code: 'VALIDATION_ERROR', issues }`（issues 保留 D21） |
| 鉴权-无 token | AC-G4 | 无 Authorization → 401 + `{ code: 'UNAUTHORIZED' }`（buildCtx G1） |
| 鉴权-token 无效/过期/吊销 | AC-G5 | TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED → 401（buildCtx G3/G4/G5） |
| 越权 | AC-G6 | role='user' → 403 + `{ code: 'FORBIDDEN' }`（service requireAdmin SEC-002） |
| ETag 生成 | AC-G7 | version=N → 响应含 `ETag: "N"` header（detailEtag 基于 version） |
| If-None-Match 匹配 | AC-G8 | `If-None-Match: "N"` + 实体未变 → 304 空体 + `ETag: "N"` |
| If-None-Match 不匹配 | AC-G9 | `If-None-Match: "N-1"` / 非法格式 → 200 + 最新 User + 新 `ETag: "N"`（parseIfNoneMatch 宽容） |
| 路由无冲突 | AC-G10 | matchRoute 断言 GET /v1/users/:id（3 段）不匹配 2/4 段既有路由 |
| 路由表新增条目 | AC-G11 | routes 数组含 GET /v1/users/:id（method=GET, auth=admin, versioned=false, cacheable=true, buildEtag=detailEtag） |
| 契约测 | — | `userDetailProcedureInputSchema.safeParse`（id uuid 合法/非法）+ 响应体 `userSchema.parse`（含 .strict() 拒绝 password_hash） |

**`apps/api/test/user-detail-embedding.test.ts`（端到端 spawn 真实 server + fetch）**：

| 用例组 | 覆盖 AC | 断言要点 |
|--------|---------|----------|
| 端到端查询成功 | AC-G1 | spawn server + admin token + fetch GET /v1/users/:id → 200 + User body + ETag header |
| 端到端 404 | AC-G2 | 不存在 id → 404 + `{ code: 'USER_NOT_FOUND' }`（验证 wire 字段名 code） |
| 端到端鉴权 | AC-G4/G5 | 无 token / 伪造 token → 401 + `{ code: ... }` |
| 端到端 ETag 304 | AC-G7/G8 | 首次 GET 200+ETag → 二次 GET If-None-Match:旧 → 304 空体 + ETag |
| 端到端 ETag 不匹配 | AC-G9 | update status（version+1）后 GET If-None-Match:旧 → 200 + 新 User + 新 ETag |
| 端到端 wire 字段名 | AC-W1~W6 | 新端点错误响应全用 `code` 字段（验证 D1 对齐在新端点生效） |
| 端到端路由表 | AC-G10/G11 | fetch GET /v1/users/:id 命中新路由（非 404 NOT_FOUND 无路由） |

### 9.3 AC ↔ 测试用例覆盖矩阵（R12 S-3 自检）

| AC | 覆盖文件 | 覆盖用例 | 备注 |
|----|----------|----------|------|
| AC-W1 | auth-embedding / optimistic-locking-embedding / user-detail-embedding | AppError catch 响应 code 字段 | — |
| AC-W2 | auth-embedding / user-detail | safeParse 失败 code + issues | issues 保留 D21 |
| AC-W3 | optimistic-locking-embedding | VERSION_REQUIRED code | — |
| AC-W4 | optimistic-locking-embedding | If-Match 格式非法 code | — |
| AC-W5 | auth-embedding | NOT_FOUND code（非 contracts） | client fallback AC-W8 |
| AC-W6 | auth-embedding / user-detail-embedding | INTERNAL_ERROR code | client fallback AC-W8 |
| AC-W7 | api-client / api-notifications/.../api-transfer（7 web） | parseErrorResponse 读 raw.code | mock 更新 |
| AC-W8 | api-client | 非 contracts 码 fallback | INTERNAL_ERROR round-trip |
| AC-W9 | optimistic-locking-embedding / api-client | 409 VERSION_CONFLICT 重试链 | current_version 读取 |
| AC-W10 | api-client | 401 拦截链 | 4 鉴权码 + INVALID_CREDENTIALS |
| AC-W11 | client.ts 注释 + web-auth-user.tech.md | D10 标注移除 | §11 反向同步 |
| AC-G1 | user-detail / user-detail-embedding | 查询成功 + userSchema | 不含 password_hash |
| AC-G2 | user-detail / user-detail-embedding | 404 USER_NOT_FOUND | wire code 字段 |
| AC-G3 | user-detail | 400 VALIDATION_ERROR + issues | id 非法 uuid |
| AC-G4 | user-detail / user-detail-embedding | 401 UNAUTHORIZED | 无 token |
| AC-G5 | user-detail | 401 TOKEN_* | 3 码 |
| AC-G6 | user-detail | 403 FORBIDDEN | role ≠ admin |
| AC-G7 | user-detail / user-detail-embedding | ETag 生成 | `"N"` |
| AC-G8 | user-detail / user-detail-embedding | 304 空体 | If-None-Match 匹配 |
| AC-G9 | user-detail / user-detail-embedding | 200 不匹配 | If-None-Match 旧/非法 |
| AC-G10 | user-detail | 路由无冲突 | 3 段 vs 2/4 段 |
| AC-G11 | user-detail / user-detail-embedding | 路由表新增条目 | routes 数组 |
| AC-G12 | web-auth-user.tech.md | D19 标注移除 + D9 重分类 | §11 反向同步 |
| AC-G13 | （future-ready，非本轮强制） | 端点可被 fetch 调用 | user-detail-embedding 验证可 fetch |

24 条 AC 全覆盖（W1-W11 + G1-G13）。AC-G13 标注 future-ready，由 user-detail-embedding 端到端验证"端点可被 fetch 调用"间接覆盖。

## 10. PII / 安全标注（SEC-002/SEC-003a）

### 10.1 SEC-002 越权校验（service 层）

`UserService.getById` 入口 `requireAdmin(ctx)`（D4），role ≠ admin → FORBIDDEN 403（AC-G6）。与既有 user 域 list/create/updateStatus + role 域 getById 同模式。`user:read` 是 admin 角色授予的概念权限，由 requireAdmin 强制（admin = 持 user:read）。

**鉴权守卫执行顺序**：buildCtx（Bearer 验签 G1-G5，401 系列）→ safeParse（id uuid，400 VALIDATION_ERROR）→ handler requireAdmin（403 FORBIDDEN）→ findById（404 USER_NOT_FOUND）。先到先返，不叠加（与 roleService.getById 守卫顺序一致）。

### 10.2 SEC-003a 输出 schema .strict() + password_hash 永不出响应

- **userSchema `.strict()`**（contracts/user.ts L37）：响应体 1:1 对齐 userSchema，拒绝多余字段。GET detail 响应经 `userSchema.parse` 断言含 8 字段（id/name/email/status/department_id/created_at/updated_at/version），**不含 password_hash**。
- **password_hash 永不出响应**：`UserService.getById` 经 `toUserOutput(target)` 剥离 password_hash（与 list/create/updateStatus 同模式，TECH-AUTH-001 D5）。存储态 `UserEntity`（userEntitySchema 含 password_hash）仅 repository/service 内部使用，HTTP 响应输出前投影剥离。
- **PII 字段标注**：
  - `password_hash`：**永不出现在响应**（userSchema 不含，SEC-003a）；
  - `email`：展示用，非高敏，正常返回（与列表/创建响应一致，不脱敏——脱敏仅用于审计日志 `redactedAuditLogSchema`）；
  - `id`：UUID，非 PII，正常返回。
- **GET 不埋审计**：读操作不埋审计（沿用 GET /v1/users / GET /v1/roles/:id 不埋点惯例；D9 审计 append-only 仅写操作）。
- **token/password 不入日志**：沿用 PRD-WEB-AUTH-USER-001 D12，本轮不改变。

## 11. advisory 偏离反向同步（D10/D19 移除）

> AI-003：advisory 偏离须反向同步 Spec。本轮消除两项 advisory，须同步既有 Spec + 代码注释。

### 11.1 既有 D10 [advisory] 移除（wire 适配消除）

**反向同步目标**：
- `docs/spec/web-auth-user.tech.md` §4.6 + D10 [advisory]（L471-472）：标注移除（或改为"R18 已消除"历史记录），说明 wire 字段名已对齐（server.ts error→code），client 删除 wire 适配层；
- `apps/web/src/api/client.ts` 注释（L6, L12-14, L33, L68-72）：移除"wire 适配 error→code（D10 [advisory]）"措辞，改为"对齐 contracts errorResponseSchema.code（D10 已消除，R18）"。

**消除后状态**：contracts `errorResponseSchema.code` / server.ts wire `code` / client `raw.code` 三层字段名一致，wire 适配层不再必要。client 仍保留 `errorCodeSchema.safeParse + fallback`（D7，非 contracts 码 fallback，非 D10 适配）——此 fallback 是非 contracts 码降级机制，与 D10 wire 字段名适配独立，不消除。

### 11.2 既有 D19 [advisory] 移除（端点 gap 闭合）

**反向同步目标**：
- `docs/spec/web-auth-user.tech.md` §1.2 + D19 [advisory]（L501-502）：标注移除（端点 gap 已闭合），说明 `GET /v1/users/:id` 已补齐；
- D9 重分类：web-auth-user.tech.md D9 从 [advisory]-adjacent 重分类为 `[约束]`（D3，client 设计选择 409-retry，非因端点缺失的临时妥协）。

**消除后状态**：user 域 detail 能力补齐，PRD AC-F4-3 字面"GET 最新 user"技术上可落地（但 Q6 决策保留 D9 409-retry，不切换为 GET-retry）。前端 future 轮次可消费 `getUser(id)`（AC-G13 future-ready）。

### 11.3 既有 D21 [advisory] 保留（本轮不消除，Q7 out of scope）

D21（VALIDATION_ERROR 响应额外 `issues` 字段，contracts 未声明）**本轮不消除**（Q7，与 D10 独立）。client 仍手动读字段不直校 `errorResponseSchema.parse(body)`（D8）。D21 列为 future advisory（与 Q2 非 contracts 码同类，未来"contracts 完整化"轮处理，§12）。

### 11.4 反向同步执行者

既有 Spec（web-auth-user.tech.md）+ client.ts 注释的反向同步由 **impl-writer 阶段落地**（AI-003：advisory 偏离消除须反向同步 Spec）。本 Tech-Spec 仅声明同步目标，不直接改 web-auth-user.tech.md（Tech Lead 边界：产本 Spec，不改既有 Spec 代码注释——注释改动属 impl-writer）。

## 12. Out of scope

- **D21（VALIDATION_ERROR 响应 issues 额外字段）消除** —— 与 D10 独立，本轮不消除（Q7），client 仍手动读字段不直校 errorResponseSchema。
- **INTERNAL_ERROR / NOT_FOUND 入 errorCodeSchema** —— Q2/D7 决策不扩 contracts，列为 future advisory（与 D21 同类，未来"contracts 完整化"轮处理）。
- **恢复 AC-F4-3 原 GET-retry 重试策略** —— Q6/D3 决策保留 D9（409 current_version 重试，重分类为 [约束]），不切换为 GET-retry。
- **前端用户详情页实现** —— 本轮仅后端补 GET 端点（AC-G13 future-ready），前端 detail page 消费为 future 轮次。
- **前端 api/users.ts 新增 getUser(id) 封装** —— 非本轮 AC 强制（future-ready，AC-G13）。
- **GET /v1/users/:id 的列表内嵌展开（如 ?expand=roles）** —— 本轮仅单条详情，无 expand。
- **批量 GET（如 GET /v1/users?ids=...）** —— 本轮不涉及。
- **用户软删除 / 回收站** —— 沿用 PRD-USER-001 Q1（不提供删除）。
- **审计埋点 for GET /v1/users/:id** —— GET 读操作不埋审计（沿用既有读端点不埋点惯例；D9 审计 append-only 仅写操作）。
- **新规则 / check-rules.mjs 改动** —— 本轮无规则改动（wire 对齐 + 端点补齐均不触发新规则）。
- **userDetailProcedureInputSchema 与 roleDetailProcedureInputSchema 提取共享** —— [advisory] 沿用重复定义（2 处，简单常量，符合 S-19 阈值，§8.3）。

## G3 自检声明

- **Tech-Spec 完整性**：12 章节齐全（§1 概述+路由表核验 / §2 架构决策 D1-D10 / §3 contracts 联动零变更 / §4 后端设计 / §5 前端设计 / §6 错误矩阵 / §7 受影响测试清单 / §8 组合副作用预判 / §9 测试矩阵 / §10 PII/安全 / §11 advisory 反向同步 / §12 Out of scope）。
- **PRD AC 全覆盖**：24 条 AC（W1-W11 + G1-G13）每条有对应设计（§9.3 AC↔测试用例覆盖矩阵 + §6 错误矩阵 + §4/§5 设计）。
- **受影响测试清单（AI-006）**：①类显式 0 + ①类隐式 **0（显式声明为空，根因 errorCodeSchema 零扩展）** + ②类 10 文件（3 api + 7 web）+ ③类 2 新增。
- **§10 组合副作用预判**：含 R16 S-17~S-20 四项增项（①多约束组合副作用 5 条 / ②全码映射收尾全集定义 / ③简单常量跨组件复用边界 / ④测试工具限制 workaround）。
- **既有路由表核验（R10 S-2）**：GET /v1/users/:id 不存在（§1.2 核验一）+ wire 字段名现状 7 处 `error:`（§1.2 核验三 + §4.1）。
- **[约束]/[advisory] 标注规范**：D1-D10 全标 [约束]；D3 D9 重分类 [约束]；D10/D19 移除标注（§11）；D21 保留 [advisory]（§11.3，Q7 out of scope）；userDetailProcedureInputSchema 沿用重复定义 [advisory]（§8.3）。
- **PII/安全标注**：SEC-002 service requireAdmin（§10.1）+ SEC-003a password_hash 永不出响应（§10.2）。
- **边界遵守**：本阶段只产本文档，不写实现代码（impl-writer 阶段）+ 不写测试断言（test-writer 阶段），Tech Lead 角色边界。
