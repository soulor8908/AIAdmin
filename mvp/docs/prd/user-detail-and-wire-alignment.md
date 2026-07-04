---
doc_type: PRD-Spec
id: PRD-USER-DETAIL-WIRE-001
title: 用户详情端点补齐 + 错误响应 wire 字段名对齐（消除 R12 D10/D19 两项 advisory 偏离）
status: decided
owner: ba@team
created: 2026-07-03
extends: PRD-USER-001
aligns: [PRD-WEB-AUTH-USER-001, PRD-ETAG-CACHING-001, PRD-OPTIMISTIC-LOCKING-001, PRD-AUTH-001]
prd_ref: RETRO-ROUND12-001
# Q&A 决策结果摘要：
# Q1=接受 breaking change（MVP 无外部消费者，前端+测试本轮同步） / Q2=仅字段名对齐 error→code，非 contracts 码保持 client fallback，不扩 errorCodeSchema /
# Q3=GET /v1/users/:id admin 鉴权 + user:read 权限（SEC-002 service 层）/ Q4=ETag 必选（cacheable=true + detailEtag，对齐 R10 detail 端点模式）/
# Q5=两改动点合并一轮（同源 R12 advisory、同 user 域、wire 测试影响含新端点错误响应天然耦合）/ Q6=保留 D9（409 current_version 重试），D19 advisory 移除（端点 gap 闭合），D9 重分类为 [约束] /
# Q7=D21（issues 额外字段）不本轮消除（out of scope，与 D10 独立）/ Q8=GET 响应对齐既有 userSchema（不新增 userResponseSchema，Tech Lead 决定是否别名）
---

# 用户详情端点补齐 + 错误响应 wire 字段名对齐（消除 R12 D10/D19 两项 advisory 偏离）

> 本轮（R18）为 R12 复盘遗留的两项 advisory 偏离消除轮。两项偏离均源自 R12（前端首轮）复盘 `docs/retro/round12-retro.md`：
> - **D10 [advisory]**（§1.2）：contracts `errorResponseSchema` 字段名 `code`，后端 server.ts 实际 wire 响应体字段名 `error`（历史遗留），前端 API client `parseErrorResponse` 做 wire 适配（读 `raw.error` → 映射为 contracts `code`）。
> - **D19 [advisory]**（§1.3）：PRD AC-F4-3 字面"API client 自动 GET 最新 user 取 version"无法落地，因 user 域无 `GET /v1/users/:id` 单条详情端点；Spec 改用 409 响应体 `current_version` 重试（D9）。
>
> R12 retro §6「剩余改进项」显式将这两项列为后续消除方向（③后端对齐 wire 字段名消除 D10 适配；④补 GET /v1/users/:id 端点消除 D19 不 GET 偏离）。本轮即承接这两项消除。
>
> **PRD 边界**：BA 仅产出本 PRD（含验收标准），不写实现代码、不预定义 contracts schema（ARCH-002，contracts 是 Tech Lead 阶段产物）。

## 1 · 背景

### 1.1 偏离来源一：D10 wire 字段名适配（R12 §1.2）

R12 引入前端时发现：`packages/contracts/src/schemas/user.ts` 的 `errorResponseSchema` 声明字段名 `code`（`{ code: ErrorCode, message, current_version? }`，`.strict()`），但 `apps/api/src/server.ts` 实际错误响应体字段名为 `error`（`{ error: <code>, message, current_version? }`），二者不一致（后端历史遗留）。另 server.ts 的 VALIDATION_ERROR（safeParse 失败）响应额外带 `issues` 字段（contracts 未声明，记为 D21 [advisory]）。

R12 的处理（Q11 决策①）：前端 API client `parseErrorResponse` 在解析层做 wire 适配——读 wire `error` 字段 → `errorCodeSchema.safeParse` 校验 → 映射为 contracts `code`，对外暴露 `ErrorResponse` 类型（contracts 派生）。前端业务代码（pages/components）只接触 `ApiError`（contracts 派生），不感知 wire 字段名 `error`。这是 advisory 偏离机制的正向案例（隔离历史遗留 + 标注消除路径），但 **advisory 偏离应被消除而非永久保留**——R12 retro §6 将"后端对齐字段名消除 D10 适配"列为后续改进项。

**核验现状（G1 自检：grep server.ts 确认 wire 字段名）**：server.ts 共 7 处错误响应使用 `error:` 字段名：
- L532：404 无路由匹配 `{ error: 'NOT_FOUND', message }`
- L552：400 缺 If-Match `{ error: 'VERSION_REQUIRED', message }`
- L554：400 If-Match 格式非法 `{ error: 'VALIDATION_ERROR', message }`
- L562-566：400 safeParse 失败 `{ error: 'VALIDATION_ERROR', message, issues }`（含 D21 issues）
- L594：AppError catch `{ error: e.code, message: e.message, ...meta }`（含 VERSION_CONFLICT 的 current_version）
- L602：500 未捕获错误 `{ error: 'INTERNAL_ERROR', message }`
- L611：500 fatal `{ error: 'INTERNAL_ERROR', message }`

`apps/web/src/api/client.ts` `parseErrorResponse`（L74-87）读 `raw.error` 做 wire 适配；注释（L12-14, L68-72）显式标注 D10 [advisory]。

