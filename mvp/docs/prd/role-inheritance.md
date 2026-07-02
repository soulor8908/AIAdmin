---
doc_type: PRD-Spec
id: PRD-ROLE-INHERITANCE-001
title: 角色权限继承（继承链 DAG + 权限并集传递 + 环检测 + 父子约束）
status: draft
owner: ba@team
created: 2026-07-02
extends: PRD-TRANSFER-001
prd_ref: RETRO-ROUND7-001
---

# 角色权限继承（继承链 DAG + 权限并集传递 + 环检测 + 父子约束）

## 背景
前七轮演练（RETRO-ROUND7-001 §5）建议下一轮继续探索"更复杂业务的适应性"，候选方向之一为**权限继承**。前七轮的角色模型（PRD-ROLE-001）为**扁平权限码集合**——每个角色独立持有一组 permission_codes，用户被分配多角色后权限码取并集。该模型未验证的工作流边界：

1. **递归数据结构**：角色可声明 `parent_role_id` 形成继承链（DAG），子角色继承父角色的全部权限码（递归向上取并集）。现有 role 域无递归遍历概念，service/repository 均无递归查询。
2. **环检测**：角色继承链须无环（DAG），否则递归计算权限并集会无限循环。设置 parent_role_id 时须校验"新继承关系不形成环"（如 A→B→A 拒绝）。这是新校验类型，未验证既有规则（CODE-001/CODE-002）在环检测算法下闭合。
3. **权限传递语义**：用户的有效权限码 = 直接分配角色的权限码 ∪ 这些角色沿继承链向上递归取并集的父角色权限码。现有 `listUserRoles` 仅返回 user_role 关联，未计算有效权限；须新增"计算用户有效权限码集合"能力（读路径聚合）。
4. **父子约束**：删除角色时须校验"无子角色引用"（否则子角色 parent_role_id 悬空）；内置 admin 不可被设为子角色（admin 是根权限源，不应被继承削弱）；自继承拒绝（parent_role_id === self.id）。
5. **AI-007 端到端验收**：权限继承的"有效权限码集合计算"是跨层行为（service 递归遍历 + repository 状态 + 权限并集聚合），须端到端验收（注入共享 roleRepo 观测继承链结构 + 断言有效权限码集合）。

本期在既有 role 领域上**扩展继承能力**（非新增领域），作为上述五方向的验证载体。权限继承 = 角色 DAG + 递归权限并集 + 环检测，是"递归数据结构 + 算法正确性"的最小完整场景。

## 业务目标
- **目标1（继承链 DAG）**：角色可声明 `parent_role_id` 指向另一角色形成继承关系，子角色继承父角色的全部权限码（递归向上取并集）。
- **目标2（环检测）**：设置 parent_role_id 时须校验"新继承关系不形成环"，形成环则拒绝（ROLE_INHERITANCE_CYCLE）。
- **目标3（权限传递）**：用户的有效权限码 = 直接分配角色权限码 ∪ 沿继承链向上递归的父角色权限码；提供查询用户有效权限码集合的 API。
- **目标4（父子约束）**：删除角色时校验"无子角色引用"（ROLE_HAS_CHILDREN）；内置 admin 不可被设为子角色（ROLE_BUILTIN_PARENT_FORBIDDEN）；自继承拒绝（ROLE_SELF_INHERITANCE）。
- **目标5（验证工作流适应性）**：验证 ARCH-001（service→repo 递归读）、CODE-001（环检测算法无 any）、CODE-002（环检测 catch 须非空）、AI-006（受影响测试清单两类标注）、AI-007（端到端验收有效权限并集）在递归数据结构新领域下是否闭合。

## 用户故事
- 作为管理员，我希望为角色指定父角色，使子角色自动继承父角色的全部权限码，避免重复配置相同权限。
- 作为管理员，我希望系统在设置继承关系时自动检测环（如 A→B→A），拒绝形成环的继承，避免权限计算无限循环。
- 作为管理员，我希望查询某用户的有效权限码集合时，系统自动沿继承链向上递归取并集，返回该用户的全部有效权限。
- 作为管理员，我希望删除角色时系统校验"无子角色引用"，避免子角色的 parent_role_id 悬空。
- 作为管理员，我希望内置 admin 角色不可被设为子角色（admin 是根权限源），避免 admin 被继承削弱语义。
- 作为系统负责人，我希望权限继承是"读时聚合"而非"写时冗余"——子角色不存储继承来的权限码，仅在查询有效权限时沿继承链递归计算，避免继承关系变更时权限码冗余副本不一致。

