---
doc_type: Tech-Spec
id: TECH-TRANSFER-001
prd_ref: PRD-TRANSFER-001
status: draft
owner: dev@team
created: 2026-07-02
extends: TECH-NOTIFICATION-001
---
# 用户调岗事务 · 技术规格（多步原子操作 + 补偿回滚 + 事务感知聚合埋点）

> 标记约定（沿用既有 Spec）：`[约束]` = Dev 必须遵守；`[advisory]` = Dev 可偏离但须反向同步 Spec。
> META 提示：本期**不新增** `.trae/rules/**` 规则文件、**不新增** check-rules.mjs markEnforcement 分支。所有规则复用既有（ARCH-001/CODE-002/SEC-001/SEC-002/AI-005~007/META-001~004），验证它们在多步事务新领域下是否闭合。本期核心验证目标 = 工作流对"多步事务 + 补偿回滚 + 事务感知埋点"新架构模式的适应性（RETRO-ROUND6-001 §5）。

## 1. 概览与范围

本 Spec 落地 PRD-TRANSFER-001 三个功能点 + 四处跨域契约联动，同时作为第七轮"工作流在更复杂业务适应性"的验证载体：

- **F1 调岗事务编排**：TransferService.transfer(input, ctx) 编排校验→改部门→移除旧角色→分配新角色，三步跨域原子操作。`[约束]`
- **F2 补偿回滚机制**：每步执行后记录补偿闭包，失败逆序执行；补偿失败抛 TRANSFER_COMPENSATION_FAILED 非静默吞。`[约束]`
- **F3 事务感知聚合埋点**：transfer 返回 WriteResult<User>，router 层 withAudit 包装记一条聚合审计日志；事务失败抛异常→不埋点→无幽灵日志。`[约束]`

**本轮核心验证目标**（Tech Lead 须在 Spec 体现）：
1. **AI-006 增强（两类标注，本轮同时触发）**：
   - ①类·contracts 联动驱动：errorCodeSchema 追加 4 码（TRANSFER_*）、permissionCodeSchema 追加 transfer:write → grep 引用这两个符号的 test 文件列受影响断言点。
   - ②类·apps/api 内部签名变更驱动：TransferService 为全新 service（无既有签名变更），但补偿闭包**直接调 RoleRepository.insertUserRole/deleteUserRole**（绕过 RoleService）——须分析既有 role.test.ts 中消费 RoleRepository 的断言点是否受影响（新增方法？否，insertUserRole/deleteUserRole 已存在，TransferService 复用，零签名变更）。②类清单结论：零影响（既有 repo 方法复用，无新增签名）。
2. **AI-007 端到端验收**：F2 回滚后状态恢复（注入共享 userRepo+roleRepo 观测）+ F3 无幽灵日志（注入共享 auditRepo 断言空）须端到端测试，见 §9。
3. **ARCH-001 在 service→service→service 三层横向依赖下闭合**：TransferService 注入 UserService+DepartmentService+RoleService（三层 service 横向依赖，沿用 R6 NotificationService→UserService 先例），验证 ARCH-001（仅禁 service→router）在更深横向依赖下仍闭合。
4. **CODE-002 在补偿 catch 下闭合**：补偿回滚的 try/catch 须非空且非仅 console（补偿失败抛 TRANSFER_COMPENSATION_FAILED）。

## 2. 影响的模块