**关键发现（非 contracts 码）**：server.ts 的 `NOT_FOUND`（通用 404 无路由）与 `INTERNAL_ERROR`（500）**不在 contracts `errorCodeSchema` 枚举内**（errorCodeSchema 含 USER_NOT_FOUND/ROLE_NOT_FOUND 等域码，但无通用 NOT_FOUND 与 INTERNAL_ERROR）。当前 client 对这两个码走 `errorCodeSchema.safeParse` 失败 → 降级 fallback `INTERNAL_ERROR`（前端本地码 `LocalErrorCode = 'NETWORK_ERROR' | 'INTERNAL_ERROR'`）。这是 D10 消除范围的关键边界（见 Q2）。

### 1.2 偏离来源二：D19 GET /v1/users/:id 端点缺失（R12 §1.3）

R12 Tech-Spec §1.2 核验既有路由表（R10 S-2 教训）发现：user 域仅有 `GET /v1/users`（列表）、`POST /v1/users`（创建）、`PATCH /v1/users/:id/status`（状态更新）、`POST /v1/users/:userId/transfer`（调岗），**无 `GET /v1/users/:id` 单条详情端点**。导致 PRD AC-F4-3 字面"API client 自动 GET 最新 user 取 version=N+1 重试 PATCH"无法落地。Spec 改用 409 响应体 `current_version` 重试（D9 [约束]），D19 记为 [advisory] 偏离（PRD 措辞与实现不一致）。

**核验现状（G1 自检：grep 既有路由表确认 GET /v1/users/:id 确实不存在）**：
- `docs/context-snapshot.md` 路由表 + `apps/api/src/server.ts` routes 数组（L221-374）：user 域 4 端点（GET /v1/users / POST /v1/users / PATCH /v1/users/:id/status / POST /v1/users/:userId/transfer），**无 GET /v1/users/:id**。
- 对照既有 detail 端点模式：`GET /v1/roles/:id`（L266-270，cacheable=true + detailEtag）+ `GET /v1/notifications/:id`（L349-353，cacheable=true + detailEtag）均为 R10 落地的 detail 端点，user 域为 R10 §1 [advisory] 显式标注的 out-of-scope（"避免 AI-001 越界——补齐 detail 端点属新增业务功能非本期 ETag 协议扩展"）。

R12 retro §6 将"补 GET /v1/users/:id 端点（R12 §1.3 发现的 gap，消除 D19 不 GET 偏离）"列为后续改进项。

### 1.3 消除动机

两项 advisory 偏离均属"历史遗留/估算偏差的临时缓解"，spec-first 工作流要求 advisory 偏离须反向同步 Spec 并在后续轮次消除（AI-003）。本轮承接消除：
- **D10 消除**：后端 wire 字段名对齐 contracts（`error` → `code`），前端删除 wire 适配逻辑（直接读 `raw.code`），Spec 反向同步移除 D10 [advisory] 标注。消除后 contracts/server/client 三层字段名一致，wire 适配层不再必要。
- **D19 消除**：补 `GET /v1/users/:id` 端点（返回 UserResponse + 404 USER_NOT_FOUND + ETag cacheable），user 域 detail 能力补齐，D19 advisory（端点 gap）移除。同时为前端用户详情页消费提供后端能力（future）。

### 1.4 单 PRD vs 拆分两 PRD 的判断

**决策：合并为单 PRD**（Q5 决策）。理由：
1. **同源**：两项偏离均源自 R12 retro（D10/D19），同一复盘的剩余改进项。
2. **同域**：均聚焦 user 域（D10 跨域但 user 域错误响应是主要消费场景；D19 纯 user 域）。
3. **测试耦合**：D10 wire 字段名改动的影响面包含"新 GET 端点的错误响应"（404 USER_NOT_FOUND / 400 VALIDATION_ERROR 须用新 `code` 字段），两项改动的测试相互交织，拆分将产生跨 PRD 测试依赖。
4. **规模可控**：两项均为"对齐/补齐"型小改动，无新业务域，合并不增加复杂度。

## 2 · 目标（可测的验收标准方向）

### 2.1 改动点 1：wire 字段名对齐（消除 D10）

- **目标 W1**：server.ts 所有错误响应体字段名由 `error` 改为 `code`，与 contracts `errorResponseSchema.code` 对齐。
- **目标 W2**：前端 `apps/web/src/api/client.ts` `parseErrorResponse` 删除 wire 适配逻辑（不再读 `raw.error`），直接读 `raw.code`。
- **目标 W3**：VERSION_CONFLICT 409 响应仍携带 `current_version`（meta 合并逻辑不变），保证 D9 重试链不破坏。
- **目标 W4**：非 contracts 码（NOT_FOUND 通用 404 / INTERNAL_ERROR 500）行为不变（client 仍 fallback INTERNAL_ERROR），不扩 `errorCodeSchema`（避免 ①类隐式 impact）。
- **目标 W5**：Spec 反向同步移除 D10 [advisory] 标注（Tech Lead 阶段）。

### 2.2 改动点 2：补 GET /v1/users/:id（消除 D19）

- **目标 G1**：新增 `GET /v1/users/:id` 端点，返回单条 User（对齐 contracts `userSchema`，不含 `password_hash`）。
- **目标 G2**：目标 id 不存在 → 404 `USER_NOT_FOUND`（errorCodeSchema 已含此码，errors.ts 已映射 404）。
- **目标 G3**：admin 鉴权（auth='admin'，与 GET /v1/users 一致）+ `user:read` 权限码（SEC-002 service 层越权校验）。
- **目标 G4**：cacheable=true + detailEtag（对齐 R10 detail 端点模式，ETag 基于实体 version）。
- **目标 G5**：与 `PATCH /v1/users/:id/status` 路由区分（前者 GET 查询单条，后者 PATCH 改状态；method + 段数不同，无路由冲突）。
- **目标 G6**：Spec 反向同步移除 D19 [advisory] 标注；D9（409 current_version 重试）保留为 [约束] 设计决策（Q6 决策）。

