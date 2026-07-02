---
doc_type: Tech-Spec
id: TECH-ROLE-001
prd_ref: PRD-ROLE-001
status: draft
owner: dev@team
---
# 角色管理 · 技术规格

> 标记约定（本轮复盘 P1 优化项）：
> - `[约束]` = Dev 必须遵守（字段集 / 错误码 / 状态机 / 权限 / 校验顺序）。
> - `[advisory]` = Dev 可偏离，但须在 PR 描述中"反向同步 Spec"（写明偏离点与理由）。
> 每条实现性描述均显式标注其一；未标注的为纯说明性文字（引用、引用指向）。

## 影响的模块
- `packages/contracts/src/schemas/role.ts`（本期新增）：角色域契约 SSOT（7 个 Zod schema + z.infer 派生类型）。`[约束]` 所有类型经 `z.infer` 派生，禁止手写（ARCH-002 / CODE-004）。
- `packages/contracts/src/schemas/user.ts`（既有，本期编辑）：`errorCodeSchema` 为跨域共享单一错误码 SSOT，角色相关码已追加其中。`[约束]` role.ts 不重复定义 `errorCodeSchema`，避免 `export *` 重名冲突。
- `apps/api/src/errors.ts`（既有，本期编辑）：`errorCodeToHttpStatus: Record<ErrorCode, number>` 穷举映射，新增 5 个角色码必须补齐，否则 `tsc` 失败。`[约束]`
- `apps/api/src/router/role.ts`（待生成）：procedure 表，输入输出经 Zod 校验，参考 `router/user.ts` 的 `Procedure` 类型。`[约束]` 每个 procedure 必须声明 auth/permission 元数据（SEC-001）。
- `apps/api/src/service/role.ts`（待生成）：业务规则、唯一性裁决、删除守卫序列、越权校验（SEC-002）。`[约束]`
- `apps/api/src/repository/role.ts`（待生成）：内存实现。`[advisory]` 用 `Map` 内存存储；真实 DB 可换，但须保持本 Spec §DB 变更的 schema 形状。
- `apps/api/src/domain/role.ts`（待生成）：领域常量（权限码、内置角色名）与守卫顺序定义，不 import 上层（ARCH-001）。`[约束]`
- `api-spec/role.openapi.yaml`（本期新增）：OpenAPI 3.1 片段，与 Zod 1:1 对齐。

## API 契约（引用，不复制）
所有 schema 与类型定义在 `packages/contracts/src/schemas/role.ts`，错误码定义在 `user.ts` 的 `errorCodeSchema`。本节仅引用，不复制字段定义（避免 SSOT 漂移）。

| Procedure | Method & Path | 入参 schema | 出参 schema | 鉴权 |
|---|---|---|---|---|
| role.list | GET `/v1/roles` | `listRoleQuerySchema` | `roleListResultSchema` | `[约束]` 需 `role:read` |
| role.create | POST `/v1/roles` | `createRoleInputSchema` | `roleSchema`（201） | `[约束]` 需 `role:write` |
| role.detail | GET `/v1/roles/{id}` | path `id` (uuid) | `roleSchema` | `[约束]` 需 `role:read` |
| role.delete | DELETE `/v1/roles/{id}` | path `id` (uuid) | 204 无 body | `[约束]` 需 `role:write` |
| role.assign | POST `/v1/users/{userId}/roles` | path `userId` + body `{ roleId }`（合并为 `assignRoleInputSchema`） | `userRoleSchema`（201） | `[约束]` 需 `role:write` |
| role.listUserRoles | GET `/v1/users/{userId}/roles` | path `userId` | `userRoleSchema[]` | `[约束]` 需 `role:read` |
| role.remove | DELETE `/v1/users/{userId}/roles/{roleId}` | path `userId`+`roleId`（合并为 `assignRoleInputSchema`） | 204 无 body | `[约束]` 需 `role:write` |

错误统一回包 `errorResponseSchema`（`{ code: ErrorCode, message: string }`），`code` 取自 `errorCodeSchema`。`[约束]`
入参解析失败的统一码：`VALIDATION_ERROR`（不区分字段，字段级 detail 仅在 message 中给出，不进入 code）。`[约束]`

