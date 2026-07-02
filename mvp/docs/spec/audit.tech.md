---
doc_type: Tech-Spec
id: TECH-AUDIT-001
prd_ref: PRD-AUDIT-001
status: draft
owner: dev@team
created: 2026-07-02
---
# 操作日志 · 技术规格

> 标记约定（沿用 TECH-DEPT-001 / TECH-ROLE-001 复盘 P1 优化项，本轮第四轮演练重点验证 ①advisory 标记 ②AI-006 受影响测试清单 ③跨域契约联动）：
> - `[约束]` = Dev 必须遵守（字段集 / 错误码 / 状态机 / 权限 / 校验顺序）。
> - `[advisory]` = Dev 可偏离，但须在 PR 描述中"反向同步 Spec"（写明偏离点与理由）。
> 每条实现性描述均显式标注其一；未标注的为纯说明性文字（引用、引用指向）。

## 影响的模块
- `packages/contracts/src/schemas/audit.ts`（本期新增）：操作日志域契约 SSOT（7 个 Zod schema + z.infer 派生类型）。`[约束]` 所有类型经 `z.infer` 派生，禁止手写（ARCH-002 / CODE-004）；`before/after` 用 `z.record(z.unknown())` 承载异构字段快照，邮箱脱敏在查询返回时由 service 层套用（见 §API 契约 / §边界与异常 F3）。
- `packages/contracts/src/schemas/user.ts`（既有，本期编辑，跨域联动）：`errorCodeSchema`（跨域共享单一错误码 SSOT）追加 `AUDIT_LOG_NOT_FOUND`（预留码，见 §边界与异常 B4）。`[约束]` audit.ts 不重复定义 `errorCodeSchema`，避免 `export *` 重名冲突。
- `packages/contracts/src/schemas/role.ts`（既有，本期编辑，跨域联动）：`permissionCodeSchema` 的 `z.enum` 追加 `audit:read`（查询操作日志所需权限码）。`[约束]`
- `packages/contracts/src/index.ts`（既有，本期编辑）：追加 `export * from './schemas/audit.js'`。`[约束]`
- `apps/api/src/errors.ts`（既有，**待 impl-writer 联动修复**）：`errorCodeToHttpStatus: Record<ErrorCode, number>` 穷举映射，新增 `AUDIT_LOG_NOT_FOUND` 必须补齐，否则 `tsc` 失败（当前已报 TS2741，见 §自检与遗留）。`[约束]` 本任务只改 contracts，此项留给 impl-writer。
- `apps/api/src/router/audit.ts`（待生成）：procedure 表，输入输出经 Zod 校验，参考 `router/user.ts` / `router/role.ts` / `router/dept.ts` 的 `Procedure` + `auth` 模式。`[约束]` 每个 procedure 必须声明 auth/permission 元数据（SEC-001）。
- `apps/api/src/service/audit.ts`（待生成）：查询过滤/分页/倒序、pageSize 钳制（Q4）、邮箱脱敏（redactEmail 套用）、越权校验（SEC-002）。`[约束]`
- `apps/api/src/repository/audit.ts`（待生成）：内存实现，append-only（仅 insert + list，无 update/delete 方法）。`[advisory]` 用数组内存存储；真实 DB 可换，但须保持本 Spec §DB 变更的 schema 形状。
- `apps/api/src/domain/audit.ts`（待生成）：脱敏纯函数 `redactEmail(email)` 与 `AUDIT_LOG_RETENTION_DAYS = 90` 常量，不 import 上层（ARCH-001）。`[约束]` 脱敏函数与保留期常量放 domain 层而非 contracts（contracts 只导出 Zod schema 与 z.infer 类型，ARCH-002）。
- `apps/api/src/service/user.ts` / `role.ts` / `dept.ts`（既有，**待 impl-writer 联动修复**）：在 create/update/delete 成功路径后追加 audit log 写入（被动旁路，主操作失败则不记录，PRD 兼容性要求）。`[约束]` 此项留给 impl-writer；本任务不改动既有 service。
- `api-spec/audit.openapi.yaml`（本期新增）：OpenAPI 3.1 片段，与 Zod 1:1 对齐。

## 跨域契约联动（本轮演练重点 ③）
PRD-AUDIT-001 §跨域依赖声明：操作日志向角色域引入 `audit:read` 权限码，向错误码 SSOT 引入 `AUDIT_LOG_NOT_FOUND`，并被动旁路记录 user/role/dept 三域写操作。本节逐项列明对既有契约文件的联动改动（已落地）与对 apps/api / OpenAPI 的待联动项（待 impl-writer）。

