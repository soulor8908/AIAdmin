---
doc_type: Tech-Spec
id: TECH-NOTIFICATION-001
prd_ref: PRD-NOTIFICATION-001
status: draft
owner: dev@team
created: 2026-07-02
extends: TECH-AUDIT-ENHANCEMENT-001
---
# 通知管理 · 技术规格（CRUD + 状态机 + 跨域埋点 + 跨 service 收件人校验）

> 标记约定（沿用 TECH-AUDIT-001 / TECH-DEPT-001 / TECH-AUDIT-ENHANCEMENT-001）：
> - `[约束]` = Dev 必须遵守（字段集 / 错误码 / 状态机 / 权限 / 校验顺序 / 架构边界）。
> - `[advisory]` = Dev 可偏离，但须在 PR 描述中"反向同步 Spec"（写明偏离点与理由）。
> 每条实现性描述均显式标注其一；未标注的为纯说明性文字（引用、引用指向）。
>
> META 提示：本 Spec 对 `scripts/check-rules.mjs` 的既有 SEC-002 分支做一处**最小增强**（新增"声明免 requireAdmin"豁免标记识别，落在既有 `markEnforcement('SEC-002')` 循环内部，非新增 markEnforcement 分支），并在对应规则文档补一段豁免标记说明。该增强为 markRead 收件人自服务语义的必要支撑（详见 §3.3），不触发 META-003（未声称新分支）；规则文档同步更新满足 META-004。其余规则全部复用既有，不新增 `.trae/rules/**` 规则文件。

## 1. 概览与范围

本 Spec 落地 PRD-NOTIFICATION-001 三个功能点 + 三处跨域契约联动 + 一处既有 service 签名变更，同时作为第六轮三项优化点的验证载体：

- **F1 通知 CRUD + 状态机**：通知含 `draft`/`sent`/`read` 三态；合法转移仅 `draft→sent`（send）与 `sent→read`（markRead，收件人自服务）；非法转移（跳过/同态/回退）与状态守卫操作违规统一 → `NOTIFICATION_INVALID_TRANSITION`；`sent`/`read` append-only（不可改不可删）。`[约束]`
- **F2 发送 + 审计埋点联动**：5 类写操作（create/update/send/markRead/delete）经第五轮 `withAudit` HOF 包装，best-effort 旁路记日志，`entity_type=notification`；读操作不埋点；主操作失败不埋点；埋点失败不影响主操作。`[约束]`
- **F3 收件人校验**：send 时校验收件人存在且 `status=active`，依赖既有 `UserService` 新增 public 方法 `findByIds(ids): User[]`；不存在 → `NOTIFICATION_RECIPIENT_NOT_FOUND`；禁用 → `NOTIFICATION_RECIPIENT_DISABLED`。draft 创建时仅做 recipient_id 的 uuid 格式校验，存在性校验延后至 send。`[约束]`

**本轮核心验证目标**（Tech Lead 须在 Spec 中体现，反推自 RETRO-ROUND5-001）：
1. **AI-006 增强（两类标注，本轮同时触发）**：
   - ①类·contracts 联动驱动：扩展 `permissionCodeSchema`（加 `notification:read`/`notification:write`）、`errorCodeSchema`（加 4 个 `NOTIFICATION_*`）、`auditLogEntityTypeSchema`（加 `notification`）→ grep 引用这三个符号的 `apps/api/test/**/*.ts`，列出受影响断言点。
   - ②类·apps/api 内部签名变更驱动：`UserService` 新增 `findByIds(ids): User[]`（既有 service public 方法签名变更）→ grep `apps/api/test/**/*.ts` 中消费 `UserService` 的断言点，显式分析 `findByIds` 新增是否击穿既有断言。
   - 两类清单见 §8，基于真实 grep，分两类标注（AI-006 增强硬要求）。
2. **AI-007 端到端验收**：F2 埋点 8 条 + F3 跨 service 5 条须端到端测试（注入共享 `AuditLogRepository`/`UserService` 观测旁路副作用与跨 service 调用），见 §9。
3. **SEC-002 bug 修复验证**：第五轮 SEC-002 扫描器方法识别正则 bug（`if(...)` 误判为方法声明截断 body）已修复（break 条件加 KW 排除）；notification service 含 `requireAdmin` 守卫的 admin 方法（create/update/send/delete）带 `if` 块不再被误报。markRead 为收件人自服务不调 requireAdmin，本轮以"声明免 requireAdmin 豁免标记"方案处理（见 §3.3），验证 bug 修复后 markRead 不被误报。

**本轮架构探索主题**（PRD §跨域依赖）：
1. 跨 service 依赖新模式（NotificationService 注入 UserService，既有服务均注入 repository）—— §3.1 决策。
2. 通知状态机层归属（domain 纯函数，参考 user 域模式）—— §3.2 决策。
3. markRead 收件人自服务权限例外与 SEC-002 豁免机制 —— §3.3 决策。

## 2. 影响的模块

- `packages/contracts/src/schemas/notification.ts`（本期新增，F1/F2/F3 契约 SSOT）：`notificationStatusSchema` / `notificationSchema` / `createNotificationInputSchema` / `updateNotificationInputSchema` / `notificationTransitionSchema` / `listNotificationQuerySchema` / `notificationListResultSchema`。`[约束]` 所有类型经 `z.infer` 派生（ARCH-002 / CODE-004）；输出 schema 带 `.strict()`（SEC-003a）。
- `packages/contracts/src/schemas/role.ts`（既有，本期编辑，跨域联动①）：`permissionCodeSchema` 的 `z.enum` 追加 `notification:read` / `notification:write`。`[约束]`
- `packages/contracts/src/schemas/user.ts`（既有，本期编辑，跨域联动①）：`errorCodeSchema` 追加 4 码 `NOTIFICATION_NOT_FOUND` / `NOTIFICATION_RECIPIENT_NOT_FOUND` / `NOTIFICATION_RECIPIENT_DISABLED` / `NOTIFICATION_INVALID_TRANSITION`。`[约束]` SSOT 仍在 user.ts，notification.ts 不重复定义。
- `packages/contracts/src/schemas/audit.ts`（既有，本期编辑，跨域联动①）：`auditLogEntityTypeSchema` 的 `z.enum` 追加 `notification`（枚举由 `user/role/dept` 扩展为 `user/role/dept/notification`）。`[约束]`
- `packages/contracts/src/index.ts`（既有，本期编辑）：追加 `export * from './schemas/notification.js'`。`[约束]`
- `apps/api/src/domain/notification.ts`（本期新增，F1 状态机）：`transitionStatus(from, to)` 纯函数 + `ALLOWED_NOTIFICATION_TRANSITIONS` 常量（合法转移 SSOT）。`[约束]` ARCH-001：domain 不得 import 上层，仅 import `@admin/contracts`。
- `apps/api/src/repository/notification.ts`（本期新增，F1）：内存 `NotificationRepository`（Map），`findById` / `insert` / `update` / `updateStatusAndSentAt` / `updateStatusAndReadAt` / `delete` / `list`。`[约束]`
- `apps/api/src/repository/user.ts`（既有，本期编辑，②签名变更落点）：新增 `findByIds(ids: string[]): UserEntity[]`（批量查，不存在的 id 静默 omitted，保持插入顺序）。`[约束]`
- `apps/api/src/service/user.ts`（既有，本期编辑，②签名变更落点）：新增 public 方法 `findByIds(ids: string[], ctx: Ctx): User[]`，调 `repo.findByIds(ids)`，入口调 `requireAdmin(ctx)`（SEC-002：public 方法须调 requireAdmin；findByIds 为 admin 运营侧调用的批量查询，沿用既有 list/create 的 admin 守卫语义）。`[约束]` 既有 `list`/`create`/`updateStatus` 不变。
- `apps/api/src/service/notification.ts`（本期新增，F1/F2/F3）：`NotificationService` 注入 `UserService`（跨 service 依赖新模式，§3.1）+ `NotificationRepository`；admin 守卫方法 `create`/`update`/`send`/`delete`/`list`/`detail`（调 `requireAdmin`）；`markRead` 收件人自服务方法（§3.3 豁免标记）。`[约束]` ARCH-001：service 不得 import router；service 不 import `AuditLogService`（埋点在 router 层 withAudit）。
- `apps/api/src/router/notification.ts`（本期新增，F1/F2/F3）：procedure 表，复用 `Procedure` + `permission` 元数据（参照 `router/audit.ts` / `router/dept.ts` 模式）；5 类写操作经 `withAudit` 包装。`[约束]` SEC-001。
- `apps/api/src/router/index.ts`（既有，本期编辑）：聚合 router 追加 `notification`。
- `apps/api/src/errors.ts`（既有，本期编辑，跨域联动①）：`errorCodeToHttpStatus: Record<ErrorCode, number>` 补齐 4 个 `NOTIFICATION_*` 码，否则 `tsc` 报 TS2741。`[约束]`
- `apps/api/src/domain/audit.ts`（既有，零改动）：`PII_FIELD_REGISTRY` 不新增 `notification` 条目（通知字段均非 PII）；`markPii('notification', fields)` 因 registry 未列 `notification` → 所有字段 `pii=false`（与 role/dept 同先例）。`[约束]`
- `apps/api/src/domain/role.ts`（既有，零改动）：`ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 已 SSOT 派生，追加 `notification:read`/`notification:write` 后自动覆盖，admin seed 自动含新码；impl-writer 须验证 admin seed 行覆盖新码（自动覆盖）。
- `scripts/check-rules.mjs`（既有，本期编辑，§3.3 SEC-002 豁免标记）：在既有 `markEnforcement('SEC-002')` 循环内，新增对 `// SEC-002-exempt: <reason>` 标记的识别（方法声明行上方 1~2 行或行尾注释），命中则跳过该方法的 requireAdmin 检查并 push 一条 info 供 Reviewer 审计。`[约束]` 非新增 markEnforcement 分支（META-003 合规）。
- `api-spec/notification.openapi.yaml`（本期新增，F1/F2/F3）：通知 OpenAPI 片段，与 Zod 1:1 对齐。`[advisory]` 既有 user/role/dept/audit.openapi.yaml 的 `PermissionCode` 枚举须同步追加 `notification:read`/`notification:write`、`ErrorCode` 枚举须同步追加 4 个 `NOTIFICATION_*`、`AuditLogEntityType` 须同步追加 `notification`，记为遗留同步项（见 §Out of scope）。

