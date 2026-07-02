---
doc_type: Tech-Spec
id: TECH-ROLE-INHERITANCE-001
prd_ref: PRD-ROLE-INHERITANCE-001
status: draft
owner: dev@team
created: 2026-07-02
extends: TECH-TRANSFER-001
---
# 角色权限继承 · 技术规格（继承链 DAG + 权限并集传递 + 环检测 + 父子约束）

> 标记约定（沿用既有 Spec）：`[约束]` = Dev 必须遵守；`[advisory]` = Dev 可偏离但须反向同步 Spec。
> META 提示：本期**不新增** `.trae/rules/**` 规则文件、**不新增** check-rules.mjs markEnforcement 分支。所有规则复用既有（ARCH-001/CODE-001/002/SEC-001/002/003/AI-005~007/META-001~004），验证它们在递归数据结构新领域下是否闭合。本期核心验证目标 = 工作流对"递归数据结构 + 环检测算法 + 读时聚合"新架构模式的适应性（RETRO-ROUND7-001 §5）。

## 1. 概览与范围

本 Spec 落地 PRD-ROLE-INHERITANCE-001 四个功能点 + 四处跨域契约联动，同时作为第八轮"工作流在更复杂业务适应性"的验证载体（递归数据结构方向）：

- **F1 设置/解除继承关系**：RoleService.setParent/unsetParent，含环检测 + 父子约束 + 自继承拒绝 + 内置 admin 约束。`[约束]`
- **F2 查询继承链**：RoleService.getInheritanceChain 返回祖先角色列表（从父到根，按继承顺序）。`[约束]`
- **F3 计算用户有效权限码集合**：RoleService.getEffectivePermissions 读时聚合（直接角色 ∪ 沿继承链向上递归的父角色权限码并集）。`[约束]`
- **F4 删除角色守卫扩展**：既有 delete 守卫追加 B8 子角色引用校验（ROLE_HAS_CHILDREN），顺序 B5→B6→B8→B7（Q8）。`[约束]`

**本轮核心验证目标**（Tech Lead 须在 Spec 体现）：
1. **AI-006 增强（两类标注，本轮同时触发）**：
   - ①类·contracts 联动驱动：errorCodeSchema 追加 4 码（ROLE_SELF_INHERITANCE / ROLE_BUILTIN_PARENT_FORBIDDEN / ROLE_INHERITANCE_CYCLE / ROLE_HAS_CHILDREN）+ roleSchema 追加 parent_role_id 字段 → grep 引用这两个符号的 test 文件列受影响断言点。
   - ②类·apps/api 内部签名变更驱动：roleSchema 追加 parent_role_id 后，RoleEntity 类型别名变化 → 所有构造 Role 对象的位置（makeRole helper / roleRepo.insert / seedBuiltinAdmin / RoleService.create）须同步追加 parent_role_id: null，否则 tsc 类型错误或 roleSchema.parse 失败。②类清单结论：**有影响**（既有测试构造 Role 对象需同步追加字段），非零影响——这是与 R7 ②类零签名变更的不同点。
2. **AI-007 端到端验收**：F3 有效权限码集合计算（递归遍历 + 并集聚合）+ F1 环检测（跨层行为）须端到端测试，见 §9。
3. **ARCH-001 在 service→repo 递归读下闭合**：getInheritanceChain/getEffectivePermissions 沿 parent_role_id 链递归调 roleRepo.findById（service→repo 递归读），验证 ARCH-001（仅禁 service→router）在递归读下闭合。
4. **CODE-001 在环检测算法下闭合**：环检测算法（祖先遍历）无 any（用 RoleEntity | undefined 类型守卫）。
5. **CODE-002 在递归异常处理下闭合**：递归遍历过程中 roleRepo.findById 返回 undefined（数据不一致）须抛 ROLE_NOT_FOUND（非静默吞）。

## 2. 影响的模块

