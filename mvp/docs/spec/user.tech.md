---
doc_type: Tech-Spec
id: TECH-USER-001
prd_ref: PRD-USER-001
status: draft
owner: dev@team
---
# 用户管理 · 技术规格

## 影响的模块
- `packages/contracts/src/schemas/user.ts`：契约 SSOT（Zod schema + z.infer 类型 + errorCodeSchema）。
- `apps/api/src/router/user.ts`（待生成）：procedure 表，输入输出经 Zod 校验。
- `apps/api/src/service/user.ts`（待生成）：业务规则、状态机裁决、越权校验（SEC-002）、邮箱唯一性。
- `apps/api/src/repository/user.ts`（待生成）：内存实现（本 MVP 不连真实 DB）。
- `apps/api/src/domain/user.ts`（待生成）：领域常量与状态机定义（不 import 上层，ARCH-001）。
- `api-spec/user.openapi.yaml`：OpenAPI 3.1 片段，与 Zod 1:1 对齐。

## API 契约（引用，不复制）
所有 schema 与类型定义在 `packages/contracts/src/schemas/user.ts`，本节仅引用，不复制字段定义（避免 SSOT 漂移）。

| Procedure | Method & Path | 入参 schema | 出参 schema | 鉴权 |
|---|---|---|---|---|
| user.list | GET `/v1/users` | `listUserQuerySchema` | `userListResultSchema` | 需管理员（SEC-001） |
| user.create | POST `/v1/users` | `createUserInputSchema` | `userSchema`（201） | 需管理员（SEC-001） |
| user.updateStatus | PATCH `/v1/users/{id}/status` | path `id` (uuid) + body `updateUserStatusInputSchema` | `userSchema` | 需管理员（SEC-001） |

错误统一回包 `errorResponseSchema`（`{ code: ErrorCode, message: string }`），`code` 取自 `errorCodeSchema`。

入参解析失败的统一码：`VALIDATION_ERROR`（不区分字段，字段级 detail 仅在 message 中给出，不进入 code）。

## DB 变更
本 MVP repository 用内存实现，但 DB schema 作为 SSOT 文档产出。以下纯 TS 接口等价于 Drizzle `pgTable` 定义，未来落地真实 DB 时按此建表。

```ts
// apps/api/src/domain/user.ts —— DB schema SSOT（等价 Drizzle pgTable）
// 等价 Drizzle：
// export const users = pgTable('users', {
//   id: uuid('id').primaryKey().defaultRandom(),
//   name: varchar('name', { length: 100 }).notNull(),
//   email: varchar('email', { length: 255 }).notNull().unique(),
//   status: varchar('status', { length: 16 }).notNull().default('active'),
//   created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
//   updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
// });

/** DB 行结构（snake_case，与契约 userSchema 一致） */
export interface UserRow {
  id: string;                  // uuid, primary key
  name: string;                // 1..100 字符
  email: string;               // 1..255 字符，唯一索引 unique
  status: 'active' | 'disabled'; // 默认 'active'
  created_at: string;          // ISO 8601 timestamptz
  updated_at: string;          // ISO 8601 timestamptz，每次写操作刷新
}

/** 唯一约束：email（DB 层 unique index） */
// 唯一冲突在 service 层捕获并转码为 USER_EMAIL_DUPLICATE。
```

变更项（首次落地 DB 时）：
- 新建表 `users`，含 `email` 唯一索引。
- 无需迁移历史数据（新模块）。
- 回滚：`DROP TABLE users;`（无外键依赖，本 MVP 无其他表引用）。

## 状态机
用户 `status` 字段为有限状态机，取值见 `userStatusSchema`（`active` | `disabled`）。