## 3. 架构决策（本轮核心）

### 3.1 跨 service 依赖新模式（F3 · NotificationService 注入 UserService）

PRD F3 要求 send 时校验收件人存在且非禁用，需调用既有 `UserService` 的批量查询能力。既有 service（user/role/dept/report）均注入 repository（`UserService(repo)` / `ReportService(auditRepo)`），无 service 注入 service 的先例。下表对比 `findByIds` 落点两方案：

| 方案 | 描述 | 跨 service 依赖 | 一致性 | 评价 |
|---|---|---|---|---|
| A. UserRepository 加 findByIds + UserService 暴露 | repo 层加 `findByIds(ids): UserEntity[]`（数据访问），service 层 `UserService.findByIds(ids, ctx)` 调 repo + `requireAdmin`（业务编排 + 权限） | NotificationService 注入 UserService（service→service，新模式） | 与既有 UserService 其他方法（list/create/updateStatus）分层一致（repo 数据 / service 编排+权限） | **推荐**：分层一致，权限校验在 service（SEC-002），NotificationService 依赖 UserService 抽象而非裸 repo |
| B. NotificationService 直接注入 UserRepository | NotificationService 注入 `UserRepository`，直接调 `userRepo.findByIds` | service→跨域 repo（绕过 UserService） | 破坏 user 域封装（跨域直连 repo，绕过权限/业务编排） | 违反领域封装：user 域的查询应经 UserService（含权限校验），跨域直连 repo 绕过 SEC-002 |

**决策 D1（`[约束]`）**：采用方案 A——`UserRepository.findByIds(ids): UserEntity[]`（数据访问层）+ `UserService.findByIds(ids, ctx): User[]`（业务层，调 `repo.findByIds` + `requireAdmin`）。`NotificationService` 构造注入 `UserService`：`constructor(userService: UserService, notificationRepo: NotificationRepository)`。send 时调 `userService.findByIds([recipient_id], ctx)` 校验收件人。

**理由**：
- 分层一致：与既有 `UserService.list/create/updateStatus`（repo 数据访问 + service 编排+权限）同构，`findByIds` 是 user 域查询能力的自然扩展，不引入新分层模式。
- 领域封装：NotificationService 依赖 `UserService` 抽象（含权限校验），而非裸 `UserRepository`。跨域直连 repo（方案 B）会绕过 user 域的 SEC-002 权限守卫，使"运营 send 时查收件人"这一 admin 操作失去 admin 守卫。
- 跨 service 依赖新模式（service→service）首次引入，但语义清晰：NotificationService 需要 user 域的**业务能力**（含权限的批量查询），而非 user 域的**存储**，故依赖 service 而非 repo。`[advisory]` ARCH-001 仅约束"service 不得 import router"，不禁止 service→service 横向依赖（与 router→service+audit 同层依赖同理）。
- `findByIds` 为纯新增方法（既有 `list/create/updateStatus` 签名不变），是 ②类签名变更驱动清单的分析对象（§8.2），经 grep 分析对既有测试零影响。

**`findByIds` 语义 D2（`[约束]`）**：`UserRepository.findByIds(ids: string[]): UserEntity[]` 遍历 store，返回存在的 UserEntity[]（不存在的 id 静默 omitted，不在结果中），保持插入顺序（与 `findById`/`findByDepartmentId` 一致），不抛错。`UserService.findByIds(ids: string[], ctx: Ctx): User[]` 入口 `requireAdmin(ctx)`，调 `repo.findByIds(ids)` 返回。调用方传唯一 id（去重由调用方负责，PRD Q10）。NotificationService.send 调 `userService.findByIds([recipient_id], ctx)`：结果为空 → `NOTIFICATION_RECIPIENT_NOT_FOUND`；结果含 user 且 `user.status === 'disabled'` → `NOTIFICATION_RECIPIENT_DISABLED`；否则校验通过。

### 3.2 通知状态机层归属（F1 · domain 纯函数，参考 user 域）

**决策 D3（`[约束]`）**：状态机裁决放 domain 层纯函数 `transitionStatus(from: NotificationStatus, to: NotificationStatus): TransitionResult`，参考 `apps/api/src/domain/user.ts` 的 `transitionStatus` 模式。不读写 IO，由 service 层调用并把 errorCode 转抛为 AppError。

```ts
// apps/api/src/domain/notification.ts （示意，impl-writer 按此形状实现）
import type { NotificationStatus, NotificationTransition } from '@admin/contracts';

/** 合法转移 SSOT（PRD Q1）：draft→sent（send）、sent→read（markRead）。 */
export const ALLOWED_NOTIFICATION_TRANSITIONS: NotificationTransition[] = [
  { from: 'draft', to: 'sent' },
  { from: 'sent', to: 'read' },
];

/** 状态机转移结果：合法返回下一态，非法统一返回 NOTIFICATION_INVALID_TRANSITION。 */
export type TransitionResult =
  | { ok: true; next: NotificationStatus }
  | { ok: false; errorCode: 'NOTIFICATION_INVALID_TRANSITION' };

/** 状态机裁决（纯函数）：合法转移见 ALLOWED_NOTIFICATION_TRANSITIONS；同态/跳过/回退均非法。 */
export function transitionStatus(from: NotificationStatus, to: NotificationStatus): TransitionResult {
  const allowed = ALLOWED_NOTIFICATION_TRANSITIONS.some((t) => t.from === from && t.to === to);
  if (!allowed) return { ok: false, errorCode: 'NOTIFICATION_INVALID_TRANSITION' };
  return { ok: true, next: to };
}
```

`[约束]` 单错误码 `NOTIFICATION_INVALID_TRANSITION` 覆盖所有"操作对当前状态非法"场景（PRD Q1）：跳过（draft→read）、同态（draft→draft/sent→sent/read→read）、回退（read→sent/read→draft/sent→draft）、状态守卫操作拒绝（update/delete 仅 draft、send 仅 draft、markRead 仅 sent）。状态守卫操作违规时，service 先判定操作是否允许在当前态执行，违规同样抛 `NOTIFICATION_INVALID_TRANSITION`（用 transitionStatus 裁决目标态或直接守卫判定）。

`[约束]` **状态守卫与状态机裁决的统一**：update/delete 操作仅 draft 允许（非 draft 态执行 → `NOTIFICATION_INVALID_TRANSITION`）；send 仅 draft 允许（非 draft → `NOTIFICATION_INVALID_TRANSITION`，等价于 `transitionStatus(currentStatus, 'sent')` 非法）；markRead 仅 sent 允许（非 sent → `NOTIFICATION_INVALID_TRANSITION`，等价于 `transitionStatus(currentStatus, 'read')` 非法）。impl-writer 可用 `transitionStatus` 统一裁决 send/markRead，update/delete 用"当前态 !== 'draft'"守卫判定。

### 3.3 markRead 权限例外与 SEC-002 豁免标记（F1 Q4b · 本轮核心决策）

PRD Q4b：markRead 为收件人自服务，须 `ctx.user.id === notification.recipient_id`，**不**走 requireAdmin/不要求 notification:write。但 SEC-002 扫描器要求 `apps/api/src/service/` 下所有 public 方法须调 `requireAdmin|requirePermission`。三方案对比：

| 方案 | 描述 | 业务逻辑归属 | SEC-002 | withAudit | 评价 |
|---|---|---|---|---|---|
| ①router 层守卫 + router 调 repo | service 不暴露 public markRead，router 校验 ctx.user.id 后调 repo | ❌ 写逻辑+changes 构造散落 router（违反 D2：changes 由 service 构造） | ✅ 不扫（无 service public 方法） | ⚠️ router 须自构 WriteResult | 破坏分层一致性，router→repo 为孤立新模式，D2 偏离 |
| ②SEC-002 声明免 requireAdmin 豁免标记 | service 暴露 public markRead 带 `// SEC-002-exempt: recipient self-service`，scanner 跳过 | ✅ service 持有（与 create/update/send/delete 同构） | ✅ 豁免标记识别（既有 SEC-002 分支内增强） | ✅ withAudit 包装 service.markRead 返回 WriteResult（统一模式） | **推荐**：架构最干净，豁免显式可审计，scanner 增强最小（3~5 行） |
| ③markRead 也调 requireAdmin 但允许非 admin | 矛盾：requireAdmin 拒绝非 admin，收件人非 admin 被阻断 | — | ✅ | — | 逻辑矛盾，不可行（收件人非 admin 无法标记已读） |

**决策 D4（`[约束]`）**：采用方案 ②——SEC-002 支持"声明免 requireAdmin"豁免标记。`NotificationService.markRead(id, ctx)` 为 public 方法，声明行上方加 `// SEC-002-exempt: recipient self-service (PRD Q4b); guard via ctx.user.id === recipient_id`，scanner 命中标记则跳过 requireAdmin 检查并 push info 供 Reviewer 审计。