- `packages/contracts/src/schemas/role.ts`（既有，编辑，跨域联动①）：roleSchema 追加 `parent_role_id: z.string().uuid().nullable()` 字段；errorCodeSchema 追加 4 码（ROLE_SELF_INHERITANCE / ROLE_BUILTIN_PARENT_FORBIDDEN / ROLE_INHERITANCE_CYCLE / ROLE_HAS_CHILDREN，SSOT 仍在 user.ts，本文件不重复定义）。`[约束]` SSOT 仍在 user.ts。
- `packages/contracts/src/schemas/user.ts`（既有，编辑，跨域联动①）：errorCodeSchema 追加 4 码 `ROLE_SELF_INHERITANCE` / `ROLE_BUILTIN_PARENT_FORBIDDEN` / `ROLE_INHERITANCE_CYCLE` / `ROLE_HAS_CHILDREN`。`[约束]` SSOT 仍在 user.ts。
- `packages/contracts/src/schemas/role-inheritance.ts`（本期新增，F1/F2/F3 契约 SSOT）：`setParentInputSchema`（{roleId, parentRoleId} + superRefine roleId!==parentRoleId）+ `inheritanceChainResultSchema`（= z.array(roleSchema)）+ `effectivePermissionsResultSchema`（= z.array(permissionCodeSchema)，去重 + 排序）。`[约束]` CODE-004 命名后缀；SEC-003a 输出 strict。
- `packages/contracts/src/index.ts`（既有，编辑）：追加 `export * from './schemas/role-inheritance.js'`。`[约束]`
- `apps/api/src/domain/role.ts`（既有，编辑）：追加 `validateSetParent(input, deps)` 纯函数（编排校验顺序 §5），返回 `{ok:true} | {ok:false, errorCode}`；追加 `detectCycle(roleId, parentRoleId, findById)` 纯函数（祖先遍历环检测，返回 `{hasCycle: boolean, cyclePath?: string[]}`）。`[约束]` ARCH-001：domain 仅 import contracts。
- `apps/api/src/domain/role-inheritance.ts`（本期新增，F1 校验纯函数）：`validateSetParent` + `detectCycle` 归属此文件（与 role.ts 分离，避免 role.ts 膨胀）。`[约束]` ARCH-001：domain 仅 import contracts。
- `apps/api/src/service/role.ts`（既有，编辑，跨域联动②）：追加 `setParent(roleId, parentRoleId, ctx)` / `unsetParent(roleId, ctx)` / `getInheritanceChain(roleId, ctx)` / `getEffectivePermissions(userId, ctx)` 四方法；既有 `delete` 守卫追加 B8 ROLE_HAS_CHILDREN（B5→B6→B8→B7，Q8）；既有 `create` 追加 `parent_role_id: null`（创建时无父角色，Q9）。`[约束]` ARCH-001：service 不 import router。
- `apps/api/src/repository/role.ts`（既有，编辑，跨域联动②）：追加 `findChildren(roleId)` 方法（查引用该 roleId 作为 parent_role_id 的全部子角色，用于 B8 守卫）；`seedBuiltinAdmin` 追加 `parent_role_id: null`（admin 是根角色）。`[约束]`
- `apps/api/src/router/role.ts`（既有，编辑）：createRoleRouter 追加 setParent/unsetParent/getInheritanceChain/getEffectivePermissions 四 procedure（setParent/unsetParent 经 withAudit 包装，entity_type=role/action=update）；getInheritanceChain/getEffectivePermissions 为读操作不经 withAudit。`[约束]` SEC-001。
- `apps/api/src/router/index.ts`（既有，编辑）：聚合 router 追加 role-inheritance 导出。
- `apps/api/src/errors.ts`（既有，编辑，跨域联动①）：errorCodeToHttpStatus 补齐 4 码（ROLE_SELF_INHERITANCE=400 / ROLE_BUILTIN_PARENT_FORBIDDEN=403 / ROLE_INHERITANCE_CYCLE=409 / ROLE_HAS_CHILDREN=409）。`[约束]` 否则 tsc TS2741。
- `apps/api/src/server.ts`（既有，编辑）：routes 追加 `POST /v1/roles/:roleId/parent` + `DELETE /v1/roles/:roleId/parent` + `GET /v1/roles/:roleId/inheritance-chain` + `GET /v1/users/:userId/effective-permissions`。`[advisory]` 工程脚手架同步。
- `apps/api/src/domain/audit.ts`（既有，零改动）：PII_FIELD_REGISTRY 不新增 role-inheritance 条目；markPii('role', ...) 沿用（setParent 的 before/after 含 parent_role_id 虚拟字段，pii=false）。
- `apps/api/src/service/transfer.ts`（既有，零改动）：TransferService 不受 roleSchema 字段扩展影响（补偿闭包调 roleRepo.insertUserRole/deleteUserRole，不构造 Role 对象）。

