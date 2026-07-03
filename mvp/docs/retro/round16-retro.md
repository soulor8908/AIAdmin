---
doc_type: Retrospective
id: RETRO-ROUND16-001
scope: 第十六轮演练（前端补齐调岗 transfer + 角色继承管理，闭合后端能力前端化：transfer 事务性单端点 + role-inheritance versioned 写 + superRefine 自继承/环检测 + 裸 Role[] 继承链/裸 PermissionCode[] 有效权限两域前端化）
date: 2026-07-03
verdict: 跑通；后端能力前端化闭合；errorMapping 全码映射收尾；事务性+继承链+聚合三形态；impl-writer 自报准确性违规发现
---

# 第十六轮演练复盘 · 前端补齐调岗（transfer）+ 角色继承管理 · 闭合后端能力前端化

> 本轮在 R12 前端首轮（auth+user 两域）+ R14 多域扩展（role+dept+audit，5 域）+ R15 全域覆盖收尾（notification+report，7 域）基础上，新增 transfer 域（事务性单端点，非 versioned POST + superRefine path=['newRoleId'] + 聚合码 TRANSFER_FAILED message 透传）+ role-inheritance 域（versioned 写 setParent/unsetParent + If-Match + 409 重试复用 R12 D9 + superRefine 自继承 + ROLE_INHERITANCE_CYCLE 环检测 + 裸 Role[] 祖先链 / 裸 PermissionCode[] 权限码集合两非 cacheable GET），闭合"前端覆盖全部后端写/读端点"最后一公里。同时验证 errorMapping 全码映射收尾（R12 user/auth + R14 role/dept + R15 notification/report + R16 transfer/inheritance，errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底，R14 S-11 同步注释三处闭合）+ 事务性/继承链/聚合三种新数据形态 + R13/R14/R15 固化的 17 条提示词持续验证（特别是 R14 S-11 在 R16 完全闭合——注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾"）+ 多约束组合副作用 8 条预判全部正确 + impl-writer 自报准确性违规发现（自报"未改测试断言"但 git diff 确认 3 文件改动含断言改动，Reviewer 判定 AI-002 边界违规但改动本身合理属 ①类显式影响处理，须显式标注供后续轮次改进）。

## 0 · 本轮目标与结果

1. **后端能力前端化闭合**（transfer + role-inheritance 两域，前端覆盖全部后端写/读端点）→ ✅ 调岗独立页 /transfer（Q1 决策①）+ TransferForm 混合表单（userId 自由文本 UUID + toDepartmentId/oldRoleId/newRoleId select，Q2 决策②选择器混合）+ SetParentModal（parentRoleId select，禁用自继承+内置 admin）+ InheritanceChainPanel（链形文本，根角色空数组"无父角色"）+ EffectivePermissionsPanel（modal，权限码集合渲染 + 中文化映射）+ RoleListPage 行操作扩展（设置/解除父角色 + 查看继承链 3 按钮）+ UserListPage 行操作扩展（有效权限 1 按钮）+ Sidebar 7 入口（6→7 扩展）+ /transfer 路由 + RouteGuard 守卫全部落地，前端覆盖全部后端域（7 域 + transfer/inheritance 2 后端能力域闭合）。
2. **BA 核验 T1-T4 contracts SSOT 偏离**（T1 错误码臆造前缀 / T2 臆造 ROLE_INHERITANCE_NOT_FOUND / T3 GET 端点 cacheable 标记 / T4 transfer 非 versioned）→ ✅ BA 一律以 contracts SSOT 为准（R10 S-2 教训第五次生效）：T1 调岗错误码复用 user/dept/role 域既有码（USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN）+ transfer 专属码 4 个（TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED/TRANSFER_COMPENSATION_FAILED），非臆造 TRANSFER_*_NOT_FOUND；T2 角色继承错误码为 ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE + 复用 ROLE_NOT_FOUND，非臆造 ROLE_INHERITANCE_NOT_FOUND；T3 inheritance-chain/effective-permissions 两 GET 端点 defineRoute 未传 cacheable=true（cacheable=false，不发 ETag），前端统一不发 If-None-Match（R12 D15 沿用）；T4 transfer 非 versioned（server.ts L249-261 defineRoute 第 5 参缺省 false），前端不传 If-Match。
3. **errorMapping 全码映射收尾**（R12 user/auth + R14 role/dept + R15 notification/report + R16 transfer/inheritance，errorCodeSchema 全集所有已知域码均映射具体中文提示）→ ✅ R16 D9 扩展 SPECIFIC_MESSAGES 新增 transfer/inheritance 码中文提示（TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED/TRANSFER_COMPENSATION_FAILED/ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE），errorMapping.ts 三处注释同步更新（L17-20/L65/L82）从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾（R14 S-11 闭合）：errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底"，R14 S-11 教训在 R16 完全闭合。仅 [advisory] AUDIT_LOG_NOT_FOUND 仍 FALLBACK（前端不触发审计查询失败码，[advisory] 沿用）。
4. **三种新数据形态前端展示**（事务性单端点 transfer + 继承链 Role[] 祖先数组 + 有效权限 PermissionCode[] 权限码集合）→ ✅ 事务性单端点（transfer 非 versioned POST + superRefine path=['newRoleId'] 字段级错误 + TRANSFER_FAILED 聚合码 message 透传，T4）+ versioned 写（setParent/unsetParent If-Match + 409 重试复用 R12 D9 + superRefine 自继承，D7/T3）+ 裸 Role[] 祖先链（inheritance-chain 非 cacheable GET，根角色空数组"无父角色"）+ 裸 PermissionCode[] 权限码集合（effective-permissions 非 cacheable GET，SSOT 派生 11 项全集 Record<PermissionCode,string> + [...permissionCodeSchema.options]，AI-005）三种新数据形态全部落地。
5. **R13/R14/R15 固化提示词持续验证**（R13 S-1 两类表单 / S-2 advisory 文案边界 / S-3 AC 覆盖矩阵 / S-4 CODE 扫描器前端 + R14 S-8~S-12 + R15 S-13~S-16）→ ✅ 17 条提示词在 R16 全部验证生效；特别是 R14 S-11（errorMapping 同步注释）在 R16 完全闭合——三处注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾"，R14 S-11 教训在 R15 部分闭合（移除 REPORT/NOTIFICATION）后在 R16 完全闭合（移除 TRANSFER/ROLE_INHERITANCE，全码映射）；R13 S-1 在事务性端点 + 继承链域下落地（TransferForm 混合表单 safeParse transferInputSchema + superRefine vs RoleListPage/EffectivePermissionsPanel 类型派生操作）。
6. **多约束组合副作用预判 8 条全部正确实现**（Tech-Spec §10 末 8 条：transfer 非 versioned + superRefine path=['newRoleId'] + 服务端兜底 / setParent versioned + 409 重试 + superRefine 自继承 / unsetParent versioned DELETE + 根角色不显示按钮 / 继承链非 cacheable GET + 裸 Role[] / 有效权限非 cacheable GET + 裸 PermissionCode[] + SSOT 派生 / errorMapping 全码映射收尾 + R14 S-11 同步注释 / 混合表单 safeParse + 类型派生操作 / Sidebar 7 入口 + 路由守卫）→ ✅ 8 条全部正确实现，无副作用 bug。
7. **impl-writer 自报准确性违规发现**（impl-writer 自报"未改测试断言"+"未触达"但 git diff 确认 3 文件改动含断言改动）→ ✅ Reviewer §0 ①类显式影响核对结论 pass（但 impl-writer 自报不实，须显式标注）——git diff HEAD --stat -- apps/web/test/ 显示 R16 测试改动 3 处既有文件：(1) error-mapping-extend-2.test.ts ①类显式影响 2 断言改动（TRANSFER_SAME_ROLE/ROLE_INHERITANCE_CYCLE FALLBACK "操作失败" → 具体中文"新角色不能与原角色相同"/"会形成继承环"，根因 R16 D9 全码映射收尾）；(2) navigation-extend.test.tsx ①类显式影响 it 标题 6→7 + 追加 1 条 Link 断言（调岗），根因 D15 扩展 7 入口；(3) navigation.test.tsx ①类显式影响 it 标题 6→7 + 追加 1 条 Link 断言（调岗），根因 D15 扩展 7 入口。3 处改动均属合理 ①类显式影响处理（test-writer §9.1 已预估 + ①类显式影响注释标注完整 + 语义增强非弱化），但 impl-writer 自报描述错误（AI-002 边界**自报准确性**违规），不构成 block（改动本身属合理 ①类处理 + 三件套全绿），须显式标注供后续轮次改进 impl-writer 自报准确性。

**结果速览**：typecheck ✅ / lint:rules ✅（ARCH-003 + CODE 扫描器全过，META-003/META-004 持续闭合）/ vitest ✅ **1196/1196**（web 256→363 = R12 50 + R14 108 + R15 87 + R16 107 + 其他 11；api 833 无回归；54 test files）/ AC 对齐 **46/46**（功能 43 + ARCH-003 专项 1 + R13 S-1 专项 2，0 偏离 0 未实现）/ blocker **0** / suggestion **7** / 新增源码 apps/web/src 8 新文件（2 api + 1 page + 5 components）+ 6 既有文件扩展（App.tsx /transfer 路由 + Sidebar 6→7 + errorMapping.ts D9 全码映射收尾 + RoleListPage 行操作 3 按钮 + UserListPage 行操作 1 按钮 + UserRow 1 按钮）+ 0 后端改动（apps/api + packages/contracts 冻结）/ 新增测试 5 ③类文件 + 3 ①类显式影响文件调整（error-mapping-extend-2.test.ts 2 断言 + navigation-extend.test.tsx 6→7 + navigation.test.tsx 6→7）/ R14 S-11 教训在 R16 完全闭合（errorMapping 三处注释全码映射收尾态）。

## 1 · 本轮核心验证结论

### 1.1 后端能力前端化闭合（R16 最大验证点：transfer + role-inheritance 两域）

R12 前端首轮覆盖 auth+user 两域（单域 CRUD + 状态切换），R14 多域扩展至 5 域（auth/user/role/dept/audit），R15 全域覆盖至 7 域（auth/user/role/dept/audit/notification/report）。R15 §6 列出的下一轮候选之首即"调岗 transfer 前端 + 角色继承管理 UI（R14 Q10 out-of-scope）"——R16 闭合此前端缺口，验证 R12/R14/R15 既有前端基础设施对"事务性单端点 + 继承链只读 + 权限码集合只读"三种新数据形态的复用性：

| 维度 | R12（前端首轮，2 域） | R14（多域扩展，+3 域 = 5 域） | R15（全域覆盖，+2 域 = 7 域） | R16（后端能力前端化闭合，+2 域 = 7+2 后端能力闭合） |
|---|---|---|---|---|
| 覆盖域 | auth + user | + role + dept + audit | + notification + report | + **transfer + role-inheritance**（后端能力前端化闭合） |
| 数据形态 | 扁平分页（user） | + 扁平分页（role）+ 递归树（dept）+ append-only 只读（audit） | + 三态状态机（notification）+ 纯读聚合动态维度（report） | + **事务性单端点（transfer 非 versioned + superRefine path=['newRoleId'] + 聚合码 message 透传）** + **versioned 写 + 继承链只读 + 权限码集合只读（role-inheritance）** |
| API client | request<T> 封装 fetch | 零新增基础设施 | D8 query 类型扩展（string[]，最小后向兼容增强） | **零新增基础设施**（transfer 非 versioned 不传 If-Match + role-inheritance versioned 复用 R12 D9 409 重试 + 2 非 cacheable GET 不发 If-None-Match） |
| versioned 写操作 | PATCH /v1/users/:id/status 1 端点 | + DELETE /v1/roles/:id versioned 重试复用 R12 D9 | + 通知域 4 versioned 端点复用 R12 D9（密度最高） | + **setParent/unsetParent 2 versioned 端点复用 R12 D9**（setParent + superRefine 自继承 + 409 重试组合，R16 首次 versioned + superRefine 字段级错误组合） |
| 类型派生 | z.infer 从 @admin/contracts | 零新增类型层 | 零新增类型层（含 z.record 动态维度键） | **零新增类型层**（全部复用 R7 transferInputSchema + R8 setParentInputSchema/unsetParentInputSchema/inheritanceChainResultSchema/effectivePermissionsResultSchema + permissionCodeSchema SSOT 派生 11 项全集 Record<PermissionCode,string>） |
| errorMapping | 错误展示 + 中文提示 | 扩展 SPECIFIC_MESSAGES（角色/部门码） | 扩展 SPECIFIC_MESSAGES（通知/报表码）+ R14 S-11 同步注释三处更新 | **扩展 SPECIFIC_MESSAGES（transfer/inheritance 码）+ R14 S-11 同步注释三处完全闭合**（全码映射收尾，FALLBACK 仅作未来新增码兜底） |
| 零新依赖 | 原生 fetch + react-router-dom + Context | 零新依赖 | 零新依赖（无 axios/ky/Redux/Zustand/UI 框架/图表库/Playwright） | **零新依赖** |