- `packages/contracts/src/schemas/user.ts`（既有，编辑，跨域联动①）：errorCodeSchema 追加 4 码 `TRANSFER_SAME_ROLE` / `TRANSFER_OLD_ROLE_NOT_ASSIGNED` / `TRANSFER_COMPENSATION_FAILED` / `TRANSFER_FAILED`。`[约束]` SSOT 仍在 user.ts。
- `packages/contracts/src/schemas/role.ts`（既有，编辑，跨域联动①）：permissionCodeSchema 追加 `transfer:write`。`[约束]` 不追加 transfer:read（调岗无读操作）。
- `packages/contracts/src/schemas/transfer.ts`（本期新增，F1 契约 SSOT）：`transferInputSchema`（含 userId/toDepartmentId/oldRoleId/newRoleId + oldRoleId!==newRoleId superRefine）+ `transferResultSchema`（= userSchema，复用；输出 strict）。`[约束]` CODE-004 命名后缀；SEC-003a 输出 strict。
- `packages/contracts/src/index.ts`（既有，编辑）：追加 `export * from './schemas/transfer.js'`。`[约束]`
- `apps/api/src/domain/transfer.ts`（本期新增，F1 校验纯函数）：`validateTransferInput(input, deps)` 纯函数，编排校验顺序（§5），返回 `{ok:true} | {ok:false, errorCode}`。`[约束]` ARCH-001：domain 仅 import contracts。
- `apps/api/src/service/transfer.ts`（本期新增，F1/F2/F3）：`TransferService` 注入 `UserService` + `DepartmentService` + `RoleService` + `UserRepository` + `RoleRepository` + `DepartmentRepository`（补偿闭包直接调 repo，§3.4 D4；`DepartmentRepository` 仅用于校验 `toDeptExists`，`[advisory]` 实现期偏离原 5 依赖设计，详见 §3.1）；`transfer(input, ctx)` 方法调 requireAdmin + validateTransferInput + 三步执行 + 补偿闭包 + 返回 WriteResult<User>。`[约束]` ARCH-001：service 不 import router/AuditLogService。
- `apps/api/src/router/transfer.ts`（本期新增，F3）：createTransferRouter + transfer procedure（经 withAudit 包装，entity_type=user/action=update）。`[约束]` SEC-001。
- `apps/api/src/router/index.ts`（既有，编辑）：聚合 router 追加 transfer 导出。
- `apps/api/src/errors.ts`（既有，编辑，跨域联动①）：errorCodeToHttpStatus 补齐 4 码（TRANSFER_SAME_ROLE=400 / TRANSFER_OLD_ROLE_NOT_ASSIGNED=409 / TRANSFER_COMPENSATION_FAILED=500 / TRANSFER_FAILED=500）。`[约束]` 否则 tsc TS2741。
- `apps/api/src/server.ts`（既有，R7 运行时入口，编辑）：routes 追加 `POST /v1/users/:userId/transfer`。`[advisory]` 工程脚手架同步。
- `apps/api/src/domain/role.ts`（既有，零改动）：`ALL_PERMISSION_CODES = [...permissionCodeSchema.options]` 已 SSOT 派生，追加 transfer:write 后 admin seed 自动覆盖。
- `apps/api/src/domain/audit.ts`（既有，零改动）：PII_FIELD_REGISTRY 不新增 transfer 条目；markPii('user', ...) 沿用（transfer 的 entity_type=user，before/after 含 department_id + role_id 虚拟字段，pii=false）。

## 3. 架构决策（本轮核心）

### 3.1 TransferService 依赖注入（D1 · service→service→service 三层横向依赖）

**决策 D1（`[约束]` + `[advisory]` 实现期偏离）**：TransferService 构造注入 6 个依赖：
```ts
constructor(
  private readonly userService: UserService,
  private readonly deptService: DepartmentService,
  private readonly roleService: RoleService,
  private readonly userRepo: UserRepository,      // 补偿闭包直接调（D4）
  private readonly roleRepo: RoleRepository,      // 补偿闭包直接调（D4）
  private readonly deptRepo: DepartmentRepository, // [advisory] 校验 toDeptExists（读，不写入）
) {}
```