**已落地（contracts 层，本任务完成）：**
- `[约束]` **role.ts · `permissionCodeSchema`**：`z.enum` 追加 `audit:read`（查询操作日志 GET /v1/audit-logs 所需权限码）。内置 admin 权限范围随枚举扩展自动覆盖（Q4）。
- `[约束]` **user.ts · `errorCodeSchema`**：追加 `AUDIT_LOG_NOT_FOUND`（`VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN` 已存在，复用不重复追加）。SSOT 仍在 user.ts，audit.ts 不重复定义。
- `[约束]` **index.ts**：追加 `export * from './schemas/audit.js'`。
- `[约束]` **audit.ts · `auditLogEntityTypeSchema`**：闭合枚举 `user` / `role` / `dept`（Q3），与三域实体类型对齐；后续新增领域时由对应 PRD 同步扩展。
- `[约束]` **audit.ts · `auditLogActionSchema`**：闭合枚举 `create` / `update` / `delete`，与三域写动作对齐（读操作不记录 Q1）。

**待 impl-writer 联动修复（apps/api / OpenAPI，本任务不改）：**
- `[约束]` **errors.ts**：`errorCodeToHttpStatus` 补齐 `AUDIT_LOG_NOT_FOUND` 的 HTTP 映射（建议 `AUDIT_LOG_NOT_FOUND`=404，预留码本期不触发但仍穷举映射以维持 `Record<ErrorCode>`）；当前 `tsc` 已报 TS2741（Record 缺键）。
- `[约束]` **apps/api/src/domain/role.ts · `ALL_PERMISSION_CODES`**：已由 `[...permissionCodeSchema.options]` 派生，枚举扩展后自动含 `audit:read`，无需手改；impl-writer 须验证内置 admin seed 行的 `permission_codes` 覆盖新码（自动覆盖，repository/role.ts L42 用 `[...ALL_PERMISSION_CODES]`）。
- `[约束]` **user/role/dept service**：在各自 create/update/delete 成功路径后追加 audit log 写入（旁路，主操作失败则不记录）；before/after 仅含变更字段（diff），create 时 before={}，delete 时 after={}。
- `[advisory]` **role.openapi.yaml**：`PermissionCode` 枚举需同步追加 `audit:read`；**user/role/dept.openapi.yaml** 的 `ErrorCode` 枚举需同步追加 `AUDIT_LOG_NOT_FOUND`。本轮为控制改动面未顺带更新既有 OpenAPI 片段，记为遗留同步项（见 §Out of scope 与遗留风险）。

## API 契约（引用，不复制）
所有 schema 与类型定义在 `packages/contracts/src/schemas/audit.ts`，错误码定义在 `user.ts` 的 `errorCodeSchema`。本节仅引用，不复制字段定义（避免 SSOT 漂移）。

| Procedure | Method & Path | 入参 schema | 出参 schema | 鉴权 |
|---|---|---|---|---|
| audit.list | GET `/v1/audit-logs` | `listAuditLogQuerySchema` | `auditLogListResultSchema`（items 为 `redactedAuditLogSchema`，邮箱已脱敏） | `[约束]` 需 `audit:read` |

错误统一回包 `errorResponseSchema`（`{ code: ErrorCode, message: string }`），`code` 取自 `errorCodeSchema`。`[约束]`
入参解析失败的统一码：`VALIDATION_ERROR`（不区分字段，字段级 detail 仅在 message 中给出，不进入 code）。`[约束]`

> F1「自动记录写操作」：`[约束]` 不设独立 API 端点——日志由 user/role/dept 三域 service 在写操作成功后被动旁路写入（主操作失败则不记录，PRD 兼容性要求）。日志记录不影响主操作成败。
> F2「分页查询」：`[约束]` 唯一查询端点 GET /v1/audit-logs，支持时间范围 / 操作者 / 实体类型三维过滤 + page/pageSize 分页，默认按 operated_at 倒序。
> F3「PII 脱敏」：`[约束]` 查询返回的 before/after 中邮箱字段由 service 层套用 `redactEmail`（domain 层纯函数），输出 items 为 `redactedAuditLogSchema`；本期不提供未脱敏返回入口（Q2）。
> F4「append-only」：`[约束]` repository 仅暴露 insert + list，无 update/delete 方法；router 不注册 PUT/PATCH/DELETE /v1/audit-logs 路由，任何入口（含管理后台/批量/快捷入口）均无修改/删除日志路径。