## 3. 架构决策（本轮核心）

### 3.1 继承模型：单继承（D1 · 每角色至多一个 parent_role_id）

**决策 D1（`[约束]`）**：单继承——每个角色至多一个 parent_role_id（string | null），null 表示根角色。继承关系存储复用 role 表的 parent_role_id 字段，不新增 role_inheritances 关联表。

```ts
// roleSchema 追加字段
parent_role_id: z.string().uuid().nullable()
```

**理由**：
- 单继承足够验证递归 + 环检测 + 权限传递（PRD Q1 决策①）。
- 复用 role 表字段，不新增关联表，实现简单。
- 多继承（一个角色多个父角色）为 out of scope（PRD §Out of scope）。

### 3.2 环检测算法：祖先遍历（D2 · 设置 parent 时从 parentRoleId 向上遍历）

**决策 D2（`[约束]`）**：设置 parent_role_id 时，从 parentRoleId 开始向上遍历祖先链（parent.parent.parent...），若途中遇到 roleId 则形成环，拒绝（ROLE_INHERITANCE_CYCLE）。

```ts
// domain/role-inheritance.ts
export function detectCycle(
  roleId: string,
  parentRoleId: string,
  findById: (id: string) => RoleEntity | undefined,
): { hasCycle: boolean; cyclePath?: string[] } {
  const path: string[] = [parentRoleId];
  let current: RoleEntity | undefined = findById(parentRoleId);
  while (current) {
    if (current.id === roleId) {
      return { hasCycle: true, cyclePath: [...path, roleId] };
    }
    if (current.parent_role_id === null) {
      return { hasCycle: false };
    }
    path.push(current.parent_role_id);
    current = findById(current.parent_role_id);
  }
  // current === undefined：链中某角色不存在（数据不一致），视为非环但须上层抛 ROLE_NOT_FOUND
  return { hasCycle: false };
}
```

**理由**：
- 单继承下祖先遍历足够（链深度有限，O(链深度)），无需拓扑排序（PRD Q2 决策①）。
- 算法纯函数，归 domain 层（D3），不读写 IO（findById 由 service 注入）。
- 环路径返回（cyclePath）供错误 message 含环路径（如 A→B→A），便于调试（AC-F1-6/F1-7）。

### 3.3 权限传递：读时聚合（D3 · 查询时沿继承链递归计算，不存储冗余副本）

**决策 D3（`[约束]`）**：有效权限码集合读时聚合——查询 getEffectivePermissions(userId) 时，对用户直接分配的每个角色，沿 parent_role_id 链向上递归收集 permission_codes，取并集。不存储 effective_permission_codes 冗余字段。

```ts
// service/role.ts
async getEffectivePermissions(userId: string, ctx: Ctx): Promise<PermissionCode[]> {
  this.requireAdmin(ctx);
  const user = this.userRepo.findById(userId);
  if (!user) throw new AppError('USER_NOT_FOUND', `用户不存在: ${userId}`);
  const userRoles = this.roleRepo.findUserRolesByUser(userId);
  const permissionSet = new Set<PermissionCode>();
  for (const ur of userRoles) {
    const role = this.roleRepo.findById(ur.role_id);
    if (!role) continue; // 数据不一致静默跳过（角色被删除但 user_role 未清理，理论上不会发生）
    // 沿继承链向上递归收集 permission_codes
    let current: RoleEntity | undefined = role;
    while (current) {
      for (const code of current.permission_codes) {
        permissionSet.add(code);
      }
      if (current.parent_role_id === null) break;
      current = this.roleRepo.findById(current.parent_role_id);
    }
  }
  // 去重 + 排序保证确定性（Q7）
  return [...permissionSet].sort();
}
```

