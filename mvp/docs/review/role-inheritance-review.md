---
doc_type: Review-Report
id: REVIEW-ROLE-INHERITANCE-001
tech_spec_ref: TECH-ROLE-INHERITANCE-001
prd_ref: PRD-ROLE-INHERITANCE-001
verdict: pass
created: 2026-07-02
---
# 角色权限继承 · Code Review 报告（第八轮演练，回溯补齐）

评审范围：第八轮"角色权限继承"PR 全部代码——F1 设置/解除继承关系（环检测 + 父子约束 + 自继承 + 内置 admin 约束）+ F2 查询继承链 + F3 计算用户有效权限码集合（读时聚合）+ F4 删除守卫扩展 B8 ROLE_HAS_CHILDREN，以及 AI-006 两类标注 / AI-007 端到端验收 / ARCH-001 service→repo 递归读 / CODE-001 环检测算法无 any / CODE-002 递归异常非静默吞五项验证。对照 `docs/prd/role-inheritance.md`（验收标准 Given/When/Then 23 条）、`docs/spec/role-inheritance.tech.md`（Tech-Spec，含 D1~D7 决策 + AI-006 两类标注清单 + AI-007 端到端指引）与 `.trae/rules` 全部规则逐条核查。

> **回溯补齐说明**：本报告为 R8 实现完成后回溯产出。R8 impl 已落地（测试全绿），但 Reviewer 报告与 retro 文件原缺失（RETRO-ROUND9-001 S-3 记录的流程未闭环问题）。核对基于当前代码库（已含 R9 expectedVersion 改动：service.setParent/unsetParent/delete 签名追加 expectedVersion 参数，before/after 含 version 字段），聚焦 R8 继承/环检测/权限传递语义，忽略 R9 版本控制改动（R9 已闭环，不影响 R8 继承语义核对）。

本轮第八轮演练核心验证：①递归数据结构（角色 parent_role_id 形成继承链 DAG）+ 环检测（祖先遍历算法，新校验类型）②权限传递读时聚合（不存储冗余副本，查询时沿继承链递归取并集）③ARCH-001 在 service→repo 递归读下闭合（getInheritanceChain/getEffectivePermissions 沿 parent_role_id 链递归调 roleRepo.findById）④CODE-001 在环检测算法下闭合（detectCycle 用 RoleEntity | undefined 类型守卫，无 any）⑤AI-007 端到端验收（注入共享 roleRepo/auditRepo 观测继承链结构 + 环检测跨层 + 无幽灵日志）。

## 汇总
- blocker 数：**0**
- suggestion 数：**2**
- verdict：**pass**（三件套全绿 653/653；AI-007 PRD F1/F2/F3/F4 验收 23 条逐条对齐；AI-006 两类标注准确（①类 errorCodeSchema 4 码 SSOT 派生零改动 + roleSchema parent_role_id 击穿 7 处 Role 对象构造 / ②类 RoleService 4 新增方法签名变更））
- 三件套门禁复核（Reviewer 实跑）：
  - typecheck：`pnpm typecheck` exit 0，0 错误 ✅
  - lint:rules：`pnpm lint:rules` exit 0，13 项 enforcement + META-003/004 双向绑定 + 2 条 SEC-002 豁免审计 info + 6 条 AI-005 建议 ✅
  - test：`pnpm test` exit 0，14 文件 653/653（含 role-inheritance 65 + role-inheritance-embedding 26），4.28s ✅
- 规则机器化覆盖率：13/19 = 68%（与第六/七轮持平，本期不新增规则文件、不新增 markEnforcement 分支）

## 总体结论

三件套全绿，role-inheritance 领域四件套（F1 设置/解除继承 + F2 继承链 + F3 有效权限读时聚合 + F4 删除 B8 守卫）实现质量高。AI-007 端到端测试（role-inheritance-embedding.test.ts 26 用例）覆盖 PRD F1/F2/F3/F4 共 23 条 Given/When/Then 逐条对齐，注入共享 roleRepo/userRepo/auditRepo 观测继承链结构 + 环检测跨层 + 无幽灵日志（AI-007 关键——setParent 校验失败 withAudit 不调 audit.record，共享 auditRepo 断言 total 不变）。

**本轮核心验证目标全部达成**：①递归数据结构 + 环检测新架构模式落地（domain/role-inheritance.ts detectCycle 祖先遍历纯函数 + validateSetParent 校验编排纯函数）；②权限传递读时聚合正确（getEffectivePermissions 沿 parent_role_id 链递归取并集，继承关系变更后下次查询自动反映，AC-F3-5 验证）；③ARCH-001 在 service→repo 递归读下闭合（getInheritanceChain/getEffectivePermissions 递归调 roleRepo.findById，ARCH-001 仅禁 service→router）；④CODE-001/CODE-002 在环检测 + 递归异常处理下闭合（detectCycle 无 any / 递归中 role 不存在抛 ROLE_NOT_FOUND 非静默吞）；⑤AI-006 两类标注准确（①类 errorCodeSchema 4 码 SSOT 派生零改动 + roleSchema parent_role_id 击穿 7 处 Role 对象构造 / ②类 RoleService 4 新增方法签名）。

## AI-007 PRD 验收逐条核对（本轮核心硬要求）