> 鉴权说明（`[advisory]` 已知限制 / 遗留风险，同 TECH-DEPT-001）：PRD 以权限码 `audit:read` 为鉴权原语，但既有 `Ctx.user.role` 仅有 `'admin' | 'user'`（user 域 MVP 鉴权桩），不携带解析后的权限码集合。本期 `[advisory]` 采用映射：内置 admin 角色持全部权限码（Q4），故 `ctx.user.role === 'admin'` 视为具备 `audit:read`；非 admin 视为无审计权限 → `FORBIDDEN`。`[约束]` procedure 元数据仍按 `audit:read` 声明所需权限，service 层 `requirePermission('audit:read')` 在 admin 桩下放行、否则拒绝。PRD F2 中"具备 audit:read 的管理员"这一验收场景须待 Auth 模块富化 `Ctx`（携带 resolved permission codes）后方可端到端验证，列入 §Out of scope 与遗留风险。该 gap 为既有基础设施限制，非 PRD 未决项，故不触发阻断。

> pageSize 钳制说明（`[约束]` 与既有域有意分歧）：PRD-AUDIT Q4 验收明确"page_size=200 → 按上限 100 返回并提示"，故 `listAuditLogQuerySchema.pageSize` 用 `.transform((n) => Math.min(n, 100))` 钳制（非拒绝）；返回结果的 `pageSize` 字段反映钳制后的值作为"提示"。这与 user/role/dept 域的 `.max(100)` 拒绝策略有意分歧，依 PRD-AUDIT Q4 决策；impl-writer 须保证 service 直接使用 schema 解析后的 `pageSize`（已钳制），不再二次校验。

## DB 变更
`[advisory]` 本 MVP repository 用内存实现（数组，append-only），但 DB schema 作为 SSOT 文档产出。以下纯 TS 接口等价于 Drizzle `pgTable` 定义，未来落地真实 DB 时按此建表。

```ts
// apps/api/src/domain/audit.ts —— DB schema SSOT（等价 Drizzle pgTable）
// 等价 Drizzle：
// export const audit_logs = pgTable('audit_logs', {
//   id: uuid('id').primaryKey().defaultRandom(),
//   operator_id: uuid('operator_id').notNull(),          // 外键 users(id)，操作者
//   operator_name: varchar('operator_name', { length: 64 }).notNull(), // 姓名快照（写入时冻结）
//   entity_type: varchar('entity_type', { length: 16 }).notNull(),     // 'user' | 'role' | 'dept'
//   entity_id: uuid('entity_id').notNull(),              // 目标实体 id
//   action: varchar('action', { length: 16 }).notNull(), // 'create' | 'update' | 'delete'
//   operated_at: timestamp('operated_at', { withTimezone: true }).notNull(),
//   before: jsonb('before').notNull(),                   // 变更前快照（仅变更字段，create 时 {}）
//   after: jsonb('after').notNull(),                     // 变更后快照（仅变更字段，delete 时 {}）
//   created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), // 90 天保留期清理依据
// });

/** DB 行结构（snake_case，与契约 auditLogSchema 一致） */
export interface AuditLogRow {
  id: string;            // uuid, primary key
  operator_id: string;   // uuid 外键 users(id)
  operator_name: string; // 操作者姓名快照（写入时冻结，1..64）
  entity_type: 'user' | 'role' | 'dept';
  entity_id: string;     // uuid 目标实体 id
  action: 'create' | 'update' | 'delete';
  operated_at: string;   // ISO 8601 timestamptz
  before: Record<string, unknown>; // 变更前快照（仅变更字段，create 时 {}）
  after: Record<string, unknown>;  // 变更后快照（仅变更字段，delete 时 {}）
  created_at: string;    // ISO 8601 timestamptz，90 天保留期清理依据
}

/** 日志保留期（PRD：90 天，本期仅记录 created_at 供后续清理任务使用，清理任务本期不实现）。 */
export const AUDIT_LOG_RETENTION_DAYS = 90;

/** 邮箱脱敏（SEC-003b）：保留首 2 字符 + *** + @ + 域名（如 ab***@example.com）。输出须可被 contracts 的 redactedEmailSchema 解析。 */
export function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 2) return email; // [advisory] local 部分不足 2 字符的边缘场景，原样返回，Dev 须反向同步 Spec
  return email.slice(0, 2) + '***' + email.slice(at);
}
```