> 鉴权说明（`[advisory]` 已知限制 / 遗留风险）：PRD 以权限码（`role:read`/`role:write`）为鉴权原语，但既有 `Ctx.user.role` 仅有 `'admin' | 'user'`（user 域 MVP 鉴权桩），不携带解析后的权限码集合。本期 `[advisory]` 采用映射：内置 admin 角色持有全部权限码（Q4），故 `ctx.user.role === 'admin'` 视为同时具备 `role:read` + `role:write`；非 admin 视为无角色权限 → `FORBIDDEN`。`[约束]` procedure 元数据仍按 `role:read`/`role:write` 声明所需权限，service 层 `requirePermission(code)` 在 admin 桩下放行全部、否则拒绝。PRD F1/F2 中"仅具备 role:read 的管理员"这一验收场景须待 Auth 模块富化 `Ctx`（携带 resolved permission codes）后方可端到端验证，列入 §Out of scope 与遗留风险。该 gap 为既有基础设施限制，非 PRD 未决项，故不触发阻断。

## DB 变更
`[advisory]` 本 MVP repository 用内存实现（`Map`），但 DB schema 作为 SSOT 文档产出。以下纯 TS 接口等价于 Drizzle `pgTable` 定义，未来落地真实 DB 时按此建表。

```ts
// apps/api/src/domain/role.ts —— DB schema SSOT（等价 Drizzle pgTable）
// 等价 Drizzle：
// export const roles = pgTable('roles', {
//   id: uuid('id').primaryKey().defaultRandom(),
//   name: varchar('name', { length: 64 }).notNull().unique(),
//   description: varchar('description', { length: 512 }).notNull(),
//   permission_codes: jsonb('permission_codes').notNull(), // 存权限码字符串数组
//   is_builtin: boolean('is_builtin').notNull().default(false),
//   created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
// });
// export const user_roles = pgTable('user_roles', {
//   id: uuid('id').primaryKey().defaultRandom(),
//   user_id: uuid('user_id').notNull(), // 外键 users(id)
//   role_id: uuid('role_id').notNull(), // 外键 roles(id)
//   assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
// });

/** DB 行结构（snake_case，与契约 roleSchema 一致） */
export interface RoleRow {
  id: string;                       // uuid, primary key
  name: string;                     // 1..64 字符，唯一索引 unique
  description: string;              // 0..512 字符
  permission_codes: string[];       // 权限码数组，元素须 ∈ permissionCodeSchema 枚举
  is_builtin: boolean;              // 内置角色标记，默认 false
  created_at: string;               // ISO 8601 timestamptz
}

/** DB 行结构（user_roles 关联表，与契约 userRoleSchema 一致） */
export interface UserRoleRow {
  id: string;          // uuid, primary key
  user_id: string;     // uuid, 外键 users(id)
  role_id: string;     // uuid, 外键 roles(id)
  assigned_at: string; // ISO 8601 timestamptz
}
```

`[约束]` 唯一约束：`roles.name` 全局唯一（Q3）→ 唯一冲突在 service 层捕获转码 `ROLE_NAME_DUPLICATE`。
`[约束]` 唯一约束：`user_roles (user_id, role_id)` 业务唯一 → 重复分配转码 `USER_ROLE_ALREADY_ASSIGNED`。
`[约束]` 外键：`user_roles.user_id` → `users.id`，`user_roles.role_id` → `roles.id`；本期内存实现不强制 FK，但落地真实 DB 须建 FK 与级联策略（见 §迁移与回滚）。
`[约束]` `roles` 无 `updated_at`：F1 决策角色创建后 `permission_codes` 不可改、本期无编辑端点，故无更新时间字段。
`[约束]` 内置 admin 行：系统初始化时插入一条 `name='admin'`、`is_builtin=true`、`permission_codes = 全部权限码` 的记录（F5/Q4）。

变更项（首次落地 DB 时）：
- `[约束]` 新建表 `roles`（含 `name` 唯一索引）与 `user_roles`（含 `(user_id, role_id)` 唯一索引）。
- 初始化内置 admin 行（幂等：若已存在 `name='admin'` 则跳过）。`[约束]`
- `[约束]` 回滚：先 `DROP TABLE user_roles;` 再 `DROP TABLE roles;`（user_roles 依赖 roles）。