**`[advisory]` 反向同步（impl-writer 实现期偏离）**：原 Spec 写 5 依赖（不含 `DepartmentRepository`）。实现期发现：校验阶段前置校验 `toDeptExists` 需直接查部门存在性，而 `DepartmentService` 无 public 只读查询方法（仅 `tree(ctx)` 返回树结构，成本高且语义不匹配）。为遵守 SEC-002（不为查询新增 service public 方法）+ 校验前置不写入（D6）+ ARCH-001（service→repo 横向读，ReportService 注入 AuditLogRepository 先例），额外注入 `DepartmentRepository`（第 6 依赖）仅用于校验 `toDeptExists`（读，不写入）。补偿闭包不调 `deptRepo`（部门变更的补偿是 `userRepo.updateDepartmentId` 改回，不涉及 dept 表）。测试文件（transfer.test.ts / transfer-embedding.test.ts）的 `new TransferService(...)` 调用已同步为 6 参数。

**理由**：
- service→service→service 三层横向依赖（TransferService→UserService/DeptService/RoleService），沿用 R6 NotificationService→UserService 先例。ARCH-001 仅禁 service→router，不禁 service→service（横向依赖同层）。
- 补偿闭包需直接调 repo（D4），故额外注入 UserRepository + RoleRepository。这与 ReportService 注入 AuditLogRepository 先例一致（service→repo 横向读，ARCH-001 不禁）。
- `deptRepo` 仅做读校验（`findById`），不参与补偿写入，故不污染补偿闭包语义。

### 3.2 补偿闭包机制（D2 · 每步记录逆操作，失败逆序执行）

**决策 D2（`[约束]`）**：transfer 方法内维护 `compensations: Array<() => void>` 数组，每步执行成功后 push 对应补偿闭包；任一步骤失败时逆序（`for (let i = compensations.length-1; i>=0; i--)`）执行补偿。