`[约束]` append-only：`audit_logs` 表只允许 INSERT，不允许 UPDATE / DELETE；repository 内存实现仅暴露 `insert` + `list`，无 update/delete 方法。落地真实 DB 时须用数据库级权限/触发器禁止 UPDATE/DELETE（见 §迁移与回滚）。
`[约束]` 外键：`audit_logs.operator_id` → `users.id`；`audit_logs.entity_id` 不建强外键（实体可能被删除，日志须保留历史痕迹，弱引用）。`[advisory]` 本期内存实现不强制 FK。
`[约束]` `before/after` 用 jsonb 列承载异构字段快照；存储保留原始 PII（邮箱原值），脱敏仅在查询返回时进行（Q2）。
`[约束]` `operator_name` 为快照字段（非外键引用 user.name），写入时从 user 表读取并冻结——append-only 不可变要求日志不随后续用户改名而漂移。
`[约束]` `created_at` 与 `operated_at` 分离：`operated_at` 记录被审计操作的发生时间（由调用 service 传入），`created_at` 记录日志落库时间（供 90 天保留期清理，PRD Q6）。

变更项（首次落地 DB 时）：
- `[约束]` 新建表 `audit_logs`（append-only，禁止 UPDATE/DELETE）。
- `[约束]` 回滚：`DROP TABLE audit_logs;`（无跨域引用列需先解除）。

## 状态机
`[约束]` 操作日志实体**无状态机**：`AuditLog` 不含 `status` 字段，不存在状态迁移。日志生命周期仅：写入（create）→ 存在（只读，永不修改/删除，F4）→ 90 天后由清理任务删除（清理任务本期不实现，Q6）。

`[约束]` append-only 不可变是本域核心不变量：任何入口（含管理后台、批量入口、快捷入口）均无修改/删除日志的路径；router 不注册 PUT/PATCH/DELETE /v1/audit-logs，repository 不暴露 update/delete 方法。`[advisory]` 落地真实 DB 时除应用层守卫外，须叠加数据库级权限/触发器禁止 UPDATE/DELETE，纵深防御。

## 边界与异常（每条对应一个错误码）
| # | 触发条件 | 错误码 | HTTP | 说明 |
|---|---|---|---|---|
| B1 | 任意 procedure 入参不通过对应 Zod schema（page<1、pageSize<1、operated_from/operated_to 非 ISO datetime、operator_id 非 uuid、entity_type 不在闭合枚举等） | `VALIDATION_ERROR` | 400 | Zod 解析失败统一此码，字段级 detail 在 message。注：pageSize 超 100 不触发 B1，由 schema transform 钳制（Q4），见 §API 契约 |
| B2 | 未携带有效凭证 / 未登录访问任意 procedure | `UNAUTHORIZED` | 401 | SEC-001 默认受保护 |
| B3 | 已登录但缺少 `audit:read` 权限码 | `FORBIDDEN` | 403 | SEC-002 service 层 requirePermission('audit:read') |
| B4 | `[advisory]` **预留码，本期不触发**——单条日志详情查询（GET /v1/audit-logs/{id}）时 id 合法但无记录。本期仅提供列表查询（F2），列表空结果返回 items=[] 而非 404，故本期 service 层不抛此码；保留以备未来单条详情端点。append-only 无 update/delete 错误码（日志不可修改/删除，F4） | `AUDIT_LOG_NOT_FOUND` | （本期 n/a；预留 404） | 见下文"AUDIT_LOG_NOT_FOUND 预留决策" |

> B4 决策（`[advisory]`）：PRD F2 仅定义列表查询 GET /v1/audit-logs，未定义单条详情端点；列表查询在无匹配日志时返回 `items=[]`（空列表），不产生 404。故 `AUDIT_LOG_NOT_FOUND` 本期不被任何路径触发。本任务按指令将该码纳入 `errorCodeSchema`（供未来单条详情端点 / OpenAPI 完整性），但在 §校验顺序中显式声明本期无路径校验此码。impl-writer 须知：此码本期不在任何守卫序列中，`errorCodeToHttpStatus` 仍须为其预留映射（404）以维持 `Record<ErrorCode>` 穷举。

**校验顺序（`[约束]` service 层必须遵守，先到先返，不叠加）：**