## 功能点清单
- [ ] F1：设置/解除角色继承关系（setParent(roleId, parentRoleId, ctx) / unsetParent(roleId, ctx)，含环检测 + 父子约束 + 自继承拒绝 + 内置 admin 约束）
- [ ] F2：查询角色继承链（getInheritanceChain(roleId, ctx) 返回从该角色到根的祖先角色列表，按继承顺序）
- [ ] F3：计算用户有效权限码集合（getEffectivePermissions(userId, ctx) = 直接分配角色权限码 ∪ 沿继承链向上递归的父角色权限码并集）
- [ ] F4：删除角色时校验"无子角色引用"（既有 delete 守卫扩展，新增 ROLE_HAS_CHILDREN）

## 数据实体草图
- **Role 扩展字段**：`parent_role_id: string | null`（既有 role 表追加字段，null 表示无父角色即根角色）。
  - `[约束]` parent_role_id 须指向已存在角色（否则 ROLE_NOT_FOUND）。
  - `[约束]` parent_role_id !== self.id（否则 ROLE_SELF_INHERITANCE）。
  - `[约束]` parent_role_id 指向的角色不得是内置 admin（否则 ROLE_BUILTIN_PARENT_FORBIDDEN，admin 是根权限源不可被继承）。
  - `[约束]` 新继承关系不得形成环（否则 ROLE_INHERITANCE_CYCLE，环检测算法：从 parentRoleId 向上遍历祖先，若回到 roleId 则形成环）。
- **继承关系存储**：复用 role 表的 parent_role_id 字段（单继承，每个角色至多一个父角色），不新增 role_inheritances 关联表（单继承足够验证递归 + 环检测，多继承为 out of scope）。
- **有效权限码集合（F3，读时聚合，不存储）**：
  - 用户有效权限码 = ∪(directRole.permission_codes ∪ ancestors(directRole).permission_codes)
  - ancestors(role) = role.parent → role.parent.parent → ... → 根角色（parent_role_id=null）
  - 计算方式：对用户直接分配的每个角色，沿 parent_role_id 链向上递归收集 permission_codes，取并集。
  - 不存储冗余副本——继承关系变更（setParent/unsetParent）后，下次查询有效权限自动反映新继承链（读时聚合）。
- **新增错误码（contracts 联动）**：
  - `ROLE_SELF_INHERITANCE`：parent_role_id === roleId（400，语义冲突，自继承无意义）。
  - `ROLE_BUILTIN_PARENT_FORBIDDEN`：parent_role_id 指向内置 admin（403，admin 是根权限源不可被继承削弱）。
  - `ROLE_INHERITANCE_CYCLE`：新继承关系形成环（409，状态冲突，避免权限计算无限循环）。
  - `ROLE_HAS_CHILDREN`：删除角色时存在子角色引用（409，状态冲突，须先解除子角色的继承关系）。
- **既有错误码复用**：
  - `ROLE_NOT_FOUND`：parent_role_id 指向的角色不存在（404）。
  - `ROLE_BUILTIN_FORBIDDEN`：对内置 admin 设置/解除继承关系（403，内置角色继承关系不可变）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