## 3 · 数据实体草图

> 前端无独立数据实体（ARCH-003），后端响应实体对齐 contracts。本轮 contracts 是否新增 schema 由 Tech Lead 决定（ARCH-002：BA 不预定义 contracts）。

### 3.1 GET /v1/users/:id 成功响应（200）

对齐既有 `userSchema`（`packages/contracts/src/schemas/user.ts`，`.strict()`，**不含 password_hash**，SEC-003a）：

```jsonc
// 200 OK + ETag header
{
  "id": "00000000-0000-4000-8000-000000000002",   // z.string().uuid()
  "name": "alice",                                  // z.string().min(1)
  "email": "alice@example.com",                     // z.string().email()
  "status": "active",                               // userStatusSchema: 'active' | 'disabled'
  "department_id": null,                            // z.string().uuid().nullable().optional()
  "created_at": "2026-07-01T00:00:00.000Z",         // z.string().datetime()
  "updated_at": "2026-07-01T00:00:00.000Z",         // z.string().datetime()
  "version": 0                                      // z.number().int().min(0)，乐观锁版本号
}
```

- **响应类型**：`User = z.infer<typeof userSchema>`（与 GET /v1/users 列表 `items[]` 元素同 schema，与 PATCH /v1/users/:id/status 成功响应同 schema）。
- **ETag**：`ETag: "<version>"`（detailEtag，对齐 GET /v1/roles/:id 模式）。
- **命名决策（Q8）**：PRD 不预定义 `userResponseSchema`（避免 contracts 越界，ARCH-002）。响应直接复用既有 `userSchema`；Tech Lead 决定是否新增 `userResponseSchema` 别名（参考 GET /v1/roles/:id 复用 `roleSchema` 既有模式，推荐复用不新增别名）。
- **PII/敏感字段标注（SEC-003a/003b）**：
  - `password_hash`：**永不出现在响应**（userSchema 不含此字段，存储态 `userEntitySchema` 含但 service 投影剥离，前端禁 import `UserEntity`）。
  - `email`：展示用，非高敏，正常返回（与列表/创建响应一致，不脱敏——脱敏仅用于审计日志 `redactedAuditLogSchema`）。
  - `id`：UUID，非 PII，正常返回。

### 3.2 GET /v1/users/:id 错误响应（对齐改动点 1 后的 wire 格式）

```jsonc
// 404 Not Found（id 合法 uuid 但无记录）
{ "code": "USER_NOT_FOUND", "message": "用户不存在" }

// 400 Bad Request（id 非法 uuid）
{ "code": "VALIDATION_ERROR", "message": "输入校验失败", "issues": [{ "path": "id", "message": "..." }] }
// 注：issues 为 D21 [advisory]，本轮不消除（Q7），仍保留

// 401 Unauthorized（无 token / token 无效）
{ "code": "UNAUTHORIZED", "message": "缺失 Authorization header" }
// 或 TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_REVOKED（鉴权五守卫，D5）
```

### 3.3 改动点 1 后的统一错误响应 wire 格式（全端点）

```jsonc
{ "code": "<ErrorCode>", "message": "<string>", "current_version"?: <number> }
// code: 对齐 contracts errorResponseSchema.code（errorCodeSchema 枚举）
// message: 字符串
// current_version: 仅 VERSION_CONFLICT(409) 时填充（D13，meta 合并）
// 例外（非 contracts 码，保持现状不扩 errorCodeSchema）：
//   - 通用 404 无路由匹配：{ "code": "NOT_FOUND", "message": "无路由匹配: ..." }
//   - 500 未捕获/fatal：{ "code": "INTERNAL_ERROR", "message": "..." }
//   以上两码 client 仍走 fallback（行为不变，Q2 决策）
```

## 4 · Q&A 决策（全 BLOCKING，未回答不进入 Spec）

### Q1 · wire 字段名对齐是否破坏向后兼容？【BLOCKING】
**影响**：影响面估算 / 部署策略 / 边界。

**背景**：`error` → `code` 是 wire 格式 breaking change。任何读取 `error` 字段的外部消费者会 break。

**方案**：①接受 breaking change，本轮同步更新所有消费者（前端 client + 全部测试）；②保留 `error` 字段 + 新增 `code` 字段（双发，过渡期）；③不改后端，仅 contracts 改字段名（违背 SSOT，wire 仍不一致）。

**决策：①接受 breaking change**。理由：MVP 无外部消费者（仅 SPA 前端 + 测试套件消费错误响应），所有消费者在本轮同步更新（前端 client + 后端 embedding 测试 + 前端 mock 测试）。双发增加复杂度且 D10 无法真正消除（advisory 永久保留），违背消除动机。③不改后端则 D10 无法消除。**阻塞下游：Tech-Spec wire 改动范围、impl server.ts + client.ts 改动、test ②类 assertion 更新清单。**

### Q2 · 非 contracts 码（NOT_FOUND 通用 404 / INTERNAL_ERROR 500）对齐策略？【BLOCKING】
**影响**：数据实体 / 验收标准 / contracts 是否扩展（①类隐式 impact）。