**理由**：
- 读时聚合避免冗余副本不一致（PRD Q3 决策①）——继承关系变更（setParent/unsetParent）后，下次查询自动反映新继承链（AC-F3-5）。
- 内存实现性能足够（角色数有限，链深度有限）。
- 去重（Set）+ 排序（sort）保证返回结果确定性（Q7）。

### 3.4 校验纯函数归属（D4 · domain 层，参考 transfer validateTransferInput 先例）

**决策 D4（`[约束]`）**：setParent 的校验逻辑放 domain 层纯函数 `validateSetParent(input, deps): {ok:true} | {ok:false, errorCode}`，不读写 IO。deps 为查询结果快照（roleExists/parentExists/roleIsBuiltin/parentIsBuiltin/hasCycle），由 service 层预先查询注入。

```ts
// domain/role-inheritance.ts
export function validateSetParent(
  input: { roleId: string; parentRoleId: string },
  deps: {
    roleExists: boolean;
    parentExists: boolean;
    roleIsBuiltin: boolean;
    parentIsBuiltin: boolean;
    hasCycle: boolean;
  },
): { ok: true } | { ok: false; errorCode: ErrorCode } {
  if (!deps.roleExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (!deps.parentExists) return { ok: false, errorCode: 'ROLE_NOT_FOUND' };
  if (deps.roleIsBuiltin) return { ok: false, errorCode: 'ROLE_BUILTIN_FORBIDDEN' };
  if (input.roleId === input.parentRoleId) return { ok: false, errorCode: 'ROLE_SELF_INHERITANCE' };
  if (deps.parentIsBuiltin) return { ok: false, errorCode: 'ROLE_BUILTIN_PARENT_FORBIDDEN' };
  if (deps.hasCycle) return { ok: false, errorCode: 'ROLE_INHERITANCE_CYCLE' };
  return { ok: true };
}
```

**理由**：校验为纯逻辑（无 IO），归 domain 层；service 层负责查询 deps 快照注入 + 调用 + 抛 AppError。与 transfer validateTransferInput 模式一致（R7 D3 先例）。

### 3.5 setParent/unsetParent 的审计日志（D5 · entity_type=role/action=update，before/after 含 parent_role_id 虚拟字段）

**决策 D5（`[约束]`）**：setParent/unsetParent 经 withAudit 包装，entity_type=`role`，action=`update`。before/after 含 parent_role_id 虚拟字段的旧值/新值（pii=false，沿用 markPii('role',...)）。

```ts
// setParent 的 WriteResult
const before = markPii('role', [
  { field: 'parent_role_id', value: role.parent_role_id, pii: false },
]);
const changes = markPii('role', [
  { field: 'parent_role_id', value: parentRoleId, pii: false },
]);
return { entity: updated, changes, before };
```

**理由**：
- 继承关系是角色属性变更，entity_type=role/action=update（PRD Q6 决策）。
- before/after 仅含 parent_role_id 虚拟字段（不包含 permission_codes，因 permission_codes 未变更）。
- 复用 R5 withAudit D1 HOF 模式，不新增埋点机制。

### 3.6 删除守卫顺序扩展（D6 · B5→B6→B8→B7，结构约束优先）

**决策 D6（`[约束]`）**：既有 delete 守卫顺序 B5（角色存在）→ B6（内置）→ B7（已分配 ROLE_IN_USE），本期在 B6 与 B7 之间插入 B8（子角色引用 ROLE_HAS_CHILDREN）：B5→B6→B8→B7。

**理由**：
- 结构约束（无子角色）优先于使用约束（未分配），避免删除后子角色 parent_role_id 悬空（PRD Q8 决策）。
- B8 在 B6 之后：内置角色不可删先于子角色校验（内置角色本身也不应被删除，B6 先拦截）。
- B8 在 B7 之前：若角色有子角色，应优先提示"须先解除子角色继承"而非"须先解除用户分配"（结构清理优先）。