### F1 设置/解除继承关系
- **AC-F1-1 正常设置继承**：GIVEN 角色 A（permission_codes=[role:read]）+ 角色 B（permission_codes=[user:read]）存在 / WHEN 设置 B 的 parent=A / THEN B.parent_role_id=A、A 不变、无审计日志记录 B 的 permission_codes 变更（仅记录 parent_role_id 变更，before=[parent_role_id:null] / after=[parent_role_id:A]）。
- **AC-F1-2 解除继承**：GIVEN B.parent_role_id=A 已建立 / WHEN 解除 B 的继承 / THEN B.parent_role_id=null、A 不变、审计日志记录 before=[parent_role_id:A] / after=[parent_role_id:null]。
- **AC-F1-3 父角色不存在**：GIVEN parentRoleId 不存在 / WHEN 设置继承 / THEN 抛 ROLE_NOT_FOUND（不修改任何角色、无审计日志）。
- **AC-F1-4 自继承**：GIVEN parentRoleId === roleId / WHEN 设置继承 / THEN 抛 ROLE_SELF_INHERITANCE（不修改任何角色）。
- **AC-F1-5 内置 admin 作为父角色**：GIVEN parentRoleId 指向内置 admin / WHEN 设置继承 / THEN 抛 ROLE_BUILTIN_PARENT_FORBIDDEN（不修改任何角色）。
- **AC-F1-6 环检测 A→B→A**：GIVEN 已有 B.parent=A / WHEN 设置 A.parent=B / THEN 抛 ROLE_INHERITANCE_CYCLE（不修改任何角色、message 含环路径 A→B→A）。
- **AC-F1-7 环检测三节点链**：GIVEN 已有 B.parent=A + C.parent=B / WHEN 设置 A.parent=C / THEN 抛 ROLE_INHERITANCE_CYCLE（不修改任何角色、环路径 A→C→B→A）。
- **AC-F1-8 对内置 admin 设置继承**：GIVEN roleId 为内置 admin / WHEN 设置/解除 admin 的继承关系 / THEN 抛 ROLE_BUILTIN_FORBIDDEN（内置角色继承关系不可变）。
- **AC-F1-9 重新设置继承（覆盖）**：GIVEN B.parent=A 已建立 / WHEN 设置 B.parent=C（C 存在且不形成环）/ THEN B.parent_role_id=C（覆盖原 A）、审计日志记录 before=[parent_role_id:A] / after=[parent_role_id:C]。

### F2 查询继承链
- **AC-F2-1 单层继承链**：GIVEN B.parent=A / WHEN 查询 B 的继承链 / THEN 返回 [A]（从 B 的父角色到根，按继承顺序）。
- **AC-F2-2 多层继承链**：GIVEN C.parent=B + B.parent=A / WHEN 查询 C 的继承链 / THEN 返回 [B, A]（按继承顺序：C→B→A）。
- **AC-F2-3 根角色继承链**：GIVEN A.parent=null（根角色）/ WHEN 查询 A 的继承链 / THEN 返回 []（空数组，无祖先）。
- **AC-F2-4 不存在的角色**：GIVEN roleId 不存在 / WHEN 查询继承链 / THEN 抛 ROLE_NOT_FOUND。

### F3 计算用户有效权限码集合
- **AC-F3-1 单角色无继承**：GIVEN 用户 U 分配角色 A（permission_codes=[role:read, user:read]），A 无父角色 / WHEN 查询 U 的有效权限 / THEN 返回 {role:read, user:read}（仅直接权限）。
- **AC-F3-2 单角色单层继承**：GIVEN U 分配 B（permission_codes=[role:write]），B.parent=A（A.permission_codes=[role:read, user:read]）/ WHEN 查询 U 的有效权限 / THEN 返回 {role:write, role:read, user:read}（B 自身 ∪ A 父角色，并集）。
- **AC-F3-3 单角色多层继承**：GIVEN U 分配 C（permission_codes=[dept:read]），C.parent=B（B.permission_codes=[role:write]），B.parent=A（A.permission_codes=[role:read, user:read]）/ WHEN 查询 U 的有效权限 / THEN 返回 {dept:read, role:write, role:read, user:read}（C ∪ B ∪ A，递归并集）。
- **AC-F3-4 多角色继承并集**：GIVEN U 分配 A（[role:read]）+ D（D.parent=E，E=[dept:write]），D=[notification:read] / WHEN 查询 U 的有效权限 / THEN 返回 {role:read, notification:read, dept:write}（A ∪ D ∪ E，多角色各自递归后取并集）。
- **AC-F3-5 继承关系变更后权限自动更新**：GIVEN U 分配 B（B 无父角色，有效权限=[role:write]）/ WHEN 设置 B.parent=A（A=[role:read]）/ THEN 再次查询 U 的有效权限返回 {role:write, role:read}（读时聚合，继承关系变更后自动反映）。
- **AC-F3-6 用户不存在**：GIVEN userId 不存在 / WHEN 查询有效权限 / THEN 抛 USER_NOT_FOUND。
- **AC-F3-7 用户无角色**：GIVEN U 存在但未分配任何角色 / WHEN 查询有效权限 / THEN 返回 {}（空集合）。