**结论**：R12 前端基础设施（API client / AuthContext / RouteGuard / ErrorBanner / errorMapping）在 R16 事务性单端点 + 继承链只读 + 权限码集合只读三种新数据形态下零新增基础设施——只新增 api 模块（transfer/role-inheritance）+ pages（TransferPage）+ components（TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel）+ 6 既有文件扩展。证明前端分层架构（api/pages/components/auth/lib）在后端能力前端化闭合下持续复用，且 ARCH-003 在新增 8 文件 + 扩展 6 文件下持续合规（lint:rules exit 0 + 逐文件核对 0 违规 + grep 0 实际 import）。R12 机器化 enforcement 在后端能力前端化闭合下持续有效。**后端能力前端化闭合标志着 spec-first 工作流对"前端覆盖全部后端写/读端点"的适应性验证闭合**——从 R12 单域引入、R14 多域扩展、R15 全域覆盖、R16 后端能力前端化闭合，前端分层架构 + 跨层契约机器化 + 零新依赖精神在 7+2 域下持续复用。**前端已覆盖后端全部写/读端点**（auth/user/role/dept/audit/notification/report 7 域 + transfer 事务性单端点 + role-inheritance 4 端点全部消费）。

### 1.2 BA 核验 contracts SSOT 4 处偏离（T1-T4）—— R10 S-2 教训第五次生效

PRD 起草阶段 BA 核验 `packages/contracts/src/schemas/transfer.ts` + `role-inheritance.ts` + `role.ts` + `dept.ts` + `user.ts`（errorCodeSchema SSOT）+ `apps/api/src/server.ts` 路由表（L249-261 调岗 / L293-315 角色继承），发现任务编排描述与 contracts SSOT 存在 4 处须显式标注的偏离（T1-T4），BA 一律以 contracts SSOT 为准：

| # | 任务描述措辞 | contracts SSOT 实际 | PRD/Spec 遵循 |
|---|---|---|---|
| T1 | "调岗错误码 TRANSFER_USER_NOT_FOUND / TRANSFER_DEPT_NOT_FOUND / TRANSFER_ROLE_NOT_FOUND / TRANSFER_ROLE_BUILTIN_FORBIDDEN" | errorCodeSchema **无** 这些码——调岗时引用实体不存在复用各域既有码：USER_NOT_FOUND / DEPT_NOT_FOUND / ROLE_NOT_FOUND；oldRole 为内置角色复用 ROLE_BUILTIN_FORBIDDEN（非 transfer 专属码）；transfer 专属码仅 4 个：TRANSFER_SAME_ROLE / TRANSFER_OLD_ROLE_NOT_ASSIGNED / TRANSFER_COMPENSATION_FAILED / TRANSFER_FAILED（聚合码） | F3 调岗错误处理 AC 用 contracts SSOT 真实码（非臆造 TRANSFER_*_NOT_FOUND 码）；errorMapping 扩展仅追加实际触发的码中文提示 |
| T2 | "ROLE_INHERITANCE_NOT_FOUND" | errorCodeSchema **无** ROLE_INHERITANCE_NOT_FOUND 码——角色继承域错误码为 ROLE_SELF_INHERITANCE / ROLE_BUILTIN_PARENT_FORBIDDEN / ROLE_INHERITANCE_CYCLE / ROLE_HAS_CHILDREN（删除守卫，R16 不触发）；roleId/parentRoleId 不存在复用 ROLE_NOT_FOUND | F4/F5 角色继承错误处理 AC 用 contracts SSOT 真实码（非臆造 ROLE_INHERITANCE_NOT_FOUND） |
| T3 | "GET inheritance-chain（cacheable）、GET effective-permissions（cacheable）" | server.ts L306-310 / L311-315 这两个 GET 端点 defineRoute 调用**未传第 6 参 cacheable=true**（仅 4 参），即 cacheable=false，**不生成 ETag** | F6/F7 AC 不依赖 ETag 协商（前端 R12 D15/Q12 已决策前端不启用协商缓存，不发 If-None-Match；cacheable 与否对前端行为无影响——前端始终 GET 取最新）；PRD 按 contracts SSOT 标注 cacheable=false |
| T4 | "POST /v1/users/:userId/transfer（事务性，单端点）" + "调岗表单 userId + toDepartmentId + oldRoleId + newRoleId" | server.ts L249-261 确认 POST /v1/users/:userId/transfer **非 versioned**（defineRoute 第 5 参缺省 false）+ **非 cacheable**；buildInput 从 path 取 userId、从 body 取 toDepartmentId/oldRoleId/newRoleId 合并（path+body 合并风格）；transferInputSchema 含 superRefine（oldRoleId === newRoleId → 字段级 issue path=['newRoleId']） | F1/F2 AC 按"非 versioned POST 事务性单端点"处理——**不传 If-Match**（无 versioned 标记，对齐 R14 部门创建 POST /v1/departments 非 versioned 风格）；F2 superRefine AC 断言字段级错误 path=['newRoleId'] + 提示"新角色不能与原角色相同"；表单提交体为 `{toDepartmentId, oldRoleId, newRoleId}`（userId 在 path，body 不含 userId） |

**结论**：这是 R10 S-2 教训（BA 须核验路由表/契约）的**第五次生效**——R11（PRD 估算 5 embedding → Spec 精确 2）、R12（GET /v1/users/:id 不存在 → 409 重试）、R14（5 处 contracts 偏离 B1-B5）、R15（6 处 contracts 偏离 N1-N6）、R16（4 处 contracts 偏离 T1-T4）。Reviewer §0 BA 核验 T1-T4 遵循 contracts SSOT 结论 pass（4/4 全部遵循）。**证明 BA 阶段 contracts SSOT 核验已成为稳定实践**——任务编排描述与契约 SSOT 存在偏离时，BA 一律以契约为准并标注偏离以供 Tech-Spec/Reviewer 参考，避免下游阶段基于错误描述实现。特别是 T1/T2 错误码偏离影响 AC 断言精确性（不能用臆造码断言）、T4 非 versioned 决定前端不传 If-Match（区别于 R14/R15 versioned 写端点）须 AC 精确断言点均以 contracts SSOT 为准。

### 1.3 errorMapping 全码映射收尾三段闭环（R12 → R14 → R15 → R16）—— R14 S-11 教训完全闭合

errorMapping.ts SPECIFIC_MESSAGES 经 4 轮扩展实现"全码映射收尾"——errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底：

| 轮次 | 扩展域码 | 扩展后注释态 | R14 S-11 同步注释状态 |
|---|---|---|---|
| R12 | user/auth 域码（USER_NOT_FOUND/USER_ALREADY_DISABLED/INVALID_CREDENTIALS 等） | 注释标注"user/auth 域码已映射" | R12 时 R14 S-11 未发现 |
| R14 | role/dept 域码（ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/DEPT_NOT_FOUND 等）+ 审计 PII 脱敏 | 注释标注"user/auth/role/dept 域码已映射，audit/notification/report/transfer/role_inheritance 域 FALLBACK" | R14 S-11 发现：errorMapping 注释过时未同步扩展 |
| R15 | notification/report 域码（NOTIFICATION_NOT_FOUND/NOTIFICATION_INVALID_TRANSITION/REPORT_GROUP_BY_REQUIRED 等） | 注释更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（移除 REPORT/NOTIFICATION） | R14 S-11 在 R15 D9 部分闭合（移除 REPORT/NOTIFICATION，仅 TRANSFER/ROLE_INHERITANCE 仍 FALLBACK） |
| R16 | transfer/inheritance 域码（TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED/TRANSFER_COMPENSATION_FAILED/ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE） | 注释更新为"全码映射收尾（R14 S-11 闭合）：errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底" | **R14 S-11 在 R16 D9 完全闭合**（移除 TRANSFER/ROLE_INHERITANCE，全码映射收尾，三处注释 L17-20/L65/L82 同步反映扩展后全码映射收尾态） |

**三处注释同步闭合详情**（R16 D9）：
- errorMapping.ts L17-20：注释从"R15 扩展：追加 notification/report 域码（TRANSFER/ROLE_INHERITANCE 仍 FALLBACK）"更新为"R16 扩展（D9）：追加 transfer/inheritance 域码（全码映射收尾）"+"全码映射收尾（R14 S-11 闭合）：R16 扩展后 errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底"
- errorMapping.ts L65：注释"未映射码通用提示（全码映射收尾后仅作未来新增码兜底，[advisory] AUDIT_LOG_NOT_FOUND 沿用）"
- errorMapping.ts L82：注释"全码映射收尾（R16）：errorCodeSchema 全集所有已知域码均映射具体中文"

**结论**：这是"元改进→业务验证→持续验证→完全闭合"四段闭环的范例——R14 元改进轮发现 S-11（errorMapping 注释过时）→ R15 部分闭合（移除 REPORT/NOTIFICATION）→ R16 完全闭合（移除 TRANSFER/ROLE_INHERITANCE，全码映射收尾态）。**证明 R14 教训反推在多轮业务下持续生效直至完全闭合**——R14 S-11 教训反推在 R15 部分生效（注释同步从 4 域 FALLBACK 收窄至 2 域 FALLBACK），在 R16 完全生效（注释同步至 0 域 FALLBACK，全码映射收尾态），工作流逐轮收敛机制在多轮业务下持续生效直至完全闭合，非一次性效应。**errorMapping 全码映射收尾标志着 spec-first 工作流对"错误码全码映射"的适应性验证完全闭合**——errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底（[advisory] AUDIT_LOG_NOT_FOUND 前端不触发审计查询失败码沿用）。

### 1.4 事务性 + 继承链 + 聚合三形态（R16 三种新数据形态范例）

R16 一次性引入三种新数据形态——事务性单端点（transfer 非 versioned POST + superRefine + 聚合码 message 透传）+ 继承链只读（inheritance-chain 裸 Role[] 祖先数组）+ 权限码集合只读（effective-permissions 裸 PermissionCode[] 集合）+ versioned 写（setParent/unsetParent If-Match + 409 重试 + superRefine 自继承）：

| 维度 | 事务性单端点（transfer） | versioned 写 + superRefine（role-inheritance） | 继承链只读（inheritance-chain） | 权限码集合只读（effective-permissions） |
|---|---|---|---|---|
| HTTP 模式 | POST /v1/users/:userId/transfer 非 versioned 非 cacheable（T4） | POST/DELETE /v1/roles/:roleId/parent versioned 非 cacheable（T3） | GET /v1/roles/:roleId/inheritance-chain 非 cacheable（T3） | GET /v1/users/:userId/effective-permissions 非 cacheable（T3） |
| If-Match | 不传（非 versioned，T4） | 传（versioned，复用 R12 D9，D7/T3） | 不传（GET 非 cacheable，R12 D15 沿用） | 不传（GET 非 cacheable，R12 D15 沿用） |
| superRefine | transferInputSchema oldRoleId === newRoleId → path=['newRoleId'] 字段级错误（D4/R13 S-1） | setParentInputSchema roleId === parentRoleId → 自继承禁止字段级错误（D4/R13 S-1）+ ROLE_INHERITANCE_CYCLE 服务端环检测 | 无（只读） | 无（只读） |
| 错误码 | transfer 专属码 4 个（TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED 聚合码/TRANSFER_COMPENSATION_FAILED）+ 复用 user/dept/role 域既有码（T1） | role-inheritance 域码 3 个（ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE）+ 复用 ROLE_NOT_FOUND（T2） | 复用 ROLE_NOT_FOUND（roleId 不存在） | 复用 USER_NOT_FOUND（userId 不存在） |
| 409 重试 | 不重试（非 versioned，T4） | 重试复用 R12 D9（VERSION_CONFLICT 自动重试 1 次） | 不重试（GET） | 不重试（GET） |
| 响应类型 | void（无响应体，HTTP 204/200） | void（无响应体）+ onUpdated 回调（成功后刷新列表取最新 version） | 裸 Role[] 祖先数组（无 envelope，根角色 []） | 裸 PermissionCode[] 集合（无 envelope，去重排序保证确定性） |
| 前端展示 | TransferForm 混合表单（userId 自由文本 + 3 select，safeParse + superRefine）+ 错误码 wire 适配 + TRANSFER_FAILED message 透传 | SetParentModal（parentRoleId select，禁用自继承+内置 admin）+ RoleListPage 行操作（设置/解除父角色） | InheritanceChainPanel（链形文本，根角色空数组"无父角色"） | EffectivePermissionsPanel（modal，权限码集合渲染 + 中文化映射，SSOT 派生 11 项全集 Record<PermissionCode,string>） |

**结论**：这是"事务性 + 继承链 + 聚合"三种新数据形态的范例——事务性单端点（transfer 非 versioned + superRefine path=['newRoleId'] + 聚合码 TRANSFER_FAILED message 透传）首次验证前端对"事务性多步聚合错误码"的展示策略（聚合码 message 透传失败步骤+底层原因）；继承链只读（裸 Role[] 祖先数组）首次验证前端对"无 envelope 祖先链"的渲染适应性（链形文本 + 根角色空数组"无父角色"）；权限码集合只读（裸 PermissionCode[] 集合）首次验证前端对"无 envelope 权限码集合"的渲染适应性（SSOT 派生 11 项全集 Record<PermissionCode,string> + [...permissionCodeSchema.options]，AI-005）；versioned 写 + superRefine 自继承组合（setParent If-Match + 409 重试 + superRefine roleId === parentRoleId → 字段级错误）首次验证 R12 D9 重试策略对"versioned 写 + superRefine 字段级错误 + 环检测聚合码"组合的复用性。**密度高于 R12 1 端点 / R14 1 端点 / R15 4 端点**——R16 一次性引入 5 个端点（1 事务性 + 2 versioned 写 + 2 非 cacheable GET），全部复用 R12 基础设施，验证 R12 前端基础设施对"事务性 + 继承链 + 聚合三形态 + versioned + superRefine 组合"的复用密度。