### 3.7 getInheritanceChain 返回形状（D7 · 祖先角色数组，从父到根）

**决策 D7（`[约束]`）**：getInheritanceChain(roleId) 返回 `Role[]`（祖先角色数组，从直接父角色到根角色，按继承顺序）。根角色返回空数组 `[]`。

```ts
// service/role.ts
async getInheritanceChain(roleId: string, ctx: Ctx): Promise<Role[]> {
  this.requireAdmin(ctx);
  const role = this.roleRepo.findById(roleId);
  if (!role) throw new AppError('ROLE_NOT_FOUND', `角色不存在: ${roleId}`);
  const chain: RoleEntity[] = [];
  let current: RoleEntity | undefined = role;
  while (current.parent_role_id !== null) {
    const parent = this.roleRepo.findById(current.parent_role_id);
    if (!parent) throw new AppError('ROLE_NOT_FOUND', `继承链中角色不存在: ${current.parent_role_id}`);
    chain.push(parent);
    current = parent;
  }
  return chain;
}
```

**理由**：返回 Role[]（非 id 数组）便于调用方直接获取祖先角色详情（含 permission_codes），无需二次查询。根角色返回 []（AC-F2-3）。

## 4. 边界与异常

| 场景 | 错误码 | HTTP | 阶段 |
|---|---|---|---|
| 角色不存在 | ROLE_NOT_FOUND | 404 | 校验 |
| 父角色不存在 | ROLE_NOT_FOUND | 404 | 校验 |
| 自继承（parentRoleId === roleId） | ROLE_SELF_INHERITANCE | 400 | 校验 |
| 父角色为内置 admin | ROLE_BUILTIN_PARENT_FORBIDDEN | 403 | 校验 |
| 对内置角色设置/解除继承 | ROLE_BUILTIN_FORBIDDEN | 403 | 校验 |
| 新继承关系形成环 | ROLE_INHERITANCE_CYCLE | 409 | 校验 |
| 删除有子角色的角色 | ROLE_HAS_CHILDREN | 409 | delete 守卫 B8 |
| 用户不存在（getEffectivePermissions） | USER_NOT_FOUND | 404 | 校验 |
| 非管理员调用 | FORBIDDEN | 403 | requireAdmin |

## 5. 校验顺序（D4/D6，先到先返，不叠加）

### setParent 校验顺序
1. requireAdmin(ctx) → FORBIDDEN
2. 角色存在（roleId）→ ROLE_NOT_FOUND
3. 父角色存在（parentRoleId）→ ROLE_NOT_FOUND
4. 角色非内置（roleId）→ ROLE_BUILTIN_FORBIDDEN
5. roleId !== parentRoleId → ROLE_SELF_INHERITANCE
6. 父角色非内置（parentRoleId）→ ROLE_BUILTIN_PARENT_FORBIDDEN
7. 环检测（detectCycle）→ ROLE_INHERITANCE_CYCLE

### delete 守卫顺序（D6 扩展）
1. B5 角色存在 → ROLE_NOT_FOUND
2. B6 内置 → ROLE_BUILTIN_FORBIDDEN
3. B8 子角色引用 → ROLE_HAS_CHILDREN（**本期新增**）
4. B7 已分配 → ROLE_IN_USE

## 6. 路由（F1/F2/F3）

```
POST   /v1/roles/:roleId/parent              body: { parentRoleId }    → setParent
DELETE /v1/roles/:roleId/parent                                        → unsetParent
GET    /v1/roles/:roleId/inheritance-chain                            → getInheritanceChain
GET    /v1/users/:userId/effective-permissions                         → getEffectivePermissions
```

input 组装：
- setParent：`{ roleId: path.roleId, parentRoleId: body.parentRoleId }`
- unsetParent：`{ roleId: path.roleId }`
- getInheritanceChain：`{ roleId: path.roleId }`
- getEffectivePermissions：`{ userId: path.userId }`

## 7. 环检测算法详述（D2）