```
        ┌─────────────────────────────┐
        │                             │
   disable(ok)                   enable(ok)
        │                             │
        ▼                             ▼
   ┌─────────┐  disable(self) ──✗── USER_DISABLE_SELF_FORBIDDEN
   │ active  │  disable(already)──✗── USER_ALREADY_DISABLED (不可达，本身即 active)
   └─────────┘
        │ disable(ok)
        ▼
   ┌──────────┐  enable(already)──✗── USER_ALREADY_ACTIVE (不可达，本身即 disabled)
   │ disabled │  enable(ok) ─────► 回到 active
   └──────────┘
```

迁移规则（service 层裁决，顺序固定，不可调换）：

**PATCH `/v1/users/{id}/status` 请求 `status=disabled`（禁用，F3）：**
1. 按 `id` 查找用户 → 不存在 → `USER_NOT_FOUND`。
2. 校验调用者：`actor.id === target.id` → `USER_DISABLE_SELF_FORBIDDEN`（权限校验先于状态校验，SEC-002）。
3. 当前 `status === 'disabled'` → `USER_ALREADY_DISABLED`。
4. 否则 `status` 置为 `disabled`，刷新 `updated_at`，返回更新后 `userSchema`。

**PATCH `/v1/users/{id}/status` 请求 `status=active`（启用，F4）：**
1. 按 `id` 查找用户 → 不存在 → `USER_NOT_FOUND`。
2. 当前 `status === 'active'` → `USER_ALREADY_ACTIVE`。
3. 否则 `status` 置为 `active`，刷新 `updated_at`，返回更新后 `userSchema`。
   - 启用自身不被禁止（无自我启用限制）。

初始态：新建用户 `status` 恒为 `active`（F2 验收），不接受创建时指定 `status`。

## 边界与异常（每条对应一个错误码）
| # | 触发条件 | 错误码 | HTTP | 说明 |
|---|---|---|---|---|
| B1 | 任意 procedure 入参不通过对应 Zod schema（字段缺失、类型错、email 格式非法、uuid 非法、page<1、pageSize 越界等） | `VALIDATION_ERROR` | 400 | Zod 解析失败统一此码，字段级 detail 在 message |
| B2 | 未携带有效凭证 / 未登录访问任意 procedure | `UNAUTHORIZED` | 401 | SEC-001 默认受保护 |
| B3 | 已登录但非管理员角色调用任意 procedure | `FORBIDDEN` | 403 | SEC-002 service 层 requirePermission |
| B4 | create 提交的 email 已被其他用户占用（邮箱唯一） | `USER_EMAIL_DUPLICATE` | 409 | F2 验收"邮箱已存在" |
| B5 | updateStatus 目标 id 不存在（含 uuid 格式合法但无记录） | `USER_NOT_FOUND` | 404 | F4 验收"用户不存在"；F3 同样适用 |
| B6 | updateStatus 目标 = 当前登录管理员自身且请求 disabled | `USER_DISABLE_SELF_FORBIDDEN` | 403 | F3 验收"不能禁用自身账号" |
| B7 | updateStatus 请求 disabled 但目标已是 disabled | `USER_ALREADY_DISABLED` | 409 | F3 验收"用户已是禁用状态" |
| B8 | updateStatus 请求 active 但目标已是 active | `USER_ALREADY_ACTIVE` | 409 | F4 验收"用户已是启用状态" |

校验顺序（service 层必须遵守，先到先返，不叠加）：B1（router 层 Zod 解析）→ B2/B3（鉴权）→ 业务规则（B4/B5/B6）→ 状态守卫（B7/B8）。

错误码枚举 SSOT：`errorCodeSchema`（`packages/contracts/src/schemas/user.ts`），新增需同步本表与 OpenAPI。

## 迁移与回滚
- 契约层：本期为首次产出，无旧契约需迁移。后续 schema 变更须保持向后兼容（仅加字段或放宽约束）；破坏性变更需新版本号并在 PRD 登记。
- DB：见 §DB 变更，首次建表，回滚为 `DROP TABLE users`。
- 数据：内存 repository 重启即清空，无需数据迁移脚本；落地真实 DB 时需补 `users` 建表迁移与 `email` 唯一索引。
- 回滚策略：契约/DB 任一回滚需保证 OpenAPI 与 errorCodeSchema 同步回滚，三处一致（自检 #3/#4）。