**背景**：server.ts 的 `NOT_FOUND`（通用 404 无路由）与 `INTERNAL_ERROR`（500）不在 `errorCodeSchema` 枚举内。D10 消除后，若要 client 改用 `errorResponseSchema.parse(body)` 直校，须将这两码加入 errorCodeSchema（contracts 扩展 → ①类隐式 impact：`[...errorCodeSchema.options]` containment 断言失效，涉及 notification/report/role-inheritance/optimistic-locking 等多域测试）。

**方案**：①扩 errorCodeSchema 加入 NOT_FOUND + INTERNAL_ERROR（contracts 完整，client 可直校，但触发 ①类隐式 impact）；②仅对齐字段名（error→code），client 保持 `errorCodeSchema.safeParse(raw.code)` + fallback（非 contracts 码继续降级 INTERNAL_ERROR，行为不变，不扩 contracts，无 ①类 impact）；③移除通用 NOT_FOUND，无路由 404 改用某 contracts 域码（语义不符）。

**决策：②仅对齐字段名，不扩 errorCodeSchema**。理由：本轮目标是消除 D10（wire 字段名适配），非"使所有错误码入 contracts"。`INTERNAL_ERROR` 当前 round-trip 正确（server 发 `INTERNAL_ERROR` → client safeParse 失败 → fallback `INTERNAL_ERROR`，值一致）；`NOT_FOUND`（通用 404）当前降级 `INTERNAL_ERROR`（SPA 仅调已知端点，无路由 404 是边缘场景），行为不变无回归。扩 contracts 触发跨域 ①类隐式 impact（containment 断言），违背"最小 churn 消除 D10"原则。`INTERNAL_ERROR`/`NOT_FOUND` 入 errorCodeSchema 列为 future advisory（与 D21 issues 同类，未来"contracts 完整化"轮处理）。**阻塞下游：Tech-Spec client parseErrorResponse 设计（保留 safeParse+fallback）、impl client 改动边界、test 非 contracts 码用例预期。**

### Q3 · GET /v1/users/:id 鉴权与权限码？【BLOCKING】
**影响**：验收标准 / SEC-001/SEC-002 合规 / 边界。

**背景**：GET /v1/users（列表）为 admin 鉴权。GET /v1/roles/:id（detail）亦 admin 鉴权。新 GET detail 端点须明确 auth + permission。

**方案**：①admin 鉴权 + `user:read` 权限（service 层 SEC-002 越权校验）；②public（无需登录）；③admin 鉴权无权限码细分（仅判登录）。

**决策：①admin 鉴权 + `user:read` 权限**。理由：与 GET /v1/users（列表）一致（同为 user 域读操作），`permissionCodeSchema` 已含 `user:read`（context-snapshot 速查），SEC-002 越权校验在 service 层（与既有 user 域写操作 `user:write` 同模式）。public 违背 SEC-001（路由默认受保护）。**阻塞下游：Tech-Spec router procedure auth 元数据、service getById 鉴权、test 鉴权守卫用例。**

### Q4 · ETag 必选还是可选？【BLOCKING】
**影响**：验收标准 / 路由元数据 / R10 模式对齐。

**背景**：R10 detail 端点（GET /v1/roles/:id / GET /v1/notifications/:id）均 cacheable=true + detailEtag。新 GET user detail 是否对齐？

**方案**：①必选（cacheable=true + detailEtag，对齐 R10 detail 模式）；②可选（cacheable=false，不生成 ETag）；③必选但用 listEtag（语义不符，detail 应用 detailEtag）。

**决策：①必选（cacheable=true + detailEtag）**。理由：与既有 2 个 detail 端点模式一致（R10 D11），detailEtag 基于 `version`（`"${version}"`），userSchema 已含 version 字段。ETag 是 HTTP 层 header 语义（ARCH-001 不污染领域层），server.ts 声明式注入。可选（②）将造成 user detail 与 role/notification detail 不一致，破坏一致性。**阻塞下游：Tech-Spec server.ts 路由注册（cacheable + buildEtag）、test 304/200+ETag 用例。**

### Q5 · 两个改动点是否合并到一轮？【BLOCKING】
**影响**：PRD 结构 / 工作流编排 / 测试依赖。

**决策：合并一轮**（理由见 §1.4）。**阻塞下游：本轮 PRD/Tech-Spec/测试/实现均覆盖两项改动。**

### Q6 · D19 消除后 client 重试策略：保留 D9（409 current_version）还是恢复 AC-F4-3 原 GET-retry？【BLOCKING】
**影响**：验收标准 / client 行为 / D9/D19 重分类。

**背景**：D19 因 GET 端点缺失而改用 D9（409 body current_version 重试）。端点补齐后，原 AC-F4-3 字面"GET 最新 user 取 version 重试"技术上可落地。

**方案**：①保留 D9（409 current_version 重试），D19 advisory 移除（端点 gap 闭合），D9 重分类为 [约束] 设计决策（非因端点缺失的临时偏离）；②恢复 AC-F4-3 原 GET-retry（GET /v1/users/:id 取最新 version 后重试），D9 弃用。

**决策：①保留 D9，D9 重分类为 [约束]**。理由：D9 无额外 round trip（409 body 已含 current_version，直接重试），已测试且工作（R12 §1.4 组合副作用 #1/#3 验证）；GET-retry 多一次 round trip 且须处理 GET 也 409 的边缘场景，复杂度更高。补 GET 端点的价值在于：闭合 D19 端点 gap + 用户详情页消费（future）+ 提供 GET-retry 可选项，非强制切换重试策略。D19 advisory 移除（不再"无法 GET"），D9 从 [advisory]-adjacent 重分类为 [约束]（client 设计选择 409-retry，非因端点缺失的妥协）。**阻塞下游：Tech-Spec D9/D19 重分类标注、client 重试逻辑不变（仅 wire 字段名改）、test 409 重试用例不断言发 GET。**

