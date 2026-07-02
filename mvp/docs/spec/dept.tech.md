---
doc_type: Tech-Spec
id: TECH-DEPT-001
prd_ref: PRD-DEPT-001
status: draft
owner: dev@team
---
# 部门管理 · 技术规格

> 标记约定（沿用 TECH-ROLE-001 复盘 P1 优化项，本轮第三轮演练重点验证 advisory 标记 + 跨域契约联动）：
> - `[约束]` = Dev 必须遵守（字段集 / 错误码 / 状态机 / 权限 / 校验顺序）。
> - `[advisory]` = Dev 可偏离，但须在 PR 描述中"反向同步 Spec"（写明偏离点与理由）。
> 每条实现性描述均显式标注其一；未标注的为纯说明性文字（引用、引用指向）。

## 影响的模块
- `packages/contracts/src/schemas/dept.ts`（本期新增）：部门域契约 SSOT（6 个 Zod schema + z.infer 派生类型）。`[约束]` 所有类型经 `z.infer` 派生，禁止手写（ARCH-002 / CODE-004）；递归树节点 `departmentTreeNodeSchema` 因 TS 无法推断自引用类型，用「私有 `DepartmentTreeNodeBase` 接口 + `z.ZodType` 注解」打破循环，对外导出类型仍为 `z.infer` 派生（详见 §API 契约）。
- `packages/contracts/src/schemas/user.ts`（既有，本期编辑，跨域联动）：`userSchema` 追加可空 `department_id` 字段；`errorCodeSchema`（跨域共享单一错误码 SSOT）追加 5 个部门码。`[约束]` dept.ts 不重复定义 `errorCodeSchema`，避免 `export *` 重名冲突。
- `packages/contracts/src/schemas/role.ts`（既有，本期编辑，跨域联动）：`permissionCodeSchema` 的 `z.enum` 追加 `dept:read` / `dept:write`。`[约束]`
- `packages/contracts/src/index.ts`（既有，本期编辑）：追加 `export * from './schemas/dept.js'`。`[约束]`
- `apps/api/src/errors.ts`（既有，**待 impl-writer 联动修复**）：`errorCodeToHttpStatus: Record<ErrorCode, number>` 穷举映射，新增 5 个部门码必须补齐，否则 `tsc` 失败（当前已报 TS2739，见 §自检与遗留）。`[约束]` 本任务只改 contracts，此项留给 impl-writer。
- `apps/api/src/router/dept.ts`（待生成）：procedure 表，输入输出经 Zod 校验，参考 `router/user.ts` / `router/role.ts` 的 `Procedure` + `auth` 模式。`[约束]` 每个 procedure 必须声明 auth/permission 元数据（SEC-001）。
- `apps/api/src/service/dept.ts`（待生成）：业务规则、同父唯一裁决、层级推导、删除守卫序列、Q1 解除归属、越权校验（SEC-002）。`[约束]`
- `apps/api/src/repository/dept.ts`（待生成）：内存实现。`[advisory]` 用 `Map` 内存存储；真实 DB 可换，但须保持本 Spec §DB 变更的 schema 形状。
- `apps/api/src/domain/dept.ts`（待生成）：领域常量（`MAX_DEPARTMENT_DEPTH = 3`）与守卫顺序定义，不 import 上层（ARCH-001）。`[约束]` 层级上限常量放 domain 层而非 contracts（contracts 只导出 Zod schema 与 z.infer 类型，ARCH-002）。
- `apps/api/src/service/user.ts` / `repository/user.ts`（既有，**待 impl-writer 联动修复**）：`userSchema` 新增 `department_id` 为 `.nullable().optional()`，既有 user 对象构造/返回类型不报错（可选字段），但 service 返回的 user 须显式携带 `department_id`（含 null）以保 SEC-003a 出参 1:1。`[约束]` 此项留给 impl-writer。
- `api-spec/dept.openapi.yaml`（本期新增）：OpenAPI 3.1 片段，与 Zod 1:1 对齐。

## 跨域契约联动（本轮演练重点）
PRD-DEPT-001 §跨域依赖声明：部门管理向用户域引入"部门归属"字段，向角色域引入 `dept:read` / `dept:write` 权限码。本节逐项列明对既有契约文件的联动改动（已落地）与对 apps/api / OpenAPI 的待联动项（待 impl-writer）。