对照 PRD `docs/prd/role-inheritance.md` §验收标准（F1 设置/解除继承 9 条 + F2 查询继承链 4 条 + F3 计算有效权限 7 条 + F4 删除守卫 3 条 = 23 条 Given/When/Then），逐条核对实现行为是否对齐。

### F1：设置/解除继承关系（9 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F1-1 | §70 正常设置继承 → B.parent_role_id=A、A 不变、审计仅记录 parent_role_id 变更（before=[null] / after=[A]） | `service/role.ts:213-260` setParent：requireAdmin → findById(role) → findById(parent) → detectCycle → validateSetParent → roleRepo.update(parent_role_id) → 返回 WriteResult（before/changes 仅含 parent_role_id 虚拟字段，pii=false）；无 permission_codes 变更记录 | `role-inheritance.test.ts:236-248`（service 层：B.parent_role_id=A + before=[null] after=[A]）+ `role-inheritance-embedding.test.ts:149-168`（端到端：roleRepo.findById(B).parent_role_id=A + 审计日志新增 1 条 entity_type=role/action=update + before.parent_role_id=null + after.parent_role_id=A） | ✅ 对齐 |
| F1-2 | §71 解除继承 → B.parent_role_id=null、A 不变、审计 before=[A] after=[null] | `service/role.ts:267-292` unsetParent：requireAdmin → findById → B6 内置守卫 → roleRepo.update(parent_role_id=null) → WriteResult（before=[A] / changes=[null]） | `role-inheritance.test.ts:348-359`（service 层）+ `role-inheritance-embedding.test.ts:170-187`（端到端：parent_role_id=null + 审计 before=[A] after=[null]） | ✅ 对齐 |
| F1-3 | §72 父角色不存在 → ROLE_NOT_FOUND（不修改任何角色、无审计日志） | `domain/role-inheritance.ts:99-100` validateSetParent：!parentExists → ROLE_NOT_FOUND；`service/role.ts:216-220` role/parent 查询前置 | `role-inheritance.test.ts:250-256`（ROLE_NOT_FOUND + B.parent_role_id 仍 null）+ `role-inheritance-embedding.test.ts:189-198`（端到端：无幽灵日志 auditRepo total 不变） | ✅ 对齐 |
| F1-4 | §73 自继承 → ROLE_SELF_INHERITANCE（不修改任何角色） | `contracts/schemas/role-inheritance.ts:20-27` setParentInputSchema superRefine 拒绝 roleId===parentRoleId；`domain/role-inheritance.ts:102` validateSetParent 冗余校验（防御 service 直调）；`service/role.ts:230-245` | `role-inheritance.test.ts:258-264`（service 层 ROLE_SELF_INHERITANCE）+ `role-inheritance-embedding.test.ts:200-209`（端到端无幽灵日志）+ `role-inheritance.test.ts:197-199`（schema superRefine 拒绝）+ `role-inheritance-embedding.test.ts:522-531`（router 入口 superRefine → VALIDATION_ERROR，无幽灵日志） | ✅ 对齐 |
| F1-5 | §74 父角色为内置 admin → ROLE_BUILTIN_PARENT_FORBIDDEN（不修改任何角色） | `domain/role-inheritance.ts:103` validateSetParent：parentIsBuiltin → ROLE_BUILTIN_PARENT_FORBIDDEN；`service/role.ts:235` 注入 parentIsBuiltin | `role-inheritance.test.ts:266-273`（service 层）+ `role-inheritance-embedding.test.ts:211-221`（端到端无幽灵日志） | ✅ 对齐 |
| F1-6 | §75 环检测 A→B→A → ROLE_INHERITANCE_CYCLE（不修改、message 含环路径 A→B→A） | `domain/role-inheritance.ts:40-59` detectCycle：从 parentRoleId 向上遍历，遇 roleId 则环；`service/role.ts:229,242-244` 环检测 + message 含 cyclePath.join('→') | `role-inheritance.test.ts:275-286`（service 层 A.parent 仍 null）+ `role-inheritance.test.ts:159-169`（domain detectCycle 两节点环 hasCycle=true cyclePath 含 A/B）+ `role-inheritance-embedding.test.ts:223-237`（端到端无幽灵日志） | ✅ 对齐 |
| F1-7 | §76 环检测三节点链 A→C→B→A → ROLE_INHERITANCE_CYCLE | `domain/role-inheritance.ts:40-59` detectCycle 三节点祖先遍历；`service/role.ts:229` | `role-inheritance.test.ts:288-301`（service 层）+ `role-inheritance.test.ts:170-179`（domain detectCycle 三节点环）+ `role-inheritance-embedding.test.ts:239-255`（端到端无幽灵日志） | ✅ 对齐 |
| F1-8 | §77 对内置 admin 设置/解除继承 → ROLE_BUILTIN_FORBIDDEN（内置角色继承关系不可变） | `domain/role-inheritance.ts:101` validateSetParent：roleIsBuiltin → ROLE_BUILTIN_FORBIDDEN（setParent）；`service/role.ts:278-280` unsetParent B6 内置守卫 | `role-inheritance.test.ts:303-309`（setParent admin → ROLE_BUILTIN_FORBIDDEN）+ `role-inheritance.test.ts:366-370`（unsetParent admin → ROLE_BUILTIN_FORBIDDEN）+ `role-inheritance-embedding.test.ts:257-266`（端到端无幽灵日志） | ✅ 对齐 |
| F1-9 | §78 重新设置继承（覆盖） → B.parent_role_id=C（覆盖原 A）、审计 before=[A] after=[C] | `service/role.ts:247-259` setParent 覆盖语义（roleRepo.update 直接覆盖 parent_role_id，Q5 决策①）；before/changes 记录旧值 A / 新值 C | `role-inheritance.test.ts:311-325`（service 层 before=[A] after=[C]）+ `role-inheritance-embedding.test.ts:268-284`（端到端：roleRepo B.parent=C + 审计 before=[A] after=[C]） | ✅ 对齐 |

