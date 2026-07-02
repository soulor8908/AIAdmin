---
doc_type: Tech-Spec
id: TECH-AUDIT-ENHANCEMENT-001
prd_ref: PRD-AUDIT-ENHANCEMENT-001
status: draft
owner: dev@team
created: 2026-07-02
extends: TECH-AUDIT-001
---
# 操作日志增强 · 技术规格（跨域埋点 + 操作统计报表 + 变更快照结构化）

> 标记约定（沿用 TECH-AUDIT-001 / TECH-DEPT-001 / TECH-ROLE-001）：
> - `[约束]` = Dev 必须遵守（字段集 / 错误码 / 状态机 / 权限 / 校验顺序 / 架构边界）。
> - `[advisory]` = Dev 可偏离，但须在 PR 描述中"反向同步 Spec"（写明偏离点与理由）。
> 每条实现性描述均显式标注其一；未标注的为纯说明性文字（引用、引用指向）。
>
> META 提示：本 Spec 不新增 `.trae/rules/**` 规则文件，亦不新增 `scripts/check-rules.mjs` 的 enforcement 分支——所有规则复用既有 AI-001~006 / ARCH-001~003 / CODE-001~004 / SEC-001~003 / META-001~004。本 Spec §校验方式 标注每条规则的现有机器校验落点（脚本既有分支 / Reviewer 流程 / CI 整体），不声称新分支（不触发 META-003），亦不遗漏既有分支（不触发 META-004）。

## 1. 概览与范围

本 Spec 为第四轮 TECH-AUDIT-001 的增强，落地 PRD-AUDIT-ENHANCEMENT-001 三个功能点 + 两处跨域契约联动，同时验证三个架构探索主题：

- **F1 跨域自动埋点**：user.create / user.updateStatus / role.create / role.delete / role.assignRole·removeRole / dept.create / dept.delete / dept.assignUserDepartment 共 8 个写操作成功后自动记结构化审计日志。`[约束]` 埋点对调用方透明、service 业务逻辑保持纯粹不感知 audit、best-effort 不影响主操作成败（PRD F1 + Q2/Q3/Q4/Q5）。
- **F2 操作统计报表**：新增 `report` 领域（非 CRUD：纯读 + 聚合），按 1~4 维（operator_id / entity_type / action / date(UTC 自然日桶)）group by 聚合计数，时间范围 + 维度过滤，count 降序 + 维度值升序 tiebreaker，分页（默认 20 / 上限 100 钳制），新增 `report:read` 权限码，实时聚合不缓存（PRD F2 + Q6~Q12）。
- **F3 变更快照结构化**：audit 的 before/after 从 `z.record(z.unknown())` 升级为 `ChangeField[]`（`{field, value, pii}`），PII 由契约层清单标记定位（本期 = `{(user, email)}`），移除运行时正则兜底（`EMAIL_LIKE_RE` + 键名/值双判断），既有日志一刀切迁移（create→before=[]、delete→after=[]），value 限定标量 | null | 同类型标量数组（PRD F3 + Q13~Q18）。
- **跨域契约联动（触发 AI-006）**：`permissionCodeSchema` 加 `report:read`；`errorCodeSchema` 加 `REPORT_GROUP_BY_REQUIRED`、`REPORT_TIME_RANGE_INVALID`。`[约束]` 受影响测试清单见 §8（基于真实 grep，不凭记忆）。

**本轮架构探索主题**（PRD §背景三方向）：
1. 跨域旁路埋点的层归属（router 中间件 / 装饰器 / 事件总线）—— §3.1 决策。
2. PII 脱敏从运行时正则灰区迁至契约层标记驱动 —— §3.2 决策。
3. 工作流对"纯读 + 聚合"非 CRUD 领域的适应性 —— §3.3 + §5 决策。

## 2. 影响的模块

- `packages/contracts/src/schemas/audit.ts`（既有，本期编辑，F3 核心）：`auditLogSchema` / `redactedAuditLogSchema` 的 `before`/`after` 从 `z.record(z.unknown())` 改型为 `z.array(changeFieldSchema)`；新增 `changeFieldSchema`、`changeFieldValueSchema`。`[约束]` 所有类型经 `z.infer` 派生（ARCH-002 / CODE-004）；输出 schema 带 `.strict()`（SEC-003a）。
- `packages/contracts/src/schemas/report.ts`（本期新增，F2）：`report` 领域契约 SSOT（`reportGroupByDimSchema` / `reportQuerySchema` / `reportResultSchema` / `reportAggItemSchema`）。`[约束]`
- `packages/contracts/src/schemas/role.ts`（既有，本期编辑，跨域联动）：`permissionCodeSchema` 的 `z.enum` 追加 `report:read`。`[约束]`
- `packages/contracts/src/schemas/user.ts`（既有，本期编辑，跨域联动）：`errorCodeSchema` 追加 `REPORT_GROUP_BY_REQUIRED` / `REPORT_TIME_RANGE_INVALID`。`[约束]` SSOT 仍在 user.ts，report.ts / audit.ts 不重复定义。
- `packages/contracts/src/index.ts`（既有，本期编辑）：追加 `export * from './schemas/report.js'`。`[约束]`
- `apps/api/src/domain/audit.ts`（既有，本期编辑，F3）：保留 `redactEmail` / `AUDIT_LOG_RETENTION_DAYS`；新增 `PII_FIELD_REGISTRY`（数据 SSOT，经 `piiFieldRegistrySchema` 校验）+ `markPii(entityType, fields)` 辅助函数。`[约束]` ARCH-001：domain 不得 import 上层；ARCH-002：contracts 只导出 schema 与类型，registry 数据放 domain（与 `redactEmail` 同一先例）。
- `apps/api/src/service/audit.ts`（既有，本期编辑，F3）：移除 `EMAIL_LIKE_RE` 常量与 `redactSnapshot` 的运行时正则兜底，改为遍历 `ChangeField[]`、对 `pii === true` 的项套用 `redactEmail`；`record` 入参 `AuditLogRecordInput.before/after` 类型随 contracts 改型为 `ChangeField[]`。`[约束]`
- `apps/api/src/service/report.ts`（本期新增，F2）：报表聚合 service，依赖 `AuditLogRepository`（读投影，无独立 repo），实时内存 group by + date 桶 + 排序 + 分页。`[约束]` SEC-002：public 方法调 `requirePermission('report:read')`。
- `apps/api/src/router/report.ts`（本期新增，F2）：procedure 表，复用 `Procedure` + `permission: 'report:read'` 元数据（参照 `router/audit.ts` / `router/dept.ts` 的 `XxxProcedure<I,O> & { permission }` 模式）。`[约束]` SEC-001。
- `apps/api/src/router/audit.ts`（既有，本期编辑，F1）：新增 `withAudit` 高阶函数（包装写操作 handler），不破坏既有 `list` procedure。`[约束]`
- `apps/api/src/router/user.ts` / `role.ts` / `dept.ts`（既有，本期编辑，F1）：8 个写操作 procedure 的 `handler` 经 `withAudit` 包装；service 写操作签名扩展为返回 `{entity, changes}` 供埋点（见 §3.1 决策 D1）。`[约束]`
- `apps/api/src/service/user.ts` / `role.ts` / `dept.ts`（既有，本期编辑，F1+F3）：写操作返回值从 `Entity` 扩展为 `{entity: Entity, changes: ChangeField[]}`；service 构造 `changes` 时查 `PII_FIELD_REGISTRY` 标 `pii`。`[约束]` ARCH-001：service 不得 import router；service 不 import `AuditLogService`（保持纯粹，埋点在 router 层）。
- `apps/api/src/repository/audit.ts`（既有，本期编辑，F2）：新增 `listAll(filter)` 方法（无分页，供 report service 聚合读投影）；既有 `list` / `insert` 不变。`[约束]` append-only 守卫不变（仍无 update/delete 方法）。
- `apps/api/src/errors.ts`（既有，本期编辑，跨域联动）：`errorCodeToHttpStatus: Record<ErrorCode, number>` 补齐 `REPORT_GROUP_BY_REQUIRED: 400` / `REPORT_TIME_RANGE_INVALID: 400`，否则 `tsc` 报 TS2741。`[约束]`
- `apps/api/src/domain/role.ts`（既有，零改动）：`ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 已 SSOT 派生，追加 `report:read` 后自动覆盖，无需手改；impl-writer 须验证 admin seed 行覆盖新码（自动覆盖）。`[约束]`
- `api-spec/audit.openapi.yaml`（既有，本期编辑，F3）：`AuditLog.before/after` 改为 `array<ChangeField>`，`ChangeField` 新组件。
- `api-spec/report.openapi.yaml`（本期新增，F2）：报表查询 OpenAPI 片段，与 Zod 1:1 对齐。`[advisory]` 既有 user/role/dept.openapi.yaml 的 `PermissionCode` 枚举须同步追加 `report:read`、`ErrorCode` 枚举须同步追加 `REPORT_*`，记为遗留同步项（见 §Out of scope）。

## 3. 架构决策（本轮核心）

### 3.1 埋点架构模式选型（F1）

PRD Q5 留 Tech Lead 裁决，业务约束为：(a) 埋点对调用方透明；(b) service 业务逻辑保持纯粹不感知 audit。下表对比三方案：

| 方案 | 描述 | service 是否纯粹 | 透明性 | best-effort | 评价 |
|---|---|---|---|---|---|
| A. router 层装饰器/包装（`withAudit` HOF） | 写操作 handler 经高阶函数包装；wrapper 在 handler 成功后组装 `AuditLogRecordInput` 调 `audit.record`，异常吞掉 | ✅ service 不 import audit | ✅ 调用方仅感知原返回类型 | ✅ wrapper 内 try/catch | **推荐**：满足 (a)(b)，service 仅扩展返回值携带 `changes`（领域知识在 service 最自然） |
| B. service 层注入 audit | service 构造注入 `AuditLogService`，写操作末尾自调 `audit.record` | ❌ service 反向依赖 audit service，破坏领域自治 | ✅ | ⚠️ 主操作已 commit，audit 异常须 service 自吞 | 违反 retro P2 建议（audit 反向侵入三域 service） |
| C. 事件总线 | service 发 `domain event`，audit subscriber 订阅写日志 | ✅ service 仅依赖事件接口 | ✅ | ✅ subscriber 异常隔离 | MVP 引入事件总线基建成本过高，过度工程 |

**决策 D1（`[约束]`）**：采用方案 A——router 层 `withAudit` 高阶函数包装写操作 handler。

**理由**：
- 满足 PRD (a) 调用方透明：`withAudit` 包装后 handler 返回类型不变（仍是 `Entity`），调用方零感知。
- 满足 PRD (b) service 纯粹：user/role/dept service **不 import `AuditLogService`**，仅扩展写操作返回值为 `{entity, changes}` 供 wrapper 提取。service 产 `changes` 是领域知识的自然产出（service 知道旧态/新态），不构成"感知 audit"——`changes` 是结构化变更描述，audit 只是它的消费者之一。
- 满足 best-effort：`withAudit` wrapper 内 `try { audit.record(...) } catch { /* 吞掉，记录内部错误 */ }`，主操作已成功返回不受影响。
- 与 ARCH-001 一致：service 不 import router，router 依赖 service + audit service（横向同层依赖允许）。

**`changes` 产出方决策 D2（`[约束]`）**：`ChangeField[]` 由 **service 写操作构造**（不是 router 层对比新旧态）。理由：
- service 写操作天然知道旧态（从 repo 读出）与新态（即将写入），构造 `changes` 最自然、最准确。
- router 层对比新旧态需重复读一次 repo（性能浪费 + 并发竞态）。
- service 产 `changes` 是"变更描述"的领域产出，audit 是其消费者——service 不因此"感知 audit"。

**service 写操作返回签名变更 D3（`[约束]`）**：写操作 public 方法返回类型从 `Promise<Entity>` 扩展为 `Promise<{ entity: Entity; changes: ChangeField[] }>`。具体：
- `UserService.create` → `Promise<{ entity: User; changes: ChangeField[] }>`（after 含 email/name/status，before=[]）
- `UserService.updateStatus` → `Promise<{ entity: User; changes: ChangeField[] }>`（before/after 仅含 status）
- `RoleService.create` → `Promise<{ entity: Role; changes: ChangeField[] }>`（after 含 name/description/permission_codes/is_builtin，before=[]）
- `RoleService.delete` → `Promise<{ entity: void; changes: ChangeField[] }>`（before 含删除前角色业务字段，after=[]）`[advisory]` void entity 时 wrapper 用 input.id 作为 entity_id
- `RoleService.assign` / `remove` → `Promise<{ entity: UserRole | void; changes: ChangeField[] }>`（虚拟字段 `assigned_user_ids: string[]` 的旧值/新值）
- `DepartmentService.create` / `delete` / `assignUserDepartment` → 同理

`[advisory]` service 写操作的既有契约测（user/role/dept.test.ts 中断言 `service.create(input, ctx)` 返回 `User` / `Role` / `Department`）须同步改为断言 `result.entity`——列入 §8 受影响测试清单。

`[advisory]` **WriteResult 实现侧扩展 `before?: ChangeField[]` 可选字段（S-2 反向同步）**：D3 声明的返回类型为 `{ entity, changes }`，实现侧（`apps/api/src/domain/audit.ts` 的 `WriteResult<E>` 接口）额外引入可选 `before?` 字段供 wrapper 直接取用，避免 wrapper 从 changes 派生 before 的复杂度（D4 示意用 `extractBefore(changes)` 派生，impl 改为 service 直接产出 before 数组传递）。功能等价（before 仍语义为"变更前快照"，create 时省略 → wrapper 用 `before ?? []` 兜底为 `[]`）。该字段为可选（`before?`），不破坏 D3 的 `{entity, changes}` 形状（未列字段对调用方透明）。Reviewer S-2 已确认此为 advisory 偏离，本条为反向同步说明。

**`withAudit` wrapper 形状 D4（`[约束]`）**：

```ts
// apps/api/src/router/audit.ts （示意，impl-writer 按此形状实现）
type AuditMeta = {
  entityType: 'user' | 'role' | 'dept';
  action: 'create' | 'update' | 'delete';
  entityIdFromInput?: (input: unknown) => string; // delete 等无 entity 返回时从 input 取
  operatorNameFromCtx?: (ctx: Ctx) => string;     // 默认从 user 表读，MVP 桩下用 ctx.user.id
};