**已落地（contracts 层，本任务完成）：**
- `[约束]` **user.ts · `userSchema`**：追加 `department_id: z.string().uuid().nullable().optional()`。字段名取 **snake_case**，沿用实体字段与 DB schema 对齐约定（与 `created_at` / `updated_at` 一致；PRD 数据实体亦记为 `department_id`）。任务描述中的 `departmentId` 指 input schema（`assignUserDepartmentInputSchema`）字段，实体字段取 snake_case。空表示用户未归属任何部门；一个用户至多归属一个部门。
- `[约束]` **user.ts · `createUserInputSchema`**：**不加** `department_id`（PRD Q5：本期新建必填 = email + name，创建时不指定部门，默认未归属）。
- `[约束]` **user.ts · `errorCodeSchema`**：追加 `DEPT_NOT_FOUND` / `DEPT_NAME_DUPLICATE` / `DEPT_HAS_CHILDREN` / `DEPT_HAS_USERS` / `DEPT_DEPTH_EXCEEDED`（`VALIDATION_ERROR` 已存在，复用不重复追加）。SSOT 仍在 user.ts，dept.ts 不重复定义。
- `[约束]` **role.ts · `permissionCodeSchema`**：`z.enum` 追加 `dept:read`（查看部门树）/ `dept:write`（创建/删除部门、维护用户归属）。内置 admin 权限范围随枚举扩展自动覆盖（Q4）。
- `[约束]` **index.ts**：追加 `export * from './schemas/dept.js'`。
- `[约束]` **dept.ts · `assignUserDepartmentInputSchema`**：新增（`userId` + `departmentId`，`departmentId` 可空表示解除归属），归属维护操作归属 dept 域（不在 user.ts 定义）。

**待 impl-writer 联动修复（apps/api / OpenAPI，本任务不改）：**
- `[约束]` **errors.ts**：`errorCodeToHttpStatus` 补齐 5 个部门码的 HTTP 映射（建议 `DEPT_NOT_FOUND`=404 / `DEPT_NAME_DUPLICATE`=409 / `DEPT_HAS_CHILDREN`=409 / `DEPT_HAS_USERS`=409 / `DEPT_DEPTH_EXCEEDED`=409）；当前 `tsc` 已报 TS2739（Record 缺键）。
- `[约束]` **apps/api/src/domain/role.ts · `ALL_PERMISSION_CODES`**：已由 `[...permissionCodeSchema.options]` 派生，枚举扩展后自动含 `dept:read`/`dept:write`，无需手改；impl-writer 须验证内置 admin seed 行的 `permission_codes` 覆盖新码。
- `[约束]` **user service/repository**：返回 user 时显式携带 `department_id`（含 null），保 SEC-003a 出参与 `userSchema` 1:1。
- `[advisory]` **role.openapi.yaml**：`PermissionCode` 枚举需同步追加 `dept:read` / `dept:write`；**user.openapi.yaml / role.openapi.yaml** 的 `ErrorCode` 枚举需同步追加 5 个部门码。本轮为控制改动面未顺带更新既有 OpenAPI 片段，记为遗留同步项（见 §Out of scope 与遗留风险）。

## API 契约（引用，不复制）
所有 schema 与类型定义在 `packages/contracts/src/schemas/dept.ts`，错误码定义在 `user.ts` 的 `errorCodeSchema`。本节仅引用，不复制字段定义（避免 SSOT 漂移）。

| Procedure | Method & Path | 入参 schema | 出参 schema | 鉴权 |
|---|---|---|---|---|
| dept.tree | GET `/v1/departments/tree` | `departmentTreeQuerySchema`（无参） | `departmentTreeResultSchema` | `[约束]` 需 `dept:read` |
| dept.create | POST `/v1/departments` | `createDepartmentInputSchema` | `departmentSchema`（201） | `[约束]` 需 `dept:write` |
| dept.delete | DELETE `/v1/departments/{id}` | path `id` (uuid) | 204 无 body | `[约束]` 需 `dept:write` |
| dept.assignUserDepartment | PATCH `/v1/users/{userId}/department` | path `userId` + body `{ departmentId }`（合并为 `assignUserDepartmentInputSchema`） | `userSchema`（200，含 `department_id`） | `[约束]` 需 `dept:write` |