`[约束]` **list（GET /v1/audit-logs）**：B1（router Zod 解析，含 pageSize 钳制）→ B2/B3（鉴权）→ 过滤（operated_from/operated_to 闭区间 / operator_id / entity_type）→ 按 operated_at 倒序 → 分页切片 → 对每条日志的 before/after 套用 redactEmail（邮箱字段脱敏，F3）→ 返回 `auditLogListResultSchema`(200，items 为 `redactedAuditLogSchema`)。
- `[约束]` 无任何部门/用户/角色存在性校验（operator_id / entity_id 为弱引用，可能指向已删除实体，日志须保留历史痕迹，不校验存在性）。
- `[约束]` 空结果返回 `items=[]` + `total=0` + `totalPages=0`（不触发 B4）。
- `[约束]` pageSize 钳制在 schema 层完成（transform），service 直接使用解析后的值；返回的 `pageSize` 字段反映钳制后的值（Q4 "提示"）。

`[约束]` **append-only 守卫**：repository 不暴露 update/delete 方法；router 不注册 PUT/PATCH/DELETE 路由。`[约束]` 任何尝试修改/删除日志的入口均在 router 层因无匹配路由而 404（非业务错误码，HTTP 层），service 层无对应方法可调用——这是 F4 的双重保障。

错误码枚举 SSOT：`errorCodeSchema`（`packages/contracts/src/schemas/user.ts`），audit 相关码为 `AUDIT_LOG_NOT_FOUND`（预留），复用 user/role/dept 域 `VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN`。`[约束]` 新增需同步本表、errors.ts 与 OpenAPI。