**理由**：
- 架构最干净：markRead 业务逻辑（通知存在校验 → 收件人校验 → 状态守卫 → 写入 → changes 构造）与 create/update/send/delete 同处 NotificationService，cohesion 最高；withAudit 统一包装 5 类写操作，无孤立 router 自构 WriteResult 路径。
- D2 保留：changes 由 service 构造（markRead 的 before/after = status + read_at 变更快照），与第五轮 D2 一致，无 advisory 偏离。
- 豁免显式可审计：`// SEC-002-exempt: <reason>` 是显式声明，scanner push info 列出所有豁免点供 Reviewer 逐条核对（比方案①把逻辑挪到 router 隐式规避更透明）。
- SEC-002 规则本质修正：SEC-002 假设"所有 service public 方法须 admin 守卫"，但自服务方法（markRead 是首个，未来 user 改密等同类）是合法例外。豁免标记是规则对自服务语义的正确扩展，非 hack。
- scanner 增强最小：在既有 `markEnforcement('SEC-002')` 循环内，方法 requireAdmin 检查前加"扫描声明行上方 1~2 行 + 行尾注释是否含 `// SEC-002-exempt:`"判定，命中则 continue 跳过 + push info。非新增 markEnforcement 分支（META-003 合规）。

**豁免标记格式 D5（`[约束]`）**：
```ts
// SEC-002-exempt: recipient self-service (PRD Q4b); guard via ctx.user.id === recipient_id
async markRead(id: string, ctx: Ctx): Promise<WriteResult<Notification>> {
  const n = this.notificationRepo.findById(id);
  if (!n) throw new AppError('NOTIFICATION_NOT_FOUND', `通知不存在: ${id}`);
  if (ctx.user.id !== n.recipient_id) throw new AppError('FORBIDDEN', '仅收件人可标记已读');
  const result = transitionStatus(n.status, 'read');
  if (!result.ok) throw new AppError(result.errorCode, `状态转移非法: ${n.status}→read`);
  const now = new Date().toISOString();
  const updated = this.notificationRepo.updateStatusAndReadAt(id, 'read', now);
  const before = markPii('notification', [
    { field: 'status', value: n.status, pii: false },
    { field: 'read_at', value: n.read_at, pii: false },
  ]);
  const changes = markPii('notification', [
    { field: 'status', value: 'read', pii: false },
    { field: 'read_at', value: now, pii: false },
  ]);
  return { entity: updated, changes, before };
}
```

`[约束]` scanner 识别规则：在 SEC-002 循环内，对每个命中 `methodRe` 的 public 方法，回溯其声明行 `i` 上方 `max(0, i-2)` ~ `i-1` 行 + 声明行本身的尾注释，若含 `SEC-002-exempt:` 则跳过 requireAdmin 检查，并 `infos.push(\`SEC-002 豁免：${rel(f)}:${i+1} ${name}() — ${reason}\`)` 供 Reviewer 审计。`[约束]` 豁免标记的 `<reason>` 须可读（如 `recipient self-service`），Reviewer 须逐条核对豁免合理性（滥用豁免记 blocker）。

`[约束]` **markRead 校验顺序**（PRD Q4b，先到先返，不叠加）：通知存在（`NOTIFICATION_NOT_FOUND`）→ 调用者为收件人（`FORBIDDEN`）→ 状态守卫 sent→read（`NOTIFICATION_INVALID_TRANSITION`）。收件人校验用 `ctx.user.id === notification.recipient_id`（非 admin 守卫，自服务语义）。

`[advisory]` **operator_name MVP 桩**：markRead 经 withAudit 埋点时，`operator_id = ctx.user.id`（收件人，正确），但 `operator_name` 沿用第五轮 withAudit 桩恒为 `'admin'`（Ctx 无姓名字段）。对非 admin 收件人，operator_name='admin' 语义不准——此为既有 MVP 桩限制（同第五轮 advisory），未来 Auth 富化 Ctx 后从 UserRepository 读姓名快照，须反向同步 Spec。

`[约束]` **SEC-002 bug 修复验证**：第五轮 SEC-002 扫描器 break 条件已加 KW 排除（`if/for/while/switch/catch/return/function/constructor/static`），notification service 的 admin 方法（create/update/send/delete/list/detail）含 `if` 块时 body 不再被截断，requireAdmin 不落出 body → 不误报。impl-writer 须验证 notification service admin 方法通过 SEC-002（bug 修复生效证据）。markRead 因豁免标记跳过检查（不误报）。

### 3.4 withAudit 复用（F2 · 沿用第五轮 HOF）

**决策 D6（`[约束]`）**：notification 5 类写操作（create/update/send/markRead/delete）经第五轮 `withAudit` HOF（`apps/api/src/router/audit.ts`）包装，`AuditMeta.entityType = 'notification'`。复用既有 `withAudit` 实现，不新增 wrapper。

`[约束]` 5 类写操作的 AuditMeta：
| 操作 | action | entity_id 来源 | before/after（ChangeField[]，pii 全 false） |
|---|---|---|---|
| create draft | `create` | `entity.id`（返回的通知） | before=`[]`；after=`[{title},{content},{recipient_id},{status:'draft'}]`（不含 id/created_at/updated_at/sent_at/read_at，沿用 audit Q3） |
| update draft | `update` | `entity.id` | before/after 仅含实际变更字段（如 title 改 → before=`[{title:旧}]`，after=`[{title:新}]`） |
| send（draft→sent） | `update` | `entity.id` | before=`[{status:'draft'},{sent_at:null}]`；after=`[{status:'sent'},{sent_at:<ISO datetime>}]`（read_at 未变更不入快照） |
| markRead（sent→read） | `update` | `entity.id` | before=`[{status:'sent'},{read_at:null}]`；after=`[{status:'read'},{read_at:<ISO datetime>}]` |
| delete draft | `delete` | `entityIdFromInput(input)`（delete 返回 void entity） | before=`[{title},{content},{recipient_id},{status:'draft'}]`；after=`[]` |

`[约束]` withAudit wrapper 的 catch 不得为空（CODE-002），沿用第五轮 `console.warn('audit record failed (best-effort, swallowed)', e)`。`[约束]` 主操作失败（service 抛 AppError）则 wrapper 不调 `audit.record`（仅成功写操作记录，PRD Q6/Q7）。

`[约束]` **markRead 经 withAudit 包装**：`withAudit((input, ctx) => service.markRead(input.id, ctx), audit, { entityType: 'notification', action: 'update' })`。markRead procedure 的 `auth` 为 `'public'`（收件人自服务，非 admin），但 permission 元数据不设 notification:write（自服务不走权限码，PRD Q4b）。`[advisory]` markRead 的 procedure 形状须扩展 Procedure 类型支持"无 permission 元数据的 public 自服务 procedure"——见 §4.2。

## 4. API 契约（引用，不复制）

所有 schema 与类型定义在 `packages/contracts/src/schemas/{notification,role,user,audit}.ts`，错误码 SSOT 在 `user.ts` 的 `errorCodeSchema`。本节仅引用，不复制字段定义（避免 SSOT 漂移）。

### 4.1 新增/修改的 contracts 符号清单

| 符号 | 文件 | 状态 | 标记 | 说明 |
|---|---|---|---|---|
| `notificationStatusSchema` | notification.ts | 新增 | `[约束]` | enum: `draft`/`sent`/`read` |
| `NotificationStatus` | notification.ts | 新增 | `[约束]` | z.infer 派生类型 |
| `notificationSchema` | notification.ts | 新增 | `[约束]` | 通知实体：`{id, title(1..128), content(1..4000), recipient_id(uuid), status, created_at, updated_at, sent_at(datetime\|null), read_at(datetime\|null)}`，`.strict()`（SEC-003a） |
| `Notification` | notification.ts | 新增 | `[约束]` | z.infer 派生类型 |
| `createNotificationInputSchema` | notification.ts | 新增 | `[约束]` | `{title(1..128), content(1..4000), recipient_id(uuid)}`，`.strict()`；不含 id/status/时间戳（服务端生成）；recipient_id 仅 uuid 格式校验，存在性延后至 send（Q8） |
| `updateNotificationInputSchema` | notification.ts | 新增 | `[约束]` | `{title?, content?, recipient_id?}`（draft 可编辑字段，partial），`.strict()`；status/sent_at/read_at/created_at 不可由调用方改 |
| `notificationTransitionSchema` | notification.ts | 新增 | `[约束]` | `{from: notificationStatusSchema, to: notificationStatusSchema}`，`.strict()`；合法转移 SSOT 由 domain 的 `ALLOWED_NOTIFICATION_TRANSITIONS` 持有（contracts 只定义形状，runtime 数据在 domain，与 PII_FIELD_REGISTRY 同先例） |
| `NotificationTransition` | notification.ts | 新增 | `[约束]` | z.infer 派生类型 |
| `listNotificationQuerySchema` | notification.ts | 新增 | `[约束]` | `{page(默认1), pageSize(默认10,上限100), status?(notificationStatusSchema)}`；`[advisory]` 非 strict（未知 query 键 strip，与 listUserQuerySchema 一致） |
| `notificationListResultSchema` | notification.ts | 新增 | `[约束]` | `{items: notificationSchema[], total, page, pageSize, totalPages}`，`.strict()`（SEC-003a） |
| `permissionCodeSchema` | role.ts | 修改 | `[约束]` | z.enum 追加 `notification:read` / `notification:write`（跨域联动①，AI-006） |
| `errorCodeSchema` | user.ts | 修改 | `[约束]` | 追加 `NOTIFICATION_NOT_FOUND` / `NOTIFICATION_RECIPIENT_NOT_FOUND` / `NOTIFICATION_RECIPIENT_DISABLED` / `NOTIFICATION_INVALID_TRANSITION`（跨域联动①，AI-006） |
| `auditLogEntityTypeSchema` | audit.ts | 修改 | `[约束]` | z.enum 追加 `notification`（枚举 user/role/dept → user/role/dept/notification）（跨域联动①，AI-006） |
| `index.ts` | index.ts | 修改 | `[约束]` | 追加 `export * from './schemas/notification.js'` |