### Q7 · D21（VALIDATION_ERROR 响应额外 issues 字段）是否本轮一并消除？【BLOCKING】
**影响**：验收标准 / client 是否可直校 errorResponseSchema / 改动范围。

**背景**：server.ts L562-566 VALIDATION_ERROR 响应带 `issues` 字段（contracts errorResponseSchema 未声明），记为 D21 [advisory]。client 因此不 `errorResponseSchema.parse(body)` 直校（会被 .strict() 拒绝），改为手动读字段。D10 消除后若同时消除 D21（移除 issues 或 contracts 声明 issues），client 可改直校。

**决策：不消除（out of scope）**。理由：D21 与 D10 独立（D10 是字段名，D21 是额外字段），本轮目标仅 D10。消除 D21 须决策"移除 issues（丢失校验细节）vs contracts 声明 issues（扩 schema）"，属独立设计决策，不应捆绑。client 保持手动读 `raw.code` + `raw.message` + `raw.current_version`（不 `errorResponseSchema.parse` 直校），issues 仍丢弃。D21 列为 future advisory（与 Q2 非 contracts 码同类，未来"contracts 完整化"轮处理）。**阻塞下游：Tech-Spec client parseErrorResponse 保留手动读字段（不直校）、impl 不改 issues 行为、test D21 用例不断言 issues 入 contracts。**

### Q8 · GET 响应是否新增 userResponseSchema？【BLOCKING】
**影响**：contracts 是否新增 schema / 命名一致性。

**决策：不新增，复用既有 `userSchema`**。理由：GET /v1/roles/:id 复用 `roleSchema`、GET /v1/notifications/:id 复用 `notificationSchema`，均无独立 `*ResponseSchema` 别名。user detail 响应与列表 `items[]` 元素、PATCH status 成功响应同 schema（均 `userSchema`），新增别名徒增 contracts 表面积且违背 ARCH-002 纯净层（无业务意义的别名）。Tech Lead 据此确认 response schema = `userSchema`。**阻塞下游：Tech-Spec response schema 声明、test 响应体断言对齐 userSchema。**

## 5 · 验收标准（Given/When/Then）—— AI-007 端到端验收依据

> 全部 AC 须可被端到端测试覆盖（后端 spawn 真实 server + fetch；前端 mock fetch）。AC 编号：W=wire 对齐（改动点 1），G=GET detail（改动点 2）。

### 改动点 1：wire 字段名对齐（消除 D10）

- **AC-W1 · AppError 错误响应字段名**：GIVEN service 抛 AppError（如 USER_NOT_FOUND）/ WHEN server.ts catch 块处理 / THEN 响应体为 `{ code: <ErrorCode>, message: <string>, ...meta }`（字段名 `code`，非 `error`）；VERSION_CONFLICT 响应含 `current_version`（meta 合并不变）。
- **AC-W2 · VALIDATION_ERROR safeParse 失败响应字段名**：GIVEN 请求体 safeParse 失败 / WHEN server.ts 返回 400 / THEN 响应体为 `{ code: 'VALIDATION_ERROR', message, issues }`（字段名 `code`，issues 保留 D21 [advisory] 不消除）。
- **AC-W3 · VERSION_REQUIRED 响应字段名**：GIVEN versioned 写路由缺失 If-Match / WHEN server.ts 返回 400 / THEN 响应体为 `{ code: 'VERSION_REQUIRED', message }`（字段名 `code`）。
- **AC-W4 · If-Match 格式非法响应字段名**：GIVEN If-Match 非非负整数字符串 / WHEN server.ts 返回 400 / THEN 响应体为 `{ code: 'VALIDATION_ERROR', message }`（字段名 `code`）。
- **AC-W5 · 通用 404 无路由响应字段名**：GIVEN 请求未匹配任何路由 / WHEN server.ts 返回 404 / THEN 响应体为 `{ code: 'NOT_FOUND', message }`（字段名 `code`；NOT_FOUND 非 contracts 码，client fallback 行为见 AC-W8）。
- **AC-W6 · 500 INTERNAL_ERROR 响应字段名**：GIVEN 未捕获错误 / WHEN server.ts 返回 500 / THEN 响应体为 `{ code: 'INTERNAL_ERROR', message }`（字段名 `code`；INTERNAL_ERROR 非 contracts 码，client fallback 行为见 AC-W8）。
- **AC-W7 · client 删除 wire 适配读 raw.code**：GIVEN 任意错误响应 / WHEN client `parseErrorResponse` 解析 / THEN 直接读 `raw.code`（不再读 `raw.error`），`errorCodeSchema.safeParse(raw.code)` 校验，成功则 code 为 contracts ErrorCode，失败 fallback `INTERNAL_ERROR`；`message`/`current_version` 字段名读取不变。
- **AC-W8 · 非 contracts 码 fallback 行为不变**：GIVEN 响应 `code: 'INTERNAL_ERROR'` 或 `code: 'NOT_FOUND'`（非 errorCodeSchema 枚举）/ WHEN client safeParse / THEN safeParse 失败 → code 降级 `INTERNAL_ERROR`（与 R12 行为一致，无回归）；INTERNAL_ERROR round-trip 正确（server 发 INTERNAL_ERROR → client code=INTERNAL_ERROR）。
- **AC-W9 · 409 VERSION_CONFLICT 重试链不破坏**：GIVEN PATCH status 返回 409 `{ code: 'VERSION_CONFLICT', message, current_version: N+1 }` / WHEN client 处理 / THEN 读 `raw.code`='VERSION_CONFLICT' + `raw.current_version`=N+1，用 N+1 重试 1 次（D9 行为不变，仅字段名 error→code）。
- **AC-W10 · 401 拦截链不破坏**：GIVEN 401 响应 `{ code: 'UNAUTHORIZED'|'TOKEN_INVALID'|'TOKEN_EXPIRED'|'TOKEN_REVOKED' }` / WHEN client 处理 / THEN 读 `raw.code` 判定鉴权类 401 → 清 token 跳 /login；`code: 'INVALID_CREDENTIALS'` 原样抛登录页（D8 行为不变，仅字段名 error→code）。
- **AC-W11 · D10 advisory 反向同步移除**：GIVEN Tech-Spec 反向同步 / THEN web-auth-user.tech.md D10 [advisory] 标注移除（或改为"已消除"历史记录），client.ts 注释移除"wire 适配 error→code（D10 [advisory]）"措辞。