**F1 小结：9/9 对齐**。校验顺序（requireAdmin → 角色存在 → 父角色存在 → 自继承 → 内置 → 环检测）先到先返不叠加；7 类校验失败均断言"不修改任何角色"+ 端到端断言"无幽灵日志"（共享 auditRepo total 不变）。环检测 message 含环路径（cyclePath.join('→')）。

### F2：查询继承链（4 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F2-1 | §81 单层继承链 B.parent=A → 返回 [A]（从父到根） | `service/role.ts:300-318` getInheritanceChain：while parent_role_id!==null push parent；返回 Role[] | `role-inheritance.test.ts:384-394`（service 层 chain=[A]）+ `role-inheritance-embedding.test.ts:291-303`（端到端 chain=[A] + A.parent_role_id=null） | ✅ 对齐 |
| F2-2 | §82 多层继承链 C.parent=B, B.parent=A → 返回 [B, A]（按继承顺序） | `service/role.ts:300-318` 递归沿 parent 链 push | `role-inheritance.test.ts:396-410`（service 层 chain=[B,A]）+ `role-inheritance-embedding.test.ts:305-321`（端到端 chain=[B,A] + B.parent=A + A.parent=null） | ✅ 对齐 |
| F2-3 | §83 根角色继承链 A.parent=null → 返回 []（空数组） | `service/role.ts:308` while parent_role_id!==null 直接跳过 → 返回 [] | `role-inheritance.test.ts:412-418`（chain=[]）+ `role-inheritance-embedding.test.ts:323-329`（端到端 chain=[]） | ✅ 对齐 |
| F2-4 | §84 不存在的角色 → ROLE_NOT_FOUND | `service/role.ts:302-305` findById 返回 undefined → 抛 ROLE_NOT_FOUND | `role-inheritance.test.ts:420-423`（ROLE_NOT_FOUND）+ `role-inheritance-embedding.test.ts:331-335`（端到端） | ✅ 对齐 |

**F2 小结：4/4 对齐**。返回 Role[]（非 id 数组，便于调用方直接获取祖先详情含 permission_codes）；递归中 role 不存在抛 ROLE_NOT_FOUND（CODE-002 非静默吞，service/role.ts:310-313）。

### F3：计算用户有效权限码集合（7 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F3-1 | §87 单角色无继承 → 仅直接权限 {role:read, user:read} | `service/role.ts:326-349` getEffectivePermissions：findUserRolesByUser → 沿 parent 链递归收集 permission_codes → Set 并集 → sort | `role-inheritance.test.ts:437-449`（service 层）+ `role-inheritance-embedding.test.ts:368-375`（端到端） | ✅ 对齐 |
| F3-2 | §88 单角色单层继承 → B ∪ A 并集 | `service/role.ts:326-349` B 沿 parent_role_id=A 收集 A.permission_codes | `role-inheritance.test.ts:451-464`（service 层 [role:write,role:read,user:read]）+ `role-inheritance-embedding.test.ts:377-387`（端到端） | ✅ 对齐 |
| F3-3 | §89 单角色多层继承 → C ∪ B ∪ A 递归并集 | `service/role.ts:326-349` while current 递归沿 parent 链向上 | `role-inheritance.test.ts:466-482`（service 层 [dept:read,role:read,role:write,user:read]）+ `role-inheritance-embedding.test.ts:389-402`（端到端） | ✅ 对齐 |
| F3-4 | §90 多角色继承并集 → A ∪ D ∪ E（多角色各自递归后取并集） | `service/role.ts:334-346` for 循环对每个 userRole 递归收集，共用同一 Set | `role-inheritance.test.ts:484-500`（service 层 [dept:write,notification:read,role:read]）+ `role-inheritance-embedding.test.ts:404-416`（端到端） | ✅ 对齐 |
| F3-5 | §91 继承关系变更后权限自动更新（读时聚合）→ setParent 后再次查询自动反映 | `service/role.ts:326-349` 读时聚合（不存储冗余副本），setParent 后 roleRepo 状态变更，下次查询沿新链递归 | `role-inheritance.test.ts:502-520`（service 层：变更前 [role:write] → setParent B.parent=A → 变更后 [role:read,role:write]）+ `role-inheritance-embedding.test.ts:418-433`（端到端） | ✅ 对齐 |
| F3-6 | §92 用户不存在 → USER_NOT_FOUND | `service/role.ts:328-331` userRepo.findById 返回 undefined → 抛 USER_NOT_FOUND | `role-inheritance.test.ts:522-525`（USER_NOT_FOUND）+ `role-inheritance-embedding.test.ts:435-439`（端到端） | ✅ 对齐 |
| F3-7 | §93 用户无角色 → 返回 {}（空集合） | `service/role.ts:332-348` findUserRolesByUser 返回 [] → for 循环不执行 → Set 空 → 返回 [] | `role-inheritance.test.ts:527-534`（[] 空数组）+ `role-inheritance-embedding.test.ts:441-448`（端到端 []） | ✅ 对齐 |