### F4 删除角色时校验子角色引用
- **AC-F4-1 删除有子角色的角色**：GIVEN A 有子角色 B（B.parent=A）/ WHEN 删除 A / THEN 抛 ROLE_HAS_CHILDREN（不删除 A、message 含子角色列表或数量）。
- **AC-F4-2 删除无子角色的角色**：GIVEN A 无子角色 / WHEN 删除 A / THEN 删除成功（既有 delete 流程，ROLE_IN_USE 守卫仍生效）。
- **AC-F4-3 解除子角色继承后可删除**：GIVEN A 有子角色 B / WHEN 解除 B 的继承 + 删除 A / THEN 删除成功（先解除子角色引用，再删除）。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · 继承模型：单继承 vs 多继承？**
BLOCKING。方案①单继承（每个角色至多一个 parent_role_id，形成树/DAG）；方案②多继承（每个角色可有多个父角色，需 role_inheritances 关联表）。本期选哪个？单继承足够验证递归 + 环检测 + 权限传递，且实现简单（复用 role 表字段），推荐①。

**Q2 · 环检测算法：祖先遍历 vs 拓扑排序？**
BLOCKING。方案①祖先遍历（设置 parent 时从 parentRoleId 向上遍历祖先链，若遇到 roleId 则形成环，O(链深度)）；方案②拓扑排序（全量角色图拓扑排序判断是否有环，O(V+E)）。本期选哪个？单继承下祖先遍历足够（链深度有限），推荐①。

**Q3 · 权限传递：读时聚合 vs 写时冗余？**
BLOCKING。方案①读时聚合（查询有效权限时沿继承链递归计算，不存储冗余副本）；方案②写时冗余（设置继承时将父角色权限码复制到子角色的 effective_permission_codes 字段，继承变更时同步更新）。本期选哪个？读时聚合避免冗余副本不一致，且内存实现性能足够，推荐①。

**Q4 · 内置 admin 的继承约束？**
BLOCKING。①admin 不可被设为子角色（admin 是根权限源，不应被继承削弱，ROLE_BUILTIN_PARENT_FORBIDDEN）；②admin 不可设置/解除自身的继承关系（内置角色继承关系不可变，ROLE_BUILTIN_FORBIDDEN）；③admin 可作为父角色被其他角色继承（admin 持有全部权限码，子角色继承后也持有全部权限码，但这与"admin 不可被继承削弱"矛盾）。本期选哪个？推荐①+②+③禁止（admin 既不可作子角色也不可变自身继承，但可作父角色——子角色继承 admin 后获全部权限码，这是合理的"创建等价 admin 角色场景"）。是否认可？

**Q5 · 重新设置继承（覆盖）的语义？**
BLOCKING。GIVEN B.parent=A 已建立 / WHEN 设置 B.parent=C / 是否允许覆盖？方案①允许覆盖（B.parent_role_id 从 A 改为 C，需对 C 做环检测）；方案②禁止覆盖（须先 unsetParent 再 setParent）。本期选哪个？允许覆盖更符合 REST 语义（setParent 幂等设置），推荐①。

**Q6 · setParent/unsetParent 的审计日志 entity_type 与 action？**
BLOCKING。entity_type=`role`（继承关系是角色属性变更），action=`update`（沿用 role.assign/remove 的 action=update 先例）。before/after 含 parent_role_id 虚拟字段的旧值/新值。是否认可？