`[约束]` notification 字段均为非 PII（title/content 为业务文本，recipient_id 为 uuid 引用，status/sent_at/read_at 为状态/时间戳），`PII_FIELD_REGISTRY` 不新增 `notification` 条目（沿用第五轮仅 `{user: {email}}`）；所有 ChangeField 的 `pii=false`。

### 4.2 Procedure 表

| Procedure | Method & Path | 入参 schema | 出参 schema | 鉴权 | permission |
|---|---|---|---|---|---|
| notification.list | GET `/v1/notifications` | `listNotificationQuerySchema` | `notificationListResultSchema` | `[约束]` admin | `notification:read` |
| notification.detail | GET `/v1/notifications/{id}` | `{id: uuid}` | `notificationSchema` | `[约束]` admin | `notification:read` |
| notification.create | POST `/v1/notifications` | `createNotificationInputSchema` | `notificationSchema` | `[约束]` admin | `notification:write` |
| notification.update | PATCH `/v1/notifications/{id}` | `{id: uuid, body: updateNotificationInputSchema}` | `notificationSchema` | `[约束]` admin | `notification:write` |
| notification.send | POST `/v1/notifications/{id}/send` | `{id: uuid}` | `notificationSchema` | `[约束]` admin | `notification:write` |
| notification.markRead | POST `/v1/notifications/{id}/read` | `{id: uuid}` | `notificationSchema` | `[约束]` public（收件人自服务） | 无（自服务不走权限码，Q4b） |
| notification.delete | DELETE `/v1/notifications/{id}` | `{id: uuid}` | void（204 无体） | `[约束]` admin | `notification:write` |

`[约束]` **NotificationProcedure 形状**：在 `Procedure<I,O>` 基础上追加 `permission` 元数据（SEC-001，参照 `AuditProcedure`/`DeptProcedure` 模式）。markRead 为收件人自服务，`auth: 'public'` 且无 `permission` 字段——须扩展类型使 `permission` 可选（或 markRead 用独立 procedure 类型）。impl-writer 须保证 SEC-001 扫描通过（markRead 仍声明 `auth`，permission 缺省表自服务）。

`[advisory]` 鉴权映射（同 TECH-AUDIT-001/ENHANCEMENT 已知限制）：PRD 以 `notification:read`/`notification:write` 为鉴权原语，但既有 `Ctx.user.role` 仅 `'admin'|'user'`。本期 `ctx.user.role === 'admin'` 视为具备两码；非 admin → `FORBIDDEN`（markRead 例外：非 admin 收件人允许，走收件人校验非权限码）。procedure 元数据仍按权限码声明，service 层 `requireAdmin` 在 admin 桩下放行。"仅 notification:read 无其他权限"验收场景待 Auth 富化 Ctx 后补，列入 §Out of scope。

`[约束]` F2 埋点不设独立 API 端点（沿用第五轮决策）——日志由 withAudit wrapper 在写操作 handler 成功后被动旁路写入。

## 5. 领域规则

### 5.1 状态机转移规则（F1 Q1）

`[约束]` 合法转移（仅 2 条，SSOT 在 `ALLOWED_NOTIFICATION_TRANSITIONS`）：
- `draft → sent`（send，运营操作）
- `sent → read`（markRead，收件人自服务）

`[约束]` 非法转移（统一 `NOTIFICATION_INVALID_TRANSITION`）：
- 跳过：`draft → read`（不可跳过发送）
- 同态：`draft → draft` / `sent → sent` / `read → read`
- 回退：`read → sent` / `read → draft` / `sent → draft`（read 为终态不可回退）

`[约束]` 状态守卫操作（违规同样 `NOTIFICATION_INVALID_TRANSITION`）：
- update（编辑）仅 `draft` 允许
- delete（删除）仅 `draft` 允许（sent/read append-only 不可删）
- send 仅 `draft` 允许
- markRead 仅 `sent` 允许

### 5.2 收件人校验顺序（F3 Q8/Q10）

`[约束]` 校验延后至 send（draft 创建时 recipient_id 仅 uuid 格式校验，不查存在性/禁用态）。send 时校验顺序（先到先返，不叠加）：
1. 通知存在（`NOTIFICATION_NOT_FOUND`）
2. 状态守卫（当前态须为 draft，否则 `NOTIFICATION_INVALID_TRANSITION`）
3. 收件人存在（`userService.findByIds([recipient_id], ctx)` 结果为空 → `NOTIFICATION_RECIPIENT_NOT_FOUND`）
4. 收件人非禁用（result 含 user 且 `status === 'disabled'` → `NOTIFICATION_RECIPIENT_DISABLED`）
5. 校验通过 → 置 status=sent、sent_at=now、updated_at=now

`[约束]` 收件人校验失败时通知 status 仍为 draft（主操作失败不改状态），不产生审计日志（仅成功写操作记录，Q6）。

### 5.3 markRead 守卫（F1 Q4b）

`[约束]` markRead 为收件人自服务：`auth: 'public'`，不走 requireAdmin，不要求 notification:write。校验顺序（§3.3 D5）：通知存在（`NOTIFICATION_NOT_FOUND`）→ 调用者为收件人（`ctx.user.id === recipient_id`，否则 `FORBIDDEN`）→ 状态守卫 sent→read（`NOTIFICATION_INVALID_TRANSITION`）。通过后置 status=read、read_at=now、updated_at=now。

`[约束]` 非收件人用户（`ctx.user.id !== recipient_id`）标记已读 → `FORBIDDEN`（不论是否 admin；admin 不可代收件人标记已读，自服务语义）。

## 6. 边界与异常

| # | 触发条件 | 错误码 | HTTP | 说明 |
|---|---|---|---|---|
| B1 | notification 入参不通过对应 Zod schema（title/content 长度越界、recipient_id 非 uuid、status 非闭合枚举等） | `VALIDATION_ERROR` | 400 | Zod 解析失败统一此码 |
| B2 | 未携带有效凭证 / 未登录访问任意 notification procedure | `UNAUTHORIZED` | 401 | SEC-001 默认受保护（markRead 亦须登录，仅不要求 admin） |
| B3 | 已登录但缺少 notification:read（list/detail）或 notification:write（create/update/send/delete） | `FORBIDDEN` | 403 | SEC-002 service 层 requireAdmin（admin 桩下非 admin 无权限） |
| B4 | markRead 调用者非收件人（`ctx.user.id !== recipient_id`） | `FORBIDDEN` | 403 | `[约束]` 收件人自服务守卫（Q4b），非 admin 守卫；admin 代标记亦拒绝 |
| B5 | 通知不存在（id 合法 uuid 但无记录）— 任意写操作（update/delete/send/markRead） | `NOTIFICATION_NOT_FOUND` | 404 | `[约束]` 区别于收件人不存在（B7） |
| B6 | 状态转移/状态守卫操作非法（跳过/同态/回退/守卫违规） | `NOTIFICATION_INVALID_TRANSITION` | 409 | `[约束]` 单码覆盖所有状态非法（Q1）；409 表状态冲突（与 USER_ALREADY_* 409 同语义层级） |
| B7 | send 时收件人不存在（findByIds 结果为空） | `NOTIFICATION_RECIPIENT_NOT_FOUND` | 404 | `[约束]` 收件人不存在（Q9），区别于 B5 通知不存在 |
| B8 | send 时收件人存在但 status=disabled | `NOTIFICATION_RECIPIENT_DISABLED` | 409 | `[约束]` 收件人禁用（Q9），409 表收件人状态冲突 |
| B9 | F2 埋点环节异常（audit.record 抛错） | （无客户端码） | （主操作仍 200/204） | `[约束]` best-effort：wrapper try/catch 吞掉，不抛调用方（Q7） |

`[约束]` **校验顺序**（service 层必须遵守，先到先返，不叠加）：
- **create**：B1（router Zod 解析）→ B2/B3（鉴权 requireAdmin）→ 写入（status=draft, sent_at=null, read_at=null）→ 返回 + 埋点
- **update**：B1 → B2/B3 → B5（通知存在）→ B6（仅 draft 允许编辑，状态守卫）→ 写入（updated_at 刷新）→ 返回 + 埋点
- **send**：B1 → B2/B3 → B5 → B6（仅 draft 允许 send）→ B7（收件人存在）→ B8（收件人非禁用）→ 写入（status=sent, sent_at=now）→ 返回 + 埋点
- **markRead**：B1 → B2（登录）→ B5（通知存在）→ B4（收件人校验，非 B3 admin 守卫）→ B6（仅 sent 允许 markRead）→ 写入（status=read, read_at=now）→ 返回 + 埋点
- **delete**：B1 → B2/B3 → B5 → B6（仅 draft 允许删除）→ 删除（204）→ 埋点（after=[]）
- **list/detail**：B1 → B2/B3 → 返回（读不埋点）

`[约束]` markRead 校验顺序中 B4（收件人）先于 B6（状态守卫）：通知存在 → 收件人身份 → 状态守卫（PRD Q4b 明确此序）。`[advisory]` 若 impl-writer 调整 B4/B6 顺序须反向同步 Spec（PRD Q4b 钦定序）。

错误码枚举 SSOT：`errorCodeSchema`，本轮新增 4 个 `NOTIFICATION_*`；notification 复用 `VALIDATION_ERROR`/`UNAUTHORIZED`/`FORBIDDEN`。`[约束]` 新增须同步本表、`errors.ts` `errorCodeToHttpStatus` 与 OpenAPI（保持四处一致，沿用 user.ts errorCodeSchema 注释约定）。

## 7. DB 变更

`[advisory]` 本 MVP repository 用内存实现（Map），无真实 DB；DB schema 作为 SSOT 文档产出。本轮新增 notification 概念表（内存），无既有表结构变更。