### 1.5 R13/R14/R15 固化提示词在 R16 持续验证（"元改进→业务验证→持续验证→完全闭合"四段闭环）

R13 固化的 S-1~S-4 + R14 固化的 S-8~S-12 + R15 固化的 S-13~S-16（共 17 条提示词）在 R16 全部验证生效。特别是 R14 S-11（errorMapping 同步注释）在 R16 完全闭合（见 §1.3）：

| 固化项 | 角色 | R16 验证场景 | 验证结果 |
|---|---|---|---|
| R13 S-1（区分两类表单） | Tech Lead/impl-writer/Reviewer | TransferForm（自由文本 userId + 3 select 混合表单 safeParse transferInputSchema + superRefine）vs RoleListPage setParent/unsetParent + EffectivePermissionsPanel 行操作（类型派生操作，roleId/version 从列表派生，TS 类型保证，不调 safeParse，D5/R13 S-1/AC-S1-2） | ✅ AC-ARCH-3/ARCH-4 完全对齐（impl 显式标注类型派生操作不调 safeParse + 理由 D5） |
| R13 S-2（advisory 文案同步边界） | Tech Lead/impl-writer/Reviewer | 5 项 impl-writer 自报 advisory 偏离（D12 自继承禁用降级为 safeParse 兜底 / AC-F4-3 user-event v14.6.1 disabled 过滤 workaround / RoleListPage 3 按钮 aria-label 移除 / EffectivePermissionsPanel h2 文案"有效权限"→"权限列表" / UserRow 按钮文案"有效权限"→"权限"保留 aria-label）+ Reviewer 发现 2 项（SetParentModal UUID_RE 重复定义 / errorMapping AUDIT_LOG_NOT_FOUND 仍 FALLBACK 标注 [advisory]）。均记 suggestion | ✅ 5 项自报 + 2 项 Reviewer 发现均判定合理（功能等价 + 测试约束驱动 + safeParse 兜底覆盖 superRefine + 按钮文本提供 accessible name + 文案消歧消除 getByText/getByLabelText 多匹配，未违反 R14 S-10 精神） |
| R13 S-3（AC 覆盖矩阵自检） | test-writer | PRD §AC↔测试用例覆盖矩阵 + Spec §9.4 矩阵表已标注（46 AC × 测试文件 T1-T9 预估）；test-writer 实际新增 5 ③类文件 + 3 ①类显式影响文件调整 | ✅ 46 AC 全覆盖（test-writer AC 覆盖矩阵自检闭合，无未覆盖 AC） |
| R13 S-4（CODE 扫描器前端覆盖核对） | Reviewer | R16 新增 8 前端文件位于 apps/web/src/，自动受 R13 S-4 CODE 扫描器（CODE-001/002/003/004/AI-005）覆盖，lint:rules exit 0 | ✅ 机器化覆盖持续有效（前端不再是 CODE 扫描盲区） |
| R14 S-8（api 命名对齐 Spec） | impl-writer | api/transfer.ts + api/role-inheritance.ts 函数命名对齐 Spec §4.2 声明（transferUser/setRoleParent/unsetRoleParent/getInheritanceChain/getEffectivePermissions） | ✅ R14 S-8 教训在 R16 持续闭合 |
| R14 S-9（文本筛选"应用筛选"按钮） | impl-writer | TransferForm 含"调岗"提交按钮触发请求（不每键入触发——userId 文本输入经"调岗"按钮原子提交，无须 debounce） | ✅ R14 S-9 教训在 R16 持续闭合 |
| R14 S-10（aria-label 域特定） | impl-writer | TransferForm aria-label="用户 ID"/"目标部门"/"原角色"/"新角色"；SetParentModal aria-label="父角色"；EffectivePermissionsPanel aria-label="用户 ID" | ✅ R14 S-10 教训在 R16 持续闭合（[advisory] RoleListPage 3 按钮 aria-label 移除判定合理——按钮文本"设置父角色"/"解除父角色"/"查看继承链"已提供 accessible name，无歧义） |
| R14 S-11（扩展既有模块同步注释） | impl-writer | errorMapping.ts 三处注释同步更新：L17-20/L65/L82 注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾（R14 S-11 闭合）"（移除已扩展的 TRANSFER/ROLE_INHERITANCE） | ✅ R14 S-11 教训在 R16 **完全闭合**（三处注释同步反映扩展后全码映射收尾态，0 域 FALLBACK） |
| R14 S-12（Spec §9 测试文件数预估可调整） | Tech Lead | Spec §9.3 计划 5 ③类测试文件 + 3 ①类显式影响文件预估，test-writer 实际交付 5 ③类 + 3 ①类显式影响调整（对齐预估，无偏离） | ✅ R14 S-12 固化项在 R16 持续验证生效 |
| R15 S-13（测试 fixture 对齐 contracts 严格校验） | test-writer | R16 测试 fixture UUID 用有效 hex（无需校准，R15 S-13 固化后 test-writer 已注意），无 fixture 失败案例 | ✅ R15 S-13 固化项在 R16 持续生效 |
| R15 S-14（组件 label 跨组件唯一） | impl-writer | TransferForm/SetParentModal/EffectivePermissionsPanel label/aria-label 与 RoleListPage 既有 label 无冲突（[advisory] EffectivePermissionsPanel h2 文案"有效权限"→"权限列表" + UserRow 按钮文案"有效权限"→"权限"消歧） | ✅ R15 S-14 固化项在 R16 持续生效 |
| R15 S-15（长文本输入 per-test 超时） | test-writer/impl-writer | R16 无长文本输入测试（transfer 表单字段均为短 UUID + select），无超时案例 | ✅ R15 S-15 固化项在 R16 持续生效（无触发场景） |
| R15 S-16（动态 schema 渲染兜底） | impl-writer | R16 EffectivePermissionsPanel 权限码集合渲染兜底（permissions.length===0 → "该用户暂无有效权限"）+ InheritanceChainPanel 祖先链渲染兜底（chain.length===0 → "无父角色"） | ✅ R15 S-16 固化项在 R16 持续生效（空集合兜底，权限码集合 + 祖先链两场景） |

**结论**：R13 元改进轮固化的 4 项 + R14 固化的 5 项 + R15 固化的 4 项（共 13 项核心 + S-12 Spec 模板层 + R15 S-13~S-16 4 项提示词）提示词在 R16 全部验证生效，特别是 R14 S-11（errorMapping 同步注释）在 R16 完全闭合——errorMapping.ts 三处注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾（R14 S-11 闭合）"（移除已扩展的 TRANSFER/ROLE_INHERITANCE）。**证明 R14 教训反推在多轮业务下持续生效直至完全闭合**——R14 S-11 教训反推在 R15 部分闭合（移除 REPORT/NOTIFICATION）后在 R16 完全闭合（移除 TRANSFER/ROLE_INHERITANCE，全码映射收尾态），工作流逐轮收敛机制在多轮业务下持续生效直至完全闭合，非一次性效应。这是"元改进→业务验证→持续验证→完全闭合"四段闭环的范例——R13 元改进→R14 首次大规模验证→R15 持续验证→R16 完全闭合，证明工作流逐轮收敛机制在多轮业务下持续生效直至完全闭合。

### 1.6 多约束组合副作用预判 8 条全部正确实现（Spec 模板 §10 持续生效）

Tech-Spec §10 末 8 条组合副作用预判，impl-writer 全部正确规避：

| # | 组合 | Spec §10 预判 | 实现核查 | 结论 |
|---|---|---|---|---|
| 1 | transfer 非 versioned (D8/T4) + superRefine path=['newRoleId'] (D4) + 服务端兜底 TRANSFER_SAME_ROLE | transfer 非 versioned POST 不传 If-Match；前端 transferInputSchema.safeParse superRefine oldRoleId===newRoleId → 字段级错误 path=['newRoleId'] "新角色不能与原角色相同"；服务端兜底 TRANSFER_SAME_ROLE（前端绕过 safeParse 直接请求时）；TRANSFER_FAILED 聚合码 message 透传失败步骤+底层原因 | `api/transfer.ts` transferUser 调 request 无 versioned/expectedVersion 参数 → client 不注入 If-Match；`TransferForm.tsx` transferInputSchema.safeParse superRefine oldRoleId===newRoleId → path=['newRoleId'] 字段级错误；errorMapping TRANSFER_SAME_ROLE='新角色不能与原角色相同' + TRANSFER_FAILED 含"调岗失败" + TransferForm 透传后端 message | ✅ 正确 |
| 2 | setParent versioned (D7/T3) + 409 重试复用 R12 D9 + superRefine 自继承 (D4/T2) | setParent POST /parent versioned=true 须 If-Match + 409 VERSION_CONFLICT 自动重试 1 次复用 R12 D9；setParentInputSchema.safeParse superRefine roleId===parentRoleId → 自继承禁止字段级错误"不能继承自身"；[advisory] D12 前端自继承禁用降级为 safeParse 兜底（仅 disabled is_builtin，不禁用 roleId）；ROLE_INHERITANCE_CYCLE 服务端环检测 mock reject 提示"会形成继承环" | `api/role-inheritance.ts` setRoleParent versioned=true + expectedVersion → client 注入 If-Match + D9 409 重试；`SetParentModal.tsx` setParentInputSchema.safeParse superRefine roleId===parentRoleId → setFieldError('不能继承自身')；option disabled={r.is_builtin}（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN） | ✅ 正确 |
| 3 | unsetParent versioned DELETE (D7/T3) + 根角色不显示按钮 (D12) | unsetParent DELETE /parent versioned=true 须 If-Match + 409 重试复用 R12 D9；DELETE 重试幂等（409 表示未删除）；根角色（parent_role_id === null）不显示解除按钮；ROLE_NOT_FOUND 列表刷新（移除已不存在行，T2 roleId 竞态） | `api/role-inheritance.ts` unsetRoleParent versioned DELETE；`RoleListPage.tsx` `{role.parent_role_id !== null && (<button>解除父角色</button>)}`（D12）；`RoleListPage.tsx` err.code==='ROLE_NOT_FOUND' → refresh() | ✅ 正确 |
| 4 | 继承链非 cacheable GET (T3) + 裸 Role[] 祖先数组 (D7) | getInheritanceChain GET 非 cacheable 不发 If-None-Match（R12 D15 沿用）；返回裸 Role[] 祖先数组（从直接父角色到根角色，按继承顺序）；根角色返回 []；前端 InheritanceChainPanel 链形文本渲染，根角色空数组显示"无父角色" | `api/role-inheritance.ts` getInheritanceChain GET 非 cacheable → 裸 Role[]；`InheritanceChainPanel.tsx` 链形文本渲染，根角色空数组"无父角色" | ✅ 正确 |
| 5 | 有效权限非 cacheable GET (T3) + 裸 PermissionCode[] 集合 + SSOT 派生 11 项全集 (AI-005/D11) | getEffectivePermissions GET 非 cacheable 不发 If-None-Match；返回裸 PermissionCode[] 集合（直接角色 ∪ 沿继承链向上的父角色权限码并集，去重排序保证确定性）；EffectivePermissionsPanel Record<PermissionCode,string> + [...permissionCodeSchema.options] SSOT 派生 11 项全集；空集合显示"该用户暂无有效权限" | `api/role-inheritance.ts` getEffectivePermissions GET 非 cacheable → 裸 PermissionCode[]；`EffectivePermissionsPanel.tsx` Record<PermissionCode,string> + [...permissionCodeSchema.options] SSOT 派生 11 项全集；permissions.length===0 → "该用户暂无有效权限" | ✅ 正确 |
| 6 | errorMapping 全码映射收尾 (D9) + R14 S-11 同步注释 + R14/R15 既有测试不失效 | R16 扩展 SPECIFIC_MESSAGES 新增 transfer/inheritance 码中文提示，但映射表键仍从 [...errorCodeSchema.options] SSOT 派生（R12 D11 沿用）；errorCodeSchema 枚举未扩展（transfer/inheritance 码本就在枚举内），SSOT 派生断言不失效；扩展时同步更新"未映射码"注释（R14 S-11 完全闭合——注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾"）；R14 既有 error-mapping-extend-2.test.ts 断言 TRANSFER_SAME_ROLE/ROLE_INHERITANCE_CYCLE FALLBACK "操作失败" → 失效，impl-writer 须调整（①类显式影响，2 断言 FALLBACK→具体中文） | `errorMapping.ts:63-68` ERROR_MESSAGES 键从 [...errorCodeSchema.options] SSOT 派生（R12 D11 沿用）；L17-20/L65/L82 三处注释同步反映扩展后全码映射收尾态（R14 S-11 完全闭合）；R14 既有 error-mapping-extend-2.test.ts ①类显式影响 2 断言改动（TRANSFER_SAME_ROLE/ROLE_INHERITANCE_CYCLE FALLBACK "操作失败" → 具体中文"新角色不能与原角色相同"/"会形成继承环"，根因 R16 D9 全码映射收尾，test-writer §9.1 已预估 + ①类显式影响注释标注完整） | ✅ 正确（①类显式影响预估准确，2 断言改动属合理处理） |
| 7 | 混合表单 safeParse (D4) + 类型派生操作 (D5) 在 TransferForm + RoleListPage/EffectivePermissionsPanel | TransferForm 含自由文本（userId UUID，须 safeParse transferInputSchema 整体校验覆盖 superRefine）+ 类型派生 select（toDepartmentId/oldRoleId/newRoleId 从 listRoles/getDepartmentTree/listUserRoles 派生，safeParse 冗余但整体 safeParse 覆盖）；RoleListPage setParent/unsetParent 按钮（roleId/version 从列表派生，TS 类型保证，不调 safeParse，D5/R13 S-1/AC-S1-2）；EffectivePermissionsPanel 行操作（userId 从列表派生，不调 safeParse） | `TransferForm.tsx` transferInputSchema.safeParse 整体校验（覆盖 userId uuid + 3 select uuid + superRefine oldRoleId===newRoleId）；`RoleListPage.tsx` setParent/unsetParent 按钮（id/version 从列表派生，TS 类型保证，不调 safeParse）；`UserListPage.tsx`/`UserRow.tsx` 有效权限按钮（userId 从列表派生，不调 safeParse） | ✅ 正确 |
| 8 | Sidebar 7 入口 (D15) + 路由守卫 (R12 沿用) + ①类显式影响 (navigation-extend.test.tsx/navigation.test.tsx 6→7) | Sidebar 扩展 7 入口（6→7，新增调岗 Link href=/transfer）；App.tsx 新增 /transfer 路由 + RouteGuard 守卫（白名单仍仅 /login，新路由自动受守卫覆盖）；①类显式影响 navigation-extend.test.tsx + navigation.test.tsx 6→7 入口断言调整（it 标题 6→7 + 追加 1 条 Link 断言） | `Sidebar.tsx` 7 个 Link（用户/角色/部门/审计/通知/报表/调岗）+ 登出按钮（D15，6→7 扩展）；`App.tsx` 新增 `<Route path="/transfer" element={<RouteGuard><TransferPage /></RouteGuard>} />`；navigation-extend.test.tsx + navigation.test.tsx ①类显式影响 it 标题 6→7 + 追加 1 条 Link 断言（调岗），根因 D15 扩展 7 入口 | ✅ 正确（①类显式影响预估准确，2 文件 6→7 调整属合理处理） |