## 迁移与回滚
- 契约层：`[约束]` 本期为新增 audit.ts + 对 user.ts/role.ts/index.ts 的纯加性编辑（枚举扩展），向后兼容（仅扩枚举）。`[约束]` `permissionCodeSchema` 追加 `audit:read` 为枚举扩展，既有 role 对象的 `permission_codes` 解析不破坏（新值合法）。破坏性变更需新版本号并在 PRD 登记。
- DB：见 §DB 变更，首次建 `audit_logs` 表（append-only）。`[advisory]` 落地真实 DB 时 `audit_logs` 须用数据库级权限/触发器禁止 UPDATE/DELETE（应用层守卫之外的纵深防御）；`operator_id` 外键 `ON DELETE RESTRICT` 或不建 FK（操作者用户被删时日志保留，弱引用）。
- 数据：`[约束]` 内存 repository 重启即清空，无内置 audit seed（日志由三域写操作动态产生）。
- 内置 admin 权限范围：`[约束]` admin 的 `permission_codes` 须等于 `permissionCodeSchema` 枚举全集（Q4），扩展 `audit:read` 后须同步刷新 admin 行；`[advisory]` 由 `ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 派生，启动时按枚举重算即可自动覆盖（Dev 可选迁移脚本，反向同步 Spec）。
- 回滚策略：`[约束]` 契约/DB/OpenAPI/errorCodeSchema 任一回滚需四处同步回滚，保持一致（自检 #4/#5）。
- **待 impl-writer 联动**：`[约束]` errors.ts 补 `AUDIT_LOG_NOT_FOUND` 映射；`[advisory]` role.openapi.yaml `PermissionCode` 枚举 + user/role/dept.openapi.yaml `ErrorCode` 枚举同步追加（见 §跨域契约联动遗留项）。

## 测试矩阵（五类）
| 用例类型 | 覆盖点 |
|---|---|
| 单测 | `[约束]` repository append-only（内存）：audit_logs 的 insert（无 update/delete 方法可调用）/ list（按 operated_at 倒序、按 operated_from/operated_to 闭区间过滤、按 operator_id 过滤、按 entity_type 过滤、page/pageSize 分页切片）；service 钳制 pageSize>100→100（Q4）；service 脱敏 redactEmail（domain 层）：`redactEmail('abcdef@example.com')==='ab***@example.com'`，其输出可被 `redactedEmailSchema` 解析。 |
| 单测 | `[约束]` service 裁决：list 守卫序列 B1→B2→B3；空结果返回 items=[]/total=0/totalPages=0（不触发 B4）；pageSize=200 经 schema transform 钳制为 100，返回 pageSize=100；before/after 中邮箱字段经 redactEmail 脱敏、非邮箱字段原样返回。 |
| 契约测 | `[约束]` 入参 schema `listAuditLogQuerySchema` 用 `safeParse` 喂合法/非法样本：page<1、pageSize<1、operated_from 非 datetime、operator_id 非 uuid、entity_type 非 user/role/dept → 均 VALIDATION_ERROR；pageSize=200 通过（钳制为 100，非拒绝）；合法样本通过。 |
| 契约测 | `[约束]` 出参 schema 校验：list 返回 `auditLogListResultSchema`（.strict() 拒绝多余字段）、items=[] 空列表通过、items 元素为 `redactedAuditLogSchema`；`redactedEmailSchema` 对 'ab***@example.com' 通过、对 'abcdef@example.com'（未脱敏）拒绝、对 'a***@x.com'（local 不足 2 字符）拒绝；构造含 email 的 before/after 样本经 service 脱敏后 email 值可被 `redactedEmailSchema` 解析。 |
| 边界 | `[约束]` F1：创建用户成功 → 生成 log（action=create/entity_type=user/before={}/after 含邮箱原值）；更新用户仅改姓名 → before/after 仅含 name（邮箱未出现在快照）；删除角色 → log（action=delete/entity_type=role/after={}/before 含角色字段）；读操作（查询用户/查询日志本身）→ 不生成日志（Q1）；主操作失败（邮箱重复）→ 不生成日志。 |
| 边界 | `[约束]` F2：25 条日志请求第 2 页（pageSize=10）→ 返回第 11-20 条 + total=25 + totalPages=3，按 operated_at 倒序；按时间范围过滤 → 仅返回区间内；按 operator_id 过滤 → 仅返回该操作者；按 entity_type=user 过滤 → 仅返回 user；无过滤 → 全量第 1 页默认 pageSize=20；pageSize=200 → 钳制为 100 返回。 |
| 边界 | `[约束]` F3：after 含 'abcdef@example.com' → 返回 'ab***@example.com'；before 含原邮箱 → 同样脱敏；非邮箱字段（name/status）原样返回；多条日志邮箱均脱敏无遗漏；任何查询入口均不暴露未脱敏邮箱（Q2）。 |
| 边界 | `[约束]` F4：append-only——repository 无 update/delete 方法（编译期保障）；router 无 PUT/PATCH/DELETE /v1/audit-logs 路由；任何尝试修改/删除日志的入口被拒。 |
| 权限 | `[约束]` B2：未登录调 list → UNAUTHORIZED（SEC-001）。 |
| 权限 | `[约束]` B3：非 admin 调 list → FORBIDDEN（SEC-002，service 层 requirePermission('audit:read')；admin 桩下非 admin 无审计权限）。 |
| 权限 | `[advisory]` audit:read 端到端鉴权：本期 admin 桩下 admin 自动具备 audit:read，无法构造"仅 audit:read 无其他权限"用户；标注为待 Auth 模块富化 Ctx 后补端到端用例（遗留风险，非本期验收阻塞）。 |
| 权限 | `[约束]` SEC-003a：list 响应仅含 `auditLogListResultSchema` 字段，无未声明 PII；.strict() 保证出参不夹带多余字段；SEC-003b：before/after 中邮箱已脱敏（redactedEmailSchema 校验）。 |
| 状态机 | `[约束]` append-only 不可变：日志写入后任何修改/删除尝试均无路径可走（repository 无方法 + router 无路由）；本类覆盖 list 守卫序列顺序 B1→B2→B3（先到先返）。 |
| 状态机 | `[约束]` F1 旁路闭环：主操作成功 → 日志写入；主操作失败 → 不写入（验证日志记录不影响主操作成败，且仅成功写操作记录）；多次写操作 → 多条日志按 operated_at 倒序可查。 |

## Out of scope
- **单条日志详情查询 GET /v1/audit-logs/{id}**：PRD F2 仅定义列表查询；`AUDIT_LOG_NOT_FOUND` 为预留码本期不触发（B4）。`[advisory]` 未来需单条详情端点时启用此码。
- **audit:read 端到端鉴权**：`[advisory]` 受限于既有 `Ctx`（admin|user）鉴权桩，本期 admin 视为全权限；"仅 audit:read 管理员"验收待 Auth 模块富化 Ctx（携带 resolved permission codes）后补，列入遗留风险。
- **按 action 过滤查询**：PRD Q5 OPEN，本期 F2 仅时间范围/操作者/实体类型三维过滤；按 action 过滤为后续迭代增强。`[约束]`
- **90 天保留期清理任务**：PRD Q6 OPEN，本期仅记录 `created_at` 供后续清理任务使用；清理策略/执行时机/失败重试待后续 PRD 定义。`[约束]`
- **未脱敏返回入口**：`[advisory]` Q2 决策本期查询入口仅返回脱敏值；存储保留原值以备深度审计，但本期不提供未脱敏返回入口（如需须补独立权限码 audit:read_raw 并反向同步 Spec）。
- **审计落库的触发器抽象**：`[advisory]` 三域 service 内联调用 audit log 写入为最简实现；未来可抽象统一 AuditRecorder 中间件，本期不做。
- **真实 DB 接入**：`[advisory]` 本 MVP repository 内存实现，DB schema 仅作文档 SSOT（见 §DB 变更）。
- **既有 OpenAPI 片段同步**：`[advisory]` role.openapi.yaml 的 `PermissionCode` 枚举需同步追加 `audit:read`，user/role/dept.openapi.yaml 的 `ErrorCode` 枚举需同步追加 `AUDIT_LOG_NOT_FOUND`；本轮为控制改动面未顺带更新，记为遗留同步项（待 impl-writer / 文档维护者处理）。

## 受影响测试清单（AI-006 · 本轮核心验证点）
本节依 AI-006 规则，基于对 `apps/api/test/**/*.ts` 的真实 grep 扫描产出。本任务对 `packages/contracts` 的联动改动为两个符号：`permissionCodeSchema`（role.ts 追加 `audit:read`）与 `errorCodeSchema`（user.ts 追加 `AUDIT_LOG_NOT_FOUND`）。下表列出所有引用被改符号的测试文件 + 受影响断言位置 + 需同步更新方向。

**grep 命令与命中（真实执行结果）：**
- `grep -rn 'permissionCodeSchema\|ALL_PERMISSION_CODES' apps/api` → 命中 `test/role.test.ts`、`test/dept.test.ts`、`src/domain/role.ts`、`src/repository/role.ts`。
- `grep -rn 'errorCodeSchema\|ErrorCode\|errorResponseSchema' apps/api` → 命中 `test/user.test.ts`、`test/dept.test.ts`、`test/role.test.ts`、`src/errors.ts`。

| 测试文件 | 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|---|
| `apps/api/test/role.test.ts` | L21 | `import { permissionCodeSchema }` | 引用被改枚举 | 见下方 L129-131 |
| `apps/api/test/role.test.ts` | L36 | `import { ALL_PERMISSION_CODES }` | 引用派生自 permissionCodeSchema 的常量 | 见下方 L129-131 / L141 |
| `apps/api/test/role.test.ts` | L129-131 | `it('ALL_PERMISSION_CODES 包含全部权限码（SSOT 派生，AI-005）')` → `expect(ALL_PERMISSION_CODES).toEqual([...permissionCodeSchema.options])` | **已用 SSOT 派生，无需改** | 枚举追加 `audit:read` 后，`permissionCodeSchema.options` 自动含新码，断言自动跟随（AI-005 价值：零测试改动） |
| `apps/api/test/role.test.ts` | L141 | `expect(admin.permission_codes).toEqual(ALL_PERMISSION_CODES)`（admin seed 用 `[...ALL_PERMISSION_CODES]`，repository/role.ts L42） | **已用 SSOT 派生，无需改** | `ALL_PERMISSION_CODES` 派生自 `permissionCodeSchema.options`，admin seed 自动含 `audit:read`；impl-writer 仅须验证 seed 行覆盖新码（自动覆盖） |
| `apps/api/test/role.test.ts` | L309-313 | `permissionCodeSchema.safeParse('foo:bar')` 拒绝 / `safeParse('role:write')` 通过 | **无需改** | 测试既有码（foo:bar 非法、role:write 合法），`audit:read` 加入不影响；可选补 `safeParse('audit:read')` 通过断言（非必须，dept.test.ts 已有同类模式） |
| `apps/api/test/dept.test.ts` | L45 | `import { permissionCodeSchema }` | 引用被改枚举 | 见下方 L482-490 |
| `apps/api/test/dept.test.ts` | L47 | `import { type ErrorCode }` | 类型级引用被改枚举 | **无需改**（`AUDIT_LOG_NOT_FOUND` 加入 ErrorCode 联合类型不破坏既有类型引用） |
| `apps/api/test/dept.test.ts` | L122 | `expectAppError(promise, code: ErrorCode)` helper | 类型级引用 ErrorCode | **无需改**（类型级，新码加入不破坏） |
| `apps/api/test/dept.test.ts` | L482-490 | `permissionCodeSchema.safeParse('dept:read'/'dept:write')` 通过 / `'foo:bar'` 拒绝 | **无需改** | 测试 dept 码，`audit:read` 加入不影响；dept.test 仅断言本域码，无需补 audit:read 断言 |
| `apps/api/test/user.test.ts` | L14 | `import { type ErrorCode }` | 类型级引用被改枚举 | **无需改**（类型级） |
| `apps/api/test/user.test.ts` | L79 | `expectAppError(promise, code: ErrorCode)` helper | 类型级引用 ErrorCode | **无需改**（类型级，新码加入不破坏） |

**清单结论（AI-006 + AI-005 交叉验证）：**
- `[约束]` 所有引用 `permissionCodeSchema` 的测试断言（role.test.ts L129-131 / L141）**均已用 SSOT 派生**（`[...permissionCodeSchema.options]`），追加 `audit:read` 后自动跟随，**零测试改动**——这正是 AI-005「禁止硬编码跨域可变集合」的价值：枚举扩展不击穿既有测试。
- `[约束]` 所有引用 `errorCodeSchema` / `ErrorCode` 的测试均为**类型级引用**（`type ErrorCode` + `expectAppError` helper 形参），追加 `AUDIT_LOG_NOT_FOUND` 不破坏类型兼容，**零测试改动**。
- `[约束]` **未发现硬编码跨域可变集合断言**（AI-005 抓取点）：`apps/api/test/**/*.ts` 中无 `.toEqual([...])` / `.toStrictEqual([...])` 后紧跟 ≥3 个权限码或错误码字面量的断言（`scripts/check-rules.mjs` AI-005 分支扫描结果为 0 suggestion）。故本清单无"需改为 SSOT 派生"项。
- `[advisory]` 新增 `apps/api/test/audit.test.ts`（覆盖本 Spec §测试矩阵五类）由 test-writer 另行产出，非本任务范围（本任务为 Tech-Spec + contracts + OpenAPI）；test-writer 须遵循 AI-005：对本域 audit 相关断言一律 SSOT 派生（如 `expect(codes).toEqual([...auditLogActionSchema.options])`），禁止硬编码。

**待 impl-writer 联动（非测试文件，记此以闭环）：**
- `[约束]` `apps/api/src/errors.ts` L19：`errorCodeToHttpStatus: Record<ErrorCode, number>` 缺 `AUDIT_LOG_NOT_FOUND` 映射 → `tsc` 报 TS2741（见 §自检与遗留）。需补 `AUDIT_LOG_NOT_FOUND: 404`（预留码本期不触发，仍穷举映射维持 Record）。此项非测试文件，但属 contracts 联动击穿的下游，impl-writer 须先修复方可通过 `npm run typecheck`。
- `[约束]` `apps/api/src/domain/role.ts` L23：`ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 已 SSOT 派生，`audit:read` 自动覆盖，无需手改。