**notifications 表（本期新增，内存投影）：**
```ts
// 内存 NotificationRepository（Map<string, Notification>），DB schema SSOT 文档：
//   id           uuid PK
//   title        varchar(128) NOT NULL
//   content      varchar(4000) NOT NULL
//   recipient_id uuid NOT NULL  -- 引用 users.id（跨域，F3 校验，无外键约束 in memory）
//   status       enum('draft','sent','read') NOT NULL DEFAULT 'draft'
//   created_at   timestamptz NOT NULL
//   updated_at   timestamptz NOT NULL
//   sent_at      timestamptz NULL  -- draft 态 null，send 时置非空
//   read_at      timestamptz NULL  -- draft/sent 态 null，markRead 时置非空
```

`[约束]` `sent`/`read` 态通知 append-only（不可 update/delete）——DB 层无独立约束（内存实现），由 service 层状态守卫裁决（B6）；落地真实 DB 时可加触发器或应用层守卫。`[advisory]` 落地真实 DB 时 recipient_id 应加外键约束 + 索引（按收件人查收件箱，本期 Out of scope）；send 时收件人校验可下推为 `EXISTS` 子查询（本期内存实现即时查）。

## 8. 受影响测试清单（AI-006 增强 · 本轮必须章节，分两类标注）

本节依 AI-006 增强规则，基于对 `apps/api/test/**/*.ts` 的真实 grep 扫描产出。本轮同时触发两类：
- **①类·contracts 联动驱动（grep 命中）**：扩展 `permissionCodeSchema`（加 notification:read/write）、`errorCodeSchema`（加 4 个 NOTIFICATION_*）、`auditLogEntityTypeSchema`（加 notification）。
- **②类·apps/api 内部签名变更驱动（手动分析）**：`UserService` 新增 public 方法 `findByIds(ids, ctx): User[]`（既有 service 签名变更）。

**grep 命令与命中（真实执行结果）：**
- `Grep 'permissionCodeSchema' apps/api/test` → 命中 `dept.test.ts`、`report.test.ts`、`role.test.ts`、`audit.test.ts`（4 文件，19 行）。
- `Grep 'errorCodeSchema|auditLogEntityTypeSchema' apps/api/test` → 命中 `audit-embedding.test.ts`、`report.test.ts`、`audit.test.ts`（3 文件，18 行）。
- `Grep 'UserService|new UserService' apps/api/test` → 命中 `audit-embedding.test.ts`、`user.test.ts`（2 文件，6 行）。
- `Grep "'user', 'role', 'dept'" apps/api/test` → 命中 `audit-embedding.test.ts` L533（1 处硬编码全集断言）。

### 8.1 ①类·contracts 联动驱动（grep 命中）

#### 8.1.1 audit-embedding.test.ts（重影响 — auditLogEntityTypeSchema 加 notification 击穿硬编码全集断言）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L30 | `import { auditLogEntityTypeSchema }` | 枚举扩展 | **无需改**（导入合法，schema 名不变） |
| L525-542 | `it('所有埋点日志 entity_type ∈ [...auditLogEntityTypeSchema.options]')` + `const validTypes = [...auditLogEntityTypeSchema.options]` + `for (const log of auditRepo.listAll()) { expect(validTypes).toContain(log.entity_type) }` + `for (const t of validTypes) { expect(seenTypes.has(t)).toBe(true) }` | **SSOT 派生循环**：加 notification 后 validTypes 自动含 notification；既有三域埋点日志仍 ∈ validTypes；但 L540 `for (t of validTypes) expect(seenTypes.has(t))` 要求"每个枚举值至少有一条日志"——加 notification 后此断言要求 seenTypes 含 notification，而既有三域 setup 不产 notification 日志 → **断言失败** | **数据补齐**：此 it 须补一步触发 notification 写操作（如 `callProc(notificationRouter.create, ...)`）使 seenTypes 含 notification；或将此断言改为"仅断言三域已见，notification 由 notification.test.ts 独立覆盖"。test-writer 须核实 setup 是否含 notificationRouter（本轮新增 router，audit-embedding setup 须扩展注入 notificationRouter + 共享 auditService，否则 L540 断言因 notification 缺失而红） |
| L533 | `expect(validTypes).toEqual(['user', 'role', 'dept'])` | **硬编码全集断言（AI-005 抓取点）**：加 notification 后 validTypes=`['user','role','dept','notification']` ≠ `['user','role','dept']` → **断言失败** | **数据补齐**：改为 `expect(validTypes).toEqual(['user', 'role', 'dept', 'notification'])`；或更稳健改为 `expect(validTypes).toEqual([...auditLogEntityTypeSchema.options])`（两侧同源，恒真，彻底消除硬编码——但失去"全集校验"语义，advisory）。**推荐**改含 notification 的字面量（保留全集校验语义，AI-005 ≥3 字面量阈值会 suggestion，但属合法全集断言，Reviewer 确认即可） |
| L531 | `const validTypes = [...auditLogEntityTypeSchema.options]` | SSOT 派生 | **无需改**（自动含 notification） |

**audit-embedding.test.ts 小结**：2 处需同步更新（L533 硬编码全集 → 补 notification；L525-542 的 seenTypes 全覆盖断言须补 notification 日志或调整断言语义）。此为本轮 ①类**唯一断点**（其余引用均为 SSOT 派生或 toContain，加性扩展不击穿）。

#### 8.1.2 audit.test.ts（auditLogEntityTypeSchema 扩展 — 零改动，SSOT 派生自动跟随）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L33 | `import { auditLogEntityTypeSchema }` | 枚举扩展 | **无需改** |
| L531-534 | `for (const t of auditLogEntityTypeSchema.options) { expect(listAuditLogQuerySchema.safeParse({ entity_type: t }).success).toBe(true) }` | **SSOT 派生遍历**：加 notification 后循环多跑一次 `entity_type:'notification'`；listAuditLogQuerySchema.entity_type 用同一 schema → 'notification' 通过 | **零改动**：自动跟随（AI-005 价值） |
| L575-576 | `auditLogEntityTypeSchema.safeParse('audit').success).toBe(false)` | 'audit' 仍非枚举值（现为 user/role/dept/notification） | **零改动**：仍 false |
| L527-528 | `listAuditLogQuerySchema.safeParse({ entity_type: 'unknown' }).success).toBe(false)` | 'unknown' 仍非枚举值 | **零改动** |

#### 8.1.3 report.test.ts（auditLogEntityTypeSchema + errorCodeSchema + permissionCodeSchema 扩展 — 零改动）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L37-38 | `import { errorCodeSchema, auditLogEntityTypeSchema }` | 枚举扩展 | **无需改** |
| L36 | `import { permissionCodeSchema }` | 枚举扩展 | **无需改** |
| L250-256 | `for (const t of auditLogEntityTypeSchema.options) { expect(reportQuerySchema.safeParse({ group_by: ['entity_type'], entity_type: t }).success).toBe(true) }` | **SSOT 派生遍历**：加 notification 后多跑一次；reportQuerySchema.entity_type 用同一 schema → 'notification' 通过 | **零改动**：自动跟随 |
| L952-957 | `const allCodes = [...permissionCodeSchema.options]; expect(allCodes).toContain('report:read'/'audit:read'/'dept:read')` | toContain 单元素断言 | **零改动**：加 notification:read/write 不破坏 toContain；advisory 可补 `toContain('notification:read')`/`toContain('notification:write')`（非必须） |
| L960-966 | `const allCodes = [...errorCodeSchema.options]; expect(allCodes).toContain('REPORT_GROUP_BY_REQUIRED'/'VALIDATION_ERROR'/'FORBIDDEN')` | toContain 单元素断言 | **零改动**：加 NOTIFICATION_* 不破坏 toContain；advisory 可补 `toContain('NOTIFICATION_INVALID_TRANSITION')` 等（非必须） |
| L969-974 | `for (const t of auditLogEntityTypeSchema.options) { expect(reportQuerySchema.safeParse({ ..., entity_type: t }).success).toBe(true) }` | SSOT 派生遍历 | **零改动**：自动跟随 |

#### 8.1.4 role.test.ts（permissionCodeSchema 扩展 — 零改动）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L21 | `import { permissionCodeSchema }` | 枚举扩展 | **无需改** |
| L36 | `import { ALL_PERMISSION_CODES }` | 派生自 permissionCodeSchema | **无需改** |
| L130 | `expect(ALL_PERMISSION_CODES).toEqual([...permissionCodeSchema.options])` | **已 SSOT 派生**（两侧同源） | **零改动**：加 notification:read/write 后两侧均自动含新码，断言自动跟随（AI-005 价值） |
| L141 | `expect(admin.permission_codes).toEqual(ALL_PERMISSION_CODES)`（admin seed 用 `[...ALL_PERMISSION_CODES]`） | **已 SSOT 派生** | **零改动**：admin seed 自动含 notification:read/write；impl-writer 须验证 seed 行覆盖新码（自动覆盖） |
| L309-313 | `permissionCodeSchema.safeParse('foo:bar')` 拒绝 / `safeParse('role:write')` 通过 | 枚举扩展 | **零改动**：测试既有码，notification:read/write 加入不影响；advisory 可补 `safeParse('notification:read')` 通过断言（非必须） |

#### 8.1.5 dept.test.ts（permissionCodeSchema 扩展 — 零改动）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L45 | `import { permissionCodeSchema }` | 枚举扩展 | **无需改** |
| L485-492 | `permissionCodeSchema.safeParse('dept:read'/'dept:write')` 通过 / `'foo:bar'` 拒绝 | 枚举扩展 | **零改动**：测试 dept 码，notification:read/write 加入不影响 |

#### 8.1.6 user.test.ts（errorCode 扩展 — 零改动，类型级引用）