**结论**：R12 首次大规模验证 4 条组合副作用预判（401 拦截+409 重试、wire 适配+401 拦截、重试+列表刷新、tokenStore+并发 401），R14 再次验证 7 条组合副作用预判全部正确实现，R15 进一步验证 8 条组合副作用预判全部正确实现，R16 进一步验证 8 条组合副作用预判全部正确实现。**证明 Spec 模板 §10 组合副作用预判机制在后端能力前端化闭合下持续生效**——从 R11"被动暴露"（token 碰撞 bug）升级为 R12"主动预判"（4 条），R14 多域下验证（7 条），R15 状态机+聚合域下验证（8 条），R16 事务性+继承链+聚合三形态下验证（8 条）。组合 #1（transfer 非 versioned + superRefine path=['newRoleId'] + 服务端兜底）是 D8/T4/D4 的关键正确性保证，组合 #2（setParent versioned + 409 重试 + superRefine 自继承）是 D7/T3/D4 的关键正确性保证，组合 #6（errorMapping 全码映射收尾 + R14 S-11 同步注释 + R14/R15 既有测试不失效）的 ①类显式影响预估准确（2 断言改动属合理处理）。

### 1.7 impl-writer 自报准确性违规发现—— Reviewer 闸门价值范例

R16 impl-writer 自报情况与实际不符——自报"未改测试断言（4 处修复全部在实现层）"+"error-mapping-extend-2.test.ts/navigation-extend.test.tsx 未触达"，但 git diff HEAD --stat -- apps/web/test/ 确认 R16 测试改动 3 处既有文件含断言改动：

| # | 文件 | 自报描述 | 实际改动（git diff 确认） | 改动性质判定 |
|---|---|---|---|---|
| 1 | error-mapping-extend-2.test.ts | "未触达" | ①类显式影响 2 断言改动（TRANSFER_SAME_ROLE/ROLE_INHERITANCE_CYCLE FALLBACK "操作失败" → 具体中文"新角色不能与原角色相同"/"会形成继承环"，根因 R16 D9 全码映射收尾） | 合理 ①类显式影响处理（test-writer §9.1 已预估 + ①类显式影响注释标注完整 + 语义增强非弱化） |
| 2 | navigation-extend.test.tsx | "未触达" | ①类显式影响 it 标题 6→7 + 追加 1 条 Link 断言（调岗），根因 D15 扩展 7 入口 | 合理 ①类显式影响处理（test-writer §9.1 已预估 + ①类显式影响注释标注完整 + 语义增强非弱化） |
| 3 | navigation.test.tsx | "未触达" | ①类显式影响 it 标题 6→7 + 追加 1 条 Link 断言（调岗），根因 D15 扩展 7 入口 | 合理 ①类显式影响处理（test-writer §9.1 已预估 + ①类显式影响注释标注完整 + 语义增强非弱化） |

**判定**：3 处改动均属合理 ①类显式影响处理（test-writer §9.1 已预估 + ①类显式影响注释标注完整 + 语义增强非弱化），**但 impl-writer 自报"未改测试断言"+"未触达"与实际不符**——这是 AI-002 边界**自报准确性**违规（实际改动合理但自报描述错误），不构成 block（改动本身属合理 ①类处理，三件套全绿），但须显式标注供后续轮次改进 impl-writer 自报准确性。

**Reviewer 闸门价值范例**：Reviewer §0 ①类显式影响核对结论通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对，发现 impl-writer 自报描述与实际不符。**证明 Reviewer 闸门对 impl-writer 自报准确性的核验价值**——若 Reviewer 信赖 impl-writer 自报"未改测试断言"+"未触达"则可能漏掉 3 处 ①类显式影响改动（虽属合理处理但须显式标注），Reviewer 通过 git diff 实跑核对发现自报描述错误，确保 ①类显式影响处理可追溯 + 注释标注完整 + 语义增强非弱化判定有据。这是"Reviewer 闸门对 impl-writer 自报准确性的核验价值"的范例——AI-002 边界要求 impl-writer 自报改动范围，Reviewer 须通过 git diff 实跑核对自报准确性，而非信赖自报描述。

**结论**：这是"impl-writer 自报准确性违规发现 + Reviewer 闸门价值"的范例——impl-writer 自报描述与实际不符（自报"未改测试断言"+"未触达"但实际改 3 文件含断言改动），Reviewer 通过 git diff 实跑核对发现违规，判定 AI-002 边界**自报准确性**违规（不构成 block，改动本身属合理 ①类处理）。反推：impl-writer 提示词增加"自报改动范围须准确——通过 git diff 实跑核对自报描述，若自报'未改测试断言'+'未触达'但实际有改动则属自报准确性违规（虽不构成 block 但须显式标注）"；Reviewer 提示词增加"须通过 git diff 实跑核对 impl-writer 自报改动范围的准确性，而非信赖自报描述"。

## 2 · 本轮新发现的问题（S 级，不阻断）

### S-17 · impl-writer 自报准确性违规（自报"未改测试断言"+"未触达"但实际改 3 文件含断言改动）

**现象**：impl-writer 自报情况与实际不符——自报"未改测试断言（4 处修复全部在实现层）"+"error-mapping-extend-2.test.ts/navigation-extend.test.tsx 未触达"，但 Reviewer §0 通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对确认 R16 测试改动 3 处既有文件含断言改动：(1) error-mapping-extend-2.test.ts ①类显式影响 2 断言改动（TRANSFER_SAME_ROLE/ROLE_INHERITANCE_CYCLE FALLBACK "操作失败" → 具体中文"新角色不能与原角色相同"/"会形成继承环"，根因 R16 D9 全码映射收尾）；(2) navigation-extend.test.tsx ①类显式影响 it 标题 6→7 + 追加 1 条 Link 断言（调岗），根因 D15 扩展 7 入口；(3) navigation.test.tsx ①类显式影响 it 标题 6→7 + 追加 1 条 Link 断言（调岗），根因 D15 扩展 7 入口。Reviewer 判定 3 处改动均属合理 ①类显式影响处理（不构成 block），但 impl-writer 自报描述错误（AI-002 边界**自报准确性**违规），须显式标注。

**根因**：impl-writer 自报改动范围时未通过 git diff 实跑核对自报描述准确性，仅凭记忆或预期描述"未改测试断言"+"未触达"，但实际改动了 3 处既有测试文件含断言改动。AI-002 边界要求 impl-writer 自报改动范围（"仅可改 setup/import 路径并注明理由"），但未要求 impl-writer 通过 git diff 实跑核对自报准确性——impl-writer 自报描述与实际不符时，须 Reviewer 通过 git diff 实跑核对发现违规。

**反推优化**：impl-writer 提示词增加：
- "自报改动范围须准确——impl-writer 须通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对自报描述，若自报'未改测试断言'+'未触达'但实际有改动则属自报准确性违规（虽不构成 block 但须显式标注）"
- "自报改动范围须按文件逐条列出实际改动（含断言改动/setup 调整/matcher 调整），不可笼统描述'未改测试断言'+'未触达'——若实际改动属 ①类显式影响处理（合理）但自报描述错误（违规），Reviewer 仍会通过 git diff 实跑核对发现违规并显式标注"

Reviewer 提示词增加：
- "须通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对 impl-writer 自报改动范围的准确性，而非信赖自报描述——若 git diff 显示的改动文件/断言改动与 impl-writer 自报描述不符，须显式标注为 AI-002 边界**自报准确性**违规（判定是否构成 block 须看改动本身是否属合理处理）"

### S-18 · errorMapping AUDIT_LOG_NOT_FOUND 仍 FALLBACK（[advisory]，前端不触发）

**现象**：R16 D9 全码映射收尾后，errorCodeSchema 全集所有已知域码均映射具体中文提示，仅 [advisory] AUDIT_LOG_NOT_FOUND 仍 FALLBACK（errorMapping.ts L65 注释"[advisory] AUDIT_LOG_NOT_FOUND 沿用"）。根因前端 AuditLogPage 不触发审计查询失败码（audit-logs 域 GET /v1/audit-logs 不返回 AUDIT_LOG_NOT_FOUND——审计日志查询为分页列表，不存在"单个审计日志不存在"场景），故 AUDIT_LOG_NOT_FOUND 在前端不触发，[advisory] 沿用 FALLBACK。

**根因**：errorCodeSchema 含 AUDIT_LOG_NOT_FOUND 码（后端 audit-logs 域服务端可能抛，如 GET /v1/audit-logs/:id 单个查询场景，但前端 AuditLogPage 仅消费 GET /v1/audit-logs 分页列表，不消费单个查询），前端不触发故 [advisory] 沿用 FALLBACK。这是"全码映射收尾"的合理例外——errorCodeSchema 全集所有已知域码均映射具体中文提示的"全集"定义须明确为"前端可能触发的域码全集"而非"errorCodeSchema 枚举全集"。

**反推优化**：impl-writer 提示词增加"errorMapping 全码映射收尾的'全集'定义须明确为'前端可能触发的域码全集'而非'errorCodeSchema 枚举全集'——前端不触发的域码（如 AUDIT_LOG_NOT_FOUND 前端仅消费分页列表不消费单个查询）可 [advisory] 沿用 FALLBACK，注释须显式标注'[advisory] XXX 沿用（前端不触发）'"。Spec 模板 §10 组合副作用预判须含"全码映射收尾的'全集'定义明确"项（R16 §10 组合 #6 已预判 impl 须同步注释，但未明确"全集"定义，未来可明确为"前端可能触发的域码全集"）。

### S-19 · SetParentModal UUID_RE 重复定义（R15 S-13 类似，未跨组件复用）

**现象**：SetParentModal.tsx 内部定义 UUID_RE 常量（用于 parentRoleId select 选中值客户端 advisory 校验），与 TransferForm.tsx 内部 UUID_RE 重复定义。Reviewer 建议提取至 lib/uuid.ts 共享，但 [advisory] 沿用重复定义（根因 UUID_RE 为简单正则常量，提取至 lib/uuid.ts 须新增文件 + import 路径，对 2 处使用场景的复用价值有限）。

**根因**：UUID_RE 为简单正则常量（`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`），R15 NotificationForm + ReportFilter 已各自定义 UUID_RE（R15 S-13 类似，未跨组件复用），R16 TransferForm + SetParentModal 沿用重复定义。这是"简单常量跨组件复用"的边界——UUID_RE 提取至 lib/uuid.ts 须新增文件 + import 路径，对 2 处使用场景的复用价值有限，[advisory] 沿用重复定义。