## 状态机
`[约束]` 角色实体**无状态机**：`Role` 不含 `status` 字段（PRD 数据实体未定义状态），不存在 active/disabled 之类迁移。角色生命周期仅：创建 → 存在 → 删除（不可编辑）。

`[约束]` 删除/分配虽无状态机，但有固定**守卫序列**（service 层裁决，顺序不可调换，先到先返，不叠加），详见 §边界与异常 B 表的"校验顺序"。

## 边界与异常（每条对应一个错误码）
| # | 触发条件 | 错误码 | HTTP | 说明 |
|---|---|---|---|---|
| B1 | 任意 procedure 入参不通过对应 Zod schema（字段缺失、类型错、uuid 非法、permission_code 非枚举、page<1、pageSize>100、name 超 64 等） | `VALIDATION_ERROR` | 400 | Zod 解析失败统一此码，字段级 detail 在 message |
| B2 | 未携带有效凭证 / 未登录访问任意 procedure | `UNAUTHORIZED` | 401 | SEC-001 默认受保护 |
| B3 | 已登录但缺少所需权限码（`role:read` 查看 / `role:write` 增删分配） | `FORBIDDEN` | 403 | SEC-002 service 层 requirePermission |
| B4 | create 提交的 name 已被其他角色占用（含与内置 admin 冲突，Q3 全局唯一） | `ROLE_NAME_DUPLICATE` | 409 | F1 验收"角色名称已存在" |
| B5 | detail/delete 目标 role_id 不存在（uuid 合法但无记录） | `ROLE_NOT_FOUND` | 404 | F2/F3 验收 |
| B6 | delete 目标 `is_builtin === true`（内置 admin，无论是否已分配） | `ROLE_BUILTIN_FORBIDDEN` | 403 | F3/F5 验收"内置角色不可删除"；Q1 决策：内置角色绝对不可删 |
| B7 | delete 目标非内置，但已被分配给 ≥1 个用户（存在 user_roles 引用） | `ROLE_IN_USE` | 409 | F3 验收（Q1 决策方案 B：禁止删除已分配角色，须先解除全部分配） |
| B8 | assign 目标 user_id 不存在 | `USER_NOT_FOUND` | 404 | F4 验收"用户不存在"（复用 user 域码） |
| B9 | assign 目标 role_id 不存在 | `ROLE_NOT_FOUND` | 404 | F4 验收"角色不存在" |
| B10 | assign 时该 (user_id, role_id) 已存在（用户已持有此角色） | `USER_ROLE_ALREADY_ASSIGNED` | 409 | F4 验收"该用户已持有此角色" |
| B11 | remove 目标 user_id 不存在 | `USER_NOT_FOUND` | 404 | F4 移除语义对称分配 |
| B12 | remove 目标 (user_id, role_id) 关联不存在 | 无（幂等 204） | 204 | 见下文"移除幂等性"决策：不抛错，返回 204 |

> B12 决策（`[约束]`）：移除不存在的关联视为幂等成功（返回 204），不抛错。理由：F4"移除 U 的 R1"语义为达成"U 不再关联 R1"的终态，幂等更安全且避免调用方竞态；若需严格区分可后续加 `USER_ROLE_NOT_ASSIGNED` 码（本期不引入，避免错误码膨胀）。故 B12 不产生新错误码，移除路径错误码仅 B2/B3/B11。

**校验顺序（`[约束]` service 层必须遵守，先到先返，不叠加）：**

`[约束]` **create（POST /v1/roles）**：B1（router Zod 解析）→ B2/B3（鉴权）→ B4（name 唯一）→ 写入（is_builtin 恒 false、id/created_at 服务端生成）→ 返回 roleSchema(201)。

`[约束]` **delete（DELETE /v1/roles/{id}）**：B1 → B2/B3 → B5（角色不存在）→ B6（is_builtin）→ B7（已被分配 ROLE_IN_USE）→ 删除角色 → 204。
- `[约束]` B6 优先于 B7：内置角色无论是否被分配都不可删（Q1 决策明示）。
- `[约束]` 删除非内置且未被分配的角色时，本期内存实现无其他引用需级联（user_roles 已由 B7 保证无引用），直接移除 roles 行。