| 行 | 引用符号 / 断言 | 受影响判定 | 同步更新方向 |
|---|---|---|---|
| L14 | `import { type ErrorCode }` | 类型级引用 | **无需改**：4 个 NOTIFICATION_* 加入 ErrorCode 联合类型不破坏既有类型引用 |
| L79 | `expectAppError(promise, code: ErrorCode)` helper 形参 | 类型级引用 | **无需改**（类型级） |

### 8.2 ②类·apps/api 内部签名变更驱动（手动分析 · UserService 新增 findByIds）

**变更描述**：`UserService` 新增 public 方法 `findByIds(ids: string[], ctx: Ctx): User[]`（调 `repo.findByIds(ids)` + `requireAdmin`）。既有 `list`/`create`/`updateStatus` 签名不变。`findByIds` 为**纯新增**方法（无既有方法签名修改）。

**grep 消费点**（`Grep 'UserService|new UserService' apps/api/test`）：

| 文件 | 行 | 消费点 | 受影响判定 | 同步更新方向 |
|---|---|---|---|---|
| audit-embedding.test.ts | L41 | `import { UserService }` | 导入合法 | **无需改** |
| audit-embedding.test.ts | L91 | `const userService = new UserService(userRepo)` | 构造签名不变（仍 `constructor(repo: UserRepository)`） | **无需改** |
| audit-embedding.test.ts | L504 | `const userService = new UserService(userRepo)` | 同上 | **无需改** |
| user.test.ts | L18 | `import { UserService }` | 导入合法 | **无需改** |
| user.test.ts | L35-37 | `function setup() { const service = new UserService(repo); ... }` | 构造签名不变 | **无需改** |

**消费既有方法返回值的断言点**（`Grep 'service\.(create|updateStatus|list|findById|findByEmail)' apps/api/test`）：
- `user.test.ts`：调用 `service.create`/`service.updateStatus`/`service.list` 的断言均访问既有返回结构（`WriteResult<User>` 的 `.entity`/`.changes`，第五轮已迁移完成），`findByIds` 新增不触及这些断言。
- `audit-embedding.test.ts` L504-518：`new UserService(userRepo)` 后调 `userRouter.create`（经 withAudit），断言返回 user 实体字段（`.id`/`.email`/`.name`/`.status`），不涉及 `findByIds`。
- 无测试枚举 `UserService` 方法集或断言 `findByIds` 缺席。

**②类分析结论（`[约束]` 显式标注）**：**零影响**。`findByIds` 为纯新增 public 方法，构造签名与既有方法签名均不变；既有测试无任何断言访问 `findByIds` 返回值或断言其缺席。`[约束]` 依 AI-006 增强第②类要求，test-writer 须反向核实此结论——若发现清单外影响点（如 Tech Lead 遗漏的 findByIds 消费断言），须在交付报告显式列出差异并修正。本轮预判：findByIds 的唯一消费方为 `NotificationService.send`（本期新增），由 `notification.test.ts`（test-writer 新建）覆盖，不击穿既有 user/role/dept/audit/report 测试。

### 8.3 清单结论（AI-006 增强 + AI-005 交叉验证）

- `[约束]` **①类·唯一断点**：`audit-embedding.test.ts` L533 硬编码 `toEqual(['user','role','dept'])` 被 `notification` 击穿（+ L525-542 seenTypes 全覆盖断言须补 notification 日志或调整语义）。test-writer 须同步更新这 2 处。
- `[约束]` **①类·其余引用零改动**：`permissionCodeSchema`/`errorCodeSchema`/`auditLogEntityTypeSchema` 的其余引用（role/dept/user/report/audit.test.ts）均 SSOT 派生或 toContain 单元素，加性扩展自动跟随（AI-005 价值）。
- `[约束]` **②类·零影响**：`UserService.findByIds` 纯新增，既有测试零击穿；test-writer 须反向核实。
- `[约束]` **未发现其他硬编码跨域可变集合断言**（AI-005）：除 L533 外，`apps/api/test/**/*.ts` 中无 `.toEqual([...])` 后紧跟 ≥3 个权限码/错误码/实体类型字面量的断言（L533 为唯一硬编码实体类型全集，已纳入①类断点）。
- `[advisory]` 新增 `apps/api/test/notification.test.ts`（覆盖本 Spec §测试矩阵）+ 扩展 `audit-embedding.test.ts`（notification 埋点端到端，§9 AI-007）由 test-writer 另行产出。test-writer 须遵循 AI-005：notification 相关全集断言一律 SSOT 派生（如 `expect([...auditLogEntityTypeSchema.options]).toContain('notification')`）。
- `[约束]` **待 impl-writer 联动（非测试文件，记此以闭环）**：
  - `apps/api/src/errors.ts`：`errorCodeToHttpStatus` 须补 4 个 `NOTIFICATION_*` 码（TS2741），映射见 §6（B5/B7→404，B6/B8→409）。
  - `apps/api/src/domain/role.ts`：`ALL_PERMISSION_CODES` SSOT 派生自动覆盖 notification:read/write，无需手改；admin seed 自动含新码。
  - `apps/api/src/domain/audit.ts`：`PII_FIELD_REGISTRY` 不加 notification（无 PII），`markPii('notification', ...)` 自动全 false，无需手改。
  - `apps/api/src/repository/user.ts` + `service/user.ts`：新增 `findByIds`（②类落点）。
  - `apps/api/src/router/index.ts`：聚合 router 追加 notification。
  - `scripts/check-rules.mjs`：SEC-002 分支内新增豁免标记识别（§3.3 D5）。

## 9. AI-007 端到端验收指引（本轮必须章节）

依 AI-007 规则，PRD 含跨层行为（F2 埋点旁路、F3 跨 service 调用）须端到端验收测试。test-writer 须对照 PRD 每条 Given/When/Then 产出端到端断言，注入**共享依赖**（共享 `AuditLogRepository` 观测旁路副作用、共享 `UserService`/`UserRepository` 观测跨 service 调用），而非隔离自建实例导致副作用不可见（RETRO-ROUND5 P0 根因）。

### 9.1 须端到端验收的验收点（共 13 条）

#### F2 埋点端到端（8 条，注入共享 AuditLogRepository）

`[约束]` test-writer 须注入共享 `AuditLogRepository`（与 notificationRouter 共用同一 auditService → 同一 auditRepo），写操作后用 `auditRepo.listAll()` 读**存储态**日志（未脱敏原值，区别于 `auditService.list` 脱敏态）断言日志内容。

| # | PRD 验收点（Given/When/Then） | 端到端断言要点 |
|---|---|---|
| F2-1 | send draft→sent 成功 → 共享 auditRepo 新增一条日志 entity_type=notification/action=update/entity_id=N1/operator_id=O1/before=[{status:'draft',pii:false},{sent_at:null,pii:false}]/after=[{status:'sent',pii:false},{sent_at:<非空ISO>,pii:false}]；调用方未显式调 audit.record | 断言 `auditRepo.listAll()` 长度+1；最后一条日志 entity_type/action/entity_id/operator_id/before/after 字段逐一断言；before/after 用 `find(f=>f.field===...)?.value` 访问；sent_at 非空 ISO datetime |
| F2-2 | create draft → 共享 auditRepo 新增日志 action=create/before=[]/after=[{title},{content},{recipient_id},{status:'draft'}]（不含 id/created_at/updated_at/sent_at/read_at） | 断言 after 含且仅含 4 字段（title/content/recipient_id/status），无服务端元数据 |
| F2-3 | update draft（title 旧→新）→ 共享 auditRepo 新增日志 action=update/before=[{title:旧}]/after=[{title:新}]（仅含实际变更字段） | 断言 before/after 仅含 title（content/recipient_id 未变更不入快照） |
| F2-4 | markRead draft 态失败（NOTIFICATION_INVALID_TRANSITION）→ 不产生审计日志（仅成功写操作记录） | 断言 send 失败后 `auditRepo.listAll()` 长度不变 |
| F2-5 | markRead sent→read 成功 → 共享 auditRepo 新增日志 action=update/before=[{status:'sent',pii:false},{read_at:null,pii:false}]/after=[{status:'read',pii:false},{read_at:<非空ISO>,pii:false}] | 断言 before/after 含 status + read_at（sent_at 未变更不入快照）；operator_id=收件人 id |
| F2-6 | delete draft → 共享 auditRepo 新增日志 action=delete/before=[{title},{content},{recipient_id},{status:'draft'}]/after=[] | 断言 after=[]；entity_id 经 entityIdFromInput 从 input 取 |
| F2-7 | send 主操作成功但埋点异常（共享 auditRepo 写入失败/ThrowingAuditLogService）→ 主操作仍对调用方返回成功（通知已 sent）；埋点异常被吞 | 用 `ThrowingAuditLogService`（record 抛错）替换共享 auditService，断言 send 仍返回 sent 通知；auditRepo 为空（埋点未入库） |
| F2-8 | send 主操作因校验失败（收件人不存在/禁用/状态非法）→ 不产生审计日志 | 各失败场景断言 `auditRepo.listAll()` 长度不变 |

#### F3 跨 service 收件人校验端到端（5 条，注入共享 UserService/UserRepository）

`[约束]` test-writer 须注入共享 `UserService`（共享 `UserRepository`），使 NotificationService.send 真实调用 `userService.findByIds`（而非 mock），观测跨 service 调用对收件人存在性/禁用态的判定。