## 测试矩阵（表格：用例类型 | 覆盖点）
| 用例类型 | 覆盖点 |
|---|---|
| 单测 | repository CRUD（内存）：create/list/getById/updateStatus；分页计算 `totalPages=ceil(total/pageSize)`；空列表 `total=0/totalPages=0`；email 唯一性在 repo 层的判定。 |
| 单测 | service 状态机裁决：B5/B6/B7/B8 四条错误码的触发与顺序；create 默认态 active；create 邮箱冲突转码 USER_EMAIL_DUPLICATE。 |
| 契约测 | 每个 procedure 的入参 schema 用 `safeParse` 喂合法/非法样本：email 缺 @、name 空串、page=0、pageSize=200、id 非 uuid、status 非枚举值 → 均 VALIDATION_ERROR；合法样本通过。 |
| 契约测 | 出参 schema 校验：list 返回结构含 items/total/page/pageSize/totalPages 且类型匹配；create/updateStatus 返回完整 userSchema（含 created_at/updated_at）。 |
| 边界 | F1：25 条数据 page=2 pageSize=10 → 返回 11-20 条，total=25 totalPages=3；空库 page=1 → items=[] total=0 totalPages=0；status=disabled 过滤后启用用户不出现；未传 status 返回全部。 |
| 边界 | F2：email 合法且未占用 → 创建成功且 status=active；email 重复 → USER_EMAIL_DUPLICATE；email 格式非法 → VALIDATION_ERROR；name 缺失 → VALIDATION_ERROR。 |
| 边界 | F3/F4：active→disabled 成功；disabled→active 成功；重复禁用 USER_ALREADY_DISABLED；重复启用 USER_ALREADY_ACTIVE；目标不存在 USER_NOT_FOUND。 |
| 权限 | B2：未登录调任意 procedure → UNAUTHORIZED（SEC-001）。 |
| 权限 | B3：非管理员角色调任意 procedure → FORBIDDEN（SEC-002，service 层 requirePermission）。 |
| 权限 | B6：管理员禁用自身 → USER_DISABLE_SELF_FORBIDDEN；管理员启用自身 → 成功（不禁止）。 |
| 权限 | SEC-003：list/create/updateStatus 响应不含未声明 PII（响应仅 userSchema 字段，无密码/角色等）。 |
| 状态机 | active --disable--> disabled（ok）；disabled --disable--> USER_ALREADY_DISABLED；disabled --enable--> active（ok）；active --enable--> USER_ALREADY_ACTIVE；任意态目标缺失 --*--> USER_NOT_FOUND；active --disable(self)--> USER_DISABLE_SELF_FORBIDDEN。 |
| 状态机 | 顺序校验：自身+已禁用同时命中时，先返 USER_DISABLE_SELF_FORBIDDEN（B6 优先 B7）；不存在+任意 → 先返 USER_NOT_FOUND（B5 优先）。 |

## Out of scope
- **Q4 关键字搜索（按姓名/邮箱模糊匹配）**：本期不做。`listUserQuerySchema` 仅支持 `status` 过滤；如需搜索后续单独加 `q` 参数与索引。
- **Q6 禁用后会话立即失效**：本期不做。禁用用户后续登录将被拒绝（login 侧校验 status），但已建立的在线会话不主动失效；后续迭代引入会话失效机制。
- **删除用户 / 批量导入**：Q1/Q2 已确认不做，避免级联复杂度。
- **新建用户的密码 / 角色 / 部门字段**：Q5 决策本期仅 `email + name` 必填；`createUserInputSchema` 不含上述字段。
- **审计落库**：非功能要求提及"留审计痕迹"，本期仅预留扩展点，不实现审计表（SEC-003 仅做 PII 脱敏约束）。
- **真实 DB 接入**：本 MVP repository 内存实现，DB schema 仅作文档 SSOT（见 §DB 变更）。