function withAudit<I, R extends { entity: unknown; changes: ChangeField[] }>(
  handler: (input: I, ctx: Ctx) => Promise<R>,
  audit: AuditLogService,
  meta: AuditMeta,
): (input: I, ctx: Ctx) => Promise<R['entity']> {
  return async (input, ctx) => {
    const { entity, changes } = await handler(input, ctx); // 主操作先成功
    try {
      await audit.record(
        {
          operator_id: ctx.user.id,
          operator_name: await resolveOperatorName(ctx), // MVP 桩：从 userRepo 读 or 'admin'
          entity_type: meta.entityType,
          entity_id: meta.entityIdFromInput ? meta.entityIdFromInput(input) : (entity as { id: string }).id,
          action: meta.action,
          operated_at: new Date().toISOString(),
          before: extractBefore(changes),
          after: extractAfter(changes),
        },
        ctx,
      );
    } catch {
      // best-effort：吞掉，记录内部错误（不抛调用方）
      // [约束] 不得用空 catch（CODE-002），须至少记录（如内部 logger.warn）
    }
    return entity;
  };
}
```

`[约束]` wrapper 的 catch 不得为空（CODE-002 校验 `catch\s*\([^)]*\)\s*\{\s*\}` 与 `catch 仅含 console`），impl-writer 须在 catch 内调用内部 logger 或写一条 `console.warn`（MVP 桩下用 `console.warn`，未来换 pino）。`[advisory]` 未来可换 pino redact 配置，本期不引入。

`[advisory]` operator_name 解析：MVP `Ctx` 仅含 `{id, role}`，无姓名字段。impl-writer 须在 wrapper 内从 `UserRepository.findById(ctx.user.id)` 读 `name` 作 `operator_name` 快照；若读不到（极端竞态）回退 `'unknown'` 并记 warn。该回退为 advisory 边缘场景，须反向同步 Spec。

### 3.2 ChangeField 结构化契约（F3）

**决策 D5（`[约束]`）**：定义 `changeFieldValueSchema` 与 `changeFieldSchema` 于 `packages/contracts/src/schemas/audit.ts`：

```ts
// value 限定：标量 | null | 同类型标量数组（PRD Q18）
export const changeFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);
export type ChangeFieldValue = z.infer<typeof changeFieldValueSchema>;

export const changeFieldSchema = z.object({
  field: z.string().min(1),
  value: changeFieldValueSchema,
  pii: z.boolean(),
}).strict();
export type ChangeField = z.infer<typeof changeFieldSchema>;
```

`[约束]` `auditLogSchema` / `redactedAuditLogSchema` 的 `before` / `after` 改型为 `z.array(changeFieldSchema)`；`.strict()` 保留（SEC-003a）。
`[约束]` create → `before: []`；delete → `after: []`；update → 两者均非空（仅含实际变更字段）。before/after 始终存在为数组（不省略字段，PRD Q17）。
`[约束]` value 不支持对象/嵌套数组（PRD Q18）；`field` 可为虚拟/关联字段（如 `assigned_user_ids`），不限定为实体列。

**PII 清单声明机制 D6（`[约束]`）**：

- **shape SSOT 在 contracts**：定义 `piiFieldRegistrySchema`（Zod）于 `audit.ts`，描述 registry 的结构契约（按 `entity_type` → `Set<field_name>`）。
- **data SSOT 在 domain**：`PII_FIELD_REGISTRY` 常量于 `apps/api/src/domain/audit.ts`，经 `piiFieldRegistrySchema.parse(...)` 校验后导出。本期数据 = `{ user: new Set(['email']) }`。
- **辅助函数**：`markPii(entityType, fields: ChangeField[]): ChangeField[]` 于 `domain/audit.ts`，遍历 fields 查 registry 标 `pii`（registry 未列的字段默认 `pii: false`）。

**ARCH-002 调和说明（`[约束]`）**：PRD Q14 措辞"contracts 层声明 PII 清单"与 ARCH-002"contracts 只导出 Zod schema 与 z.infer 类型"存在字面张力。本 Spec 采用与 `redactEmail` 同一先例调和：**shape 契约在 contracts（schema），runtime 数据在 domain（经 schema 校验）**。这样既满足"contracts 层声明"（shape SSOT 在 contracts），又不违反 ARCH-002（contracts 不导出数据/函数）。新增 PII 字段须同时扩展 `piiFieldRegistrySchema` 的枚举闭合性（advisory，见下）+ `PII_FIELD_REGISTRY` 数据，由对应领域 PRD 走（SSOT 派生，AI-005）。

```ts
// packages/contracts/src/schemas/audit.ts
export const piiFieldRegistrySchema = z.record(
  auditLogEntityTypeSchema,
  z.set(z.string().min(1)), // 字段名集合
);
export type PiiFieldRegistry = z.infer<typeof piiFieldRegistrySchema>;
```

```ts
// apps/api/src/domain/audit.ts
import { piiFieldRegistrySchema, type ChangeField, type AuditLogEntityType } from '@admin/contracts';

