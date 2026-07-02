---
doc_type: TECH-Spec
id: TECH-OPTIMISTIC-LOCKING-001
title: 乐观锁并发控制 Tech-Spec
prd_ref: PRD-OPTIMISTIC-LOCKING-001
status: decided
created: 2026-07-02
---

# TECH-OPTIMISTIC-LOCKING-001 · 乐观锁并发控制 Tech-Spec

## 1. 概述
在既有 user/role/notification 三域的可编辑实体上追加 `version` 字段 + `If-Match` 条件请求 + 冲突检测。所有写操作（update / delete / 状态转移）须携带 `If-Match: <version>` header，service 层比对实体当前 version，不匹配抛 `VERSION_CONFLICT`（409，响应含 `current_version`）；缺失 header 抛 `VERSION_REQUIRED`（400）。

## 2. 契约层变更（contracts）

### D1 · version 字段扩散（3 实体 schema）
- `userSchema` 追加 `version: z.number().int().min(0)`（初始 0，updateStatus 时 +1）。
- `roleSchema` 追加 `version: z.number().int().min(0)`（初始 0，setParent/unsetParent 时 +1）。
- `notificationSchema` 追加 `version: z.number().int().min(0)`（初始 0，update/send/markRead/delete 时 +1）。
- **Department / UserRole 不加 version**（Dept 无 update 端点 Q6；UserRole 是关联增删非实体更新 Q7）。
- **createInput 不含 version**（version 由服务端生成，createInputSchema `.strict()` 拒绝多余字段）。

### D2 · errorCodeSchema 追加 2 码
- `VERSION_REQUIRED`（400，入参校验失败，与 VALIDATION_ERROR 同层）。
- `VERSION_CONFLICT`（409，状态冲突，与 USER_ALREADY_* 409 同层）。

### D3 · errorResponseSchema 扩展（首次扩展错误响应体）
- 追加可选 `current_version: z.number().int().min(0).optional()` 字段（仅 VERSION_CONFLICT 时填充）。
- **不破坏既有消费者**：current_version 为 optional，既有 `{code, message}` 消费者不受影响。

### D4 · 写 procedure input schema 追加 expected_version
- 需追加 `expected_version` 的 procedure input schema（8 个写操作）：
  - `updateUserStatusProcedureInputSchema`（user.updateStatus）
  - `roleDetailProcedureInputSchema`（role.delete）—— **注意**：roleDetail 同时用于 delete 和 detail 读，需拆分为 `roleDeleteProcedureInputSchema`（含 expected_version）与保留 `roleDetailProcedureInputSchema`（读，不含）
  - `setParentProcedureInputSchema`（role.setParent）
  - `unsetParentProcedureInputSchema`（role.unsetParent）
  - `updateNotificationProcedureInputSchema`（notification.update）
  - `notificationIdProcedureInputSchema`（notification.send/markRead/delete）—— **注意**：同上需拆分读写版本
- **拆分原则**：同一 path 参数的读/写 procedure 不共享 input schema（读无 expected_version，写有）。新增 `*WriteProcedureInputSchema` 导出供 server.ts 写路由引用，读路由继续用原 schema。
- `expected_version: z.number().int().min(0)`（必填，server.ts 从 If-Match header 注入）。
- **Q4 决策**：必填，缺失 → schema safeParse 失败。但 safeParse 失败返回 VALIDATION_ERROR 而非 VERSION_REQUIRED。为精确区分，server.ts 在 safeParse **之前**对 versioned 路由检查 If-Match header 存在性，缺失直接抛 VERSION_REQUIRED（400），不进入 schema safeParse。

## 3. domain 层变更

### D5 · validateVersion 纯函数（新增 domain/version.ts）
```ts
export function validateVersion(
  expected: number,
  actual: number,
): { ok: true } | { ok: false; errorCode: 'VERSION_CONFLICT' } {
  if (expected !== actual) return { ok: false, errorCode: 'VERSION_CONFLICT' };
  return { ok: true };
}
```
- 归属 `domain/version.ts`（纯函数无 IO，ARCH-001 合规）。
- 与 `validateSetParent` / `transitionStatus` 同模式（domain 持纯函数，service 调用转抛 AppError）。