```
detectCycle(roleId, parentRoleId, findById):
  path = [parentRoleId]
  current = findById(parentRoleId)
  while current !== undefined:
    if current.id === roleId:
      return { hasCycle: true, cyclePath: [...path, roleId] }  // 环形成
    if current.parent_role_id === null:
      return { hasCycle: false }  // 到达根角色，无环
    path.push(current.parent_role_id)
    current = findById(current.parent_role_id)
  return { hasCycle: false }  // 链中某角色不存在（数据不一致），视为非环（上层须抛 ROLE_NOT_FOUND）
```

**环路径示例**（AC-F1-6/F1-7）：
- A→B→A：已有 B.parent=A，设置 A.parent=B → detectCycle(A, B, findById)：path=[B]，current=B，B.id!==A，B.parent=A，path=[B,A]，current=A，A.id===A → hasCycle=true, cyclePath=[B,A,B]（或 [B,A]→A，message 含 A→B→A）
- A→C→B→A：已有 C.parent=B + B.parent=A，设置 A.parent=C → detectCycle(A, C, findById)：path=[C]，current=C，C.id!==A，C.parent=B，path=[C,B]，current=B，B.id!==A，B.parent=A，path=[C,B,A]，current=A，A.id===A → hasCycle=true

## 8. AI-006 受影响测试清单（两类标注）

### ①类·contracts 联动驱动（grep 命中）

**grep 命令与命中**：
- `grep -rn "errorCodeSchema\|ErrorCode" apps/api/test/**/*.ts`：notification.test.ts:36/878-879 + report.test.ts:37/960-961（均用 `[...errorCodeSchema.options]` SSOT 派生，追加 4 码后自动覆盖，**零改动**）
- `grep -rn "roleSchema\|roleListResultSchema" apps/api/test/**/*.ts`：role.test.ts:15-16/250-253/265-272/278-282/517/709-715（roleSchema.parse 断言，追加 parent_role_id 后需确保 service 返回的 Role 含该字段，否则 parse 失败——**需核实 service.create/getById/list 返回的 Role 含 parent_role_id**）

**①类断点**：
- **L272/L282/L517/L713/L715 roleSchema.parse**：roleSchema 追加 parent_role_id 后，若 service 返回的 Role 不含 parent_role_id → .strict() 模式下 parse 失败。**修复方向**：service 层 RoleService.create/getById/list 返回的 Role 须含 parent_role_id（由 repo 层存储态带出，create 时设 null，Q9）。test-writer 须核实 service 返回值含 parent_role_id，无需改断言（parse 自动覆盖新字段）。
- **errorCodeSchema 全集断言**：SSOT 派生（`[...errorCodeSchema.options]`），追加 4 码后自动覆盖，**零改动**（AI-005 价值）。

### ②类·apps/api 内部签名变更驱动（Tech Lead 手动分析）

**签名变更**：roleSchema 追加 parent_role_id → RoleEntity 类型别名变化 → 所有构造 Role 对象的位置须同步追加 `parent_role_id: null`（否则 tsc 类型错误或 roleSchema.parse 失败）。

**受影响断言点（grep + 手动分析）**：
- **role.test.ts:71-81 makeRole helper**：构造 Role 对象缺 parent_role_id → 需追加 `parent_role_id: null`。影响所有用 makeRole 的测试（约 10 处调用，单点修复 helper 即可）。
- **role.test.ts:349-350 is_builtin:true 构造**：需确认是否经 makeRole（若是则 helper 修复覆盖，若直接构造需单独追加）。
- **transfer.test.ts:79-86, 87-94 roleRepo.insert 构造 Role**：缺 parent_role_id → 需追加 `parent_role_id: null`（2 处）。
- **transfer.test.ts:337-338 builtin role 构造**：缺 parent_role_id → 需追加 `parent_role_id: null`（1 处）。
- **transfer-embedding.test.ts:186-187, 194-195 roleRepo.insert 构造 Role**：缺 parent_role_id → 需追加 `parent_role_id: null`（2 处）。
- **repository/role.ts:38-46 seedBuiltinAdmin**：构造 admin Role 缺 parent_role_id → 需追加 `parent_role_id: null`（admin 是根角色，1 处）。
- **service/role.ts:63-70 RoleService.create**：构造 Role 缺 parent_role_id → 需追加 `parent_role_id: null`（创建时无父角色，Q9，1 处）。