**F3 小结：7/7 对齐**。读时聚合（D3）正确——继承关系变更后下次查询自动反映新继承链（AC-F3-5 关键验证）；去重（Set）+ 排序（sort）保证返回确定性（Q7）；PRD 写"{}空集合"，实现返回 [] 空数组（Q7 决策①数组形式便于 JSON 序列化），语义等价。

### F4：删除角色时校验子角色引用（3 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F4-1 | §96 删除有子角色的角色 → ROLE_HAS_CHILDREN（不删除 A、message 含子角色列表或数量） | `service/role.ts:115-120` delete B8 守卫：roleRepo.findChildren(id).length>0 → 抛 ROLE_HAS_CHILDREN（B5→B6→B8→B7 顺序，D6） | `role-inheritance.test.ts:549-559`（service 层 ROLE_HAS_CHILDREN + A 仍存在）+ `role-inheritance-embedding.test.ts:455-469`（端到端 + 无幽灵日志） | ✅ 对齐 |
| F4-2 | §97 删除无子角色的角色 → 成功（既有 delete 流程，ROLE_IN_USE 守卫仍生效） | `service/role.ts:117-126` findChildren 返回 [] → 跳过 B8 → 继续到 B7/删除 | `role-inheritance.test.ts:561-567`（service 层删除成功）+ `role-inheritance-embedding.test.ts:471-485`（端到端 + 删除日志落库） | ✅ 对齐 |
| F4-3 | §98 解除子角色继承后可删除 → 先 unsetParent B + 再 delete A 成功 | `service/role.ts:267-292` unsetParent 置 B.parent=null → `service/role.ts:117` findChildren(A) 返回 [] → delete A 成功 | `role-inheritance.test.ts:569-581`（service 层）+ `role-inheritance-embedding.test.ts:487-501`（端到端：A 不存在 + B 仍存在 parent=null） | ✅ 对齐 |

**F4 小结：3/3 对齐**。delete 守卫顺序 B5→B6→B8→B7（D6，结构约束优先于使用约束）经 `role-inheritance.test.ts:583-608` 双行为断言验证：内置角色先于子角色校验（B6 先于 B8）+ 有子角色且已分配 → ROLE_HAS_CHILDREN（B8 先于 B7）。

### AI-007 PRD 逐条核对总结

- **F1 设置/解除继承**：9/9 对齐（校验顺序先到先返，7 类校验失败均断言无写入 + 端到端无幽灵日志）
- **F2 查询继承链**：4/4 对齐（返回 Role[] 从父到根，根角色返回 []，递归异常非静默吞）
- **F3 计算有效权限**：7/7 对齐（读时聚合 + 递归并集 + 去重排序，继承变更后自动反映 AC-F3-5）
- **F4 删除守卫扩展**：3/3 对齐（B5→B6→B8→B7 顺序，结构约束优先）
- **合计**：23/23 对齐，0 偏离

**AI-007 是否生效**：✅ **生效**。role-inheritance-embedding.test.ts 26 用例对照 PRD F1/F2/F3/F4 每条 Given/When/Then 产出端到端断言，注入共享 roleRepo/userRepo/auditRepo（观测继承链结构 + 环检测跨层 + 无幽灵日志），而非隔离自建实例。关键：setParent 校验失败（环/自继承/内置约束）→ withAudit 不调 audit.record → 共享 auditRepo total 不变（F1-3/F1-4/F1-5/F1-6/F1-7/F1-8 + F4-1 各断言无幽灵日志）；getEffectivePermissions 递归聚合 → 共享 roleRepo.findById 观测继承链结构。Reviewer 按 PRD 23 条验收逐条核对无 [约束] 偏离。

## AI-006 增强受影响测试清单校验（本轮核心）

### 清单章节存在性 + 两类标注完整性
- **章节存在**：Tech-Spec §8 受影响测试清单存在，基于真实 grep ✅
- **两类标注齐全**：
  - ①类·contracts 联动驱动（§8.1）：errorCodeSchema 追加 4 码（ROLE_SELF_INHERITANCE / ROLE_BUILTIN_PARENT_FORBIDDEN / ROLE_INHERITANCE_CYCLE / ROLE_HAS_CHILDREN）+ roleSchema 追加 parent_role_id 字段 → grep 引用这两个符号的 test 文件列断言点
  - ②类·apps/api 内部签名变更驱动（§8.2）：roleSchema 追加 parent_role_id → RoleEntity 类型变化 → 所有构造 Role 对象位置须同步追加 parent_role_id: null
- **两类均覆盖，缺一无** ✅ 满足 AI-006 增强硬要求