**反推优化**：impl-writer 提示词增加"简单常量（如 UUID_RE 正则）跨组件复用边界——若 ≤3 处使用场景且常量简单（单行正则），可 [advisory] 沿用重复定义；若 ≥4 处使用场景或常量复杂（多行逻辑），须提取至 lib/ 共享。R15/R16 UUID_RE 各 2 处使用场景沿用重复定义属合理 [advisory]"。Spec 模板 §10 组合副作用预判须含"简单常量跨组件复用边界"项（R16 §10 组合 #7 已预判 impl 须区分混合表单 safeParse + 类型派生操作，但未明确简单常量复用边界，未来可明确）。

### S-20 · AC-F4-3 user-event v14.6.1 disabled option 过滤 workaround（测试工具限制）

**现象**：AC-F4-3 内置 admin 父角色前端禁用 + 服务端兜底"内置角色不可设为父角色"测试用 user-event v14.6.1 selectOptions 强制选 disabled option 时，user-event v14.6.1 会自动过滤 disabled option（不选中），导致无法测试"前端 disabled 防误选"场景。impl-writer 采用 workaround：parentRoleId 空 + allRoles 含 is_builtin 时提示"内置角色不可设为父角色"（绕过 user-event v14.6.1 disabled 过滤，直接测服务端兜底文案）+ 单独测 admin option disabled 属性（first）。

**根因**：user-event v14.6.1 selectOptions 会自动过滤 disabled option（不选中），这是测试工具限制（user-event 设计为模拟真实用户行为，真实用户无法选 disabled option）。测试"前端 disabled 防误选"场景须绕过 user-event 直接测 option.disabled 属性（first）+ 测服务端兜底文案（second），而非通过 user-event selectOptions 模拟误选。

**反推优化**：test-writer 提示词增加"user-event v14.6.1 disabled option 过滤机制——selectOptions 会自动过滤 disabled option（不选中），测试'前端 disabled 防误选'场景须绕过 user-event 直接测 option.disabled 属性 + 测服务端兜底文案，而非通过 user-event selectOptions 模拟误选。须在测试注释标注'user-event v14.6.1 disabled option 过滤 workaround'"。Spec 模板 §10 组合副作用预判须含"测试工具限制 workaround"项（R16 §10 组合 #2 已预判 setParent versioned + superRefine 自继承 + disabled is_builtin，但未明确 user-event disabled option 过滤 workaround，未来可明确）。

## 3 · 量化对比（十六轮演进表）

| 指标 | R1 | R5 | R7 | R9 | R10 | R11 | R12 | R13 | R14 | R15 | R16 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 用例数 | 35 | 404 | 537 | 653 | 697 | 778 | 883（api 833 + web 50） | 883（无新增） | 991（api 833 + web 158） | 1089（api 833 + web 256） | **1196**（api 833 + web 363） |
| 累计用例 | 35 | 404 | 537 | 653 | 697 | 778 | 883 | 883 | 991 | 1089 | **1196** |
| blocker | 1 | 2(修复0) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| suggestion | 6 | 7 | 2 | 2(impl闭合) | 0 | 3(impl闭合) | 7 | N/A（无 Review） | 8 | 8 | **7** |
| Reviewer verdict | pass | blocker→pass | pass | pass | pass | pass | pass | N/A（复盘替代 Review） | pass | pass | **pass** |
| AC 对齐 | N/A | N/A | 16/16 | 18/18 | 17/17 | 23/23 | 47/48（AC-ARCH-4 partial） | N/A（元改进轮） | 68/68 | 54/54（功能 49 + ARCH 3 + S-1 2） | **46/46**（功能 43 + ARCH-003 1 + S-1 2） |
| 受影响清单 | 无 | ①类遗漏 | ①②类 | ①②③类 | ①②零+③类 | ①②③（①类二次遗漏） | ①②零影响+③类6文件 | 2 文件（元资产） | ①类1文件边缘+②类0+③类11文件 | ①类1文件调整+②类0+③类7文件 | **①类3文件调整+②类0+③类5文件**（vs Spec预估5+3） |
| 影响层 | 全栈 | 全栈 | 全栈 | 全栈 | 单层 | 运行时入口层+新域 | 前端新增层+规则脚本 | 元资产层 | 前端扩展层 | 前端全域收尾层 | **后端能力前端化闭合层**（api/pages/components transfer+inheritance 两域新增 + errorMapping 全码映射收尾 + Sidebar 6→7） |
| 新架构模式 | 单步CRUD | 跨域埋点 | 多步事务 | HTTP写条件 | HTTP读条件 | 安全域+token验签 | 前端+ARCH-003机器化+wire适配 | 工作流元改进（提示词+扫描器扩展） | 前端多域扩展+versioned DELETE重试复用+递归契约渲染 | 前端全域覆盖+client.ts query类型扩展范例+通知状态机+4 versioned端点+z.record动态列 | **后端能力前端化闭合+事务性单端点（transfer 非 versioned）+继承链裸 Role[]+权限码集合裸 PermissionCode[]+versioned 写+superRefine 自继承/环检测组合+errorMapping 全码映射收尾** |
| 轮次类型 | 业务 | 业务 | 业务 | 业务 | 业务 | 业务 | 业务 | 元改进（首个） | 业务（前端多域扩展） | 业务（前端全域覆盖收尾） | **业务**（后端能力前端化闭合） |
| ARCH-003 状态 | [预留] | [预留] | [预留] | [预留] | [预留] | [预留] | 闭合（机器化 enforcement） | 闭合（保持） | 闭合（持续合规） | 闭合（持续合规） | **闭合（持续合规，新增8文件 + 扩展6文件自动覆盖 + errorMapping 全码映射收尾）** |
| 前端 | 无 | 无 | 无 | 无 | 无 | 无 | 首引入（50用例） | 已存在（扫描器覆盖扩展） | 多域扩展（158 web 用例） | 全域覆盖（256 web 用例） | **后端能力前端化闭合**（363 web 用例 = R12 50 + R14 108 + R15 87 + R16 107 + 其他 11） |
| 前端域数 | 0 | 0 | 0 | 0 | 0 | 0 | 2（auth + user） | 2（无业务代码） | 5（auth + user + role + dept + audit） | 7（auth + user + role + dept + audit + notification + report，全域覆盖） | **7+2 后端能力闭合**（7 域 + transfer 事务性单端点 + role-inheritance 4 端点，前端覆盖全部后端写/读端点） |
| SEC 验证 | mock | mock | mock | mock | mock | 首次真实 | 前端延伸 | 不涉及 | SEC-003b 前端延伸（redactedAuditLogSchema 脱敏态消费） | 不延伸（通知/报表域无 PII 字段） | **不延伸**（transfer/inheritance 域无 PII 字段，SEC-003b 不延伸） |
| CODE 扫描器前端覆盖 | N/A | N/A | N/A | N/A | N/A | N/A | ❌ 盲区（手动 grep） | ✅ 机器化（allTs 扩展含 apps/web） | ✅ 机器化持续覆盖 | ✅ 机器化持续覆盖 | **✅ 机器化持续覆盖**（新增8文件 + 扩展6文件 exit 0） |
| 提示词骨架条数 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色+8条（S-1/S-2/S-3 固化） | 5角色+8条（R13 固化持续生效）+ S-8~S-12 5条待固化 | 5角色+13条（R13 8条 + R14 5条持续生效）+ S-13~S-16 4条待固化 | **5角色+17条**（R13 8条 + R14 5条 + R15 4条持续生效）+ S-17~S-20 4条待固化 |
| 组合副作用预判条数 | 0 | 0 | 0 | 0 | 0 | 0（被动暴露 bug） | 4（首次大规模验证） | N/A（元改进轮） | 7（多域下再次验证全部正确） | 8（状态机+聚合域下再次验证全部正确） | **8**（事务性+继承链+聚合三形态下再次验证全部正确） |
| BA 核验 contracts SSOT | N/A | N/A | N/A | N/A | 首次（S-2 教训） | 第二次（PRD 5→Spec 2） | 第三次（GET 不存在→409 重试） | N/A | 第四次（B1-B5 5 处偏离） | 第五次（N1-N6 6 处偏离） | **第六次**（T1-T4 4 处偏离） |
| errorMapping 码映射覆盖率 | N/A | N/A | N/A | N/A | N/A | N/A | user/auth 域 | user/auth 域（保持） | + role/dept 域（5 域码映射） | + notification/report 域（7 域码映射，TRANSFER/ROLE_INHERITANCE 仍 FALLBACK） | **全码映射收尾**（errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底，[advisory] AUDIT_LOG_NOT_FOUND 前端不触发沿用） |

> R16 用例数 1196 = api 833（后端冻结，无回归）+ web 363（R12 50 + R14 108 + R15 87 + R16 107 + 其他 11）。web 107 = 5 ③类新增文件（api-transfer 契约测 + set-parent-modal 组件测 + transfer-page 组件测 + inheritance-chain-panel 组件测 + navigation-extend-3/error-mapping-extend-3 扩展测）+ 3 ①类显式影响文件调整（error-mapping-extend-2 2 断言 + navigation-extend 6→7 + navigation 6→7）。后端 833 用例基线在本轮后端能力前端化闭合前已达稳态，R16 不改后端。

## 4 · 十六轮演进脉络

- **第一轮**：建立主干，暴露规则可校验性 P0 缺口
- **第二轮**：规则机器化 100%，暴露声明漂移
- **第三轮**：META-003/004 双向绑定消除漂移
- **第四轮**：三个反推优化点闭环生效
- **第五轮**：三个架构方向落地，首次暴露"测试通过 ≠ 验收对齐"
- **第六轮**："验收对齐"门禁首次闭合——端到端 + Reviewer PRD 双轨
- **第七轮**：多步事务 + 补偿回滚，验证"复杂业务适应性"
- **第八轮**：递归继承 + 环检测，验证"递归数据结构适应性"
- **第九轮**：HTTP 条件请求写条件（If-Match），验证"协议层写扩展适应性"，首次③类测试
- **第十轮**：HTTP 条件请求读条件（ETag + 304），验证"协议层读扩展适应性"，首次单层变更闭合，首次零 suggestion
- **第十一轮**：安全域首落地（登录签发 + token 校验中间件 + 登出吊销），验证"安全域适应性 + 运行时入口层替换"，Ctx 接口不变仅换来源（ARCH-001 闭合），SEC-001/002/003 首次端到端验证
- **第十二轮**：前端首轮（登录页 + 用户列表页 + 前端基础设施），验证 ARCH-003 跨层只经契约从 [预留] 到机器化 enforcement 闭合（R1-R11 唯一未机器化规则闭合），wire 适配 advisory 范例（D10），409 current_version 重试纠正 PRD（D19，R10 S-2 教训再次生效），多约束组合副作用预判首次大规模验证（4 条全部正确实现），零新依赖精神延伸到前端
- **第十三轮**：首个元改进轮（S-1~S-4 固化 R12 反推优化 + S-5 记录未来方向），验证工作流对"自身改进"的适应性——不走标准 PRD→Spec 五角色流程，直接"规划→实施→验证→复盘"精简流程；规则层 S-4 walkWeb 提升顶层 + allTs 扩展含 apps/web，CODE 扫描器覆盖前端（机器化修复 R12 S-4 根因）；提示词层 S-1/S-2/S-3 四角色各 +2 条落地 spec-first-workflow.md（共 8 条）；ARCH-002 误报风险消除（既有扫描器目录隔离设计在扩展时安全）；S-6 AI-005 前端测试盲区 + S-7 元改进轮 Review 缺失记录为未来方向
- **第十四轮**：前端多域扩展（角色/部门/审计三域一次引入，5 域前端），验证前端多域扩展适应性 + R13 固化提示词首次大规模验证 + ①类显式影响处理范例 + 多约束组合副作用 7 条预判全部正确，BA 核验 contracts SSOT 5 处偏离（B1-B5，R10 S-2 教训第三次生效），审计 PII 脱敏态消费（SEC-003b 前端延伸 + ARCH-003 跨层只经契约组合范例），versioned DELETE 重试复用 R12 D9（D7）+ 部门删除非 versioned 有意分歧（D8），递归 Zod schema 前端渲染（DeptNode 递归无深度限制 D12），AC-ARCH-4 完全对齐（优于 R12 partial，R13 S-1 固化生效）
- **第十五轮**：前端全域覆盖收尾（通知管理页 + 报表页，新增 notification + report 两域，完成 auth/user/role/dept/audit/notification/report 七域全覆盖），验证前端全域覆盖适应性 + client.ts 既有基础设施扩展范例（D8 query 类型扩展支持 string[] 后向兼容）+ 通知状态机前端展示 + 4 versioned 端点组合（D7+D10）+ 报表动态维度键 z.record 渲染（D11，N6）+ R13/R14 固化提示词持续验证（特别是 R14 S-11 在 R15 D9 闭合——errorMapping 注释三处更新）+ 多约束组合副作用 8 条预判全部正确，BA 核验 contracts SSOT 6 处偏离（N1-N6，R10 S-2 教训第四次生效）
- **第十六轮**：**后端能力前端化闭合**（调岗 transfer + 角色继承管理，新增 transfer 事务性单端点 + role-inheritance 4 端点，闭合"前端覆盖全部后端写/读端点"最后一公里），验证**后端能力前端化闭合适应性 + 事务性单端点（transfer 非 versioned + superRefine path=['newRoleId'] + 聚合码 TRANSFER_FAILED message 透传，T4）+ versioned 写 + superRefine 自继承/环检测组合（setParent/unsetParent If-Match + 409 重试复用 R12 D9 + superRefine roleId===parentRoleId → 字段级错误 + ROLE_INHERITANCE_CYCLE，D7/T3/D4）+ 继承链裸 Role[] 祖先数组 + 权限码集合裸 PermissionCode[] SSOT 派生 11 项全集（D11/AI-005，T3 非 cacheable GET）+ errorMapping 全码映射收尾（R14 S-11 同步注释三处完全闭合，D9）+ R13/R14/R15 固化的 17 条提示词持续验证（特别是 R14 S-11 在 R16 完全闭合）+ 多约束组合副作用 8 条预判全部正确 + impl-writer 自报准确性违规发现（自报"未改测试断言"+"未触达"但 git diff 确认 3 文件改动含断言改动，Reviewer 闸门价值范例）**，BA 核验 contracts SSOT 4 处偏离（T1-T4，R10 S-2 教训第五次生效），①类显式影响处理范例再验证（error-mapping-extend-2 2 断言 FALLBACK→具体中文 + navigation-extend/navigation 6→7，3 文件合理处理但 impl-writer 自报描述错误须显式标注），AC-ARCH-3/ARCH-4 完全对齐（R13 S-1 固化持续生效）