### 改动点 2：补 GET /v1/users/:id（消除 D19）

- **AC-G1 · 查询成功**：GIVEN 已存在用户（id=alice，version=N）/ WHEN admin 携带有效 Bearer token GET /v1/users/:id / THEN 返回 200 + User（对齐 userSchema：id/name/email/status/department_id/created_at/updated_at/version），**不含 password_hash**（SEC-003a）。
- **AC-G2 · 用户不存在 404**：GIVEN id 为合法 uuid 但无记录 / WHEN GET /v1/users/:id / THEN 返回 404 + `{ code: 'USER_NOT_FOUND', message }`（对齐改动点 1 后的 wire 格式）。
- **AC-G3 · id 非法 uuid 400**：GIVEN id 非 uuid 格式（如 "abc"）/ WHEN GET /v1/users/abc / THEN 返回 400 + `{ code: 'VALIDATION_ERROR', message, issues }`（safeParse 失败，issues 保留 D21）。
- **AC-G4 · 鉴权守卫-无 token**：GIVEN 未携带 Authorization header / WHEN GET /v1/users/:id / THEN 返回 401 + `{ code: 'UNAUTHORIZED', message }`（buildCtx G1 守卫，admin 路由非 public）。
- **AC-G5 · 鉴权守卫-token 无效/过期/吊销**：GIVEN token 伪造/过期/已吊销 / WHEN GET /v1/users/:id / THEN 返回 401 + 对应 `{ code: 'TOKEN_INVALID'|'TOKEN_EXPIRED'|'TOKEN_REVOKED' }`（G3/G4/G5 守卫）。
- **AC-G6 · 越权校验**：GIVEN role 非 admin（无 user:read 权限）的 token / WHEN GET /v1/users/:id / THEN service 层 SEC-002 拒绝，返回 403 + `{ code: 'FORBIDDEN', message }`（与 GET /v1/users 越权行为一致）。
- **AC-G7 · ETag 生成**：GIVEN 用户 version=N / WHEN GET /v1/users/:id 成功 / THEN 响应含 `ETag: "N"` header（detailEtag 基于 version，对齐 GET /v1/roles/:id 模式）。
- **AC-G8 · If-None-Match 匹配 304**：GIVEN 客户端携带 `If-None-Match: "N"` 且实体未变 / WHEN GET /v1/users/:id / THEN 返回 304 Not Modified（空体 + `ETag: "N"` header，无 body）。
- **AC-G9 · If-None-Match 不匹配 200**：GIVEN 客户端携带 `If-None-Match: "N-1"`（旧）或非法格式 / WHEN GET /v1/users/:id / THEN 返回 200 + 最新 User body + 新 `ETag: "N"`（parseIfNoneMatch 宽容解析，对齐 R10 D8）。
- **AC-G10 · 路由不与列表/状态更新冲突**：GIVEN 路由表 / THEN `GET /v1/users/:id`（3 段）与 `GET /v1/users`（2 段，列表）、`PATCH /v1/users/:id/status`（4 段，状态更新）、`POST /v1/users/:userId/transfer`（4 段）、`GET /v1/users/:userId/roles`（4 段）、`GET /v1/users/:userId/effective-permissions`（4 段）均无 matchPattern 冲突（段数/method 不同）。
- **AC-G11 · 路由表新增条目**：GIVEN server.ts routes 数组 / THEN 含 `GET /v1/users/:id`（method=GET, pattern=/v1/users/:id, auth=admin, versioned=false, cacheable=true, buildEtag=detailEtag），注册位置在 `GET /v1/users` 之后、`PATCH /v1/users/:id/status` 之前（user 域读端点聚拢）。
- **AC-G12 · D19 advisory 反向同步移除**：GIVEN Tech-Spec 反向同步 / THEN web-auth-user.tech.md D19 [advisory] 标注移除（端点 gap 已闭合）；D9 重分类为 [约束]（client 设计选择 409-retry，Q6 决策）。
- **AC-G13 · 前端消费（future-ready，非本轮前端实现）**：GIVEN GET /v1/users/:id 端点存在 / THEN 前端 api/users.ts 可新增 `getUser(id)` 封装（本轮后端落地，前端消费列为 future，不在本轮 AC 强制——但端点须可被 fetch 调用）。