错误统一回包 `errorResponseSchema`（`{ code: ErrorCode, message: string }`），`code` 取自 `errorCodeSchema`。`[约束]`
入参解析失败的统一码：`VALIDATION_ERROR`（不区分字段，字段级 detail 仅在 message 中给出，不进入 code）。`[约束]`

> F4「查看用户部门归属」：`[约束]` 不设独立 dept GET 端点——用户部门归属由用户域 `GET /v1/users`（及详情）返回的 `department_id` 字段表达（userSchema 已含该字段），复用既有 user 列表/详情即可，避免重复端点。

> 鉴权说明（`[advisory]` 已知限制 / 遗留风险，同 TECH-ROLE-001）：PRD 以权限码（`dept:read`/`dept:write`）为鉴权原语，但既有 `Ctx.user.role` 仅有 `'admin' | 'user'`（user 域 MVP 鉴权桩），不携带解析后的权限码集合。本期 `[advisory]` 采用映射：内置 admin 角色持全部权限码（Q4），故 `ctx.user.role === 'admin'` 视为同时具备 `dept:read` + `dept:write`；非 admin 视为无部门权限 → `FORBIDDEN`。`[约束]` procedure 元数据仍按 `dept:read`/`dept:write` 声明所需权限，service 层 `requirePermission(code)` 在 admin 桩下放行全部、否则拒绝。PRD F2 中"仅具备 dept:read 的管理员"这一验收场景须待 Auth 模块富化 `Ctx`（携带 resolved permission codes）后方可端到端验证，列入 §Out of scope 与遗留风险。该 gap 为既有基础设施限制，非 PRD 未决项，故不触发阻断。

> 递归树节点实现说明（`[advisory]`）：`departmentTreeNodeSchema` 为递归 schema（`children` 自引用）。TS 无法从自引用初始化器推断递归类型（TS7022/TS7024），故采用「私有 `DepartmentTreeNodeBase` 接口 + `z.ZodType<DepartmentTreeNodeBase>` 注解 + `z.lazy(() => …)` 延迟运行时引用」打破循环。`[约束]` 对外导出的 `DepartmentTreeNode` 类型仍由 `z.infer<typeof departmentTreeNodeSchema>` 派生；私有 `DepartmentTreeNodeBase` 不 export，仅为注解服务。`[advisory]` 若字段集变更须同步该私有接口，契约测须断言样本可解析以防漂移；Dev 若改用扁平邻接表结构须反向同步 Spec。

## DB 变更
`[advisory]` 本 MVP repository 用内存实现（`Map`），但 DB schema 作为 SSOT 文档产出。以下纯 TS 接口等价于 Drizzle `pgTable` 定义，未来落地真实 DB 时按此建表。

```ts
// apps/api/src/domain/dept.ts —— DB schema SSOT（等价 Drizzle pgTable）
// 等价 Drizzle：
// export const departments = pgTable('departments', {
//   id: uuid('id').primaryKey().defaultRandom(),
//   name: varchar('name', { length: 64 }).notNull(),
//   parent_id: uuid('parent_id'), // 自引用外键 departments(id)，可空=根部门
//   created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
// }, (t) => ({
//   sameParentNameUniq: unique().on(t.parent_id, t.name), // Q3 同父下名称唯一
// }));
// users 表追加列（跨域联动，见 §跨域契约联动）：
//   department_id: uuid('department_id'), // 外键 departments(id)，可空

/** DB 行结构（snake_case，与契约 departmentSchema 一致） */
export interface DepartmentRow {
  id: string;          // uuid, primary key
  name: string;        // 1..64 字符
  parent_id: string | null; // uuid 外键 departments(id)，null=根部门（第 1 层）
  created_at: string;  // ISO 8601 timestamptz
}

/** 部门最大层级深度（Q4 确认约束：根=1，最多 3 层）。层级不存储，由 parent_id 链路推导。 */
export const MAX_DEPARTMENT_DEPTH = 3;
```