### D6 · 实体类型自动跟随
- `UserEntity` / `RoleEntity` / `NotificationEntity` 均为 `z.infer` 派生的类型别名，schema 追加 version 后类型自动跟随，domain 层无需手改。

## 4. repository 层变更

### D7 · update 方法递增 version
所有 update 方法在构造 updated 实体时追加 `version: oldEntity.version + 1`：
- **UserRepository**：`updateStatus` / `updateDepartmentId` 追加 version +1。
- **RoleRepository**：`update`（setParent/unsetParent 用）追加 version +1。
- **NotificationRepository**：`update` / `updateStatusAndSentAt` / `updateStatusAndReadAt` 追加 version +1。
- **delete 不递增 version**（delete 移除实体，无 version 概念；delete 的版本校验在 service 层比对 delete 前的 version，通过后直接删除）。
- **insert 不设 version**（service 层构造实体时填 `version: 0`，repo insert 仅存储）。

### D8 · seed 数据 version=0
- `seedBuiltinAdmin`：追加 `version: 0`。
- server.ts `seedDemoData`：追加 `version: 0`。

## 5. service 层变更

### D9 · 守卫顺序编排（B5 → B_version → B6/B7/B8）
版本校验插入"实体存在（B5）"之后、"业务规则（B6/B7/B8）"之前：
```
updateStatus:  B3 鉴权 → B5 用户存在 → B_version 版本匹配 → B6 禁用自身 → B7/B8 状态守卫
delete(role):  B3 鉴权 → B5 角色存在 → B_version 版本匹配 → B6 内置 → B8 子角色 → B7 已分配
setParent:     B3 鉴权 → B5 角色存在(B5a) → B5b 父角色存在 → B_version 版本匹配 → validateSetParent(自继承/内置/环)
unsetParent:   B3 鉴权 → B5 角色存在 → B_version 版本匹配 → B6 内置
update(notif): B3 鉴权 → B5 通知存在 → B_version 版本匹配 → B6 仅 draft
send:          B3 鉴权 → B5 → B_version → B6 仅 draft → B7 收件人存在 → B8 收件人禁用
markRead:      B5 → B_version → B4 收件人 → B6 仅 sent
delete(notif): B3 鉴权 → B5 → B_version → B6 仅 draft
```

### D10 · service 方法签名追加 expected_version 参数
所有写操作的 service 方法追加 `expectedVersion: number` 参数（首位或末位，与既有 ctx 位置一致）：
- `UserService.updateStatus(targetId, newStatus, expectedVersion, ctx)`
- `RoleService.delete(id, expectedVersion, ctx)`
- `RoleService.setParent(roleId, parentRoleId, expectedVersion, ctx)`
- `RoleService.unsetParent(roleId, expectedVersion, ctx)`
- `NotificationService.update(id, input, expectedVersion, ctx)`
- `NotificationService.send(id, expectedVersion, ctx)`
- `NotificationService.markRead(id, expectedVersion, ctx)`
- `NotificationService.delete(id, expectedVersion, ctx)`

### D11 · VERSION_CONFLICT 携带 current_version
service 层检测到版本不匹配时，抛 `new AppError('VERSION_CONFLICT', msg, { current_version: entity.version })`。
- AppError 追加可选 `meta?: Record<string, unknown>` 字段（D12）。
- server.ts 错误处理将 `e.meta` 合并到响应体。

### D12 · 审计日志记录 version 变更（Q11）
写操作的 WriteResult 的 before/after 追加 `version` 字段：
- before: `{ field: 'version', value: oldVersion, pii: false }`
- after: `{ field: 'version', value: newVersion, pii: false }`
- delete 的 before 含 version（after 为空，delete 无 after）。
- 冲突时不写审计日志（冲突不修改实体，无 withAudit 触发）。