/** PII 字段清单（数据 SSOT，经 contracts 的 piiFieldRegistrySchema 校验）。本期 = { user: Set(['email']) }。 */
export const PII_FIELD_REGISTRY = piiFieldRegistrySchema.parse({
  user: new Set(['email']),
  // role / dept 本期无 PII 字段；新增须扩展此处 + 对应领域 PRD（AI-005 SSOT 派生）
});

/** 标注 fields 中 PII 项（查 PII_FIELD_REGISTRY，未列默认 pii=false）。纯函数，无 IO。 */
export function markPii(entityType: AuditLogEntityType, fields: ChangeField[]): ChangeField[] {
  const piiSet = PII_FIELD_REGISTRY[entityType] ?? new Set<string>();
  return fields.map((f) => ({ ...f, pii: piiSet.has(f.field) }));
}
```

`[advisory]` `z.set` 在 Zod v3 部分版本可用；若 impl-writer 所用 Zod 版本不支持 `z.set`，可降级为 `z.array(z.string())` 并在 domain 用 `new Set(arr)` 转换——须反向同步 Spec。

**脱敏策略 D7（`[约束]`）**：`AuditLogService.redactLog` 改为遍历 `before`/`after` 的 `ChangeField[]`，对 `pii === true` 的项套用 `redactEmail`（值须为 string，非 string 时原样返回）；移除 `EMAIL_LIKE_RE` 常量与 `redactSnapshot` 的键名/值双判断逻辑（PRD Q15：信任标记，不做运行时正则兜底）。脱敏仅保留 marker-based 一条路径。

```ts
// apps/api/src/service/audit.ts （示意）
private redactLog(log: AuditLog): AuditLog {
  return {
    ...log,
    before: this.redactFields(log.before),
    after: this.redactFields(log.after),
  };
}
private redactFields(fields: ChangeField[]): ChangeField[] {
  return fields.map((f) => (f.pii && typeof f.value === 'string' ? { ...f, value: redactEmail(f.value) } : f));
}
```

`[约束]` 既有第四轮 `z.record` 格式日志一刀切迁移为 `ChangeField[]`（PRD Q16）：内存 repository 重启即清空，无生产迁移；test fixture（audit.test.ts 的 `makeLog`）须同步改型（见 §8）。

### 3.3 报表聚合契约（F2）

**决策 D8（`[约束]`）**：新增 `packages/contracts/src/schemas/report.ts`，定义 `reportGroupByDimSchema` / `reportQuerySchema` / `reportResultSchema` / `reportAggItemSchema`。

```ts
// packages/contracts/src/schemas/report.ts
import { z } from 'zod';
import { auditLogEntityTypeSchema, auditLogActionSchema } from './audit.js';

/** group by 维度枚举（PRD Q6：1~4 维，去重）。 */
export const reportGroupByDimSchema = z.enum(['operator_id', 'entity_type', 'action', 'date']);
export type ReportGroupByDim = z.infer<typeof reportGroupByDimSchema>;

/**
 * 报表查询入参（F2）。
 * [约束] group_by 必填、非空、≤4 维、去重；空 → REPORT_GROUP_BY_REQUIRED（B1'）。
 * [约束] operated_from/operated_to 为 ISO datetime 闭区间；from > to → REPORT_TIME_RANGE_INVALID（B1''）。
 * [约束] page 默认 1；pageSize 默认 20、上限 100（transform 钳制，与 audit 列表查询一致）。
 * [advisory] 查询 schema 非 strict（未知 query 键被 strip，与 listAuditLogQuerySchema 一致）。
 */
export const reportQuerySchema = z.object({
  group_by: z.array(reportGroupByDimSchema).min(1).max(4),
  operated_from: z.string().datetime().optional(),
  operated_to: z.string().datetime().optional(),
  operator_id: z.string().uuid().optional(),
  entity_type: auditLogEntityTypeSchema.optional(),
  action: auditLogActionSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).transform((n) => Math.min(n, 100)).default(20),
}).superRefine((data, ctx) => {
  // 去重校验：group_by 须无重复维度
  const seen = new Set<string>();
  for (const dim of data.group_by) {
    if (seen.has(dim)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'group_by 维度重复', path: ['group_by'] });
    }
    seen.add(dim);
  }
  // 时间范围校验：from > to 拒绝
  if (data.operated_from && data.operated_to && data.operated_from > data.operated_to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'operated_from 晚于 operated_to', path: ['operated_from'] });
  }
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** 聚合行 item：含各 group_by 维度的值 + count。 */
export const reportAggItemSchema = z.record(z.string(), z.union([z.string(), z.number()])).and(
  z.object({ count: z.number().int().min(0) }),
);
export type ReportAggItem = z.infer<typeof reportAggItemSchema>;