`[约束]` **assign（POST /v1/users/{userId}/roles）**：B1 → B2/B3 → B8（用户不存在）→ B9（角色不存在）→ B10（已持有）→ 写入 user_roles → 返回 userRoleSchema(201)。
- `[约束]` B8 优先于 B9：先校验用户存在再校验角色存在（与 PRD"用户不存在"/"角色不存在"提示顺序一致；二者皆合法时返回对应的那个）。

`[约束]` **remove（DELETE /v1/users/{userId}/roles/{roleId}）**：B1 → B2/B3 → B11（用户不存在）→ 关联不存在则幂等 204（B12 决策）→ 关联存在则删除 → 204。

`[约束]` **list / detail / listUserRoles**：B1 → B2/B3 → B5/ROLE_NOT_FOUND（detail 目标不存在）→ 返回；list/listUserRoles 无业务错误码，仅 B1/B2/B3。

错误码枚举 SSOT：`errorCodeSchema`（`packages/contracts/src/schemas/user.ts`），角色相关码为 `ROLE_NOT_FOUND` / `ROLE_NAME_DUPLICATE` / `ROLE_BUILTIN_FORBIDDEN` / `ROLE_IN_USE` / `USER_ROLE_ALREADY_ASSIGNED`，复用 user 域 `VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN` / `USER_NOT_FOUND`。`[约束]` 新增需同步本表、errors.ts 与 OpenAPI。

## 迁移与回滚
- 契约层：本期为首次产出 role.ts，无旧契约需迁移。`[约束]` 后续 schema 变更须保持向后兼容（仅加字段或放宽约束）；破坏性变更需新版本号并在 PRD 登记。
- DB：见 §DB 变更，首次建表（`roles` + `user_roles`），回滚为先 `DROP TABLE user_roles` 再 `DROP TABLE roles`。`[advisory]` 落地真实 DB 时 `user_roles` 的 FK 级联策略：`ON DELETE RESTRICT`（角色被引用时禁止删，与 B7 一致）；用户删除的级联策略由 user 域决定，本期不引入。
- 数据：`[约束]` 内存 repository 重启即清空，但须在初始化时幂等插入内置 admin 角色（F5）；落地真实 DB 时需补 `roles`/`user_roles` 建表迁移 + admin seed 脚本。
- 内置 admin 权限范围：`[约束]` admin 的 `permission_codes` 须等于 `permissionCodeSchema` 枚举全集（Q4）；枚举扩展时（随新模块 PRD）须同步刷新 admin 行的 `permission_codes`。`[advisory]` 刷新方式可由启动时按枚举重算（Dev 可选迁移脚本，反向同步 Spec）。
- 回滚策略：`[约束]` 契约/DB/OpenAPI/errorCodeSchema 任一回滚需四处同步回滚，保持一致（自检 #4/#5）。