`[约束]` 唯一约束：`departments (parent_id, name)` 同父下唯一（Q3）→ 唯一冲突在 service 层捕获转码 `DEPT_NAME_DUPLICATE`。`[advisory]` 多数 DB 的 NULL 在唯一索引中互不相等，根部门（`parent_id=NULL`）间同名需 service 层显式校验（内存实现直接判等即可）。
`[约束]` 外键：`departments.parent_id` → `departments.id`（自引用）；`users.department_id` → `departments.id`（跨域）。本期内存实现不强制 FK，但落地真实 DB 须建 FK 与级联策略（见 §迁移与回滚）。
`[约束]` `departments` 无 `updated_at`：PRD Q6 决策部门创建后 `name`/`parent_id` 不可编辑、本期无编辑端点，故无更新时间字段。
`[约束]` 层级深度不作为存储字段：由 `parent_id` 链路推导（根=1，每深入一层 +1），创建时按目标父部门层级推导新部门层级，超过 `MAX_DEPARTMENT_DEPTH`（3）拒绝（Q4）。

变更项（首次落地 DB 时）：
- `[约束]` 新建表 `departments`（含 `(parent_id, name)` 唯一索引）。
- `[约束]` users 表追加可空列 `department_id`（跨域联动，PRD-DEPT-001 §数据实体草图声明）。
- `[约束]` 回滚：先 `ALTER TABLE users DROP COLUMN department_id;`（解除跨域引用）再 `DROP TABLE departments;`。

## 状态机
`[约束]` 部门实体**无状态机**：`Department` 不含 `status` 字段（PRD 数据实体未定义状态），不存在 active/disabled 之类迁移。部门生命周期仅：创建 → 存在 → 删除（不可编辑，Q6）。

`[约束]` 删除/归属维护虽无状态机，但有固定**守卫序列**（service 层裁决，顺序不可调换，先到先返，不叠加），详见 §边界与异常 的"校验顺序"。

## 边界与异常（每条对应一个错误码）
| # | 触发条件 | 错误码 | HTTP | 说明 |
|---|---|---|---|---|
| B1 | 任意 procedure 入参不通过对应 Zod schema（字段缺失、类型错、uuid 非法、name 空/超 64、parent_id 非 uuid、departmentId 非 uuid 且非 null 等） | `VALIDATION_ERROR` | 400 | Zod 解析失败统一此码，字段级 detail 在 message |
| B2 | 未携带有效凭证 / 未登录访问任意 procedure | `UNAUTHORIZED` | 401 | SEC-001 默认受保护 |
| B3 | 已登录但缺少所需权限码（`dept:read` 查看树 / `dept:write` 创建·删除·归属维护） | `FORBIDDEN` | 403 | SEC-002 service 层 requirePermission |
| B4 | create 提交 `parent_id`（非空）但该父部门不存在 | `DEPT_NOT_FOUND` | 404 | F1 父部门校验 |
| B5 | create 目标父部门已处于第 3 层，新子部门将达第 4 层（Q4） | `DEPT_DEPTH_EXCEEDED` | 409 | F1 验收"超过最大层级 3 层" |
| B6 | create 提交的 name 在同一父部门下已存在（Q3 同父唯一；不同父允许重名） | `DEPT_NAME_DUPLICATE` | 409 | F1 验收"同级部门名称已存在" |
| B7 | delete 目标 `id` 不存在（uuid 合法但无记录） | `DEPT_NOT_FOUND` | 404 | F3 验收"部门不存在" |
| B8 | delete 待删部门下仍有子部门（Q2 禁止级联，须先清空子部门） | `DEPT_HAS_CHILDREN` | 409 | F3 验收"请先处理子部门" |
| B9 | assign 目标 `userId` 不存在 | `USER_NOT_FOUND` | 404 | F4 验收"用户不存在"（复用 user 域码） |
| B10 | assign `departmentId` 为非空 uuid 但该部门不存在 | `DEPT_NOT_FOUND` | 404 | F4 验收"部门不存在" |
| B11 | `[advisory]` **预留码，本期不触发**——删除部门时其下仍有归属用户。Q1 决策为「解除归属」（置空而非阻断），故删除路径**不抛此码**；保留以备未来「严格删除模式」或显式阻断场景，本期 service 层不抛出。 | `DEPT_HAS_USERS` | （本期 n/a；预留 409） | 见下文"DEPT_HAS_USERS 预留决策" |

> B11 决策（`[advisory]`）：PRD Q1 已明确"删除部门时其下用户解除归属、账号保留"。故删除含用户的部门**成功**（用户 `department_id` 被置空），不产生 `DEPT_HAS_USERS`。本任务按指令将该码纳入 `errorCodeSchema`（供未来严格模式 / OpenAPI 完整性），但在 §校验顺序中显式声明删除路径不校验此码，避免与 Q1 形成状态机断裂。impl-writer 须知：此码不在删除守卫序列中，`errorCodeToHttpStatus` 仍须为其预留映射（409）以维持 `Record<ErrorCode>` 穷举。