**②类清单结论**：**有影响**（非零影响）。需同步更新 7 处构造 Role 对象的位置（makeRole helper 1 处 + transfer.test.ts 3 处 + transfer-embedding.test.ts 2 处 + seedBuiltinAdmin 1 处 + RoleService.create 1 处，其中 makeRole helper 单点修复覆盖约 10 处调用）。这是与 R7 ②类零签名变更的不同点——R8 roleSchema 字段扩展击穿既有测试的 Role 对象构造。

**test-writer 反向核实要求**：
- 核实 makeRole helper 修复后，所有 makeRole 调用返回的 Role 经 roleSchema.parse 通过。
- 核实 transfer.test.ts / transfer-embedding.test.ts 的 roleRepo.insert 构造 Role 追加 parent_role_id 后，transfer 测试仍通过（补偿闭包不受影响，因 TransferService 不构造 Role 对象）。
- 核实 seedBuiltinAdmin + RoleService.create 追加 parent_role_id 后，role.test.ts 的 create/list/detail 断言通过（roleSchema.parse 含 parent_role_id）。

### 两类标注完整性
- ①类·contracts 联动：errorCodeSchema 4 码（SSOT 派生零改动）+ roleSchema parent_role_id（parse 自动覆盖，需核实 service 返回值含字段）✅
- ②类·service 签名变更：RoleEntity 类型变化击穿 7 处 Role 对象构造（makeRole helper + transfer test + seedBuiltinAdmin + RoleService.create）✅
- 两类均覆盖，缺一无 ✅ 满足 AI-006 增强硬要求

## 9. AI-007 端到端验收指引

### F1 setParent 端到端（环检测 + 父子约束）
- 注入共享 roleRepo，setup 多个角色（A/B/C + 内置 admin），通过 service.setParent 建立继承关系。
- 端到端断言：setParent 成功后 roleRepo.findById(roleId).parent_role_id === parentRoleId；环检测场景（A→B→A）抛 ROLE_INHERITANCE_CYCLE + 两个角色 parent_role_id 不变；内置 admin 约束抛 ROLE_BUILTIN_PARENT_FORBIDDEN + admin 不变。

### F3 getEffectivePermissions 端到端（递归 + 并集聚合）
- 注入共享 roleRepo + userRepo，setup 继承链（C.parent=B, B.parent=A）+ 分配 C 给用户 U。
- 端到端断言：getEffectivePermissions(U) 返回 C ∪ B ∪ A 的 permission_codes 并集（AC-F3-3）。
- 继承关系变更后权限自动更新：setParent(B, A) 后再次查询 U 的有效权限，断言含 A 的 permission_codes（AC-F3-5，读时聚合验证）。

### F4 delete 守卫端到端（B8 ROLE_HAS_CHILDREN）
- setup A + B（B.parent=A），尝试 delete A → 抛 ROLE_HAS_CHILDREN + A 仍存在。
- 解除 B 的继承 + delete A → 成功（AC-F4-3）。

### 端到端测试文件
- `apps/api/test/role-inheritance.test.ts`：service 层单测（setParent/unsetParent/getInheritanceChain/getEffectivePermissions + 校验顺序 + 环检测 + delete B8 守卫）。
- `apps/api/test/role-inheritance-embedding.test.ts`：端到端验收测试（注入共享 roleRepo/userRepo，覆盖 PRD F1/F2/F3/F4 共 21 条 Given/When/Then）。

## 10. 测试矩阵

| 测试文件 | 覆盖范围 | 预估用例数 |
|---|---|---|
| role-inheritance.test.ts | service 层单测（setParent 校验 7 + unsetParent 3 + getInheritanceChain 4 + getEffectivePermissions 7 + delete B8 守卫 3 + 环检测算法 3 + 契约 schema 4） | ~31 |
| role-inheritance-embedding.test.ts | 端到端验收（F1 9 + F2 4 + F3 7 + F4 3，覆盖 PRD 21 条 Given/When/Then） | ~21 |
| 既有 role.test.ts | makeRole helper 追加 parent_role_id（②类修复） | 0 新增（修改 helper） |
| 既有 transfer.test.ts | roleRepo.insert 构造 Role 追加 parent_role_id（②类修复） | 0 新增（修改 3 处） |
| 既有 transfer-embedding.test.ts | roleRepo.insert 构造 Role 追加 parent_role_id（②类修复） | 0 新增（修改 2 处） |