## 测试矩阵（五类）
| 用例类型 | 覆盖点 |
|---|---|
| 单测 | `[约束]` repository CRUD（内存）：roles 的 insert/findById/findByName/list/delete；user_roles 的 insert/findByUser/findByUserRole/existsPair/delete；分页计算 `totalPages=ceil(total/pageSize)`；空列表 `total=0/totalPages=0`。 |
| 单测 | `[约束]` service 裁决：create name 唯一性转码 ROLE_NAME_DUPLICATE；delete 守卫序列 B5→B6→B7；assign 守卫序列 B8→B9→B10；初始化内置 admin 行存在且 is_builtin=true、permission_codes=全集。 |
| 契约测 | `[约束]` 每个 procedure 入参 schema 用 `safeParse` 喂合法/非法样本：create name 空串/超 64、permission_codes 含未知码 `foo:bar`、permission_codes 空数组（应通过）、userId/roleId 非 uuid、page=0、pageSize=101 → 均 VALIDATION_ERROR；合法样本通过。 |
| 契约测 | `[约束]` 出参 schema 校验：list 返回结构含 items/total/page/pageSize/totalPages 且匹配 roleListResultSchema（.strict() 拒绝多余字段）；create/assign 返回完整 roleSchema/userRoleSchema；list 结果中内置 admin 的 is_builtin=true。 |
| 边界 | `[约束]` F1：name 合法且未占用 → 创建成功，is_builtin=false，permission_codes 按提交值固定；name 重复 → ROLE_NAME_DUPLICATE；name=空/超 64 → VALIDATION_ERROR；permission_codes 含未知码 → VALIDATION_ERROR；permission_codes=[] → 成功（零权限角色）。 |
| 边界 | `[约束]` F2：列表含内置 admin 并标识 is_builtin；detail 返回 name/description/permission_codes/is_builtin；detail 不存在 → ROLE_NOT_FOUND；25 条 page=2 pageSize=10 → 11-20 条 total=25 totalPages=3；空库 → total=0 totalPages=0。 |
| 边界 | `[约束]` F3：删除非内置且未被分配 → 204；删除内置 admin → ROLE_BUILTIN_FORBIDDEN（即使 admin 未被分配）；删除已被分配的非内置角色 → ROLE_IN_USE；删除不存在 → ROLE_NOT_FOUND；解除全部分配后删除 → 204。 |
| 边界 | `[约束]` F4：为无角色用户分配 R1 → 201 返回 userRoleSchema；再分配 R2 → 201，用户持多角色；重复分配已持有角色 → USER_ROLE_ALREADY_ASSIGNED；为不存在用户分配 → USER_NOT_FOUND；为不存在角色分配 → ROLE_NOT_FOUND；移除已持有 → 204；移除不存在的关联 → 204（幂等，B12）。 |
| 权限 | `[约束]` B2：未登录调任意 procedure → UNAUTHORIZED（SEC-001）。 |
| 权限 | `[约束]` B3：非 admin 调任意 procedure → FORBIDDEN（SEC-002，service 层 requirePermission；admin 桩下非 admin 无角色权限）。 |
| 权限 | `[advisory]` role:read vs role:write 区分：本期 admin 桩下 admin 同时具备二者，无法构造"仅 role:read"用户；标注为待 Auth 模块富化 Ctx 后补端到端用例（遗留风险，非本期验收阻塞）。 |
| 权限 | `[约束]` SEC-003：list/detail/listUserRoles 响应仅含 roleSchema/userRoleSchema 字段，无未声明 PII（无密码、无其他用户敏感字段）；.strict() 保证出参不夹带多余字段。 |
| 状态机 | `[约束]` 角色无状态机；本类覆盖守卫序列顺序：delete 不存在+内置同时命中 → 先 ROLE_NOT_FOUND（B5 优先 B6）；delete 内置+已分配同时命中 → 先 ROLE_BUILTIN_FORBIDDEN（B6 优先 B7）；assign 用户不存在+角色不存在同时命中 → 先 USER_NOT_FOUND（B8 优先 B9）。 |
| 状态机 | `[约束]` 删除前置链：角色被分配 → ROLE_IN_USE → 手动移除全部分配 → 再次删除 → 204（验证 Q1 方案 B 的"先解除全部分配才能删"闭环）。 |

## Out of scope
- **角色编辑（改名 / 改描述 / 改权限码）**：F1 决策创建后 `permission_codes` 不可改，需变更只能删除重建；本期无 PATCH 端点。`[约束]`
- **role:read/role:write 端到端鉴权**：`[advisory]` 受限于既有 `Ctx`（admin|user）鉴权桩，本期 admin 视为全权限；"仅 role:read 管理员"验收待 Auth 模块富化 Ctx（携带 resolved permission codes）后补，列入遗留风险。
- **Q5 单用户角色数上限**：PRD 标注非阻断，本期无硬性上限，后续可在界面层加超额提示。`[advisory]`
- **审计落库**：非功能要求提及"留审计痕迹"，本期仅预留扩展点，不实现审计表（与 user 域一致）。`[advisory]`
- **批量操作 / 快捷删除入口**：F3 验收"任一入口删除 admin 均被拒绝"由 service 层守卫统一保障，本期不提供批量端点。`[约束]`
- **真实 DB 接入**：`[advisory]` 本 MVP repository 内存实现，DB schema 仅作文档 SSOT（见 §DB 变更）。
- **权限码动态扩展运行时热加载**：`[约束]` 权限码为编译期固定枚举（Q2），扩展须随新模块 PRD 改码 + 同步 admin 权限范围，不做运行时动态注册。