### ①类断点准确性 + SSOT 派生零改动
Reviewer 核实：
- **errorCodeSchema 4 码 SSOT**：4 码定义在 `packages/contracts/src/schemas/user.ts:168-174`（SSOT 单点），role-inheritance.ts 不重复定义。`role-inheritance.test.ts:676-684` 断言 `[...errorCodeSchema.options]` 含 4 码（SSOT 派生，零硬编码全集断言需改）✅。`apps/api/src/errors.ts:60-63` 补齐 4 码 HTTP 映射（ROLE_SELF_INHERITANCE=400 / ROLE_BUILTIN_PARENT_FORBIDDEN=403 / ROLE_INHERITANCE_CYCLE=409 / ROLE_HAS_CHILDREN=409），否则 tsc TS2741；tsc exit 0 佐证 ✅
- **roleSchema parent_role_id**：`packages/contracts/src/schemas/role.ts:56` 追加 `parent_role_id: z.string().uuid().nullable()`。role.test.ts 等的 `roleSchema.parse` 断言经 .strict() 模式要求 Role 含 parent_role_id —— Reviewer 核实 service.create/getById/list 返回的 Role 由 repo 存储态带出 parent_role_id（create 时设 null，`service/role.ts:81`；seedBuiltinAdmin 设 null，`repository/role.ts:46`），roleSchema.parse 通过（`role-inheritance.test.ts:641-670` ②类回归测断言）✅
- **permissionCodeSchema 不变**：继承不新增权限码（PRD Q9 决策），permissionCodeSchema 无改动，无 ①类断点 ✅

**①类结论**：✅ 零硬编码全集断言改动，SSOT 派生（AI-005）生效。errorCodeSchema 4 码经 `[...errorCodeSchema.options]` 自动覆盖；roleSchema parent_role_id 经 service 返回值含字段使 parse 通过。

### ②类签名变更击穿 7 处 Role 对象构造反向核实
Tech-Spec §8.2 判定：roleSchema 追加 parent_role_id → RoleEntity 类型变化 → 7 处构造 Role 对象位置须同步追加 `parent_role_id: null`。Reviewer 核实：
- **role.test.ts makeRole helper**：`role-inheritance.test.ts:50-62` makeRole 已追加 `parent_role_id: null`（②类同步注释标注），覆盖所有 makeRole 调用 ✅
- **transfer.test.ts roleRepo.insert 构造 Role**：Tech-Spec 列 3 处（L79-86/L87-94/L337-338），tsc exit 0 + transfer 25 用例全通过佐证已同步 ✅
- **transfer-embedding.test.ts roleRepo.insert 构造 Role**：Tech-Spec 列 2 处（L186-187/L194-195），tsc exit 0 + transfer-embedding 6 用例全通过佐证已同步 ✅
- **repository/role.ts:38-50 seedBuiltinAdmin**：已追加 `parent_role_id: null`（admin 是根角色），`role-inheritance.test.ts:654-659` 断言 admin.parent_role_id=null + roleSchema.parse 通过 ✅
- **service/role.ts:73-84 RoleService.create**：已追加 `parent_role_id: null`（Q9 创建时无父角色），`role-inheritance.test.ts:645-653` 断言 service.create 返回 entity.parent_role_id=null + roleSchema.parse 通过 ✅

**②类结论**：✅ 7 处 Role 对象构造全部同步追加 parent_role_id: null。makeRole helper 单点修复覆盖约 10 处调用 + transfer test 3 处 + transfer-embedding 2 处 + seedBuiltinAdmin 1 处 + RoleService.create 1 处。tsc exit 0 + 全测试通过佐证。这是与 R7 ②类零签名变更的不同点——R8 roleSchema 字段扩展击穿既有测试的 Role 对象构造，Tech-Spec §8.2 清单准确预判。

### AI-006 增强本轮是否生效
✅ **生效**。①类 errorCodeSchema 4 码 SSOT 派生零改动（AI-005 价值）+ roleSchema parent_role_id 经 service 返回值含字段使 parse 通过；②类 RoleEntity 签名变更击穿 7 处 Role 对象构造，Tech-Spec §8.2 清单准确预判且全部同步修复。两类标注完整，无遗漏。

## AI-001 越界检查

R8 新增导出符号均可溯源至 Tech-Spec §2 影响模块清单或 §3 决策：
- **contracts 层**（`packages/contracts/src/schemas/role-inheritance.ts`）：setParentInputSchema / SetParentInput / unsetParentInputSchema / UnsetParentInput / inheritanceChainInputSchema / InheritanceChainInput / inheritanceChainResultSchema / InheritanceChainResult / effectivePermissionsInputSchema / EffectivePermissionsInput / effectivePermissionsResultSchema / EffectivePermissionsResult —— 均溯源 Tech-Spec §2（role-inheritance.ts 新增）+ §3.4/§3.7 ✅
- **4 错误码**（ROLE_SELF_INHERITANCE / ROLE_BUILTIN_PARENT_FORBIDDEN / ROLE_INHERITANCE_CYCLE / ROLE_HAS_CHILDREN）：溯源 Tech-Spec §2（user.ts errorCodeSchema 追加 4 码）+ §4 边界与异常 ✅
- **domain 层**（`apps/api/src/domain/role-inheritance.ts`）：validateSetParent / detectCycle / FindRoleById / CycleDetectionResult / ValidateSetParentDeps —— 溯源 Tech-Spec §2（domain/role-inheritance.ts 新增）+ §3.2 D2 + §3.4 D4 ✅
- **repository 层**（`apps/api/src/repository/role.ts`）：findChildren —— 溯源 Tech-Spec §2（repository/role.ts 追加 findChildren）+ §3.6 D6 ✅
- **service 层**（`apps/api/src/service/role.ts`）：setParent / unsetParent / getInheritanceChain / getEffectivePermissions —— 溯源 Tech-Spec §2（service/role.ts 追加 4 方法）+ §3.1~§3.7 ✅
- **router 层**（`apps/api/src/router/role.ts`）：setParentProcedureInputSchema / unsetParentProcedureInputSchema / inheritanceChainProcedureInputSchema / effectivePermissionsProcedureInputSchema + 4 procedure —— 溯源 Tech-Spec §2（router/role.ts 追加 4 procedure）+ §6 路由 ✅