**Q7 · getEffectivePermissions 返回形状？**
BLOCKING。返回 `PermissionCode[]`（数组形式，去重后的有效权限码集合）还是 `Set<PermissionCode>`？数组形式便于 JSON 序列化（HTTP 响应），推荐 `PermissionCode[]`（去重 + 排序保证确定性）。是否认可？

**Q8 · 删除角色的守卫顺序扩展？**
BLOCKING。既有 delete 守卫顺序：B5 角色存在 → B6 内置 → B7 已分配（ROLE_IN_USE）。本期新增 B8 子角色引用（ROLE_HAS_CHILDREN）。顺序应为 B5 → B6 → B7 → B8 还是 B5 → B6 → B8 → B7？推荐 B5 → B6 → B8 → B7（先校验结构约束"无子角色"再校验使用约束"未分配"，结构约束优先级更高，避免删除后子角色悬空）。是否认可？

**Q9 · 新增 contracts 联动？**
BLOCKING。errorCodeSchema 追加 4 码（ROLE_SELF_INHERITANCE / ROLE_BUILTIN_PARENT_FORBIDDEN / ROLE_INHERITANCE_CYCLE / ROLE_HAS_CHILDREN）；roleSchema 追加 parent_role_id 字段（z.string().uuid().nullable()）；permissionCodeSchema 不变（权限继承不新增权限码）；createRoleInputSchema 不追加 parent_role_id（创建时无父角色，继承关系通过 setParent 单独设置）；auditLogEntityTypeSchema 不变（沿用 role）。errors.ts 补齐 4 码 HTTP 映射。是否认可？

**Q10 · setParent/unsetParent 的路由设计？**
BLOCKING。方案①`POST /v1/roles/:roleId/parent`（body: {parentRoleId}）设置继承 + `DELETE /v1/roles/:roleId/parent` 解除继承；方案②`PATCH /v1/roles/:roleId`（body: {parent_role_id}）部分更新。本期选哪个？方案①更语义化（继承关系是独立资源），推荐①。是否认可？

**Q11 · getInheritanceChain 与 getEffectivePermissions 的路由设计？**
BLOCKING。`GET /v1/roles/:roleId/inheritance-chain` 返回祖先角色列表；`GET /v1/users/:userId/effective-permissions` 返回有效权限码数组。是否认可？

**Q12 · 跨 service 依赖与 ARCH-001？**
BLOCKING。本期 RoleService 既有依赖（RoleRepository + UserRepository）不变，新增方法（setParent/unsetParent/getInheritanceChain/getEffectivePermissions）均在 RoleService 内实现，不新增跨 service 依赖。getEffectivePermissions 需查 user_role 关联（RoleRepository.findUserRolesByUser）+ 递归查 role 的 parent 链（RoleRepository.findById）+ 收集 permission_codes。这是 service→repo 递归读（ARCH-001 不禁，已有先例）。是否认可？

**Q13 · 环检测的 catch 语义（CODE-002）？**
BLOCKING。环检测算法为同步遍历（不抛异常，返回 boolean 或环路径），不涉及 try/catch。但 setParent 方法整体经 withAudit 包装，若环检测失败抛 AppError → withAudit 不调 audit.record → 无幽灵日志。CODE-002 在本期是否触发？环检测本身无 catch，但若递归遍历过程中 roleRepo.findById 返回 undefined（数据不一致，如并发删除），须抛 ROLE_NOT_FOUND（非静默吞）。是否认可？

## Out of scope
- 多继承（一个角色多个父角色）—— 本期单继承足够验证递归 + 环检测，多继承为未来工程化方向。
- 继承链深度限制（如最大 10 层）—— 本期无深度限制，单继承下链深度自然有限（角色总数）。
- 继承关系变更的级联校验（如删除父角色时自动解除子角色继承）—— 本期删除父角色须先手动解除子角色引用（ROLE_HAS_CHILDREN 守卫），不自动级联。
- effective_permission_codes 冗余存储 + 索引 —— 本期读时聚合，性能优化为未来工程化方向。
- 权限缓存（如 LRU 缓存有效权限集合）—— 本期无缓存，每次查询实时聚合。
- OpenAPI yaml 同步（role-inheritance.openapi.yaml）—— 记为遗留同步项，沿用既有先例。