## 6. errors.ts 变更

### D13 · AppError 追加 meta 字段
```ts
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly meta?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.meta = meta;
  }
}
```

### D14 · errorCodeToHttpStatus 追加 2 码
```ts
VERSION_REQUIRED: 400,
VERSION_CONFLICT: 409,
```

## 7. router 层变更

### D15 · 写 procedure input schema 拆分读写
- `roleDetailProcedureInputSchema`（读，detail 用）保持不变。
- 新增 `roleDeleteProcedureInputSchema = roleDetailProcedureInputSchema.extend({ expected_version: z.number().int().min(0) })`。
- `notificationIdProcedureInputSchema`（读，detail 用）保持不变。
- 新增 `notificationWriteIdProcedureInputSchema = notificationIdProcedureInputSchema.extend({ expected_version: z.number().int().min(0) })`（send/markRead/delete 共用）。
- `updateUserStatusProcedureInputSchema` 追加 `expected_version`（updateStatus 仅写用，无需拆分）。
- `setParentProcedureInputSchema` / `unsetParentProcedureInputSchema` 追加 `expected_version`。
- `updateNotificationProcedureInputSchema` 追加 `expected_version`。

### D16 · procedure handler 传递 expected_version
router handler 从 `input.expected_version` 提取并传给 service 方法：
```ts
handler: withAudit(
  (input, ctx) => service.updateStatus(input.id, input.body.status, input.expected_version, ctx),
  ...
)
```

## 8. server.ts 变更

### D17 · Route 类型追加 versioned 标记
```ts
type Route = {
  method: string;
  pattern: string;
  buildInput: (m: MatchCtx) => unknown;
  inputSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  handler: (input: unknown, ctx: Ctx) => Promise<unknown>;
  auth: 'admin' | 'public';
  versioned: boolean; // 新增：true 表示写操作须 If-Match header
};
```
- `defineRoute` 追加 `versioned` 参数（默认 false）。
- versioned=true 的路由：server.ts 从 `If-Match` header 解析 version（纯数字），缺失 → VERSION_REQUIRED（400），格式非法 → VALIDATION_ERROR（400），合法 → 注入 `expected_version` 到 rawInput。

### D18 · If-Match header 解析与注入
```ts
// handle() 内，safeParse 之前：
if (route.versioned) {
  const ifMatch = req.headers['if-match'];
  if (ifMatch === undefined) {
    sendJson(res, 400, { error: 'VERSION_REQUIRED', message: '写操作须携带 If-Match header' });
    return;
  }
  const parsed = Number(ifMatch);
  if (!Number.isInteger(parsed) || parsed < 0) {
    sendJson(res, 400, { error: 'VALIDATION_ERROR', message: 'If-Match 须为非负整数' });
    return;
  }
  rawInput = { ...rawInput, expected_version: parsed };
}
```

### D19 · 错误响应合并 meta
```ts
if (e instanceof AppError) {
  const status = errorCodeToHttpStatus[e.code] ?? 500;
  const body: Record<string, unknown> = { error: e.code, message: e.message };
  if (e.meta) Object.assign(body, e.meta);
  sendJson(res, status, body);
  return;
}
```

### D20 · versioned 路由标记清单
以下路由 `versioned: true`：
- `PATCH /v1/users/:id/status`（updateStatus）
- `DELETE /v1/roles/:id`（role.delete）
- `POST /v1/roles/:roleId/parent`（setParent）
- `DELETE /v1/roles/:roleId/parent`（unsetParent）
- `PATCH /v1/notifications/:id`（notification.update）
- `POST /v1/notifications/:id/send`（send）
- `POST /v1/notifications/:id/read`（markRead）
- `DELETE /v1/notifications/:id`（notification.delete）