| # | PRD 验收点（Given/When/Then） | 端到端断言要点 |
|---|---|---|
| F3-1 | recipient_id=U_valid（存在且 active）→ send 成功，通知 status=sent | 共享 userRepo 预置 active 用户；send 返回 sent 通知 |
| F3-2 | recipient_id=U_missing（不存在）→ send 抛 NOTIFICATION_RECIPIENT_NOT_FOUND；通知 status 仍 draft；不产生审计日志 | 共享 userRepo 不预置该 id；断言 AppError code=NOTIFICATION_RECIPIENT_NOT_FOUND；通知仍 draft；auditRepo 不增 |
| F3-3 | recipient_id=U_disabled（存在但 disabled）→ send 抛 NOTIFICATION_RECIPIENT_DISABLED；通知 status 仍 draft；不产生审计日志 | 共享 userRepo 预置 disabled 用户；断言 AppError code=NOTIFICATION_RECIPIENT_DISABLED |
| F3-4 | 创建 draft 时 recipient_id 指向不存在用户 → 创建成功（draft 不校验收件人）；后续 send → NOTIFICATION_RECIPIENT_NOT_FOUND（验证延后校验） | 断言 create 成功（draft）；send 抛 NOTIFICATION_RECIPIENT_NOT_FOUND（延后校验生效） |
| F3-5 | UserService.findByIds 传入 ids → 返回 User[]，仅含存在的用户（不存在的 id 静默 omitted） | 直接断言 `userService.findByIds([存在id, 不存在id], adminCtx)` 返回长度=1，仅含存在用户；NotificationService 据此判存在与禁用 |

### 9.2 端到端 setup 指引（注入共享依赖）

`[约束]` test-writer 须参照 `audit-embedding.test.ts` 的 setup 模式（第五轮方案A），扩展为 notification 端到端 setup：

```ts
// 示意（test-writer 按此结构实现）
function setup() {
  const auditRepo = new AuditLogRepository();
  const auditService = new AuditLogService(auditRepo);
  const userRepo = new UserRepository();           // 共享：NotificationService + UserService 共用
  const userService = new UserService(userRepo);   // 共享：注入 NotificationService
  const notificationRepo = new NotificationRepository();
  const notificationService = new NotificationService(userService, notificationRepo);
  // 预置 active/disabled 收件人
  userRepo.insert({ id: U_VALID, ..., status: 'active' });
  userRepo.insert({ id: U_DISABLED, ..., status: 'disabled' });
  // notificationRouter 共享 auditService（→ 同一 auditRepo，埋点可观测）
  const notificationRouter = createNotificationRouter(notificationService, auditService);
  return { auditRepo, userRepo, userService, notificationRepo, notificationRouter };
}
```

`[约束]` 关键：`NotificationService` 注入的 `userService` 须与 setup 中可观测的 `userService`/`userRepo` 同一实例（共享），否则 send 时 findByIds 查隔离实例 → 收件人存在性不可观测（RETRO-ROUND5 P0 同构风险）。`[约束]` `notificationRouter` 注入的 `auditService` 须与 `auditRepo` 同源，否则埋点副作用不可观测。

`[约束]` Reviewer 须按 PRD F2/F3 每条 Given/When/Then 逐条核对端到端断言对齐（AI-007）：不仅查规则合规（tsc/check-rules/vitest），还须对照 PRD 验收标准核对日志内容（entity_type/action/before/after 字段逐一）与跨 service 调用（findByIds 真实调用、收件人存在/禁用判定）。发现 [约束] 偏离记 blocker。

## 10. 测试矩阵（七类，本轮新增 notification 类 + 端到端）

| 用例类型 | 覆盖点 |
|---|---|
| 单测 | `[约束]` domain/notification.ts：`transitionStatus` 合法转移（draft→sent/sent→read）返回 ok+next；非法转移（跳过/同态/回退）返回 NOTIFICATION_INVALID_TRANSITION；`ALLOWED_NOTIFICATION_TRANSITIONS` 经 `notificationTransitionSchema` 校验通过。 |
| 单测 | `[约束]` repository/notification.ts：insert/findById/update/updateStatusAndSentAt/updateStatusAndReadAt/delete/list（按 status 过滤 + 分页）；append-only 守卫由 service 层裁决（repo 不阻止 sent 态 update，但 service 抛 INVALID_TRANSITION）。 |
| 单测 | `[约束]` repository/user.ts + service/user.ts：`UserRepository.findByIds([存在,不存在])` 返回仅存在者（保持插入顺序，不抛错）；`UserService.findByIds(ids, ctx)` 非 admin → FORBIDDEN（SEC-002），admin 返回 User[]。 |
| 契约测 | `[约束]` 入参 `createNotificationInputSchema`/`updateNotificationInputSchema`/`listNotificationQuerySchema` safeParse 合法/非法样本；`notificationSchema`（.strict 拒绝多余字段）；`notificationStatusSchema` 三值；`notificationListResultSchema` .strict。 |
| 边界 | `[约束]` F1 状态机：draft 可编辑/删除；sent/read 不可编辑/删除（INVALID_TRANSITION）；draft→read 跳过非法；同态/回退非法；不存在通知写操作→NOTIFICATION_NOT_FOUND；markRead 非收件人→FORBIDDEN；markRead draft→INVALID_TRANSITION。 |
| 边界 | `[约束]` F3 收件人校验：recipient 不存在→NOTIFICATION_RECIPIENT_NOT_FOUND；disabled→NOTIFICATION_RECIPIENT_DISABLED；校验失败通知仍 draft；创建不校验收件人（延后至 send）。 |
| 权限 | `[约束]` B2：未登录→UNAUTHORIZED；B3：非 admin create/update/send/delete/list/detail→FORBIDDEN；B4：markRead 非收件人→FORBIDDEN（含 admin 代标记拒绝）；markRead 收件人（非 admin）成功（自服务）。 |
| 状态机 | `[约束]` F1 闭环：draft→sent→read 全路径；各非法转移逐一覆盖（跳过/同态/回退）；状态守卫操作违规逐一覆盖。 |
| 端到端 | `[约束]` F2 埋点 8 条 + F3 跨 service 5 条（§9），注入共享 auditRepo/userService，断言日志内容与跨 service 调用（AI-007）。 |

## 11. 校验方式（META-001 / META-003 / META-004 合规标注）

本 Spec 对 `scripts/check-rules.mjs` 做一处**既有 SEC-002 分支内的最小增强**（豁免标记识别，非新增 markEnforcement 分支）+ SEC-002 规则文档同步补段。其余规则全部复用既有。每条实现性规则的校验落点如下（META-001：须含机器校验关键词；META-003：声称 check-rules.mjs 专属分支的须真有；META-004：脚本有分支的须有规则文档）：

| 规则 | 校验方式 | 落点 | META 合规 |
|---|---|---|---|
| ARCH-001（service 不 import router / audit service） | `scripts/check-rules.mjs` ARCH-001 分支按目录分层扫描 import；NotificationService 不得 `import { AuditLogService }`（埋点在 router 层 withAudit）；NotificationService 可 import UserService（service→service 横向依赖，§3.1 决策，ARCH-001 未禁止） | check-rules.mjs 既有 `markEnforcement('ARCH-001')` 分支 | META-003 ✅ / META-004 ✅ |
| ARCH-002（contracts 纯净，只导出 schema 与类型） | `scripts/check-rules.mjs` ARCH-002 分支扫描 contracts 内 import；notification.ts 只导出 Zod schema 与 z.infer 类型，`ALLOWED_NOTIFICATION_TRANSITIONS` runtime 数据放 domain（与 PII_FIELD_REGISTRY 同先例） | check-rules.mjs 既有 `markEnforcement('ARCH-002')` 分支 | META-003 ✅ / META-004 ✅ |
| CODE-004（Zod schema 须 Schema 后缀） | `scripts/check-rules.mjs` CODE-004 分支正则扫描 `export const X = z.(object\|enum\|...)`；新增 `notificationStatusSchema`/`notificationSchema`/`createNotificationInputSchema`/`updateNotificationInputSchema`/`notificationTransitionSchema`/`listNotificationQuerySchema`/`notificationListResultSchema` 均带 Schema 后缀 | check-rules.mjs 既有 `markEnforcement('CODE-004')` 分支 | META-003 ✅ / META-004 ✅ |
| SEC-001（procedure 须声明 auth 元数据） | `scripts/check-rules.mjs` SEC-001 分支扫描 router 下 procedure 对象缺 `auth:` 字段；notification.router.ts 的 7 个 procedure 须含 `auth`（list/detail/create/update/send/delete='admin'，markRead='public'） | check-rules.mjs 既有 `markEnforcement('SEC-001')` 分支 | META-003 ✅ / META-004 ✅ |
| SEC-002（service public 方法须调 requireAdmin/requirePermission，含豁免标记） | `scripts/check-rules.mjs` SEC-002 分支扫描 service 方法体含 `requireAdmin\|requirePermission`；NotificationService.create/update/send/delete/list/detail 须调 requireAdmin；**markRead 带 `// SEC-002-exempt: recipient self-service` 标记 → 分支内新增识别逻辑跳过检查并 push info**；UserService.findByIds 须调 requireAdmin；bug 修复（KW 排除）使 admin 方法的 if 块不截断 body | check-rules.mjs 既有 `markEnforcement('SEC-002')` 分支（**内增豁免标记识别，非新分支**）+ SEC-002 规则文档补豁免标记段 | META-003 ✅（未声称新 markEnforcement 分支，豁免逻辑在既有分支内）/ META-004 ✅（SEC-002 规则文档存在，补豁免标记说明） |
| SEC-003a（输出 schema 须 .strict()） | `scripts/check-rules.mjs` SEC-003a 分支扫描 contracts 输出 schema（名含 Result/Response）；`notificationListResultSchema` 须 `.strict()`；`notificationSchema` 亦 .strict（实体输出） | check-rules.mjs 既有 `markEnforcement('SEC-003a')` 分支（warning 级） | META-003 ✅ / META-004 ✅ |
| CODE-002（禁止空 catch） | `scripts/check-rules.mjs` CODE-002 分支扫描空 catch 与仅 console catch；notification withAudit 复用第五轮 wrapper 的 `console.warn` catch | check-rules.mjs 既有 `markEnforcement('CODE-002')` 分支 | META-003 ✅ / META-004 ✅ |
| AI-005（禁止硬编码跨域可变集合断言） | `scripts/check-rules.mjs` AI-005 分支扫描测试 `.toEqual([...])` 后紧跟 ≥3 个枚举字面量；notification.test.ts 全集断言须 SSOT 派生；audit-embedding.test.ts L533 改含 notification 后会触发 suggestion（合法全集断言，Reviewer 确认） | check-rules.mjs 既有 `markEnforcement('AI-005')` 分支（warning 级） | META-003 ✅ / META-004 ✅ |
| AI-006（Tech Lead 须产出受影响测试清单，分两类标注） | Reviewer subagent 检查 Tech-Spec 含"受影响测试清单"章节且分①②两类标注（contracts 联动 + service 签名变更）；本 Spec §8 即此章节，两类均覆盖 | Reviewer subagent 流程（脚本无专属分支，AI-006 规则文档明确"脚本无专属 enforcement 分支，由 Reviewer 流程校验（不触发 META-003）"） | META-003 ✅（未声称专属分支）/ META-001 ✅（含 Reviewer subagent 关键词） |
| AI-007（端到端验收测试 + Reviewer PRD 逐条核对） | Reviewer subagent 检查测试文件覆盖 PRD F2/F3 每条 Given/When/Then（端到端断言，注入共享依赖）；Reviewer 报告含"PRD 验收逐条核对"章节；本 Spec §9 指引 13 条端到端验收点 | Reviewer subagent 流程（脚本无专属分支） | META-003 ✅ / META-001 ✅ |
| AI-001（先读 Spec 再写码） | Reviewer subagent 扫描 diff 新增导出符号与 `docs/spec/*.tech.md` + contracts 比对 | Reviewer subagent 流程 | META-003 ✅ / META-001 ✅ |
| AI-002（测试先行 + tsc 自检） | 编排者实跑 `vitest run` 收集断言级红 + `git diff` 检查 impl-writer 未改测试断言；test-writer 交付附 tsc 自检 | CI（vitest）+ 编排者 git diff | META-003 ✅ / META-001 ✅ |
| AI-003（禁止越界发挥） | Reviewer subagent 扫描 diff 新增导出符号在 docs/spec + contracts 有来源；advisory 偏离检查 PR 描述含"反向同步 Spec" | Reviewer subagent 流程 | META-003 ✅ / META-001 ✅ |
| AI-004（每次改动必跑三件套） | CI 执行 `tsc --noEmit` + `node scripts/check-rules.mjs`（整体脚本）+ `vitest run`；本地 pre-commit hook 同步 | CI 整体（AI-004 规则文档明确"AI-004 本身无 check-rules.mjs 专属 enforcement，其必跑三件套由 CI 整体执行保障（不触发 META-003）"） | META-003 ✅ / META-001 ✅ |