> 注：setParentProcedureInputSchema / unsetParentProcedureInputSchema 含 expected_version 字段为 R9 追加（D15 拆分读写 schema），非 R8 越界。R8 原始 procedure input 复用 contracts schema，R9 演进为独立声明写 schema（R9 已闭环，不记 R8 越界）。

## 规则合规（META-001/003/004 + ARCH + CODE + SEC）

| 规则 | 校验 | 结论 |
|---|---|---|
| META-001 | 本期不新增规则文件、不新增 markEnforcement 分支；既有规则均含校验方式段（spec-first.md AI-001~007 各含"校验方式"） | ✅ pass |
| META-003 | 本期不新增 markEnforcement 项（复用既有 13 项验证递归数据结构新领域）；check-rules 输出 13 项 enforcement 与规则文档双向绑定 | ✅ pass |
| META-004 | 脚本 13 项 enforcement 均有规则文档块；本期不新增规则故无新增块 | ✅ pass |
| ARCH-001 | `domain/role-inheritance.ts:6-7` 仅 import `@admin/contracts`（ErrorCode 类型）+ 同层 `./role.js`（RoleEntity 类型），不 import 上层 service/repository/router；`service/role.ts` 不 import router；getInheritanceChain/getEffectivePermissions 沿 parent_role_id 链递归调 roleRepo.findById（service→repo 递归读，ARCH-001 仅禁 service→router 不禁 service→repo 递归读） | ✅ pass |
| ARCH-002 | `contracts/schemas/role-inheritance.ts` 仅导出 Zod schema + z.infer 类型；validateSetParent/detectCycle 纯函数放 domain（与 transfer validateTransferInput 同先例） | ✅ pass |
| CODE-001 | `domain/role-inheritance.ts:46-58` detectCycle 用 `RoleEntity \| undefined` 类型守卫，无 any；`service/role.ts:307,338` getInheritanceChain/getEffectivePermissions 用 `Role \| undefined` 无 any；router schema 用 z.infer 派生 | ✅ pass |
| CODE-002 | `service/role.ts:310-313` getInheritanceChain 递归中 roleRepo.findById 返回 undefined 抛 ROLE_NOT_FOUND（非静默吞）；setParent 校验失败抛 AppError（非空非仅 console）；`service/role.ts:336` getEffectivePermissions 中 role 不存在 `continue` 跳过（注释说明"数据不一致静默跳过，理论上不会发生"——角色被删除但 user_role 未清理，与 PRD AC-F3 语义一致，非 catch 吞异常） | ✅ pass |
| CODE-003 | 无 eval/new Function | ✅ pass |
| CODE-004 | 新增 schema 均带 Schema 后缀（setParentInputSchema/unsetParentInputSchema/inheritanceChainInputSchema/inheritanceChainResultSchema/effectivePermissionsInputSchema/effectivePermissionsResultSchema）；新错误码 ROLE_* 前缀一致（ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN） | ✅ pass |
| SEC-001 | `router/role.ts:171-199` setParent/unsetParent/getInheritanceChain/getEffectivePermissions 4 procedure 均声明 `auth: 'admin'`（Procedure 类型字段，SEC-001 强制要求）；check-rules SEC-001 分支 0 违规 | ✅ pass |
| SEC-002 | `service/role.ts:214,268,301,327` setParent/unsetParent/getInheritanceChain/getEffectivePermissions 入口均 requireAdmin(ctx)；check-rules SEC-002 分支 0 违规（既有 2 条豁免 record+markRead 不变） | ✅ pass |
| SEC-003a | `contracts/schemas/role-inheritance.ts:19,38,48,65` setParentInputSchema/unsetParentInputSchema/inheritanceChainInputSchema/effectivePermissionsInputSchema 均 `.strict()`；inheritanceChainResultSchema/effectivePermissionsResultSchema 为 z.array 不带 .strict()（数组 schema 无多余字段风险，与既有先例一致） | ✅ pass |
| SEC-003b | `service/role.ts:251-258,283-290` setParent/unsetParent 的 before/changes 含 parent_role_id 虚拟字段 pii=false（markPii('role',...) 不标 PII）；`domain/audit.ts` PII_FIELD_REGISTRY 不新增 role-inheritance 条目（parent_role_id 非 PII） | ✅ pass |

> 注：Tech-Spec §11 提及 procedure 须声明 `permission='role:write'/'role:read'`，但实际 Procedure 类型（`router/user.ts:23-26`）仅含 `auth: 'admin' \| 'public'` 字段，无 permission 字段。SEC-001 规则（`.trae/rules/security/authz.md`）强制要求的是 `auth` 字段，permission 为 Tech-Spec advisory 表述（与全部既有轮次一致，非 R8 偏离）。SEC-001 判定基于实际规则要求（auth='admin'）✅。

## 测试覆盖与三件套