以下路由 `versioned: false`（create / assign / remove / 读操作 / transfer / dept）：
- 所有 GET（list/detail/tree/inheritance-chain/effective-permissions）
- POST /v1/users（create）
- POST /v1/roles（create）
- POST /v1/notifications（create）
- POST/DELETE /v1/users/:userId/roles/:roleId（assign/remove，Q7 不纳入）
- POST /v1/users/:userId/transfer（transfer，Q8 不纳入）
- 所有 dept 路由（无 version 字段）

## 9. 受影响测试清单（AI-006）

### ① 类：schema 变更影响（contracts 层测试）
- 所有断言 userSchema/roleSchema/notificationSchema 字段集的契约测须追加 version 字段。
- errorResponseSchema 断言须覆盖 current_version 可选字段。
- errorCodeSchema 断言须追加 VERSION_REQUIRED / VERSION_CONFLICT。

### ② 类：既有测试加 If-Match（service/router/端到端测试）
- 所有调用写操作的既有测试须传 expected_version 参数（service 直调）或 If-Match header（router/HTTP）。
- 涉及文件：user.test.ts / role.test.ts / role-inheritance.test.ts / notification.test.ts / *-embedding.test.ts / transfer.test.ts（transfer 本身不 versioned，但 transfer 内部调 assign/remove 不受影响）。
- **setup 辅助函数**：测试中构造实体时追加 `version: 0`，调用写操作时传 `expectedVersion: 0`（或从实体读取）。

### ③ 类：新增并发冲突测试（optimistic-locking.test.ts + optimistic-locking-embedding.test.ts）
- F1 version 字段：AC-F1-1~F1-5（5 条）
- F2 If-Match 解析：AC-F2-1~F2-4（4 条）
- F3 版本校验：AC-F3-1~F3-6（6 条）
- F4 守卫顺序：AC-F4-1~F4-3（3 条）
- 端到端：lost update 防护 + current_version 返回 + 冲突不修改实体 + 冲突无审计日志

## 10. 边界与异常

| 错误码 | HTTP | 触发条件 | 位置 |
|--------|------|----------|------|
| VERSION_REQUIRED | 400 | 写操作缺失 If-Match header | server.ts（safeParse 前） |
| VALIDATION_ERROR | 400 | If-Match 格式非法（非数字/负数） | server.ts（safeParse 前） |
| VERSION_CONFLICT | 409 | expected_version !== entity.version | service（B_version 守卫） |
| USER_NOT_FOUND | 404 | 用户不存在（优先于 VERSION_CONFLICT） | service（B5 守卫） |
| ROLE_NOT_FOUND | 404 | 角色不存在（优先于 VERSION_CONFLICT） | service（B5 守卫） |
| NOTIFICATION_NOT_FOUND | 404 | 通知不存在（优先于 VERSION_CONFLICT） | service（B5 守卫） |

## 11. ARCH-001 依赖方向
- `domain/version.ts` 不 import 上层（纯函数）。
- service 调 domain.validateVersion + 抛 AppError（meta 携带 current_version）。
- router 不感知 version（expected_version 透传 service）。
- server.ts 解析 header + 注入 input + 合并 meta 到响应（工程脚手架）。
- AppError.meta 是通用扩展点，不耦合 VERSION_CONFLICT 语义。

## 12. 实现顺序
1. contracts 层：3 实体 schema 追加 version + errorCodeSchema 追加 2 码 + errorResponseSchema 扩展 + 写 procedure input schema 追加/拆分 expected_version
2. errors.ts：AppError 追加 meta + errorCodeToHttpStatus 追加 2 码
3. domain 层：新增 version.ts（validateVersion 纯函数）
4. repository 层：3 repo 的 update 方法递增 version + seed 数据 version=0
5. service 层：8 写方法追加 expectedVersion 参数 + B_version 守卫 + 审计日志 version 字段
6. router 层：写 procedure input schema 拆分/追加 expected_version + handler 透传
7. server.ts：Route versioned 标记 + If-Match 解析注入 + 错误响应合并 meta
8. 既有测试修复（②类）+ 新增测试（③类）
9. 三件套验证 + HTTP 烟测