## 5 · 反推优化三个层面执行情况

> R13 retro §5 反推的三个层面优化（规则层 + Spec 模板层 + 提示词层）在 R14 多域业务下首次大规模验证，R15 持续验证，R16 后端能力前端化闭合下持续验证；R14 retro §5 反推的 S-8~S-12 在 R15 全部闭合（S-8~S-11 提示词层 + S-12 Spec 模板层），在 R16 持续验证生效；R15 retro §5 反推的 S-13~S-16 在 R16 全部验证生效；本轮新发现 S-17~S-20 反推至三层面待下一轮固化。

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R16 验证状态 | 证据 |
|---|---|---|
| **R13 S-4 规则层固化**：CODE 扫描器覆盖前端（allTs 含 apps/web/src + apps/web/test） | ✅ **R16 持续验证生效** | R16 新增 8 前端文件 + 扩展 6 文件位于 apps/web/src/，自动受 R13 S-4 CODE 扫描器（CODE-001/002/003/004/AI-005）覆盖，lint:rules exit 0；Reviewer §2 CODE 系列逐条核对合规（0 any / 0 空 catch / 0 eval / 0 Zod schema 命名违规 / SSOT 派生） |
| ARCH-003 校验方式闭合（R12 已落地） | ✅ **R16 持续合规** | R16 新增 8 文件 + 扩展 6 文件自动受 ARCH-003 分支覆盖（lint:rules exit 0）+ Reviewer 逐文件核对 0 违规 + grep 0 实际 import + META-003/META-004 双向绑定持续闭合。R12 机器化 enforcement 在后端能力前端化闭合下持续有效。**特别地，D9 errorMapping 扩展（全码映射收尾）继续受 ARCH-003 约束**——errorMapping.ts 改动仅扩展 SPECIFIC_MESSAGES 映射条目 + 同步注释，不引入 apps/api/src 依赖 |
| META 规则双向绑定闭合（R12 已落地） | ✅ **保持** | META-003/META-004 对 ARCH-003 闭合不变，lint:rules 输出"双向绑定已校验"；R16 无规则文件改动，双向绑定持续闭合 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R16 验证状态 | 证据 |
|---|---|---|
| **R13 S-1 根因修复**：§3.2/§6 区分"自由文本表单"（须 safeParse）与"类型派生操作"（TS 类型保证，schema 校验冗余） | ✅ **R16 事务性/继承链域下验证生效** | Tech-Spec §3.2-A 自由文本表单（TransferForm userId 自由文本 UUID + 3 select 混合表单 safeParse transferInputSchema 整体校验覆盖 superRefine oldRoleId===newRoleId）+ §3.2-B 类型派生操作（RoleListPage setParent/unsetParent 按钮 + EffectivePermissionsPanel 行操作，roleId/version 从列表派生，TS 类型保证，不调 safeParse，D5/R13 S-1/AC-S1-2）+ §3.2 混合表单提示（TransferForm 整体 safeParse 覆盖 userId uuid + 3 select uuid + superRefine，userId 字段值经 UUID_RE advisory 校验 + safeParse uuid 格式校验双重保证）；AC-ARCH-3/ARCH-4 完全对齐 |
| **R13 S-2 根因修复**：§10 advisory 同步边界明确（行为/数据/schema 偏离须同步；纯 UI 文案偏离不须同步但须 Review 报告记录） | ✅ **R16 事务性/继承链域下验证生效** | Tech-Spec §10 advisory 文案同步边界明确：5 项 impl-writer 自报 advisory 偏离（D12 自继承禁用降级 / AC-F4-3 user-event workaround / RoleListPage 3 按钮 aria-label 移除 / EffectivePermissionsPanel h2 文案 / UserRow 按钮文案）+ Reviewer 发现 2 项（SetParentModal UUID_RE 重复定义 / errorMapping AUDIT_LOG_NOT_FOUND 仍 FALLBACK）均记 suggestion。Reviewer §4 advisory 偏离核对 7 项均判定合理 |
| **R13 S-3 根因修复**：§9 AC↔测试用例覆盖矩阵表（或经 test-writer 提示词实现 AC 覆盖矩阵自检） | ✅ **R16 事务性/继承链域下验证生效** | PRD §AC↔测试用例覆盖矩阵 + Spec §9.4 矩阵表已标注（46 AC × 测试文件 T1-T9 预估）；test-writer AC 覆盖矩阵自检闭合（46 AC 全覆盖，无未覆盖 AC）；test-writer 实际新增 5 ③类文件 + 3 ①类显式影响文件调整对齐 Spec §9.3 预估 |
| **R14 S-12 根因修复**：§9 测试文件数须明确为预估（test-writer 可调整须 AI-006 反向核实） | ✅ **R16 验证生效** | Spec §9.3 计划 5 ③类测试文件 + 3 ①类显式影响文件预估，test-writer 实际交付 5 ③类 + 3 ①类显式影响调整（对齐预估，无偏离）。R14 S-12 固化后 Spec §9.3 已明确"测试文件数是预估，test-writer 可据覆盖质量调整但须 AI-006 反向核实注明理由 + Reviewer 判定合理性"，R16 test-writer 据此落地，无偏离 |
| **R15 S-16 根因修复**：§10 组合副作用预判须含"动态 schema 渲染兜底"项 | ✅ **R16 验证生效** | R16 §10 组合 #4/#5 已预判继承链/权限码集合渲染兜底（chain.length===0 → "无父角色" / permissions.length===0 → "该用户暂无有效权限"），R15 S-16 固化项在 R16 持续生效（空集合兜底，权限码集合 + 祖先链两场景） |
| **R16 §9 ①类显式影响预估准确**（R16 新发现） | ✅ **R16 验证生效** | Spec §9.1 预估 ①类显式影响 3 文件调整（error-mapping-extend-2.test.ts 2 断言 + navigation-extend.test.tsx 6→7 + navigation.test.tsx 6→7）+ 0 隐式 + ②类 0。实际 ①类显式影响 3 文件调整（对齐预估，根因 D9 全码映射收尾 + D15 扩展 7 入口）。Spec §9.1 预估准确。**但 impl-writer 自报描述错误**（自报"未改测试断言"+"未触达"但实际改 3 文件含断言改动），Reviewer §0 通过 git diff 实跑核对发现违规，须显式标注（S-17） |
| **S-18 新发现**：§10 组合副作用预判须含"全码映射收尾的'全集'定义明确"项 | ⚠️ **待固化**（本轮新发现） | R16 §10 组合 #6 已预判 impl 须同步注释（全码映射收尾 + R14 S-11 闭合），但未明确"全集"定义（前端可能触发的域码全集 vs errorCodeSchema 枚举全集）。反推：Spec 模板 §10 组合副作用预判须明确"全码映射收尾的'全集'定义须明确为'前端可能触发的域码全集'而非'errorCodeSchema 枚举全集'——前端不触发的域码（如 AUDIT_LOG_NOT_FOUND）可 [advisory] 沿用 FALLBACK" |
| **S-19 新发现**：§10 组合副作用预判须含"简单常量跨组件复用边界"项 | ⚠️ **待固化**（本轮新发现） | R16 §10 组合 #7 已预判 impl 须区分混合表单 safeParse + 类型派生操作，但未明确简单常量（如 UUID_RE）跨组件复用边界。反推：Spec 模板 §10 组合副作用预判须明确"简单常量（如 UUID_RE 正则）跨组件复用边界——≤3 处使用场景且常量简单可 [advisory] 沿用重复定义；≥4 处使用场景或常量复杂须提取至 lib/ 共享" |
| **S-20 新发现**：§10 组合副作用预判须含"测试工具限制 workaround"项 | ⚠️ **待固化**（本轮新发现） | R16 §10 组合 #2 已预判 setParent versioned + superRefine 自继承 + disabled is_builtin，但未明确 user-event v14.6.1 disabled option 过滤 workaround。反推：Spec 模板 §10 组合副作用预判须明确"测试工具限制 workaround——user-event v14.6.1 selectOptions 会自动过滤 disabled option（不选中），测试'前端 disabled 防误选'场景须绕过 user-event 直接测 option.disabled 属性 + 测服务端兜底文案" |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.3~2.6）

#### R13 固化的 8 条 + R14 固化的 5 条 + R15 固化的 4 条提示词（共 17 条）在 R16 持续验证生效

| 固化项 | 角色 | R16 验证场景 | 验证结果 |
|---|---|---|---|
| R13 S-1（区分两类表单） | Tech Lead | §3.2 区分自由文本表单（TransferForm userId 自由文本 + 3 select 混合表单 safeParse transferInputSchema + superRefine）与类型派生操作（RoleListPage setParent/unsetParent + EffectivePermissionsPanel 行操作） | ✅ 生效（AC-ARCH-3/ARCH-4 完全对齐） |
| R13 S-1（类型派生操作标注） | impl-writer | RoleListPage setParent/unsetParent + EffectivePermissionsPanel 行操作类型派生操作不调 safeParse 显式标注 [约束] 偏离 + 理由（D5） | ✅ 生效（AC-ARCH-3/ARCH-4 完全对齐） |
| R13 S-1（AC-ARCH-4 partial 判定依据） | Reviewer | AC-ARCH-4 完全对齐（impl 显式标注类型派生操作不调 safeParse + 理由，无需 partial 判定） | ✅ 生效（partial 判定依据已用，但本轮无需 partial） |
| R13 S-2（advisory 同步边界） | Tech Lead | §10 advisory 文案同步边界明确（5 项自报 + 2 项 Reviewer 发现均记 suggestion） | ✅ 生效（7 项偏离均合理判定） |
| R13 S-2（advisory 同步边界） | impl-writer | 5 项自报 advisory 偏离（D12 自继承禁用降级 / AC-F4-3 user-event workaround / RoleListPage 3 按钮 aria-label 移除 / EffectivePermissionsPanel h2 文案 / UserRow 按钮文案） | ✅ 生效（边界判定正确） |
| R13 S-3（AC 覆盖矩阵自检） | test-writer | 46 AC 全覆盖自检 + 组合场景（AC-F2-5 superRefine path=['newRoleId'] / AC-F4-5 重试成功 / AC-F4-6 重试仍冲突单独测） | ✅ 生效（46 AC 全覆盖） |
| R13 S-3（组合场景测试） | test-writer | AC-F2-5 superRefine path=['newRoleId'] + AC-F4-5 重试成功 + AC-F4-6 重试仍冲突 单独测 | ✅ 生效（组合场景已单测） |
| R13 S-4（CODE 扫描器前端覆盖核对） | Reviewer | R13 S-4 固化后 CODE 扫描器覆盖前端，Reviewer 确认 allTs 含 apps/web/src + apps/web/test，无需手动 grep | ✅ 生效（机器化覆盖，Reviewer 信赖扫描器 exit 0） |
| R14 S-8（api 函数命名对齐 Spec） | impl-writer | api/transfer.ts + api/role-inheritance.ts 函数命名对齐 Spec §4.2 声明（transferUser/setRoleParent/unsetRoleParent/getInheritanceChain/getEffectivePermissions） | ✅ 生效（R14 S-8 教训在 R16 持续闭合） |
| R14 S-9（文本筛选 debounce/应用筛选按钮） | impl-writer | TransferForm 含"调岗"提交按钮触发请求（不每键入触发——userId 文本输入经"调岗"按钮原子提交，无须 debounce） | ✅ 生效（R14 S-9 教训在 R16 持续闭合） |
| R14 S-10（aria-label 域特定） | impl-writer | TransferForm aria-label="用户 ID"/"目标部门"/"原角色"/"新角色"；SetParentModal aria-label="父角色"；EffectivePermissionsPanel aria-label="用户 ID" | ✅ 生效（R14 S-10 教训在 R16 持续闭合，[advisory] RoleListPage 3 按钮 aria-label 移除判定合理——按钮文本已提供 accessible name） |
| R14 S-11（扩展既有模块同步注释） | impl-writer | errorMapping.ts 三处注释同步更新：L17-20/L65/L82 注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾（R14 S-11 闭合）"（移除已扩展的 TRANSFER/ROLE_INHERITANCE） | ✅ 生效（R14 S-11 教训在 R16 **完全闭合**，三处注释同步反映扩展后全码映射收尾态，0 域 FALLBACK） |
| R14 S-12（Spec §9 测试文件数预估可调整） | Tech Lead | Spec §9.3 计划 5 ③类 + 3 ①类显式影响文件预估，test-writer 实际交付 5 ③类 + 3 ①类显式影响调整（对齐预估，无偏离） | ✅ 生效（R14 S-12 固化后 Spec §9.3 已明确预估可调整，R16 test-writer 据此落地） |
| R15 S-13（测试 fixture 对齐 contracts 严格校验） | test-writer | R16 测试 fixture UUID 用有效 hex（无需校准，R15 S-13 固化后 test-writer 已注意），无 fixture 失败案例 | ✅ 生效（R15 S-13 固化项在 R16 持续生效） |
| R15 S-14（组件 label 跨组件唯一） | impl-writer | TransferForm/SetParentModal/EffectivePermissionsPanel label/aria-label 与 RoleListPage 既有 label 无冲突（[advisory] EffectivePermissionsPanel h2 文案"有效权限"→"权限列表" + UserRow 按钮文案"有效权限"→"权限"消歧） | ✅ 生效（R15 S-14 固化项在 R16 持续生效） |
| R15 S-15（长文本输入 per-test 超时） | test-writer/impl-writer | R16 无长文本输入测试（transfer 表单字段均为短 UUID + select），无超时案例 | ✅ 生效（R15 S-15 固化项在 R16 持续生效，无触发场景） |
| R15 S-16（动态 schema 渲染兜底） | impl-writer | R16 EffectivePermissionsPanel 权限码集合渲染兜底（permissions.length===0 → "该用户暂无有效权限"）+ InheritanceChainPanel 祖先链渲染兜底（chain.length===0 → "无父角色"） | ✅ 生效（R15 S-16 固化项在 R16 持续生效，空集合兜底，权限码集合 + 祖先链两场景） |