```ts
async transfer(input: TransferInput, ctx: Ctx): Promise<WriteResult<User>> {
  this.requireAdmin(ctx);
  const validation = validateTransferInput(input, { ...deps });  // §3.3
  if (!validation.ok) throw new AppError(validation.errorCode, ...);

  const compensations: Array<() => void> = [];
  try {
    // 步骤 A：改部门
    const fromDeptId = this.userRepo.findById(input.userId)!.department_id;
    this.deptService.assignUserDepartment(input.userId, input.toDepartmentId, ctx);
    compensations.push(() => { this.userRepo.updateDepartmentId(input.userId, fromDeptId, new Date().toISOString()); });

    // 步骤 B：移除旧角色
    this.roleService.remove(input.userId, input.oldRoleId, ctx);
    compensations.push(() => { this.roleRepo.insertUserRole({ user_id: input.userId, role_id: input.oldRoleId, assigned_at: new Date().toISOString() }); });

    // 步骤 C：分配新角色
    this.roleService.assign(input.userId, input.newRoleId, ctx);
    compensations.push(() => { this.roleRepo.deleteUserRole(input.userId, input.newRoleId); });

    // 三步全成功 → 构造聚合 WriteResult
    const updated = this.userRepo.findById(input.userId)!;
    return { entity: updated, changes: [...], before: [...] };
  } catch (e) {
    // 逆序补偿
    for (let i = compensations.length - 1; i >= 0; i--) {
      try { compensations[i]!(); }
      catch (compErr) {
        // 补偿失败：非静默吞（CODE-002），抛 TRANSFER_COMPENSATION_FAILED
        throw new AppError('TRANSFER_COMPENSATION_FAILED', `补偿失败 at step ${i}: ${compErr instanceof Error ? compErr.message : String(compErr)}; 原失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // 补偿完成 → 抛 TRANSFER_FAILED（聚合执行阶段失败）
    throw new AppError('TRANSFER_FAILED', `调岗失败已回滚: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

**理由**：
- 补偿闭包在 service 内构造，逆序执行（栈语义：后执行先补偿）。
- 补偿失败抛 TRANSFER_COMPENSATION_FAILED（500），非静默吞（CODE-002 合规：catch 内 throw，非空非仅 console）。
- 执行阶段失败（A/B/C 抛错）补偿后聚合为 TRANSFER_FAILED（500），message 含原失败原因；校验阶段失败（validateTransferInput）直接传播底层错误码（USER_NOT_FOUND 等，不聚合）。

### 3.3 校验纯函数归属（D3 · domain 层，参考 user/notification 状态机先例）

**决策 D3（`[约束]`）**：校验逻辑放 domain 层纯函数 `validateTransferInput(input, deps): {ok:true} | {ok:false, errorCode}`，不读写 IO。deps 为查询结果快照（user/部门/角色存在性、用户已分配角色集合、builtin 标记），由 service 层预先查询注入。

```ts
// apps/api/src/domain/transfer.ts （示意）
export function validateTransferInput(
  input: TransferInput,
  deps: { userExists: boolean; userActive: boolean; toDeptExists: boolean; newRoleExists: boolean; oldRoleExists: boolean; oldRoleBuiltin: boolean; userHasOldRole: boolean },
): { ok: true } | { ok: false; errorCode: ErrorCode } {
  if (!deps.userExists) return { ok: false, errorCode: 'USER_NOT_FOUND' };
  if (!deps.userActive) return { ok: false, errorCode: 'USER_ALREADY_DISABLED' };
  if (!deps.toDeptExists) return { ok: false, errorCode: 'DEPT_NOT_FOUND' };
  if (!deps.newRoleExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (!deps.oldRoleExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (deps.oldRoleBuiltin) return { ok: false, errorCode: 'ROLE_BUILTIN_FORBIDDEN' };
  if (input.oldRoleId === input.newRoleId) return { ok: false, errorCode: 'TRANSFER_SAME_ROLE' };
  if (!deps.userHasOldRole) return { ok: false, errorCode: 'TRANSFER_OLD_ROLE_NOT_ASSIGNED' };
  return { ok: true };
}
```

**理由**：校验为纯逻辑（无 IO），归 domain 层；service 层负责查询 deps 快照注入 + 调用 + 抛 AppError。与 user/notification 域 transitionStatus 纯函数模式一致。

### 3.4 补偿绕过 service 直接调 repo（D4 · 避免污染）

**决策 D4（`[约束]`）**：补偿闭包**直接调 repo**（userRepo.updateDepartmentId / roleRepo.insertUserRole / roleRepo.deleteUserRole），**不调 service**。

**理由**：
- 经 service 会触发 requireAdmin（ctx 已是 admin 可通过，但冗余）+ withAudit 埋点（污染——补偿操作不应产生审计日志，否则回滚也会埋点，造成幽灵日志）。
- 经 service 还可能触发额外校验（如 roleService.assign 检查 USER_ROLE_ALREADY_ASSIGNED），补偿场景下这些校验可能误拦（如补偿重新分配 oldRole 时，oldRole 已被步骤 B 移除，但若补偿前状态不一致会误报）。
- 直接调 repo 绕过校验与埋点，补偿纯粹是"数据层逆操作"。这是 service→repo 横向写（ARCH-001 不禁，ReportService→AuditLogRepository 先例）。

### 3.5 事务感知聚合 WriteResult（D5 · 复用 withAudit，单条聚合日志）

**决策 D5（`[约束]`）**：transfer 返回 `WriteResult<User>`：
- `entity`：步骤 C 后的 user 快照（含新 department_id）。
- `before`：`markPii('user', [{field:'department_id', value: fromDeptId, pii:false}, {field:'role_id', value: oldRoleId, pii:false}])`
- `changes`（after）：`markPii('user', [{field:'department_id', value: toDepartmentId, pii:false}, {field:'role_id', value: newRoleId, pii:false}])`
- role_id 为虚拟字段（类似 R5 role.assign 的 assigned_user_ids 虚拟字段先例），标记用户当前主角色。

router 层 `withAudit(handler, audit, { entityType:'user', action:'update' })` 包装。事务成功 → handler 返回 WriteResult → withAudit 调 audit.record（一条聚合日志）；事务失败 → handler 抛异常 → withAudit 不调 audit.record → 无幽灵日志。

**理由**：复用 R5 withAudit D1 HOF 模式，不新增埋点机制。聚合日志（一条含 department_id+role_id 变更）符合"一次调岗事件一条审计"语义（PRD Q4 决策①）。

### 3.6 校验顺序与错误码传播（D6 · 先到先返，校验传播/执行聚合）

**决策 D6（`[约束]`）**：
- **校验阶段**（validateTransferInput，前置不写入）：失败直接传播底层错误码（USER_NOT_FOUND/USER_ALREADY_DISABLED/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED），调用方可区分具体原因。
- **执行阶段**（A/B/C 步骤）：失败已回滚后聚合为 TRANSFER_FAILED（500，message 含失败步骤+底层原因）。
- **补偿阶段**：补偿自身失败抛 TRANSFER_COMPENSATION_FAILED（500，message 含补偿失败步骤+原失败原因）。

## 4. 边界与异常

| 场景 | 错误码 | HTTP | 阶段 |
|---|---|---|---|
| 用户不存在 | USER_NOT_FOUND | 404 | 校验 |
| 用户已禁用 | USER_ALREADY_DISABLED | 409 | 校验 |
| 目标部门不存在 | DEPT_NOT_FOUND | 404 | 校验 |
| 新角色不存在 | ROLE_NOT_FOUND | 404 | 校验 |
| 旧角色不存在 | ROLE_NOT_FOUND | 404 | 校验 |
| 旧角色 builtin | ROLE_BUILTIN_FORBIDDEN | 403 | 校验 |
| oldRoleId===newRoleId | TRANSFER_SAME_ROLE | 400 | 校验 |
| 用户未分配 oldRole | TRANSFER_OLD_ROLE_NOT_ASSIGNED | 409 | 校验 |
| 步骤 A/B/C 执行失败（已回滚） | TRANSFER_FAILED | 500 | 执行 |
| 补偿自身失败 | TRANSFER_COMPENSATION_FAILED | 500 | 补偿 |
| 非管理员调用 | FORBIDDEN | 403 | requireAdmin |

## 5. 校验顺序（D6，先到先返，不叠加）

1. requireAdmin(ctx) → FORBIDDEN
2. 用户存在 → USER_NOT_FOUND
3. 用户 active → USER_ALREADY_DISABLED
4. 目标部门存在 → DEPT_NOT_FOUND
5. 新角色存在 → ROLE_NOT_FOUND
6. 旧角色存在 → ROLE_NOT_FOUND
7. 旧角色非 builtin → ROLE_BUILTIN_FORBIDDEN
8. oldRoleId !== newRoleId → TRANSFER_SAME_ROLE
9. 用户已分配 oldRole → TRANSFER_OLD_ROLE_NOT_ASSIGNED

## 6. 补偿闭包定义（D2/D4）

| 步骤 | 正向操作 | 补偿操作（直接调 repo） |
|---|---|---|
| A 改部门 | deptService.assignUserDepartment(userId, toDeptId, ctx) | userRepo.updateDepartmentId(userId, fromDeptId, now) |
| B 移除旧角色 | roleService.remove(userId, oldRoleId, ctx) | roleRepo.insertUserRole({user_id:userId, role_id:oldRoleId, assigned_at:now}) |
| C 分配新角色 | roleService.assign(userId, newRoleId, ctx) | roleRepo.deleteUserRole(userId, newRoleId) |

逆序执行：C 失败→补偿 B+A；B 失败→补偿 A；A 失败→无补偿。

## 7. 路由（F3）

```
POST /v1/users/:userId/transfer
body: { toDepartmentId, oldRoleId, newRoleId }
```
input 组装：`{ userId: path.userId, toDepartmentId: body.toDepartmentId, oldRoleId: body.oldRoleId, newRoleId: body.newRoleId }`

## 8. AI-006 受影响测试清单（两类标注）

### ①类·contracts 联动驱动（grep 命中）

grep `errorCodeSchema` / `ErrorCode` / `permissionCodeSchema` in `apps/api/test/**/*.ts`：

- `apps/api/test/audit-embedding.test.ts` L533：`seenTypes` 断言（枚举所有 entity_type，transfer 不新增 entity_type，**无影响**）
- `apps/api/test/role.test.ts`：admin seed 权限码断言（`[...permissionCodeSchema.options]` SSOT 派生，追加 transfer:write 后自动覆盖，**无影响**——验证 AI-005 SSOT 派生生效）
- `apps/api/test/notification.test.ts` / `notification-embedding.test.ts`：不引用 errorCodeSchema/permissionCodeSchema 的全集断言，**无影响**

**①类结论**：errorCodeSchema 追加 4 码后，既有测试无硬编码全集断言需更新（SSOT 派生已覆盖）；permissionCodeSchema 追加 transfer:write 后，role.test.ts 的 admin seed 断言经 `[...permissionCodeSchema.options]` 自动覆盖。**零改动**。

### ②类·apps/api 内部签名变更驱动（Tech Lead 手动分析）

TransferService 为**全新 service**，无既有 public 方法签名变更。补偿闭包复用既有 `UserRepository.updateDepartmentId` / `RoleRepository.insertUserRole` / `RoleRepository.deleteUserRole`（均已存在，R3/R2 落地），**无新增 repo 方法签名**。

grep `apps/api/test/**/*.ts` 中消费 `UserRepository.updateDepartmentId` / `RoleRepository.insertUserRole` / `RoleRepository.deleteUserRole` 的断言点：均为既有 role/dept 测试的 setup 调用，TransferService 复用不改变其签名/行为，**零影响**。

**②类结论**：零签名变更，零影响。TransferService 新增为独立 service，不击穿既有断言。

### test-writer 反向核实要求

test-writer 须在交付报告显式列出：①类清单 grep 结果是否与 Spec 一致；②类零签名变更结论是否成立（tsc 佐证）。若发现清单外影响点，须列出差异并修正。

## 9. AI-007 端到端验收标准（PRD Given/When/Then 逐条覆盖）

test-writer 须产出 `transfer-embedding.test.ts`（端到端验收），注入**共享** `UserRepository` + `RoleRepository` + `DepartmentRepository` + `AuditLogRepository` 观测多步副作用与回滚恢复：

- **F1 调岗成功**（AC-F1-1）：注入共享依赖 → transfer 成功 → 断言 userRepo 中 user.department_id=toDept、roleRepo 中 oldRole 已移除+newRole 已分配、auditRepo 有一条聚合日志。
- **F2 回滚恢复**（AC-F2-1/2/4）：注入 ThrowingRoleService（步骤 B remove 抛错）→ transfer → 断言 userRepo 中 user.department_id 恢复 fromDept（步骤 A 补偿）、roleRepo 中 oldRole 仍在（未被移除）、auditRepo 无日志。
- **F2 补偿失败告警**（AC-F2-3）：注入 ThrowingUserRepo（updateDepartmentId 补偿抛错）→ transfer 步骤 B 失败 → 补偿 A 抛错 → 断言抛 TRANSFER_COMPENSATION_FAILED。
- **F3 无幽灵日志**（AC-F3-2）：任一步骤失败 → 断言 auditRepo 中无 entity_type=user/action=update 的调岗日志（注入共享 auditRepo 观测）。
- **校验前置**（AC-F1-2~9）：校验失败 → 断言 userRepo/roleRepo 状态未变（无写入）+ auditRepo 无日志。

## 10. Out of scope
- 真实 DB 事务、调岗历史表、批量调岗、跨层级限制、transfer.openapi.yaml（遗留同步）。