`[advisory]` **reportAggItemSchema 的 count 子 object 不加 `.strict()`（S-3 反向同步）**：本 Spec D8 示例原写 `.and(z.object({ count }).strict())`，实现侧（`packages/contracts/src/schemas/report.ts`）移除了 count 子 object 的 `.strict()`。理由：`z.object({ count }).strict()` 与外层 `z.record(z.string(), ...)` 交集后，`.strict()` 会拒绝 group_by 维度键（operator_id / entity_type / action / date 等动态字段），导致多维 item（如 `{ operator_id, entity_type, count }`）校验失败。SEC-003a 扫描范围仅覆盖 *Result/*Response 命名 schema，`reportAggItemSchema` 非 *Result/*Response 模式，不在 SEC-003a 强制范围；外层 `reportResultSchema` 仍 `.strict()`（SEC-003a 保留）。Reviewer S-3 已确认此为 advisory 偏离，本条为反向同步说明（实现侧报告 A-2）。

/** 报表查询结果（F2）。[约束] .strict()（SEC-003a）；group_by 原样回显。 */
export const reportResultSchema = z.object({
  items: z.array(reportAggItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  group_by: z.array(reportGroupByDimSchema),
}).strict();
export type ReportResult = z.infer<typeof reportResultSchema>;
```

`[约束]` report 不引入独立 repository：`ReportService` 依赖 `AuditLogRepository.listAll(filter)` 读全量（已过滤），在 service 层做内存 group by + date 桶 + 排序 + 分页。理由：report 是 audit_logs 的只读投影，无独立存储；分离 repo 会重复存储/一致性复杂度。
`[约束]` AuditLogRepository 新增 `listAll(filter: AuditLogListFilter): AuditLog[]`（无分页，仅过滤），与既有 `list(opts)` 共用过滤逻辑（可抽 `private applyFilter`）。append-only 守卫不变（仍无 update/delete）。
`[advisory]` `reportAggItemSchema` 用 `z.record(z.string(), ...)` 承载 `{ [dim]: value, count }`——维度键随 group_by 动态变化，无法静态枚举字段名；impl-writer 须保证 items 每项含且仅含 group_by 声明的维度键 + count（service 层裁决，契约测断言）。

**聚合算法 D9（`[约束]`）**：
1. `reportQuerySchema.parse(query)` 应用默认值、pageSize 钳制、去重 + 时间范围 superRefine（B1' / B1''）。
2. `requirePermission('report:read')`（B3）。
3. `auditRepo.listAll({ operated_from, operated_to, operator_id, entity_type, action })` 取已过滤全量日志。
4. 对每条日志计算 group key：按 `group_by` 顺序取维度值——`date` 维度取 `operated_at.slice(0, 10)`（UTC 自然日 `YYYY-MM-DD`，ISO 字符串前 10 字符即日期，与 UTC 一致因 `operated_at` 为 UTC datetime）；其余维度取日志顶层字段值。
5. `Map<string, number>` 累计 count（key = `group_by` 维度值用 `\u0000` 拼接的字符串）。
6. 排序：count 降序；计数相同按 `group_by` 声明顺序依次作为次级排序键升序（维度值为字符串，字典序升序；`date` 维度 YYYY-MM-DD 字典序与日历序一致）。
7. 分页：`slice((page-1)*pageSize, page*pageSize)`；`total` = Map.size（去重后维度组合数），`totalPages = total === 0 ? 0 : ceil(total/pageSize)`。
8. 空结果（无日志或无匹配）→ `items=[]` / `total=0` / `totalPages=0`（不报错，PRD Q11）。

`[约束]` date 桶算法：`operated_at.slice(0, 10)` 直接取 ISO datetime 字符串前 10 字符（`YYYY-MM-DD`），等价于 UTC 自然日截断——因 `operated_at` 为 `z.string().datetime()`（Zod datetime 校验含 UTC 标记 `Z` 或时区偏移，本期 seed 数据均为 `...Z` UTC）；不做时区转换（PRD Q6：UTC 自然日桶）。`[advisory]` 若未来 `operated_at` 含非 UTC 偏移，须在桶前先转 UTC，反向同步 Spec。

`[约束]` count 降序 + 维度值升序 tiebreaker 须稳定可复现（PRD Q8）。impl-writer 须用 `Array.sort` 多级比较器，禁止依赖 Map 插入序（不同 JS 引擎 Map 序虽有规范保障，但多级排序须显式比较器）。

## 4. API 契约（引用，不复制）

所有 schema 与类型定义在 `packages/contracts/src/schemas/{audit,report,role,user}.ts`，错误码 SSOT 在 `user.ts` 的 `errorCodeSchema`。本节仅引用，不复制字段定义（避免 SSOT 漂移）。

### 4.1 新增/修改的 contracts 符号清单

| 符号 | 文件 | 状态 | 标记 | 说明 |
|---|---|---|---|---|
| `changeFieldValueSchema` | audit.ts | 新增 | `[约束]` | ChangeField.value 类型：标量 \| null \| 同类型标量数组（Q18） |
| `changeFieldSchema` | audit.ts | 新增 | `[约束]` | `{field, value, pii}`，`.strict()`（SEC-003a） |
| `ChangeField` / `ChangeFieldValue` | audit.ts | 新增 | `[约束]` | z.infer 派生类型（ARCH-002 / CODE-004） |
| `piiFieldRegistrySchema` | audit.ts | 新增 | `[约束]` | PII 清单 shape SSOT：`record(entityType, set(fieldName))` |
| `PiiFieldRegistry` | audit.ts | 新增 | `[约束]` | z.infer 派生类型 |
| `auditLogSchema.before/after` | audit.ts | 修改 | `[约束]` | `z.record(z.unknown())` → `z.array(changeFieldSchema)`；create→before=[]、delete→after=[]（Q17） |
| `redactedAuditLogSchema.before/after` | audit.ts | 修改 | `[约束]` | 同上，输出 schema 仍 `.strict()`（SEC-003a） |
| `reportGroupByDimSchema` | report.ts | 新增 | `[约束]` | enum: operator_id / entity_type / action / date |
| `reportQuerySchema` | report.ts | 新增 | `[约束]` | group_by 必填非空≤4 去重 + 时间范围 superRefine + pageSize 钳制 |
| `reportAggItemSchema` | report.ts | 新增 | `[约束]` | `{ [dim]: value, count }`，`.strict()` 子段 |
| `reportResultSchema` | report.ts | 新增 | `[约束]` | items + total + page + pageSize + totalPages + group_by 回显，`.strict()`（SEC-003a） |
| `ReportQuery` / `ReportResult` / `ReportAggItem` / `ReportGroupByDim` | report.ts | 新增 | `[约束]` | z.infer 派生类型 |
| `permissionCodeSchema` | role.ts | 修改 | `[约束]` | z.enum 追加 `report:read`（跨域联动，AI-006） |
| `errorCodeSchema` | user.ts | 修改 | `[约束]` | 追加 `REPORT_GROUP_BY_REQUIRED` / `REPORT_TIME_RANGE_INVALID`（跨域联动，AI-006） |
| `index.ts` | index.ts | 修改 | `[约束]` | 追加 `export * from './schemas/report.js'` |

### 4.2 Procedure 表

| Procedure | Method & Path | 入参 schema | 出参 schema | 鉴权 |
|---|---|---|---|---|
| report.query | GET `/v1/reports/audit-operations` | `reportQuerySchema` | `reportResultSchema` | `[约束]` 需 `report:read` |

`[约束]` F1 埋点不设独立 API 端点（沿用 TECH-AUDIT-001 F1 决策）——日志由 `withAudit` wrapper 在写操作 handler 成功后被动旁路写入。
`[约束]` F2 报表查询端点为唯一新增端点；report 领域无 create/update/delete 路由（纯读，PRD §跨域依赖）。
`[约束]` report 领域不扩展 `auditLogEntityTypeSchema` 枚举（entity_type 仍为 user/role/dept，PRD §跨域依赖）。

错误统一回包 `errorResponseSchema`，`code` 取自 `errorCodeSchema`。`[约束]` 入参解析失败的统一码：`VALIDATION_ERROR`（不区分字段）；但 group_by 空 / 时间范围非法的语义校验由 `reportQuerySchema.superRefine` 触发，schema 解析失败 → `VALIDATION_ERROR`（400）。`[advisory]` PRD F2 验收明确"group_by 空 → REPORT_GROUP_BY_REQUIRED"、"时间范围非法 → REPORT_TIME_RANGE_INVALID"——本 Spec 决策：**由 router 层在 schema 解析后做语义判定，对 group_by 空抛 `REPORT_GROUP_BY_REQUIRED`、对时间范围非法抛 `REPORT_TIME_RANGE_INVALID`**（而非统一 `VALIDATION_ERROR`），以满足 PRD 验收的码精确性。impl-writer 须在 router 层用 `schema.safeParse` 后检查 `error.issues` 的 message/path 区分两种语义错误并抛对应码。

> 鉴权说明（`[advisory]` 已知限制，同 TECH-AUDIT-001）：PRD 以 `report:read` 为鉴权原语，但既有 `Ctx.user.role` 仅有 `'admin' | 'user'`。本期 `[advisory]` 采用映射：`ctx.user.role === 'admin'` 视为具备 `report:read`；非 admin → `FORBIDDEN`。procedure 元数据仍按 `report:read` 声明，service 层 `requirePermission('report:read')` 在 admin 桩下放行。"仅 report:read 无其他权限"验收场景待 Auth 富化 Ctx 后补，列入 §Out of scope。

> pageSize 钳制说明（`[约束]`，与 audit 列表查询一致）：`reportQuerySchema.pageSize` 用 `.transform((n) => Math.min(n, 100))` 钳制（非拒绝）；返回结果的 `pageSize` 字段反映钳制后的值。PRD F2 验收"pageSize=200 → 按上限 100 返回"。

## 5. 领域规则

### 5.1 报表聚合 group by 语义（F2）

`[约束]` 维度取值规则：
- `operator_id` → 取日志顶层 `operator_id`（uuid 字符串）。
- `entity_type` → 取日志顶层 `entity_type`（`user` / `role` / `dept`）。
- `action` → 取日志顶层 `action`（`create` / `update` / `delete`）。
- `date` → 取 `operated_at.slice(0, 10)`（UTC 自然日 `YYYY-MM-DD`）。

`[约束]` 多维交叉：`group_by=['operator_id','entity_type']` 时，每项含 `operator_id` + `entity_type` + `count`；同一 operator 的不同 entity_type 为不同行。

`[约束]` 维度值类型（PRD §数据实体草图）：operator_id → uuid 字符串；entity_type → `user|role|dept`；action → `create|update|delete`；date → `YYYY-MM-DD`。聚合维度均为非 PII 字段，仅返回计数，不涉及 PII，无需脱敏（PRD F2 验收末条）。

### 5.2 date 桶算法

`[约束]` UTC 自然日桶：`operated_at.slice(0, 10)`。例：`2026-06-01T23:59:59.000Z` → `2026-06-01`；`2026-06-02T00:00:01.000Z` → `2026-06-02`。不做时区转换（PRD Q6）。

### 5.3 排序规则

`[约束]` 主排序：count 降序。次级 tiebreaker：按 `group_by` 声明顺序，依次以各维度值升序作次级排序键。维度值为字符串，字典序升序（`date` 的 `YYYY-MM-DD` 字典序与日历序一致；`operator_id` uuid 字典序无业务含义但稳定可复现）。
`[约束]` 调用方不可自定义排序（PRD Q8）。

### 5.4 空结果处理

`[约束]` 无审计日志 / 无匹配日志 → `items=[]` / `total=0` / `totalPages=0`，不报错（PRD Q11，与 audit 列表查询空结果约定一致）。

## 6. 边界与异常

| # | 触发条件 | 错误码 | HTTP | 说明 |
|---|---|---|---|---|
| B1 | report 入参不通过 `reportQuerySchema`（page<1、pageSize<1、group_by 含非法维度、operated_from/to 非 datetime、operator_id 非 uuid、entity_type/action 非闭合枚举等） | `VALIDATION_ERROR` | 400 | Zod 解析失败统一此码（含 superRefine 的维度去重 issue，但 group_by 空/时间范围非法单独见 B1'/B1''） |
| B1' | report 入参 `group_by` 为空数组 / 缺省 | `REPORT_GROUP_BY_REQUIRED` | 400 | `[约束]` router 层在 schema 解析后语义判定：group_by 空 → 抛此码（PRD F2 验收）。注：`z.array(...).min(1)` 会在 schema 层拒绝空数组（→ B1 VALIDATION_ERROR），故 impl-writer 须将 group_by 改为 `.optional()` 或在 router 层先判空抛 B1'——见 §6 决策 D10 |
| B1'' | report 入参 `operated_from` 晚于 `operated_to` | `REPORT_TIME_RANGE_INVALID` | 400 | `[约束]` router 层语义判定（PRD F2 验收） |
| B2 | 未携带有效凭证 / 未登录访问 report.query | `UNAUTHORIZED` | 401 | SEC-001 默认受保护 |
| B3 | 已登录但缺少 `report:read` 权限码 | `FORBIDDEN` | 403 | SEC-002 service 层 `requirePermission('report:read')`；admin 桩下非 admin 无报表权限 |
| B4 | `[advisory]` 预留码本期不触发——`AUDIT_LOG_NOT_FOUND`（沿用 TECH-AUDIT-001 B4） | `AUDIT_LOG_NOT_FOUND` | （n/a） | report 不查单条日志，空结果走 §5.4 |
| B5 | F1 埋点环节异常（audit.record 抛错） | （无客户端码） | （主操作仍 200） | `[约束]` best-effort：wrapper 内 try/catch 吞掉，记录内部错误，不抛调用方（PRD Q2）。F1 不引入客户端错误码 |

**决策 D10（`[约束]`）**：为满足 PRD F2 验收"group_by 空 → REPORT_GROUP_BY_REQUIRED"与"时间范围非法 → REPORT_TIME_RANGE_INVALID"的码精确性，`reportQuerySchema.group_by` 改为 `z.array(reportGroupByDimSchema).max(4).optional()`（不在 schema 层用 `.min(1)` 拒绝空），由 router 层在 `safeParse` 后判定：group_by 缺省/空数组 → 抛 `REPORT_GROUP_BY_REQUIRED`；schema superRefine 仅做维度去重 + 时间范围检测，router 层据 `error.issues` 的 message 区分时间范围非法 → 抛 `REPORT_TIME_RANGE_INVALID`，其余 issue → `VALIDATION_ERROR`。`[advisory]` 此为与 audit 列表查询"统一 VALIDATION_ERROR"的有意分歧，依 PRD F2 验收码精确性要求；impl-writer 须在 router 层实现语义判定，service 层不重复判定（service 入口仍 `requirePermission` 后直接聚合）。

`[advisory]` **ReportService.query 校验逻辑提取到私有 `parseAndValidate` 方法（S-4 反向同步）**：实现侧（`apps/api/src/service/report.ts`）将 schema 解析 + 语义判定（B1'/B1''）提取为私有方法 `parseAndValidate(query)`，紧随其后调用 `requireAdmin`（SEC-002）。理由：`scripts/check-rules.mjs` SEC-002 静态扫描的 body 收集 break 条件 `/^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*[:{]/` 会把 `if (...) {` 误判为方法声明并提前截断 body，使位于首个 if 块之后的 `requireAdmin` 落出 body → 误报 SEC-002 违规。提取 `parseAndValidate` 后，`requireAdmin` 紧随 `parseAndValidate(...)` 调用之后、先于任何 `if` 块，扫描通过。根因是 check-rules.mjs SEC-002 break 条件未排除控制流关键字（`if/for/while/switch` 等），属扫描器 bug，建议后续修复扫描器；当前以提取 `parseAndValidate` workaround 规避，本条为反向同步说明（实现侧报告 A-3）。功能等价（校验顺序不变：parseAndValidate → requireAdmin → 聚合），仅结构重组。

**校验顺序（`[约束]` service 层必须遵守，先到先返，不叠加）：**

`[约束]` **report.query（GET /v1/reports/audit-operations）**：B1/B1'/B1''（router Zod 解析 + 语义判定）→ B2/B3（鉴权）→ `auditRepo.listAll(filter)` 取已过滤全量 → 内存 group by + date 桶 → count 降序 + 维度值升序 → 分页切片 → 返回 `reportResultSchema`（200）。
- `[约束]` 空结果返回 `items=[]` + `total=0` + `totalPages=0`（不触发 B4）。
- `[约束]` pageSize 钳制在 schema 层完成（transform），service 直接使用解析后的值；返回的 `pageSize` 字段反映钳制后的值（Q9）。
- `[约束]` report 聚合不缓存（PRD Q12 实时聚合），每次查询现算。

`[约束]` **F1 埋点 best-effort 守卫**：`withAudit` wrapper 内 `try { audit.record(...) } catch { logger.warn(...) }`；主操作已成功返回不受影响。`[约束]` 主操作失败（service 抛 AppError）则 wrapper 不调 `audit.record`（PRD 兼容性：仅成功写操作记录）。

错误码枚举 SSOT：`errorCodeSchema`（`packages/contracts/src/schemas/user.ts`），本轮新增 `REPORT_GROUP_BY_REQUIRED` / `REPORT_TIME_RANGE_INVALID`；report 复用 `VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN`。`[约束]` 新增须同步本表、`errors.ts` `errorCodeToHttpStatus` 与 OpenAPI。

## 7. DB 变更

`[advisory]` 本 MVP repository 用内存实现（数组，append-only for audit；report 无独立 repo），但 DB schema 作为 SSOT 文档产出。本轮无新表（report 无独立存储），仅 audit_logs 表的 `before`/`after` 列语义变化。

**audit_logs 表 before/after 列语义变化（F3）：**

```ts
// 既有（TECH-AUDIT-001）：
//   before: jsonb('before').notNull(),  // Record<string, unknown>，create 时 {}
//   after:  jsonb('after').notNull(),   // Record<string, unknown>，delete 时 {}

// 本轮升级（TECH-AUDIT-ENHANCEMENT-001）：
//   before: jsonb('before').notNull(),  // ChangeField[]，create 时 []
//   after:  jsonb('after').notNull(),   // ChangeField[]，delete 时 []
//   // 列类型仍为 jsonb（承载 JSON 数组），仅 JSON 文档形状从 object 升级为 array<ChangeField>
```

`[约束]` 列类型不变（jsonb），仅 JSON 文档形状变化：`object` → `array<{field, value, pii}>`。落地真实 DB 时须编写数据迁移脚本将既有 `z.record` 格式日志转为 `ChangeField[]`（本期内存实现重启即清空，无生产迁移成本，PRD Q16 一刀切）。
`[约束]` `pii` 字段为字段级布尔标记，存储保留（存储态含 `pii: true/false`），查询返回时 service 据 `pii` 标记套用 `redactEmail`（D7）。存储态 `pii` 不可省略（避免查询时再查 registry，性能 + 一致性）。
`[advisory]` 落地真实 DB 时 report 聚合可下推为 SQL `GROUP BY` + `DATE_TRUNC('day', operated_at AT TIME ZONE 'UTC')`；本期内存实现，SQL 下推为未来性能优化项。

## 8. 受影响测试清单（AI-006 · 本轮必须章节）

本节依 AI-006 规则，基于对 `apps/api/test/**/*.ts` 的真实 grep 扫描产出。本轮对 `packages/contracts` 的联动改动为四个符号：
1. `auditLogSchema` / `redactedAuditLogSchema` 的 `before`/`after` 改型（audit.ts）—— 影响 audit.test.ts 大量断言。
2. `permissionCodeSchema` 追加 `report:read`（role.ts）—— 影响 role.test.ts / dept.test.ts / audit.test.ts。
3. `errorCodeSchema` 追加 `REPORT_GROUP_BY_REQUIRED` / `REPORT_TIME_RANGE_INVALID`（user.ts）—— 影响所有引用 `ErrorCode` 的测试。
4. 新增 `reportQuerySchema` / `reportResultSchema` 等（report.ts）—— 新增 report.test.ts（非受影响，由 test-writer 另行产出）。

**grep 命令与命中（真实执行结果）：**
- `Grep 'auditLogSchema|redactedAuditLogSchema|auditLogListResultSchema' apps/api/test` → 命中 `test/audit.test.ts`（1 文件）。
- `Grep 'permissionCodeSchema|ALL_PERMISSION_CODES' apps/api/test` → 命中 `test/audit.test.ts`、`test/role.test.ts`、`test/dept.test.ts`（3 文件）。
- `Grep 'errorCodeSchema|errorResponseSchema' apps/api/test` → 0 命中（测试均用 `type ErrorCode` 类型级引用，未直接引用 schema）。
- `Grep 'ErrorCode' apps/api/test` → 命中 `test/user.test.ts`、`test/role.test.ts`、`test/dept.test.ts`、`test/audit.test.ts`（4 文件，均为 `type ErrorCode` + `expectAppError(promise, code: ErrorCode)` helper 形参）。
- `Grep 'before: \{\}|after: \{\}|before: \{|after: \{' apps/api/test/audit.test.ts` → 命中 ~30 处 `z.record` 形态字面量（详见下表）。

### 8.1 audit.test.ts（重影响 — before/after 结构迁移 + permissionCode 扩展）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L31-35 | `import { auditLogSchema, auditLogListResultSchema, redactedAuditLogSchema }` | schema 形状改型 | **类型对齐**：导入仍合法（schema 名不变），但 `AuditLog.before/after` 类型从 `Record<string, unknown>` 变为 `ChangeField[]`，下游所有访问须改 |
| L38 | `import { permissionCodeSchema }` | 枚举扩展 | **数据补齐**（可选）：L467-469 断言 `toContain('audit:read')`，可补 `toContain('report:read')`（advisory，非必须） |
| L71-85 | `makeLog` 工厂：`before: {}`, `after: { email: 'abcdef@example.com', name: 'user${i}' }` | **z.record 形态 → ChangeField[] 形态** | **数据补齐**：改为 `before: []`, `after: markPii('user', [{field:'email',value:'abcdef@example.com',pii:false},{field:'name',value:`user${i}`,pii:false},{field:'status',value:'active',pii:false}])`（markPii 标 email 为 pii=true） |
| L80-81 | `before: {}`, `after: { email: ..., name: ... }` | 同上 | **数据补齐**：改为 `[]` / `ChangeField[]` |
| L340-341 | `auditLogSchema` 合法样本：`before: {}`, `after: { email: 'abcdef@example.com' }` | z.record → ChangeField[] | **数据补齐**：改为 `before: []`, `after: [{field:'email',value:'abcdef@example.com',pii:true}]` |
| L356-357 | `auditLogSchema.strict` 拒绝多余字段样本：`before: {}`, `after: { email: 'ab***@example.com' }` | z.record → ChangeField[] | **数据补齐**：改为 `[]` / `[{field:'email',value:'ab***@example.com',pii:true}]`（多余字段 `secret` 仍被 .strict() 拒绝，断言不变） |
| L376-382 | `result.items[0]!.after.email as string` + `redactedEmailSchema.safeParse(email)` | ChangeField[] 访问方式变化 | **类型对齐**：改为 `const emailField = result.items[0]!.after.find(f => f.field==='email')!; expect(emailField.value).toBe('ab***@example.com')` |
| L467-469 | `expect([...permissionCodeSchema.options]).toContain('audit:read')` | 枚举扩展（加 report:read） | **无需改**（SSOT 派生，仍含 audit:read）；advisory 可补 `toContain('report:read')` |
| L486-487, L496-497 | `service.record({...before:{}, after:{email:...,name:'u1'}})` + `expect(log.before).toEqual({})` + `expect(log.after.email).toBe('abcdef@example.com')` | z.record → ChangeField[] | **数据补齐**：record 入参 before/after 改为 `[]` / `ChangeField[]`；断言改为 `expect(log.before).toEqual([])` + `expect(log.after.find(f=>f.field==='email')?.value).toBe('abcdef@example.com')` |
| L510-511, L518-519 | 同上（record 后 list 查回脱敏） | 同上 | **数据补齐 + 类型对齐**：before=[] / after=ChangeField[]；`expect(result.items[0]!.before).toEqual([])`；`expect(result.items[0]!.after.find(f=>f.field==='email')?.value).toBe('ab***@example.com')` |
| L532-533, L540-541 | delete 日志：`before: {name:'role-x'}`, `after: {}` + `expect(after).toEqual({})` + `expect(before.name).toBe('role-x')` | z.record → ChangeField[] | **数据补齐 + 类型对齐**：before=`[{field:'name',value:'role-x',pii:false}]` / after=[]；`expect(result.items[0]!.after).toEqual([])`；`expect(result.items[0]!.before.find(f=>f.field==='name')?.value).toBe('role-x')` |
| L554-555, L567-568 | 多次 record：`before:{}`, `after:{name:'u1'}` / `after:{name:'u2'}` | 同上 | **数据补齐**：before=[] / after=`[{field:'name',value:'u1',pii:false}]` |
| L675 | `auditRepo.insert(makeLog(1, { after: { email: 'abcdef@example.com', name: 'u1' } }))` | 同上 | **数据补齐**：after=`[{field:'email',value:...,pii:true},{field:'name',value:'u1',pii:false}]` |
| L684-685, L690-691 | update 脱敏：`before:{email:'abcdef@...',name:'old'}`, `after:{email:'new@...',name:'new'}` + `expect(before.email).toBe('ab***@example.com')` + `expect(after.email).toBe('ne***@example.com')` | z.record → ChangeField[]；脱敏仍由 service 按 pii 标记套 redactEmail | **数据补齐 + 类型对齐**：before/after 改为 ChangeField[]（email 项 pii=true）；断言改为 `.find(f=>f.field==='email')?.value` |
| L697, L700-701 | `after:{email:...,name:'u1',status:'active'}` + `expect(after.name).toBe('u1')` + `expect(after.status).toBe('active')` | 同上 | **数据补齐 + 类型对齐** |
| L706-708, L712 | 多条日志邮箱脱敏：`after:{email:'a1@example.com'}` 等 + `const email = l.after.email as string` | 同上 | **数据补齐 + 类型对齐**：访问改为 `.find(f=>f.field==='email')?.value` |
| L776, L778 | `auditLogListResultSchema.parse(result)` 断言不抛 | items 元素形状变化（redactedAuditLogSchema.before/after 改型） | **数据补齐**：makeLog 工厂已改型后，parse 仍通过（schema 自洽）；断言本身不变 |
| L783-788 | `result.items[0]!.after as {email?:string;name?:string}` + `expect(after.email).toBe('ab***@example.com')` | ChangeField[] 访问 | **类型对齐**：改为 `.find(f=>f.field==='email')?.value` |
| L794, L796-797, L801-804 | update 双脱敏：`before:{email:'old@example.com'}`, `after:{email:'new@example.com'}` + `expect(before.email).toBe('ol***@example.com')` | 同上 | **数据补齐 + 类型对齐** |
| L810, L813-815 | `after:{email:...,name:'u1',status:'active'}` + `expect(after.name).toBe('u1')` + `expect(after.status).toBe('active')` | 同上 | **数据补齐 + 类型对齐** |
| L928-929, L949-950, L973-974 | 状态机闭环：record(create) `before:{}`, `after:{email:...}` / `after:{name:'u${i}'}` | 同上 | **数据补齐** |
| L956, L959 | `stored.after as {email:string}` + `expect(...email).toBe('abcdef@example.com')` + `expect(...email).toBe('ab***@example.com')` | ChangeField[] 访问 | **类型对齐** |
| L996-997, L1003-1004 | delete 闭环：`before:{name:'role-x',permission_codes:['user:read']}`, `after:{}` + `expect(after).toEqual({})` + `expect(before as {name:string}).name).toBe('role-x')` | z.record → ChangeField[]；permission_codes 为 string[]（Q18 允许） | **数据补齐 + 类型对齐**：before=`[{field:'name',value:'role-x',pii:false},{field:'permission_codes',value:['user:read'],pii:false}]` / after=[]；断言改 `.find(f=>f.field==='name')?.value` |

**audit.test.ts 小结**：~30 处断言需同步更新（数据补齐 + 类型对齐），无 SSOT 派生改造（无硬编码权限码/错误码全集断言）。L467-469 的 `toContain('audit:read')` 不被 `report:read` 扩展破坏。

### 8.2 role.test.ts（permissionCode 扩展 — 零改动）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L21 | `import { permissionCodeSchema }` | 枚举扩展 | **无需改**（导入合法） |
| L36 | `import { ALL_PERMISSION_CODES }` | 派生自 permissionCodeSchema | **无需改**（派生自动跟随） |
| L129-131 | `expect(ALL_PERMISSION_CODES).toEqual([...permissionCodeSchema.options])` | **已 SSOT 派生** | **零改动**：枚举追加 `report:read` 后，两侧均自动含新码，断言自动跟随（AI-005 价值） |
| L141 | `expect(admin.permission_codes).toEqual(ALL_PERMISSION_CODES)`（admin seed 用 `[...ALL_PERMISSION_CODES]`，repository/role.ts L42） | **已 SSOT 派生** | **零改动**：admin seed 自动含 `report:read`；impl-writer 仅须验证 seed 行覆盖新码（自动覆盖） |
| L309-313 | `permissionCodeSchema.safeParse('foo:bar')` 拒绝 / `safeParse('role:write')` 通过 | 枚举扩展 | **无需改**：测试既有码，`report:read` 加入不影响；advisory 可补 `safeParse('report:read')` 通过断言（非必须） |

### 8.3 dept.test.ts（permissionCode 扩展 — 零改动）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L45 | `import { permissionCodeSchema }` | 枚举扩展 | **无需改** |
| L47 | `import { type ErrorCode }` | 类型级引用 | **无需改**：`REPORT_*` 加入 ErrorCode 联合类型不破坏既有类型引用 |
| L122 | `expectAppError(promise, code: ErrorCode)` helper | 类型级引用 | **无需改**（类型级） |
| L482-490 | `permissionCodeSchema.safeParse('dept:read'/'dept:write')` 通过 / `'foo:bar'` 拒绝 | 枚举扩展 | **无需改**：测试 dept 码，`report:read` 加入不影响 |

### 8.4 user.test.ts（errorCode 扩展 — 零改动）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L14 | `import { type ErrorCode }` | 类型级引用 | **无需改**：`REPORT_*` 加入不破坏类型兼容 |
| L79 | `expectAppError(promise, code: ErrorCode)` helper | 类型级引用 | **无需改**（类型级） |

### 8.5 清单结论（AI-006 + AI-005 交叉验证）

- `[约束]` **audit.test.ts** 为本轮重影响文件：~30 处断言需同步更新（before/after 从 `z.record` 形态迁移为 `ChangeField[]` 形态，访问方式从 `obj.field` 改为 `arr.find(f=>f.field===...)?.value`）。test-writer 须遵循 AI-002（impl-writer 禁改测试断言，仅可改 setup/import 路径并注明理由）。
- `[约束]` **role.test.ts / dept.test.ts / user.test.ts** 所有引用 `permissionCodeSchema` / `ErrorCode` 的断言**均已用 SSOT 派生或类型级引用**，追加 `report:read` / `REPORT_*` 后**零测试改动**——AI-005 价值：枚举扩展不击穿既有测试。
- `[约束]` **未发现硬编码跨域可变集合断言**（AI-005 抓取点）：`apps/api/test/**/*.ts` 中无 `.toEqual([...])` / `.toStrictEqual([...])` 后紧跟 ≥3 个权限码或错误码字面量的断言。audit.test.ts L468 的 `toContain('audit:read')` 为单元素 `toContain`，不触发 AI-005（≥3 阈值）。
- `[advisory]` 新增 `apps/api/test/report.test.ts`（覆盖本 Spec §测试矩阵 report 类）由 test-writer 另行产出，非本任务范围；test-writer 须遵循 AI-005：对 report 相关断言一律 SSOT 派生（如 `expect(result.group_by).toEqual([...reportGroupByDimSchema.options])` 仅当测试全维度时，否则按入参 group_by 断言）。
- `[约束]` **待 impl-writer 联动（非测试文件，记此以闭环）**：
  - `apps/api/src/errors.ts` L19：`errorCodeToHttpStatus: Record<ErrorCode, number>` 须补 `REPORT_GROUP_BY_REQUIRED: 400` / `REPORT_TIME_RANGE_INVALID: 400`，否则 `tsc` 报 TS2741。
  - `apps/api/src/domain/role.ts` L23：`ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 已 SSOT 派生，`report:read` 自动覆盖，无需手改。
  - `apps/api/src/service/audit.ts`：移除 `EMAIL_LIKE_RE` 常量与 `redactSnapshot` 运行时正则兜底（D7）。
  - `apps/api/src/service/{user,role,dept}.ts`：写操作返回签名扩展为 `{entity, changes}`（D3）。

## 9. 校验方式（META-001 / META-003 / META-004 合规标注）

本 Spec 不新增 `.trae/rules/**` 规则文件，亦不新增 `scripts/check-rules.mjs` 的 enforcement 分支。所有规则复用既有，每条实现性规则的校验落点如下（META-001：须含机器校验关键词；META-003：声称 check-rules.mjs 专属分支的须真有；META-004：脚本有分支的须有规则文档）：

| 规则 | 校验方式 | 落点 | META 合规 |
|---|---|---|---|
| ARCH-001（service 不 import router / audit service） | `scripts/check-rules.mjs` ARCH-001 分支按目录分层扫描 import；本期 service/user.ts、role.ts、dept.ts 不得 `import { AuditLogService }` | check-rules.mjs 既有 `markEnforcement('ARCH-001')` 分支 | META-003 ✅（脚本有分支）/ META-004 ✅（规则文档有 ARCH-001 块） |
| ARCH-002（contracts 纯净，只导出 schema 与类型） | `scripts/check-rules.mjs` ARCH-002 分支扫描 contracts 内 import；`PII_FIELD_REGISTRY` 数据放 domain 而非 contracts | check-rules.mjs 既有 `markEnforcement('ARCH-002')` 分支 | META-003 ✅ / META-004 ✅ |
| CODE-004（Zod schema 须 Schema 后缀） | `scripts/check-rules.mjs` CODE-004 分支正则扫描 `export const X = z.(object\|enum\|...)`；新增 `changeFieldSchema` / `changeFieldValueSchema` / `piiFieldRegistrySchema` / `reportGroupByDimSchema` / `reportQuerySchema` / `reportResultSchema` / `reportAggItemSchema` 均带 Schema 后缀 | check-rules.mjs 既有 `markEnforcement('CODE-004')` 分支 | META-003 ✅ / META-004 ✅ |
| SEC-001（procedure 须声明 auth 元数据） | `scripts/check-rules.mjs` SEC-001 分支扫描 router 下 procedure 对象缺 `auth:` 字段；report.router.ts 的 `query` procedure 须含 `auth: 'admin'` | check-rules.mjs 既有 `markEnforcement('SEC-001')` 分支 | META-003 ✅ / META-004 ✅ |
| SEC-002（service public 方法须调 requireAdmin/requirePermission） | `scripts/check-rules.mjs` SEC-002 分支扫描 service 方法体含 `requireAdmin\|requirePermission`；`ReportService.query` 须调 `requirePermission('report:read')` | check-rules.mjs 既有 `markEnforcement('SEC-002')` 分支 | META-003 ✅ / META-004 ✅ |
| SEC-003a（输出 schema 须 .strict()） | `scripts/check-rules.mjs` SEC-003a 分支扫描 contracts 输出 schema（名含 Result/Response）带 `.strict()`；`reportResultSchema` 须 `.strict()` | check-rules.mjs 既有 `markEnforcement('SEC-003a')` 分支（warning 级，不阻断） | META-003 ✅ / META-004 ✅ |
| SEC-003b（PII 脱敏） | 契约测断言 `redactedAuditLogSchema.parse(service.list(...))` 通过 + email 项 value 可被 `redactedEmailSchema` 解析；service 按 `pii` 标记套 `redactEmail`（D7） | 契约测（vitest）+ Reviewer subagent 人工审查 | 无声称 check-rules.mjs 专属分支（不触发 META-003）；META-001 ✅（含机器校验关键词：契约测/vitest） |
| CODE-002（禁止空 catch） | `scripts/check-rules.mjs` CODE-002 分支扫描空 catch 与仅 console catch；`withAudit` wrapper 的 catch 须含 `console.warn` 或 logger 调用 | check-rules.mjs 既有 `markEnforcement('CODE-002')` 分支 | META-003 ✅ / META-004 ✅ |
| AI-005（禁止硬编码跨域可变集合断言） | `scripts/check-rules.mjs` AI-005 分支扫描测试文件 `.toEqual([...])` 后紧跟 ≥3 个枚举字面量；本期 report.test.ts 须 SSOT 派生 | check-rules.mjs 既有 `markEnforcement('AI-005')` 分支（warning 级） | META-003 ✅ / META-004 ✅ |
| AI-006（Tech Lead 须产出受影响测试清单） | Reviewer subagent 检查 Tech-Spec 是否含"受影响测试清单"章节（contracts 有联动改动时）；本 Spec §8 即此章节 | Reviewer subagent 流程（脚本无专属分支，AI-006 规则文档明确"脚本无专属 enforcement 分支，由 Reviewer 流程校验（不触发 META-003）"） | META-003 ✅（未声称专属分支）/ META-001 ✅（含机器校验关键词：Reviewer subagent） |
| AI-001（先读 Spec 再写码） | Reviewer subagent 扫描 diff 新增导出符号与 `docs/spec/*.tech.md` + contracts 比对 | Reviewer subagent 流程（脚本无专属分支） | META-003 ✅ / META-001 ✅ |
| AI-002（测试先行 + tsc 自检） | 编排者实跑 `vitest run` 收集断言级红 + `git diff` 检查 impl-writer 未改测试断言；test-writer 交付附 tsc 自检 | CI（vitest）+ 编排者 git diff | META-003 ✅（未声称专属分支）/ META-001 ✅（含 vitest/git diff 关键词） |
| AI-003（禁止越界发挥） | Reviewer subagent 扫描 diff 新增导出符号在 docs/spec + contracts 有来源；advisory 偏离检查 PR 描述含"反向同步 Spec" | Reviewer subagent 流程 | META-003 ✅ / META-001 ✅ |
| AI-004（每次改动必跑三件套） | CI 执行 `tsc --noEmit` + `node scripts/check-rules.mjs`（整体脚本）+ `vitest run`；本地 pre-commit hook 同步 | CI 整体（AI-004 规则文档明确"AI-004 本身无 check-rules.mjs 专属 enforcement，其必跑三件套由 CI 整体执行保障（不触发 META-003）"） | META-003 ✅ / META-001 ✅ |

**META 合规自检结论**：
- `[约束]` 本 Spec 不声称任何新的 check-rules.mjs 专属分支（不触发 META-003 声明漂移）。
- `[约束]` 本 Spec 引用的所有 check-rules.mjs 既有分支（ARCH-001/002、CODE-002/004、SEC-001/002/003a、AI-005）均有对应规则文档块（不触发 META-004 反向缺口）。
- `[约束]` 本 Spec 每条实现性规则的"校验方式"均含机器校验关键词（check-rules.mjs / tsc / vitest / CI / Reviewer subagent / 契约测），满足 META-001。

## 10. 测试矩阵（六类，本轮新增 report 类）

| 用例类型 | 覆盖点 |
|---|---|
| 单测 | `[约束]` domain/audit.ts：`PII_FIELD_REGISTRY` 经 `piiFieldRegistrySchema.parse` 校验通过；`markPii('user', [{field:'email',value:'x',pii:false},{field:'name',value:'y',pii:false}])` → email 项 pii=true、name 项 pii=false；`markPii('role', [...])` → 全部 pii=false（role 本期无 PII）。`redactEmail` 既有断言保留。 |
| 单测 | `[约束]` repository/audit.ts：`listAll(filter)` 按过滤条件返回全量（无分页），与 `list(opts)` 过滤逻辑一致；append-only 守卫不变（无 update/delete 方法）。 |
| 单测 | `[约束]` service/audit.ts：`redactLog` 遍历 `ChangeField[]`，对 `pii===true` 且 value 为 string 的项套 `redactEmail`；`pii===false` 或 value 非 string 原样返回；移除 `EMAIL_LIKE_RE` 后，未标记 pii 但值像邮箱的字段原样返回（PRD F3 验收：信任标记不兜底）。 |
| 单测 | `[约束]` service/report.ts：聚合算法 D9——单维 group_by=[entity_type] → 按 entity_type 计数；多维 [operator_id,entity_type] → 交叉聚合；date 维度按 UTC 自然日桶；count 降序 + 维度值升序 tiebreaker；空结果 items=[]/total=0/totalPages=0；pageSize=200 钳制为 100。 |
| 契约测 | `[约束]` 入参 `reportQuerySchema` safeParse：group_by 空数组（若 D10 改 optional）→ superRefine 不拒但 router 抛 REPORT_GROUP_BY_REQUIRED；group_by 含非法维度 → VALIDATION_ERROR；group_by 重复维度 → superRefine 拒绝；operated_from 晚于 operated_to → router 抛 REPORT_TIME_RANGE_INVALID；pageSize=200 通过（钳制为 100）；合法样本通过。 |
| 契约测 | `[约束]` 出参 `reportResultSchema`（.strict 拒绝多余字段）；`reportAggItemSchema` 含 count + 各 group_by 维度键；`changeFieldSchema` 合法样本通过、缺 pii 拒绝、value 为对象拒绝（Q18）；`auditLogSchema` 改型后 before=[]/after=ChangeField[] 通过。 |
| 边界 | `[约束]` F1：8 个写操作（user.create/updateStatus、role.create/delete/assign/remove、dept.create/delete/assignUserDepartment）成功后自动生成日志（entity_type/action/before/after 符合 PRD 验收）；主操作失败（邮箱重复/角色不存在等）→ 不生成日志；读操作 → 不生成日志；埋点异常（mock audit.record 抛错）→ 主操作仍成功返回（best-effort）。 |
| 边界 | `[约束]` F2：25 条 user create + 10 条 role create → group_by=[entity_type] 返回 items=[{entity_type:user,count:25},{entity_type:role,count:10}]（count 降序）；group_by=[operator_id,entity_type] 多维交叉；group_by=[date]+operated_from/to 按日桶；group_by=[entity_type]+operator_id=O1 过滤；第 2 页分页；空库 items=[]/total=0；pageSize=200 钳制 100；结果不含 PII。 |
| 边界 | `[约束]` F3：user.create 日志 after 为 ChangeField[]，email 项 pii=true、name/status 项 pii=false；含 email 变更的 update 日志 before/after 中 email 项 value 均脱敏；role.create 日志 after 含 permission_codes 项 value=string[]、pii=false；create → before=[]；delete → after=[]；未标记 pii 但值像邮箱 → 原样返回（不兜底）。 |
| 边界 | `[约束]` F4 append-only：repository 无 update/delete 方法；router 无 PUT/PATCH/DELETE /v1/audit-logs 与 /v1/reports/audit-operations 路由。 |
| 权限 | `[约束]` B2：未登录调 report.query → UNAUTHORIZED；B3：非 admin 调 report.query → FORBIDDEN。 |
| 权限 | `[约束]` SEC-003a：report.query 响应仅含 `reportResultSchema` 字段，.strict() 拒绝多余；SEC-003b：report 聚合维度均为非 PII，不涉及脱敏。 |
| 状态机 | `[约束]` F1 旁路闭环：主操作成功 → 日志写入（含正确 changes）；主操作失败 → 不写入；多次写操作 → 多条日志按 operated_at 倒序可查；report 聚合这些日志 → count 准确。 |

## 11. 迁移与回滚

- 契约层：`[约束]` 本期为对 audit.ts 的破坏性改型（before/after 元素类型从 `z.record(z.unknown())` 改为 `z.array(changeFieldSchema)`）+ role.ts/user.ts 的枚举扩展（加性）+ 新增 report.ts（加性）。破坏性变更需新版本号并在 PRD 登记；既有 audit.test.ts 须同步迁移（§8.1）。
- DB：见 §7，audit_logs.before/after 列类型不变（jsonb），仅 JSON 文档形状变化；落地真实 DB 须编写数据迁移脚本（本期内存实现无生产迁移）。
- 数据：`[约束]` 内存 repository 重启即清空，无内置 audit seed；既有第四轮 z.record 格式日志一刀切迁移为 ChangeField[]（PRD Q16，无双格式共存）。
- 内置 admin 权限范围：`[约束]` admin 的 `permission_codes` 须等于 `permissionCodeSchema` 枚举全集（Q4），扩展 `report:read` 后由 `ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 自动覆盖。
- 回滚策略：`[约束]` 契约/DB/OpenAPI/errorCodeSchema 任一回滚需四处同步回滚，保持一致。
- `[advisory]` 既有 OpenAPI 片段同步：user/role/dept.openapi.yaml 的 `PermissionCode` 枚举须同步追加 `report:read`，`ErrorCode` 枚举须同步追加 `REPORT_GROUP_BY_REQUIRED` / `REPORT_TIME_RANGE_INVALID`；audit.openapi.yaml 的 `AuditLog.before/after` 须改为 `array<ChangeField>`。本轮为控制改动面未顺带更新既有 OpenAPI 片段，记为遗留同步项（待 impl-writer / 文档维护者处理）。

## 12. Out of scope

- **按 action 过滤 audit 列表查询**：沿用 TECH-AUDIT-001 Q5 OPEN，本期 audit 列表仍仅时间范围/操作者/实体类型三维过滤；report 查询支持 action 过滤（report 是聚合统计，action 既可作 group_by 维度也可作过滤项）。`[约束]`
- **90 天保留期清理任务**：沿用 TECH-AUDIT-001 Q6 OPEN，本期仅记录 `created_at` 供后续清理任务使用。`[约束]`
- **未脱敏返回入口**：沿用 TECH-AUDIT-001 Q2，本期查询入口仅返回脱敏值；存储保留原值以备深度审计。`[advisory]`
- **report:read 端到端鉴权**：`[advisory]` 受限于既有 `Ctx`（admin|user）鉴权桩，本期 admin 视为全权限；"仅 report:read 管理员"验收待 Auth 模块富化 Ctx 后补，列入遗留风险。
- **报表缓存**：`[约束]` PRD Q12 决策本期实时聚合不缓存；缓存引入失效/一致性复杂度，留待性能需求驱动时迭代。
- **报表 SQL 下推**：`[advisory]` 本期内存实现，report 聚合在 service 层；落地真实 DB 时可下推 SQL GROUP BY + DATE_TRUNC，留待性能优化。
- **周/月/小时桶**：`[约束]` PRD Q6 决策本期 date 桶粒度固定为"日"，不支持周/月/小时桶。
- **PII 清单扩展至 role/dept**：`[约束]` 本期 PII 清单仅 `{(user, email)}`；role/dept 本期无 PII 字段。新增 PII 字段须扩展 `PII_FIELD_REGISTRY` + 对应领域 PRD（AI-005 SSOT 派生）。
- **既有 OpenAPI 片段同步**：`[advisory]` user/role/dept/audit.openapi.yaml 的枚举与 before/after 形状须同步，本轮未顺带更新，记为遗留同步项。
- **真实 DB 接入**：`[advisory]` 本 MVP repository 内存实现，DB schema 仅作文档 SSOT（见 §7）。

## 13. 自检与遗留

- `[约束]` 自检（沿用 TECH-AUDIT-001 8 项 + 本轮新增）：
  - contracts tsc：本任务完成后须 0 错误（含新增 report.ts + 联动编辑的 audit.ts/role.ts/user.ts/index.ts）。
  - apps/api tsc：本任务完成后须 0 错误——`errors.ts` `errorCodeToHttpStatus` 须补 `REPORT_GROUP_BY_REQUIRED: 400` / `REPORT_TIME_RANGE_INVALID: 400`（impl-writer 联动）。
  - `node scripts/check-rules.mjs`：通过（ARCH-001/002、CODE-002/004、SEC-001/002/003a、AI-005、META-001/003/004 全绿，0 error）。
  - OpenAPI 与 Zod 1:1：`api-spec/report.openapi.yaml` 字段/类型/枚举/必填/`.strict()` 与 report.ts 对齐；`api-spec/audit.openapi.yaml` 的 before/after 改为 `array<ChangeField>`。
  - 边界每条有错误码且在 errorCodeSchema：B1 VALIDATION_ERROR / B1' REPORT_GROUP_BY_REQUIRED / B1'' REPORT_TIME_RANGE_INVALID / B2 UNAUTHORIZED / B3 FORBIDDEN / B4 AUDIT_LOG_NOT_FOUND（预留）/ B5 无客户端码（best-effort）均在校举或明确标注。
  - 实现性描述均有 `[约束]`/`[advisory]` 标记。
  - 跨域联动改动已列出（§2 + §4.1 + §8）。
  - 受影响测试清单章节存在且基于真实 grep 结果（§8，AI-006）。
  - 校验方式标注完整（§9，META-001/003/004 合规）。
- `[advisory]` 遗留风险：
  1. report:read 端到端鉴权待 Auth 富化 Ctx（同 audit:read 遗留）。
  2. 既有 OpenAPI 片段（user/role/dept）ErrorCode/PermissionCode 枚举 + audit.openapi.yaml before/after 形状待同步。
  3. errors.ts Record 补码待 impl-writer（TS2741）。
  4. 三域 service 写操作签名扩展 + withAudit wrapper 待 impl-writer（本任务为 Tech-Spec + contracts，不改 apps/api 业务逻辑）。
  5. operator_name 解析待 impl-writer 在 wrapper 内从 userRepo 读（MVP 桩下 admin 可硬编码 'admin'，advisory 须反向同步 Spec）。
  6. `redactEmail` 对 local 部分不足 2 字符的邮箱为边缘场景（原样返回，沿用 TECH-AUDIT-001 advisory）。
  7. `z.set` 在 Zod v3 部分版本可用性，若不可用降级为 `z.array` + `new Set` 转换（advisory D6）。