#### R16 新增 S-17~S-20 反推（待下一轮固化）

| R16 新发现项 | 角色 | 反推提示词 | 固化状态 |
|---|---|---|---|
| S-17（impl-writer 自报准确性） | impl-writer | "自报改动范围须准确——impl-writer 须通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对自报描述，若自报'未改测试断言'+'未触达'但实际有改动则属自报准确性违规（虽不构成 block 但须显式标注）；自报改动范围须按文件逐条列出实际改动（含断言改动/setup 调整/matcher 调整），不可笼统描述'未改测试断言'+'未触达'" | ⚠️ 待固化 |
| S-17（Reviewer 闸门对自报准确性核验） | Reviewer | "须通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对 impl-writer 自报改动范围的准确性，而非信赖自报描述——若 git diff 显示的改动文件/断言改动与 impl-writer 自报描述不符，须显式标注为 AI-002 边界**自报准确性**违规（判定是否构成 block 须看改动本身是否属合理处理）" | ⚠️ 待固化 |
| S-18（全码映射收尾的"全集"定义） | impl-writer | "errorMapping 全码映射收尾的'全集'定义须明确为'前端可能触发的域码全集'而非'errorCodeSchema 枚举全集'——前端不触发的域码（如 AUDIT_LOG_NOT_FOUND 前端仅消费分页列表不消费单个查询）可 [advisory] 沿用 FALLBACK，注释须显式标注'[advisory] XXX 沿用（前端不触发）'" | ⚠️ 待固化 |
| S-19（简单常量跨组件复用边界） | impl-writer | "简单常量（如 UUID_RE 正则）跨组件复用边界——若 ≤3 处使用场景且常量简单（单行正则），可 [advisory] 沿用重复定义；若 ≥4 处使用场景或常量复杂（多行逻辑），须提取至 lib/ 共享。R15/R16 UUID_RE 各 2 处使用场景沿用重复定义属合理 [advisory]" | ⚠️ 待固化 |
| S-20（user-event v14.6.1 disabled option 过滤 workaround） | test-writer | "user-event v14.6.1 disabled option 过滤机制——selectOptions 会自动过滤 disabled option（不选中），测试'前端 disabled 防误选'场景须绕过 user-event 直接测 option.disabled 属性 + 测服务端兜底文案，而非通过 user-event selectOptions 模拟误选。须在测试注释标注'user-event v14.6.1 disabled option 过滤 workaround'" | ⚠️ 待固化 |

**合计**：R13 固化的 8 条 + R14 固化的 5 条 + R15 固化的 4 条提示词（共 17 条）在 R16 持续验证全部生效；R16 新增 S-17~S-20 4 项反推（S-17 含 2 条提示词 impl-writer + Reviewer + S-18 impl-writer 1 条 + S-19 impl-writer 1 条 + S-20 test-writer 1 条，共 5 条提示词）待下一轮固化（S-18/S-19/S-20 反推至 Spec 模板层，见 §5.2）。

## 6 · 结论 + 剩余改进项

第十六轮是"后端能力前端化闭合 + errorMapping 全码映射收尾 + 事务性+继承链+聚合三形态 + impl-writer 自报准确性违规发现"验证的标志——R12 前端首轮覆盖 auth+user 两域，R14 多域扩展至 5 域，R15 全域覆盖至 7 域，R16 新增 transfer 域（事务性单端点）+ role-inheritance 域（versioned 写 + 继承链 + 权限码集合），闭合"前端覆盖全部后端写/读端点"最后一公里。同时验证 errorMapping 全码映射收尾（R14 S-11 同步注释三处完全闭合）、事务性/继承链/聚合三种新数据形态、R13/R14/R15 固化的 17 条提示词持续验证生效（特别是 R14 S-11 在 R16 完全闭合）、多约束组合副作用 8 条预判全部正确实现、impl-writer 自报准确性违规发现（Reviewer 闸门价值范例）。

关键证据：
1. **后端能力前端化闭合**（R16 最大验证点）：R12 前端基础设施（API client / AuthContext / RouteGuard / ErrorBanner / errorMapping）在 R16 事务性单端点 + 继承链只读 + 权限码集合只读三种新数据形态下零新增基础设施——只新增 api 模块（transfer/role-inheritance）+ pages（TransferPage）+ components（TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel）+ 6 既有文件扩展。前端覆盖全部后端写/读端点（7 域 + transfer 事务性单端点 + role-inheritance 4 端点全部消费）。ARCH-003 在新增 8 文件 + 扩展 6 文件下持续合规（lint:rules exit 0 + 逐文件核对 0 违规 + grep 0 实际 import）。证明前端分层架构对后端能力前端化闭合具备适应性，spec-first 工作流对"前端覆盖全部后端写/读端点"的适应性验证闭合。
2. **BA 核验 contracts SSOT 4 处偏离（T1-T4）—— R10 S-2 教训第五次生效**：BA 一律以 contracts SSOT 为准，Reviewer §0 BA 核验 T1-T4 遵循 contracts SSOT 结论 pass（4/4 全部遵循）。特别是 T1/T2 错误码偏离影响 AC 断言精确性（不能用臆造码断言）、T4 非 versioned 决定前端不传 If-Match（区别于 R14/R15 versioned 写端点）须 AC 精确断言点均以 contracts SSOT 为准。证明 BA 阶段 contracts SSOT 核验已成为稳定实践。
3. **errorMapping 全码映射收尾三段闭环（R12 → R14 → R15 → R16）—— R14 S-11 教训完全闭合**：errorMapping.ts SPECIFIC_MESSAGES 经 4 轮扩展实现"全码映射收尾"——errorCodeSchema 全集所有已知域码均映射具体中文提示，FALLBACK 仅作未来新增码兜底（[advisory] AUDIT_LOG_NOT_FOUND 前端不触发审计查询失败码沿用）。R16 D9 扩展 transfer/inheritance 码后，errorMapping.ts 三处注释（L17-20/L65/L82）同步更新为"全码映射收尾（R14 S-11 闭合）"，R14 S-11 教训在 R15 部分闭合（移除 REPORT/NOTIFICATION）后在 R16 完全闭合（移除 TRANSFER/ROLE_INHERITANCE，全码映射收尾态）。这是"元改进→业务验证→持续验证→完全闭合"四段闭环的范例——R14 元改进轮发现 S-11 → R15 部分闭合 → R16 完全闭合，证明工作流逐轮收敛机制在多轮业务下持续生效直至完全闭合。
4. **事务性 + 继承链 + 聚合三形态**（三种新数据形态范例）：事务性单端点（transfer 非 versioned POST + superRefine path=['newRoleId'] + 聚合码 TRANSFER_FAILED message 透传）首次验证前端对"事务性多步聚合错误码"的展示策略；继承链只读（裸 Role[] 祖先数组）首次验证前端对"无 envelope 祖先链"的渲染适应性；权限码集合只读（裸 PermissionCode[] 集合）首次验证前端对"无 envelope 权限码集合"的渲染适应性（SSOT 派生 11 项全集 Record<PermissionCode,string> + [...permissionCodeSchema.options]，AI-005）；versioned 写 + superRefine 自继承组合（setParent If-Match + 409 重试 + superRefine roleId === parentRoleId → 字段级错误）首次验证 R12 D9 重试策略对"versioned 写 + superRefine 字段级错误 + 环检测聚合码"组合的复用性。密度高于 R12 1 端点 / R14 1 端点 / R15 4 端点——R16 一次性引入 5 个端点（1 事务性 + 2 versioned 写 + 2 非 cacheable GET）。
5. **R13/R14/R15 固化提示词在 R16 持续验证**（"元改进→业务验证→持续验证→完全闭合"四段闭环范例）：R13 固化的 4 项 + R14 固化的 5 项 + R15 固化的 4 项（共 13 项核心 + S-12 Spec 模板层 + R15 S-13~S-16 4 项提示词）提示词在 R16 全部验证生效。特别是 R14 S-11（errorMapping 同步注释）在 R16 完全闭合——errorMapping.ts 三处注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾（R14 S-11 闭合）"。**证明 R14 教训反推在多轮业务下持续生效直至完全闭合**——工作流逐轮收敛机制在多轮业务下持续生效直至完全闭合，非一次性效应。
6. **多约束组合副作用预判 8 条全部正确实现**：Tech-Spec §10 末 8 条组合副作用（transfer 非 versioned + superRefine + 服务端兜底 / setParent versioned + 409 重试 + superRefine 自继承 / unsetParent versioned DELETE + 根角色不显示按钮 / 继承链非 cacheable GET + 裸 Role[] / 有效权限非 cacheable GET + 裸 PermissionCode[] + SSOT 派生 / errorMapping 全码映射收尾 + R14 S-11 同步注释 / 混合表单 safeParse + 类型派生操作 / Sidebar 7 入口 + 路由守卫）全部正确实现。R12 首次大规模验证 4 条，R14 再次验证 7 条，R15 进一步验证 8 条，R16 进一步验证 8 条，证明 Spec 模板 §10 组合副作用预判机制在后端能力前端化闭合下持续生效。组合 #1（transfer 非 versioned + superRefine path=['newRoleId'] + 服务端兜底）+ #2（setParent versioned + 409 重试 + superRefine 自继承）+ #6（errorMapping 全码映射收尾 + R14 S-11 同步注释 + ①类显式影响预估准确）是 D8/D9/D7/D4 的关键正确性保证。
7. **impl-writer 自报准确性违规发现—— Reviewer 闸门价值范例**：R16 impl-writer 自报"未改测试断言"+"未触达"但 git diff 确认 3 文件改动含断言改动（error-mapping-extend-2.test.ts 2 断言 FALLBACK→具体中文 + navigation-extend.test.tsx/navigation.test.tsx 6→7 入口）。Reviewer §0 通过 `git diff HEAD --stat -- apps/web/test/` 实跑核对发现违规，判定 AI-002 边界**自报准确性**违规（不构成 block，改动本身属合理 ①类显式影响处理）。**证明 Reviewer 闸门对 impl-writer 自报准确性的核验价值**——Reviewer 须通过 git diff 实跑核对自报准确性，而非信赖自报描述。这是"impl-writer 自报准确性违规发现 + Reviewer 闸门价值"的范例。
8. **①类显式影响处理范例再验证**：R16 D9 扩展 errorMapping 全码映射收尾，导致 R14 既有 error-mapping-extend-2.test.ts 2 断言失效（TRANSFER_SAME_ROLE/ROLE_INHERITANCE_CYCLE FALLBACK "操作失败" → 具体中文）；D15 扩展 Sidebar 为 7 入口（6→7），导致 R14/R15 既有 navigation-extend.test.tsx + navigation.test.tsx 6 入口断言失效。test-writer §9.1 提前识别 + impl-writer 合理调整（3 文件 ①类显式影响注释标注完整 + 语义增强非弱化）+ Reviewer 判定 pass（根因 D9/D15 扩展 + 语义增强非弱化 + 注释标注完整）。①类显式影响预估准确（3 文件调整，编排者实跑 1196/1196 全绿核验）。**但 impl-writer 自报描述错误**（自报"未改测试断言"+"未触达"但实际改 3 文件含断言改动），Reviewer §0 通过 git diff 实跑核对发现违规，须显式标注（S-17）。
9. **三件套全绿 + 0 blocker + 46/46 AC 对齐**：typecheck ✅ / lint:rules ✅（ARCH-003 + CODE 扫描器全过）/ vitest ✅ 1196/1196（web 363 = R12 50 + R14 108 + R15 87 + R16 107 + 其他 11；api 833 无回归）。AC 对齐 46/46（功能 43 + ARCH-003 专项 1 + R13 S-1 专项 2，0 偏离 0 未实现），AC-ARCH-3/ARCH-4 完全对齐。7 项 suggestion 均为文案/常量/UX/测试配置/代码复用类改进，不阻断合入。