**校验顺序（`[约束]` service 层必须遵守，先到先返，不叠加）：**

`[约束]` **create（POST /v1/departments）**：B1（router Zod 解析）→ B2/B3（鉴权）→ [若 `parent_id` 非空：B4（父部门不存在 `DEPT_NOT_FOUND`）→ B5（层级超限 `DEPT_DEPTH_EXCEEDED`）] → B6（同父名称重复 `DEPT_NAME_DUPLICATE`）→ 写入（`id`/`created_at` 服务端生成）→ 返回 `departmentSchema`(201)。
- `[约束]` 根部门（`parent_id` 缺省/`null`）：跳过 B4/B5，层级=1，仅校验 B6（根之间同名）。层级上限对根不生效（根恒为第 1 层）。
- `[约束]` B4 优先于 B5：层级推导需父部门存在；B5 优先于 B6：先确认结构合法再判名称冲突。

`[约束]` **delete（DELETE /v1/departments/{id}）**：B1 → B2/B3 → B7（部门不存在 `DEPT_NOT_FOUND`）→ B8（仍有子部门 `DEPT_HAS_CHILDREN`）→ [Q1：将该部门下所有用户的 `department_id` 置空，解除归属] → 删除部门 → 204。
- `[约束]` **不校验 B11 / `DEPT_HAS_USERS`**：Q1 决策解除归属为副作用（非阻断）。用户账号保留、不删除、不迁移到父部门。
- `[约束]` B7 优先于 B8：先确认目标存在再判子部门。

`[约束]` **assignUserDepartment（PATCH /v1/users/{userId}/department）**：B1 → B2/B3 → B9（用户不存在 `USER_NOT_FOUND`）→ [若 `departmentId` 非空：B10（部门不存在 `DEPT_NOT_FOUND`）] → 写入用户 `department_id`（`departmentId=null` 时置空=解除归属）→ 返回 `userSchema`(200，含 `department_id`)。
- `[约束]` B9 优先于 B10：先校验用户存在再校验部门存在（与 PRD"用户不存在"/"部门不存在"提示顺序一致；二者皆合法时返回对应的那个）。
- `[约束]` `departmentId=null`（解除归属）时不触发 B10（无需校验部门存在）。
- `[约束]` 一个用户仅属一个部门：归属操作为覆盖写（直接置 `department_id`），无需先解除原归属。

`[约束]` **tree（GET /v1/departments/tree）**：B1 → B2/B3 → 返回 `departmentTreeResultSchema`；无任何部门时 `items=[]`（F2 验收：返回空结果）。无业务错误码，仅 B1/B2/B3。

错误码枚举 SSOT：`errorCodeSchema`（`packages/contracts/src/schemas/user.ts`），部门相关码为 `DEPT_NOT_FOUND` / `DEPT_NAME_DUPLICATE` / `DEPT_HAS_CHILDREN` / `DEPT_HAS_USERS`（预留）/ `DEPT_DEPTH_EXCEEDED`，复用 user/role 域 `VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN` / `USER_NOT_FOUND`。`[约束]` 新增需同步本表、errors.ts 与 OpenAPI。