## 6 · 影响面估算

### 6.1 跨层文件清单（改动点 1：wire 字段名对齐）

| 层 | 文件 | 改动性质 | 改动点 |
|----|------|----------|--------|
| 后端入口 | `apps/api/src/server.ts` | ②类 wire 字段名 | 7 处 `error:` → `code:`（L532/552/554/563/602/611 + L594 catch 块 `error: e.code` → `code: e.code`） |
| 前端 client | `apps/web/src/api/client.ts` | ②类 删 wire 适配 | `parseErrorResponse`（L74-87）`raw.error` → `raw.code`；注释（L6, L12-14, L33, L68-72）移除 "wire 适配 error→code（D10 [advisory]）" 措辞 |
| contracts | `packages/contracts/src/schemas/user.ts` | 零变更 | `errorResponseSchema` 已声明 `code` 字段，无需改（Q2 不扩 errorCodeSchema） |
| errors.ts | `apps/api/src/errors.ts` | 零变更 | `errorCodeToHttpStatus` 映射不变（USER_NOT_FOUND 已 404） |
| Spec | `docs/spec/web-auth-user.tech.md` | 反向同步 | §4.6 + D10 [advisory] 标注移除/改历史；§1.2 + D19 [advisory] 标注移除；D9 重分类 [约束]（Q6） |

### 6.2 跨层文件清单（改动点 2：补 GET /v1/users/:id）

| 层 | 文件 | 改动性质 | 改动点 |
|----|------|----------|--------|
| 后端入口 | `apps/api/src/server.ts` | ③类 新增路由 | routes 数组新增 `defineRoute('GET', '/v1/users/:id', (m) => ({ id: m.path.id }), userRouter.detail, false, true, detailEtag)`（参考 GET /v1/roles/:id L266-270 模式） |
| router | `apps/api/src/router/user.ts` | ③类 新增 procedure | 新增 `detail` procedure（input=id uuid schema, handler=service.getById, auth='admin'）；参考 roleRouter.detail（router/role.ts L133-135） |
| service | `apps/api/src/service/user.ts` | ③类 新增方法 | 新增 `getById(id, ctx)`：调 repository.findById + SEC-002 越权校验（user:read）+ 投影剥离 password_hash + 不存在抛 USER_NOT_FOUND |
| repository | `apps/api/src/repository/user.ts` | ③类 复用/新增 | findById（R10 etag-caching.tech.md D3 注："repository 已提供 findById"，预计复用；若签名不符则新增） |
| contracts | `packages/contracts/src/schemas/user.ts` | 零变更 | 复用 `userSchema`（Q8 不新增 userResponseSchema）；USER_NOT_FOUND 已在 errorCodeSchema |
| 前端（future） | `apps/web/src/api/users.ts` | 本轮不强制 | 可新增 `getUser(id)` 封装（AC-G13 future-ready，非本轮 AC 强制） |

### 6.3 测试影响（AI-006 两类标注）

**改动点 1（wire 字段名）—— ②类签名/行为变更驱动**：

| 文件 | 影响类型 | 改动 |
|------|----------|------|
| `apps/api/test/auth-embedding.test.ts` | ②类 assertion 更新 | 11 处 `expect(body.error).toBe(...)` → `expect(body.code).toBe(...)`（L169/170/179/190/198/206/215/235/261/279/293） |
| `apps/api/test/persist-embedding.test.ts` | ②类 assertion 更新 | 1 处 `create2.body.error` → `create2.body.code`（L221） |
| `apps/api/test/optimistic-locking-embedding.test.ts` | ②类 assertion 更新 | 7 处 `res.body.error` → `res.body.code`（L170/180/190/231/262/280/322） |
| `apps/web/test/api-client.test.ts` | ②类 mock 更新 | mock fetch 响应 `{ error: ... }` → `{ code: ... }`（L112/130/151/166/168）；"wire 适配" 测试名/注释更新 |
| `apps/web/test/api-notifications.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L224/241/258/274/290/315/330/344）；"wire 适配" 测试名更新 |
| `apps/web/test/api-departments.test.ts` | ②类 mock 更新 | mock 响应 `{ error: 'DEPT_HAS_CHILDREN' }` → `{ code: ... }`（L131） |
| `apps/web/test/api-role-inheritance.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L109/124/138/151/182/276/289/299） |
| `apps/web/test/api-reports.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L211/226） |
| `apps/web/test/api-roles.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L143/158/224/241） |
| `apps/web/test/api-transfer.test.ts` | ②类 mock 更新 | mock 响应 `{ error: ... }` → `{ code: ... }`（L123/136/148/160/172/184/196/208/220） |

> ②类 assertion 更新说明（AI-002 边界）：wire 字段名 `error→code` 是行为变更，test-writer 将既有 `body.error`/mock `{ error: }` 更新为 `body.code`/mock `{ code: }` 属合法 ②类签名驱动更新（非静默弱化断言），matcher 不变（`.toBe`），仅字段名变。impl-writer 阶段使 server.ts 对齐后转绿。

**改动点 2（GET /v1/users/:id）—— ③类新增**：

| 文件 | 影响类型 | 覆盖 AC |
|------|----------|---------|
| `apps/api/test/user-detail.test.ts`（新增） | ③类 单测+行为+契约 | AC-G1~G9（成功/404/400/鉴权/越权/ETag/304/200 不匹配） |
| `apps/api/test/user-detail-embedding.test.ts`（新增，spawn 真实 server + fetch） | ③类 端到端 | AC-G1/G2/G4/G5/G7/G8/G10/G11（端到端 HTTP 全链路） |