这证明：**AI 原生工作流在"前端全域覆盖收尾 + 既有基础设施扩展范例 + 状态机+versioned 组合"验证（R15）后，进入"后端能力前端化闭合 + errorMapping 全码映射收尾 + 事务性+继承链+聚合三形态 + impl-writer 自报准确性违规发现"验证阶段（R16）**——R12 前端首轮闭合 ARCH-003 机器化（R1-R11 唯一未机器化规则闭合），R13 元改进轮固化 8 条提示词，R14 多域扩展验证 R13 固化提示词在多域下首次大规模生效，R15 前端全域覆盖验证 R12 前端基础设施在 7 域下持续复用 + R13/R14 固化的 13 条提示词持续生效，**R16 后端能力前端化闭合验证 R12 前端基础设施在 7+2 域（含事务性单端点 + 继承链 + 权限码集合三形态）下持续复用 + R13/R14/R15 固化的 17 条提示词持续生效（特别是 R14 S-11 在 R16 完全闭合）+ errorMapping 全码映射收尾 + impl-writer 自报准确性违规发现（Reviewer 闸门价值范例）**。R14 教训反推在 R16 完全闭合（S-11 同步注释三处完全闭合），R15 教训反推在 R16 持续生效（S-13~S-16 4 项提示词持续验证），证明"元改进→业务验证→持续验证→完全闭合"四段闭环有效。Reviewer verdict=pass 0 blocker，证明 spec-first 工作流对"后端能力前端化闭合"具有适应性，且 R13/R14/R15 固化的提示词在事务性/继承链/聚合域下落地。前端覆盖全部后端写/读端点已完成，可进入"前端质量加固"阶段（E2E/性能/可访问性）。

剩余改进项（S 级，不阻断）：
- **S-5**（R12 遗留，advisory 不强制）：setupFiles 全局副作用——未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 node/jsdom 配置（独立 vitest.config.web.ts）。本期不阻断（当前安全，仅追加 matcher）。
- **S-6**（R13 新发现）：AI-005 前端测试盲区——AI-005 分支硬编码目录过滤 `apps/api/test/`，扩展 allTs 后仍只扫后端测试，未覆盖 apps/web/test。前端测试若硬编码跨域可变集合无机器校验。未来改进方向：AI-005 continue 条件扩展含 apps/web/test（须核查正则对前端测试的适用性）。
- **S-7**（R13 新发现）：元改进轮 Review 缺失——R13 是首个元改进轮，无标准 Review 报告（无 PRD AC 可逐条核对），复盘替代 Review 作为质量门禁。未来元改进轮可考虑轻量 Review checklist（核对 S-x 是否全部固化 + 三件套绿 + 改动范围合规 + 探针验证执行）。
- **S-8**（R14 新发现，R15 闭合，R16 持续生效）：getDeptTree 命名偏离 Spec §4.2.2 getDepartmentTree——R15 D20 [约束] 落地，R16 api/transfer.ts + api/role-inheritance.ts 函数命名对齐 Spec §4.2 声明，R14 S-8 教训在 R16 持续闭合。
- **S-9**（R14 新发现，R15 闭合，R16 持续生效）：AuditLogPage useEffect 每键入触发请求——R15 D12 [约束] 落地，R16 TransferForm 含"调岗"提交按钮触发请求（不每键入触发），R14 S-9 教训在 R16 持续闭合。
- **S-10**（R14 新发现，R15 闭合，R16 持续生效）：RoleForm/DeptForm aria-label="名称"非"角色名称"/"部门名称"——R15 D21 [约束] 落地，R16 TransferForm aria-label="用户 ID"/"目标部门"/"原角色"/"新角色" + SetParentModal aria-label="父角色" + EffectivePermissionsPanel aria-label="用户 ID"，R14 S-10 教训在 R16 持续闭合（[advisory] RoleListPage 3 按钮 aria-label 移除判定合理——按钮文本已提供 accessible name）。
- **S-11**（R14 新发现，R15 部分闭合，R16 完全闭合）：errorMapping.ts L62-63 注释过时——R15 D9 [约束] 部分闭合（注释从"REPORT/NOTIFICATION/TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"），**R16 D9 [约束] 完全闭合**（注释从"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"更新为"全码映射收尾（R14 S-11 闭合）"，三处注释 L17-20/L65/L82 同步反映扩展后全码映射收尾态，0 域 FALLBACK），R14 S-11 教训在 R16 完全闭合。
- **S-12**（R14 新发现，R15 验证生效，R16 持续生效）：test-writer 测试文件数偏离 Spec §9（11 vs 9）——R14 S-12 固化后 Spec §9.3 已明确"测试文件数是预估，test-writer 可据覆盖质量调整但须 AI-006 反向核实注明理由 + Reviewer 判定合理性"，R16 test-writer 据此落地（5 ③类 + 3 ①类显式影响调整对齐预估，无偏离），R14 S-12 固化项在 R16 持续验证生效。
- **S-13**（R15 新发现，R16 持续生效）：impl-writer 测试 setup 改动增多——R16 测试 fixture UUID 用有效 hex（无需校准，R15 S-13 固化后 test-writer 已注意），无 fixture 失败案例，R15 S-13 固化项在 R16 持续生效。
- **S-14**（R15 新发现，R16 持续生效）：组件 label 跨组件唯一——R16 TransferForm/SetParentModal/EffectivePermissionsPanel label/aria-label 与 RoleListPage 既有 label 无冲突（[advisory] EffectivePermissionsPanel h2 文案"有效权限"→"权限列表" + UserRow 按钮文案"有效权限"→"权限"消歧），R15 S-14 固化项在 R16 持续生效。
- **S-15**（R15 新发现，R16 持续生效无触发场景）：vitest testTimeout 全局放宽——R16 无长文本输入测试（transfer 表单字段均为短 UUID + select），无超时案例，R15 S-15 固化项在 R16 持续生效（无触发场景）。
- **S-16**（R15 新发现，R16 持续生效）：报表动态列空值兜底——R16 EffectivePermissionsPanel 权限码集合渲染兜底（permissions.length===0 → "该用户暂无有效权限"）+ InheritanceChainPanel 祖先链渲染兜底（chain.length===0 → "无父角色"），R15 S-16 固化项在 R16 持续生效（空集合兜底，权限码集合 + 祖先链两场景）。
- **S-17**（R16 新发现）：impl-writer 自报准确性违规（自报"未改测试断言"+"未触达"但实际改 3 文件含断言改动）——impl-writer 自报改动范围时未通过 git diff 实跑核对自报描述准确性，仅凭记忆或预期描述"未改测试断言"+"未触达"，但实际改动了 3 处既有测试文件含断言改动。Reviewer §0 通过 git diff 实跑核对发现违规，判定 AI-002 边界**自报准确性**违规（不构成 block，改动本身属合理 ①类显式影响处理）。反推：impl-writer 提示词增加"自报改动范围须准确——须通过 git diff 实跑核对自报描述，按文件逐条列出实际改动（含断言改动/setup 调整/matcher 调整），不可笼统描述'未改测试断言'+'未触达'"；Reviewer 提示词增加"须通过 git diff 实跑核对 impl-writer 自报改动范围的准确性，而非信赖自报描述"。
- **S-18**（R16 新发现）：errorMapping AUDIT_LOG_NOT_FOUND 仍 FALLBACK（[advisory]，前端不触发）——R16 D9 全码映射收尾后，errorCodeSchema 全集所有已知域码均映射具体中文提示，仅 [advisory] AUDIT_LOG_NOT_FOUND 仍 FALLBACK（前端 AuditLogPage 仅消费 GET /v1/audit-logs 分页列表，不消费单个查询，前端不触发故 [advisory] 沿用 FALLBACK）。反推：impl-writer 提示词增加"errorMapping 全码映射收尾的'全集'定义须明确为'前端可能触发的域码全集'而非'errorCodeSchema 枚举全集'——前端不触发的域码可 [advisory] 沿用 FALLBACK，注释须显式标注'[advisory] XXX 沿用（前端不触发）'"；Spec 模板 §10 组合副作用预判须含"全码映射收尾的'全集'定义明确"项。
- **S-19**（R16 新发现）：SetParentModal UUID_RE 重复定义（R15 S-13 类似，未跨组件复用）——SetParentModal.tsx 内部定义 UUID_RE 常量与 TransferForm.tsx 内部 UUID_RE 重复定义。[advisory] 沿用重复定义（根因 UUID_RE 为简单正则常量，提取至 lib/uuid.ts 须新增文件 + import 路径，对 2 处使用场景的复用价值有限）。反推：impl-writer 提示词增加"简单常量（如 UUID_RE 正则）跨组件复用边界——若 ≤3 处使用场景且常量简单（单行正则），可 [advisory] 沿用重复定义；若 ≥4 处使用场景或常量复杂（多行逻辑），须提取至 lib/ 共享"；Spec 模板 §10 组合副作用预判须含"简单常量跨组件复用边界"项。
- **S-20**（R16 新发现）：AC-F4-3 user-event v14.6.1 disabled option 过滤 workaround（测试工具限制）——user-event v14.6.1 selectOptions 会自动过滤 disabled option（不选中），导致无法测试"前端 disabled 防误选"场景。impl-writer 采用 workaround：parentRoleId 空 + allRoles 含 is_builtin 时提示"内置角色不可设为父角色"（绕过 user-event v14.6.1 disabled 过滤，直接测服务端兜底文案）+ 单独测 admin option disabled 属性（first）。反推：test-writer 提示词增加"user-event v14.6.1 disabled option 过滤机制——selectOptions 会自动过滤 disabled option（不选中），测试'前端 disabled 防误选'场景须绕过 user-event 直接测 option.disabled 属性 + 测服务端兜底文案，而非通过 user-event selectOptions 模拟误选"；Spec 模板 §10 组合副作用预判须含"测试工具限制 workaround"项。

> 十六轮演进脉络：R9/R10 验证"协议层扩展适应性"（写条件 + 读条件），R11 验证"安全域适应性"（鉴权），R12 验证"前端域适应性 + ARCH-003 机器化闭合"，R13 验证"工作流自身元改进固化"（S-1~S-4 固化 + S-5 记录），R14 验证"前端多域扩展适应性 + R13 固化提示词多域验证 + ①类显式影响处理范例"，R15 验证"前端全域覆盖收尾 + client.ts 既有基础设施扩展范例 + 通知状态机+versioned 组合 + R14 教训反推生效"，**R16 验证"后端能力前端化闭合 + errorMapping 全码映射收尾 + 事务性+继承链+聚合三形态 + R13/R14/R15 固化提示词持续验证（特别是 R14 S-11 完全闭合）+ impl-writer 自报准确性违规发现（Reviewer 闸门价值范例）"**。R12 证明前端引入可跨层契约机器化闭合（ARCH-003 从 [预留] 到 enforcement），R13 证明工作流元资产改进可经精简流程闭环，R14 证明前端多域扩展可零新增基础设施复用 R12 基础设施 + R13 固化提示词在多域下生效，R15 证明前端全域覆盖（7 域）可零新增基础设施复用 R12/R14 基础设施 + 既有基础设施扩展（D8）可后向兼容 + 状态机+versioned 组合 + 动态 schema（z.record）渲染 + R13/R14 固化提示词持续生效（特别是 R14 S-11 在 R15 D9 部分闭合），**R16 证明后端能力前端化闭合（7+2 域含事务性单端点 + 继承链 + 权限码集合三形态）可零新增基础设施复用 R12/R14/R15 基础设施 + errorMapping 全码映射收尾（R14 S-11 在 R16 完全闭合）+ R13/R14/R15 固化的 17 条提示词持续生效 + impl-writer 自报准确性违规发现（Reviewer 闸门价值范例）**。前端覆盖全部后端写/读端点已完成，下一轮可考虑进入"前端质量加固"阶段：①后端对齐 wire 字段名消除 D10 适配（server.ts `error`→`code`）；②补 GET /v1/users/:id（R12 §1.3 发现的 gap，消除 D19 不 GET 偏离）；③E2E 测试引入（Playwright 跑真实浏览器+真实后端）；④S-17~S-20 固化（提示词层 S-17/S-18/S-19/S-20 + Spec 模板层 S-18/S-19/S-20）；⑤前端质量加固阶段如性能优化（React.memo/useMemo/useCallback 评估 + 虚拟列表 + 代码分割）；⑥可访问性深化（aria-label 域特定已落地 R14 S-10 + R15 D21 + R16 持续闭合，可进一步 screen reader 端到端测试、键盘导航、色彩对比等可访问性深化）；⑦前端覆盖全部后端写/读端点已完成，可进入"前端质量加固"阶段如 E2E/性能/可访问性。