## 11. 既有规则闭合验证

| 规则 | 闭合验证 | 结论 |
|---|---|---|
| ARCH-001 | getInheritanceChain/getEffectivePermissions 沿 parent_role_id 链递归调 roleRepo.findById（service→repo 递归读）；service 不 import router；domain/role-inheritance.ts 仅 import contracts | ✅ 闭合 |
| ARCH-002 | role-inheritance.ts 仅导出 Zod schema + z.infer 类型；validateSetParent/detectCycle 纯函数放 domain | ✅ 闭合 |
| CODE-001 | detectCycle 用 `RoleEntity \| undefined` 类型守卫，无 any；getEffectivePermissions 用 `Set<PermissionCode>` 无 any | ✅ 闭合 |
| CODE-002 | getInheritanceChain 递归中 roleRepo.findById 返回 undefined 抛 ROLE_NOT_FOUND（非静默吞）；setParent 校验失败抛 AppError（非空非仅 console） | ✅ 闭合 |
| CODE-004 | 新增 schema 带后缀（setParentInputSchema/inheritanceChainResultSchema/effectivePermissionsResultSchema）；新错误码 ROLE_* 前缀一致 | ✅ 闭合 |
| SEC-001 | setParent/unsetParent/getInheritanceChain/getEffectivePermissions procedure 声明 auth='admin' + permission='role:write'（写）/ 'role:read'（读） | ✅ 闭合 |
| SEC-002 | RoleService 新增方法入口 requireAdmin；既有 2 条 SEC-002 豁免不变 | ✅ 闭合 |
| SEC-003a | setParentInputSchema/inheritanceChainResultSchema/effectivePermissionsResultSchema 带 .strict() | ✅ 闭合 |
| SEC-003b | setParent 的 before/after 含 parent_role_id 虚拟字段 pii=false（markPii('role',...) 不标 PII）；PII_FIELD_REGISTRY 不新增条目 | ✅ 闭合 |
| AI-005 | errorCodeSchema 4 码经 SSOT 派生（`[...errorCodeSchema.options]`）零改动；permissionCodeSchema 不变 | ✅ 闭合 |
| AI-006 | 两类标注完整（①类 contracts 联动 + ②类 RoleEntity 签名变更击穿 7 处） | ✅ 闭合 |
| AI-007 | 端到端测试覆盖 PRD 21 条 Given/When/Then + Reviewer PRD 逐条核对 | ✅ 闭合 |

## 12. 实现顺序（impl-writer 指引）

1. **contracts 层**（SSOT 先行）：role.ts 追加 parent_role_id + user.ts 追加 4 码 + 新增 role-inheritance.ts + index.ts 追加导出。
2. **errors.ts**：补齐 4 码 HTTP 映射（否则 tsc TS2741）。
3. **domain 层**：新增 role-inheritance.ts（validateSetParent + detectCycle 纯函数）。
4. **repository 层**：role.ts 追加 findChildren + seedBuiltinAdmin 追加 parent_role_id。
5. **service 层**：role.ts 追加 setParent/unsetParent/getInheritanceChain/getEffectivePermissions + delete B8 守卫 + create 追加 parent_role_id。
6. **router 层**：role.ts 追加 4 procedure + index.ts 追加导出。
7. **server.ts**：追加 4 路由。
8. **既有测试修复**（②类）：makeRole helper + transfer test 3 处 + transfer-embedding test 2 处追加 parent_role_id。

> 注：test-writer 先行产出测试（含 ②类修复），impl-writer 后续实现。②类修复属 test-writer 职责（修改测试 setup 的 Role 对象构造），非 impl-writer 跨角色改动。