**①类 contracts 联动 —— 0 文件**（Q2 不扩 errorCodeSchema，枚举值不变，containment 断言不失效）。

### 6.4 既有路由表核验（R10 S-2 教训闭合）

核验 `apps/api/src/server.ts` routes 数组（L221-374）+ `docs/context-snapshot.md` 路由表：

| 核验项 | 结论 |
|--------|------|
| `GET /v1/users/:id` 是否已存在 | **不存在**（user 域仅 GET /v1/users / POST /v1/users / PATCH /v1/users/:id/status / POST /v1/users/:userId/transfer） |
| 新增是否覆盖既有路由 | **不覆盖**（GET /v1/users/:id 3 段，与既有 user 域路由段数/method 不同，见 AC-G10） |
| wire 字段名现状 | server.ts 7 处 `error:` 字段，contracts `errorResponseSchema` 用 `code` 字段（不一致，D10 待消除） |
| detail 端点参考模式 | GET /v1/roles/:id（L266-270, cacheable=true + detailEtag）+ GET /v1/notifications/:id（L349-353）已落地，user detail 对齐 |
| USER_NOT_FOUND 错误码 | errorCodeSchema 已含（user.ts L127），errors.ts 已映射 404，无需新增 |
| detailEtag helper | `apps/api/src/etag.ts` 已导出（R10 D7），server.ts 已 import，无需新增 |

### 6.5 advisory 偏离来源核验

| 偏离 | 来源文件 | 章节/决策号 | 核验结论 |
|------|----------|-------------|----------|
| D10 wire 适配 | `docs/spec/web-auth-user.tech.md` | §4.6 + D10 [advisory]（L471-472） | 确认：字段名 error→code 适配，client.ts parseErrorResponse 读 raw.error |
| D10 标注 | `apps/web/src/api/client.ts` | L12-14, L68-72 注释 | 确认："[advisory] D10：wire 适配 INTERNAL_ERROR 降级码" |
| D19 不 GET | `docs/spec/web-auth-user.tech.md` | §1.2 + D19 [advisory]（L501-502） | 确认：GET /v1/users/:id 端点不存在，改用 409 current_version |
| D19 来源 | `docs/retro/round12-retro.md` | §1.3 | 确认：PRD AC-F4-3 字面"GET 最新 user"无法落地，Spec 改 409 current_version |

## G1 自检声明

- **PRD 完整性**：六章节齐全（背景 / 目标 / 数据实体草图 / Q&A 决策 / 验收标准 / 影响面估算）+ frontmatter（id/status=decided/Q&A 摘要）+ Out of scope。
- **验收标准可测**：24 条 AC（W1-W11 + G1-G13），每条 Given/When/Then 可由端到端测试覆盖（后端 spawn server + fetch；前端 mock fetch）。AC-G13 标注 future-ready 非强制。
- **既有路由表核验（R10 S-2）**：grep server.ts routes 确认 GET /v1/users/:id 确实不存在（§6.4）；确认 wire 字段名现状（server.ts 7 处 `error:`，contracts `code`，§1.1）。
- **advisory 偏离来源核验**：读 round12-retro.md §1.3 确认 D19 背景（§1.2）；读 web-auth-user.tech.md 确认 D10 标注（§4.6 + D10，§6.5）。
- **BLOCKING 项已拍板**：Q1-Q8 全部决策（status=decided 前提满足）。
- **PII/敏感字段标注**：password_hash 永不出响应（SEC-003a，§3.1）；email 非高敏正常返回；token/password 不入日志（沿用 PRD-WEB-AUTH-USER-001 D12，本轮不改变）。
- **Out of scope 明确**：D21 issues 消除 / INTERNAL_ERROR+NOT_FOUND 入 errorCodeSchema / 前端用户详情页实现 / 恢复 AC-F4-3 GET-retry 均列为 out of scope 或 future。

## Out of scope

- **D21（VALIDATION_ERROR 响应 issues 额外字段）消除** —— 与 D10 独立，本轮不消除（Q7），client 仍手动读字段不直校 errorResponseSchema。
- **INTERNAL_ERROR / NOT_FOUND 入 errorCodeSchema** —— Q2 决策不扩 contracts，列为 future advisory（与 D21 同类，未来"contracts 完整化"轮处理）。
- **恢复 AC-F4-3 原 GET-retry 重试策略** —— Q6 决策保留 D9（409 current_version 重试），不切换为 GET-retry。
- **前端用户详情页实现** —— 本轮仅后端补 GET 端点（AC-G13 future-ready），前端 detail page 消费为 future 轮次。
- **前端 api/users.ts 新增 getUser(id) 封装** —— 非本轮 AC 强制（future-ready）。
- **GET /v1/users/:id 的列表内嵌展开（如 ?expand=roles）** —— 本轮仅单条详情，无 expand。
- **批量 GET（如 GET /v1/users?ids=...）** —— 本轮不涉及。
- **用户软删除 / 回收站** —— 沿用 PRD-USER-001 Q1（不提供删除）。
- **审计埋点 for GET /v1/users/:id** —— GET 读操作不埋审计（沿用既有读端点 GET /v1/users / GET /v1/roles/:id 不埋点惯例；D9 审计 append-only 仅写操作）。
- **新规则 / check-rules.mjs 改动** —— 本轮无规则改动（wire 对齐 + 端点补齐均不触发新规则）。