## 自检与遗留
- `[约束]` 自检 8 项见任务说明；本节记录关键证据：
  - contracts tsc：**0 错误**（`packages/contracts/src` 全绿，含新增 audit.ts + 联动编辑的 user.ts/role.ts/index.ts）。
  - apps/api tsc：**1 错误** —— `apps/api/src/errors.ts(19,14) TS2741`（`errorCodeToHttpStatus` 缺 `AUDIT_LOG_NOT_FOUND` 键），属"待 impl-writer 联动修复"，本任务不改 apps/api。
  - `node scripts/check-rules.mjs`：通过（CODE-004 / SEC-003a / META-003/004 等全绿，0 error）。
  - OpenAPI 与 Zod 1:1：`api-spec/audit.openapi.yaml` 字段/类型/枚举/必填/`.strict()`（additionalProperties: false）与 audit.ts 对齐。
  - 边界每条有错误码且在 errorCodeSchema：B1 VALIDATION_ERROR / B2 UNAUTHORIZED / B3 FORBIDDEN / B4 AUDIT_LOG_NOT_FOUND 均在枚举。
  - 实现性描述均有 `[约束]`/`[advisory]` 标记（advisory 项数：见下）。
  - 跨域联动改动已列出（§跨域契约联动）。
  - 受影响测试清单章节存在且基于真实 grep 结果（§受影响测试清单，AI-006）。
- `[advisory]` 遗留风险：① audit:read 端到端鉴权待 Auth 富化 Ctx；② 既有 OpenAPI 片段（user/role/dept）ErrorCode/PermissionCode 枚举待同步（user/role/dept 的 ErrorCode 加 AUDIT_LOG_NOT_FOUND、role 的 PermissionCode 加 audit:read）；③ errors.ts Record 补码待 impl-writer（TS2741）；④ 三域 service 内联 audit log 写入待 impl-writer（本任务不改动既有 service）；⑤ before/after 为 `z.record(z.unknown())` 弱类型，邮箱脱敏由 service 保证（契约测断言脱敏值可被 redactedEmailSchema 解析，防漂移）；⑥ redactEmail 对 local 部分不足 2 字符的邮箱为边缘场景（原样返回，须反向同步 Spec）。