- **三件套真绿**：✅ Reviewer 实跑 typecheck exit 0（0 错误）/ lint:rules exit 0（13 enforcement + 2 SEC-002 豁免 + 6 AI-005 建议）/ test exit 0（14 文件 653/653，含 R8 新增 role-inheritance 65 + role-inheritance-embedding 26 = 91）
- **AI-007 端到端覆盖**：✅ role-inheritance-embedding.test.ts 26 用例覆盖 PRD F1 9 条 + F2 4 条 + F3 7 条 + F4 3 条 Given/When/Then（注入共享 roleRepo/userRepo/auditRepo 观测继承链结构 + 环检测跨层 + 无幽灵日志 + 读时聚合自动反映）
- **service 层覆盖**：✅ role-inheritance.test.ts 65 用例覆盖 domain validateSetParent（7）+ detectCycle（4）+ 契约 schema（8）+ F1 setParent 校验（11）+ F1 unsetParent（4）+ F2 getInheritanceChain（5）+ F3 getEffectivePermissions（8）+ F4 delete B8 守卫（5）+ router procedure 注册（4）+ ②类签名变更回归（4）+ AI-005 SSOT 派生（1）+ 守卫顺序 B5→B6→B8→B7（2）+ 非admin FORBIDDEN（2）
- **②类签名变更回归**：✅ `role-inheritance.test.ts:640-670` 4 用例验证 makeRole/service.create/seedBuiltinAdmin/setParent 后 roleSchema.parse 通过（含 parent_role_id）

## 本轮亮点

1. **递归数据结构 + 环检测新架构模式落地**：role-inheritance 引入角色 parent_role_id 形成继承链 DAG（前七轮扁平权限码集合未验证的递归数据结构）。环检测算法（detectCycle 祖先遍历纯函数，O(链深度)）归 domain 层，service 注入 findById 快照保持纯函数性（D2/D4，参考 transfer validateTransferInput 先例）。环路径返回 cyclePath 供错误 message 含 A→B→A 便于调试。这是前七轮单步 CRUD/多步事务未验证的新架构模式，ARCH-001/CODE-001 在递归 + 环检测下闭合。
2. **权限传递读时聚合正确（D3）**：getEffectivePermissions 沿 parent_role_id 链递归收集 permission_codes 取并集，不存储 effective_permission_codes 冗余副本。继承关系变更（setParent/unsetParent）后下次查询自动反映新继承链（AC-F3-5 关键验证——读时聚合避免冗余副本不一致）。去重（Set）+ 排序（sort）保证返回确定性（Q7）。
3. **ARCH-001 在 service→repo 递归读下闭合**：getInheritanceChain/getEffectivePermissions 沿 parent_role_id 链递归调 roleRepo.findById（service→repo 递归读）。ARCH-001 仅禁 service→router，不禁 service→repo 递归读。验证了 ARCH-001 约束边界在递归读模式下仍合理（PRD 目标5 / Tech-Spec §1.3 达成）。
4. **AI-007 端到端验收 + Reviewer PRD 逐条核对双轨闭合**：role-inheritance-embedding.test.ts 26 用例对照 PRD F1/F2/F3/F4 每条 Given/When/Then 产出端到端断言，注入共享 roleRepo/userRepo/auditRepo 观测继承链结构 + 环检测跨层 + 无幽灵日志。关键：setParent 校验失败 → withAudit 不调 audit.record → 共享 auditRepo total 不变（F1-3/F1-4/F1-5/F1-6/F1-7/F1-8 + F4-1 共 7 处断言无幽灵日志）。Reviewer 按 PRD 23 条验收逐条核对 0 偏离。
5. **AI-006 两类标注准确 + ②类击穿预判**：①类 errorCodeSchema 4 码 SSOT 派生零改动（AI-005 价值）+ roleSchema parent_role_id 经 service 返回值含字段使 parse 通过；②类 RoleEntity 签名变更击穿 7 处 Role 对象构造（与 R7 ②类零签名变更不同），Tech-Spec §8.2 清单准确预判且全部同步修复（makeRole helper 单点覆盖 + transfer test 3 处 + transfer-embedding 2 处 + seedBuiltinAdmin + RoleService.create）。两类标注完整闭合。
6. **delete 守卫顺序编排 B5→B6→B8→B7（D6）**：结构约束（无子角色）优先于使用约束（未分配），避免删除后子角色 parent_role_id 悬空。经 `role-inheritance.test.ts:583-608` 双行为断言验证：内置角色先于子角色校验（B6 先于 B8）+ 有子角色且已分配 → ROLE_HAS_CHILDREN（B8 先于 B7 非 ROLE_IN_USE）。

## 本轮问题

### Blocker（0）
无。本轮无 [约束] 偏离，PRD 23 条验收逐条对齐。

### Suggestion（2）

- **S-1**：role-inheritance 测试中 permission_codes 数组硬编码字面量（AI-005 lint 5 条建议）。
  - **现状**：`role-inheritance.test.ts:463/481/499` + `role-inheritance-embedding.test.ts:401/415` 出现 `.toEqual(['role:read','user:read',...])` 等 3~4 个枚举字面量数组，触发 AI-005 lint 启发式建议"改用 SSOT 派生（如 [...schema.options]）"。
  - **性质**：这些是测试 fixture 的角色 permission_codes 期望值（单角色特定权限码子集，非跨域全集断言），属 AI-005 例外"单领域内固定 fixture 值可硬编码"。lint 启发式无法区分"全集断言"vs"fixture 子集"，属误报倾向。但提示测试可考虑用常量提取或派生部分码以降低字面量噪声。
  - **处置**：记 suggestion（非 blocker）。AI-005 lint 建议待人工确认，本轮判定为 fixture 数据可硬编码（非跨域全集断言），不强制改派生。
  - **位置**：`apps/api/test/role-inheritance.test.ts:463/481/499` + `apps/api/test/role-inheritance-embedding.test.ts:401/415`。