**META 合规自检结论**：
- `[约束]` 本 Spec 对 check-rules.mjs 的唯一改动是**既有 SEC-002 分支内新增豁免标记识别**（非新增 `markEnforcement(...)` 分支），不触发 META-003 声明漂移；SEC-002 规则文档同步补豁免标记段，满足 META-004。
- `[约束]` 本 Spec 引用的所有 check-rules.mjs 既有分支（ARCH-001/002、CODE-002/004、SEC-001/002/003a、AI-005）均有对应规则文档块（不触发 META-004 反向缺口）。
- `[约束]` 本 Spec 每条实现性规则的"校验方式"均含机器校验关键词（check-rules.mjs / tsc / vitest / CI / Reviewer subagent / 契约测），满足 META-001。

## 12. Out of scope

- **收件人收件箱列表**：`[约束]` PRD Q4b 明确本期仅提供 markRead 端点，不提供"我的通知"列表（收件人查看自己收到的通知）。收件箱列表待未来迭代（需收件人维度的 list 端点 + 权限模型）。
- **群发通知（多收件人）**：`[约束]` 本期 recipient_id 为单用户；`findByIds` 批量查为未来群发预留语义，但 send 仅校验单收件人。群发待未来迭代。
- **通知保留期/清理任务**：`[约束]` 本期不设通知清理任务（Out of scope）；审计日志保留期仍 90 天（沿用 PRD-AUDIT-001）。
- **notification:read/write 端到端鉴权**：`[advisory]` 受限于既有 `Ctx`（admin|user）鉴权桩，本期 admin 视为全权限；"仅 notification:read 管理员"验收待 Auth 富化 Ctx 后补。
- **operator_name 富化**：`[advisory]` markRead 经 withAudit 埋点时 operator_name 桩为 'admin'（非 admin 收件人语义不准），待 Auth 富化 Ctx 后从 UserRepository 读姓名快照，须反向同步 Spec。
- **既有 OpenAPI 片段同步**：`[advisory]` user/role/dept/audit.openapi.yaml 的 PermissionCode/ErrorCode/AuditLogEntityType 枚举须同步追加 notification 相关值，本轮未顺带更新，记为遗留同步项。
- **真实 DB 接入**：`[advisory]` 本 MVP repository 内存实现，DB schema 仅作文档 SSOT（见 §7）。
- **SEC-002 豁免标记滥用防护**：`[约束]` 本期豁免标记共两处使用（markRead + AuditLogService.record），Reviewer 须逐条核对豁免合理性。未来若自服务方法增多，可考虑在规则文档限定豁免 reason 白名单（recipient self-service 等）。

**[advisory] 反向同步（impl-writer 实现期偏离 D4，已同步 authz.md，此处补 Spec）**：实现 F2-5（markRead 自服务埋点 operator_id=收件人）时发现，`AuditLogService.record(input, ctx)` 内的 `requireAdmin(ctx)` 会拒绝非 admin 收件人，导致 markRead 的旁路埋点被 withAudit catch 吞掉、日志不入库，F2-5 不可达。故对 `record` 也声明 `// SEC-002-exempt: framework-internal bypass logging via withAudit; authz delegated to audited service method` 豁免标记并移除 requireAdmin。
- **理由**：record 是框架内部旁路日志写入方法，由 withAudit 在被审计 service 方法**已通过自身鉴权**（create/update/send/delete 走 requireAdmin；markRead 走收件人守卫）后调用；operator_id 取自 input.operator_id（withAudit 从 ctx.user.id 设置），反映真实操作者。record 移除 requireAdmin 不引入越权面：record 仅 append-only 写日志（不改业务态），且其调用方（withAudit）只在被审计方法成功后调用。
- **隐含契约**：被审计 service 方法须自行完成鉴权（SEC-002 对 admin 方法 + markRead 收件人守卫）；record 信任调用方已鉴权。Reviewer 须核对此契约未被破坏（任何新增 withAudit 包装点须确保被包装方法已鉴权）。
- **authz.md 已同步**：SEC-002 豁免段已含 markRead + record 两处（META-004 合规）。

## 13. 自检与遗留

- `[约束]` 自检（沿用既有 + 本轮新增）：
  - contracts tsc：本任务完成后须 0 错误（含新增 notification.ts + 联动编辑的 role.ts/user.ts/audit.ts/index.ts）。
  - apps/api tsc：本任务完成后须 0 错误——`errors.ts` `errorCodeToHttpStatus` 须补 4 个 `NOTIFICATION_*`（impl-writer 联动）；`UserService.findByIds` / `NotificationService` / `NotificationRepository` / `domain/notification.ts` / `router/notification.ts` 新增。
  - `node scripts/check-rules.mjs`：通过（ARCH-001/002、CODE-002/004、SEC-001/002（含豁免标记识别）/003a、AI-005、META-001/003/004 全绿，0 error；SEC-002 豁免标记 push info 不阻断）。
  - OpenAPI 与 Zod 1:1：`api-spec/notification.openapi.yaml` 字段/类型/枚举/必填/.strict() 与 notification.ts 对齐。
  - 边界每条有错误码且在 errorCodeSchema：B1 VALIDATION_ERROR / B2 UNAUTHORIZED / B3/B4 FORBIDDEN / B5 NOTIFICATION_NOT_FOUND / B6 NOTIFICATION_INVALID_TRANSITION / B7 NOTIFICATION_RECIPIENT_NOT_FOUND / B8 NOTIFICATION_RECIPIENT_DISABLED / B9 无客户端码（best-effort）均在校举或明确标注。
  - 实现性描述均有 `[约束]`/`[advisory]` 标记。
  - 跨域联动改动已列出（§2 + §4.1 + §8）。
  - 受影响测试清单章节存在且分①②两类标注、基于真实 grep 结果（§8，AI-006 增强）。
  - AI-007 端到端验收指引存在且覆盖 F2 8 条 + F3 5 条（§9）。
  - 校验方式标注完整（§10，META-001/003/004 合规）。
- `[advisory]` 遗留风险：
  1. notification:read/write 端到端鉴权待 Auth 富化 Ctx（同 audit:read/report:read 遗留）。
  2. 既有 OpenAPI 片段枚举同步待 impl-writer/文档维护者。
  3. errors.ts Record 补码待 impl-writer（TS2741）。
  4. SEC-002 豁免标记识别逻辑 + 规则文档补段待 impl-writer（§3.3 D5）。
  5. operator_name MVP 桩对 markRead 非收件人语义不准（§3.3 advisory）。
  6. NotificationService 注入 UserService 为 service→service 新模式，impl-writer 须验证 ARCH-001 扫描通过（ARCH-001 仅禁 service→router，不禁 service→service）。
  7. markRead procedure 类型须扩展支持"无 permission 的 public 自服务 procedure"，impl-writer 须保证 SEC-001 扫描通过（markRead 仍声明 auth）。