## 迁移与回滚
- 契约层：`[约束]` 本期为新增 dept.ts + 对 user.ts/role.ts/index.ts 的纯加性编辑（新增可选字段、枚举扩展），向后兼容（仅加字段或扩枚举）。`[约束]` userSchema 的 `department_id` 为 `.nullable().optional()`，既有 user 对象构造/解析不破坏（可选字段）。破坏性变更需新版本号并在 PRD 登记。
- DB：见 §DB 变更，首次建 `departments` 表 + users 追加 `department_id` 列。`[advisory]` 落地真实 DB 时 `users.department_id` 的 FK 级联策略：`ON DELETE SET NULL`（与 Q1 解除归属语义一致）；`departments.parent_id` 自引用 FK：`ON DELETE RESTRICT`（与 B8 禁止级联删子部门一致，须先清空子部门）。
- 数据：`[约束]` 内存 repository 重启即清空，无内置部门 seed（部门由管理员按需创建，区别于 role 域的内置 admin seed）。
- 内置 admin 权限范围：`[约束]` admin 的 `permission_codes` 须等于 `permissionCodeSchema` 枚举全集（Q4），扩展 `dept:read`/`dept:write` 后须同步刷新 admin 行；`[advisory]` 由 `ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 派生，启动时按枚举重算即可自动覆盖（Dev 可选迁移脚本，反向同步 Spec）。
- 回滚策略：`[约束]` 契约/DB/OpenAPI/errorCodeSchema 任一回滚需四处同步回滚，保持一致（自检 #4/#5）。
- **待 impl-writer 联动**：`[约束]` errors.ts 补 5 个部门码映射；`[advisory]` role.openapi.yaml `PermissionCode` 枚举 + user/role.openapi.yaml `ErrorCode` 枚举同步追加（见 §跨域契约联动遗留项）。

## 测试矩阵（五类）
| 用例类型 | 覆盖点 |
|---|---|
| 单测 | `[约束]` repository CRUD（内存）：departments 的 insert/findById/findByParent/list/delete；按 `(parent_id, name)` 同父查重；层级推导 `computeDepth(parent_id)`（根=1，逐层 +1，≤3）；删除时将其下用户 `department_id` 批量置空（Q1 解除归属）。 |
| 单测 | `[约束]` service 裁决：create 守卫序列 B4→B5→B6；delete 守卫序列 B7→B8（**不触发 DEPT_HAS_USERS**，验证含用户部门删除成功且用户 `department_id` 被置空）；assign 守卫序列 B9→B10；root 创建跳过 B4/B5；`departmentId=null` 解除归属跳过 B10。 |
| 契约测 | `[约束]` 每个 procedure 入参 schema 用 `safeParse` 喂合法/非法样本：create name 空串/超 64、parent_id 非 uuid、departmentId 非 uuid 且非 null、id 非 uuid → 均 VALIDATION_ERROR；合法样本通过；`createDepartmentInputSchema` 不含 `department_id`（创建时不指定部门）→ 含该字段应被 .strict() 拒绝。 |
| 契约测 | `[约束]` 出参 schema 校验：tree 返回 `departmentTreeResultSchema`（.strict() 拒绝多余字段）、`items=[]` 空树通过；create 返回完整 `departmentSchema`；assign 返回 `userSchema`（含 `department_id`）；递归 `departmentTreeNodeSchema` 对 3 层嵌套样本可解析、对第 4 层样本（构造）仍可解析（schema 不限层数，层数由 service 校验）。 |
| 边界 | `[约束]` F1：合法名称 + 有效父 → 创建成功，挂在该父下；不指定父 → 根部门（层级 1）；父在第 3 层下创建 → DEPT_DEPTH_EXCEEDED；同父同名 → DEPT_NAME_DUPLICATE；不同父同名 → 成功（Q3 跨父重名）；父 `parent_id` 指向不存在部门 → DEPT_NOT_FOUND；name 空/超 64 → VALIDATION_ERROR。 |
| 边界 | `[约束]` F2：多层级部门 → 树形结构正确体现父子归属与层级；无任何部门 → `items=[]`；叶节点 `children=[]`。 |
| 边界 | `[约束]` F3：无子无用户 → 204；无子有用户 → 204 且用户 `department_id` 置空（Q1，账号保留）；有子部门 → DEPT_HAS_CHILDREN（Q2 禁止级联）；不存在 → DEPT_NOT_FOUND；含子 + 含用户同时命中 → 先 DEPT_HAS_CHILDREN（B8 在 Q1 解除前）。 |
| 边界 | `[约束]` F4：无部门用户归属 D → 200 返回 user 含 `department_id=D`；已归属 D1 改归属 D2 → 覆盖为 D2（仅属一个）；解除归属（`departmentId=null`）→ `department_id=null`；不存在用户 → USER_NOT_FOUND；不存在部门 → DEPT_NOT_FOUND；部门被删后原归属用户 → `department_id=null`（Q1 语义闭环）。 |
| 权限 | `[约束]` B2：未登录调任意 procedure → UNAUTHORIZED（SEC-001）。 |
| 权限 | `[约束]` B3：非 admin 调任意 procedure → FORBIDDEN（SEC-002，service 层 requirePermission；admin 桩下非 admin 无部门权限）。 |
| 权限 | `[advisory]` dept:read vs dept:write 区分：本期 admin 桩下 admin 同时具备二者，无法构造"仅 dept:read"用户；标注为待 Auth 模块富化 Ctx 后补端到端用例（遗留风险，非本期验收阻塞）。 |
| 权限 | `[约束]` SEC-003：tree/create/assign 响应仅含 `departmentTreeResultSchema`/`departmentSchema`/`userSchema` 字段，无未声明 PII；.strict() 保证出参不夹带多余字段。 |
| 状态机 | `[约束]` 部门无状态机；本类覆盖守卫序列顺序：create 父不存在+层级超限同时命中 → 先 DEPT_NOT_FOUND（B4 优先 B5）；create 层级超限+同名同时命中 → 先 DEPT_DEPTH_EXCEEDED（B5 优先 B6）；delete 不存在+有子同时命中 → 先 DEPT_NOT_FOUND（B7 优先 B8）；assign 用户不存在+部门不存在同时命中 → 先 USER_NOT_FOUND（B9 优先 B10）。 |
| 状态机 | `[约束]` 删除前置链：部门有子 → DEPT_HAS_CHILDREN → 逐个删除子部门 → 再次删除本部门 → 204（验证 Q2"先清空子部门才能删"闭环）；删除含用户部门 → 用户 `department_id=null` → 再次查用户确认无归属（Q1 闭环）。 |

## Out of scope
- **部门信息编辑（改名 / 改父部门）**：PRD Q6 决策创建后 `name`/`parent_id` 不可编辑，需变更只能删除重建；本期无 PATCH 部门信息端点。`[约束]`
- **dept:read/dept:write 端到端鉴权**：`[advisory]` 受限于既有 `Ctx`（admin|user）鉴权桩，本期 admin 视为全权限；"仅 dept:read 管理员"验收待 Auth 模块富化 Ctx（携带 resolved permission codes）后补，列入遗留风险。
- **跨部门批量调整用户归属**：PRD 明确本期不做跨部门批量调整；归属维护为单用户操作。`[约束]`
- **DEPT_HAS_USERS 严格删除模式**：`[advisory]` 本期 Q1 决策删除部门时解除用户归属（非阻断），`DEPT_HAS_USERS` 为预留码不触发；未来若需"删除前须先清空用户"的严格模式可启用此码，本期不实现。
- **F4 用户部门归属"查看"专用端点**：`[约束]` 由用户域 `GET /v1/users`（返回 `department_id`）满足，不设独立 dept GET 端点。
- **审计落库**：非功能要求提及"留审计痕迹"，本期仅预留扩展点，不实现审计表（与 user/role 域一致）。`[advisory]`
- **批量操作 / 快捷删除入口**：F3 验收"任一入口对含子部门的部门删除均被拒绝"由 service 层守卫统一保障，本期不提供批量端点。`[约束]`
- **真实 DB 接入**：`[advisory]` 本 MVP repository 内存实现，DB schema 仅作文档 SSOT（见 §DB 变更）。
- **既有 OpenAPI 片段同步**：`[advisory]` role.openapi.yaml 的 `PermissionCode` 枚举、user/role.openapi.yaml 的 `ErrorCode` 枚举需同步追加部门相关值，本轮为控制改动面未顺带更新，记为遗留同步项（待 impl-writer / 文档维护者处理）。

## 自检与遗留
- `[约束]` 自检 7 项见任务说明；本节记录关键证据：
  - contracts tsc：**0 错误**（`packages/contracts/src` 全绿）。
  - apps/api tsc：**1 错误** —— `apps/api/src/errors.ts(19,14) TS2739`（`errorCodeToHttpStatus` 缺 5 个 DEPT_* 键），属"待 impl-writer 联动修复"，本任务不改 apps/api。
  - `node scripts/check-rules.mjs`：通过（CODE-004 / SEC-003a / META-003/004 等全绿）。
- `[advisory]` 遗留风险：① dept:read/dept:write 端到端鉴权待 Auth 富化 Ctx；② 既有 OpenAPI 片段（user/role）ErrorCode/PermissionCode 枚举待同步；③ errors.ts Record 补码待 impl-writer；④ 递归树节点依赖私有 `DepartmentTreeNodeBase` 接口防漂移（契约测覆盖）。