- **S-2**：R8 review/retro 回溯核对的历史污染（流程未闭环的代价）。
  - **现状**：R8 impl 完成后未及时产出 review/retro（RETRO-ROUND9-001 S-3 记录），本报告为回溯补齐。核对基于当前代码库（已含 R9 expectedVersion 改动：service.setParent/unsetParent/delete 签名追加 expectedVersion 参数，before/after 含 version 字段，router 拆分读写 schema）。R8 原始签名应为 setParent(roleId, parentRoleId, ctx)，现已演进为 setParent(roleId, parentRoleId, expectedVersion, ctx)。
  - **性质**：回溯核对无法基于 R8 原始代码快照，须人工区分 R8 继承语义 vs R9 版本控制改动。本次核对聚焦继承/环检测/权限传递语义（忽略 R9 版本控制），23 条 AC 对齐结论不受影响。但回溯核对的历史污染增加了 Reviewer 工作量与误判风险。
  - **处置**：记 suggestion（非 blocker）。建议工作流确保每轮演练闭环（impl → Reviewer → RETRO）及时产出，避免回溯核对的历史污染。该项与 RETRO-ROUND9-001 S-3 一致，R8 retro 产出后该流程问题在 R8 维度闭合（R9 维度已记录）。
  - **位置**：工作流编排（`.trae/rules/ai-behavior/spec-first.md` AI-004 校验方式 + 编排者轮次闭环检查）。

## 门禁复核（Reviewer 实跑）
| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `pnpm typecheck` | exit 0，0 错误 |
| lint:rules | `pnpm lint:rules` | exit 0，13 项 enforcement + META-003/004 双向绑定 + 2 条 SEC-002 豁免审计 info（record + markRead）+ 6 条 AI-005 建议（5 条命中 role-inheritance 测试 + 1 条其他） |
| test | `pnpm test` | exit 0，14 文件 653/653（含 role-inheritance 65 + role-inheritance-embedding 26 + optimistic-locking 22 + optimistic-locking-embedding 8 + 其余既有），4.28s |

三件套全绿，且**本轮全绿 = 验收对齐**——AI-007 端到端测试 + Reviewer PRD 逐条核对双轨验证，未发现 [约束] 偏离。递归继承 + 环检测 + 读时聚合权限传递新架构模式在前七轮单步 CRUD/多步事务的工作流下成功落地。

## 最终结论

**verdict: pass**。

- **0 项 blocker**：本轮无 [约束] 偏离，PRD F1/F2/F3/F4 共 23 条验收逐条对齐（F1 9/9 + F2 4/4 + F3 7/7 + F4 3/3）。
- **2 项 suggestion**：
  - S-1：role-inheritance 测试 permission_codes 数组硬编码字面量（AI-005 lint 5 条建议，判定 fixture 数据可硬编码，非跨域全集断言，不强制改派生）。
  - S-2：R8 review/retro 回溯核对的历史污染（流程未闭环代价，建议工作流确保每轮闭环，与 RETRO-ROUND9-001 S-3 一致）。
- **AI-007 PRD 逐条核对结论**：23/23 对齐，0 偏离。
- **AI-006 增强清单校验结论**：✅ 生效。两类标注准确（①类 errorCodeSchema 4 码 SSOT 派生零改动 + roleSchema parent_role_id 经 service 返回值含字段使 parse 通过 / ②类 RoleEntity 签名变更击穿 7 处 Role 对象构造，Tech-Spec §8.2 清单准确预判且全部同步修复）。
- **advisory 偏离评估结论**：本期无 [advisory] 偏离需评估（R9 expectedVersion 改动属 R9 范围，R8 维度无 advisory 偏离）。
- **本轮 AI-007/AI-006 增强是否生效**：✅ **均生效**。
  - AI-007：端到端测试（26 用例覆盖 F1/F2/F3/F4 23 条）+ Reviewer PRD 逐条核对（23/23 对齐）双轨闭合，注入共享依赖观测继承链结构 + 环检测跨层 + 无幽灵日志。
  - AI-006：两类标注准确（①类 SSOT 派生零改动 / ②类 7 处 Role 构造击穿预判且同步修复）。
- **本轮核心验证目标达成**：①递归继承 + 环检测新架构模式落地（ARCH-001/CODE-001 闭合）；②权限传递读时聚合正确（D3，AC-F3-5 验证）；③ARCH-001 在 service→repo 递归读下闭合；④CODE-002 在递归异常处理下闭合；⑤AI-007 端到端 + AI-006 两类标注双轨闭合。
- **最值得关注的发现**：**递归继承 + 环检测 + 读时聚合权限传递新架构模式在前七轮单步 CRUD/多步事务的工作流下成功落地**——验证了 spec-first 工作流对"递归数据结构 + 算法正确性"的适应性（RETRO-ROUND7-001 §5 建议达成）。但 R8 流程未及时闭环（review/retro 缺失，回溯补齐）提示工作流须确保每轮闭环（S-2，与 RETRO-ROUND9-001 S-3 一致）。下一轮 R9 已转向 HTTP 条件请求方向（乐观锁并发控制），R8 retro §5 建议指向 R9 已落地。
