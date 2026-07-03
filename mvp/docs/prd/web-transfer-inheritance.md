---
doc_type: PRD-Spec
id: PRD-WEB-TRANSFER-INHERITANCE-001
title: 前端调岗管理页 + 角色继承管理（R16 前端补齐后端能力前端化，闭合 transfer + role-inheritance 两域）
status: decided
# Q&A 决策结果：Q1=①独立页(/transfer，对齐R14 DeptTreePage独立路由风格) / Q2=②选择器混合(userId自由UUID文本safeParse + oldRoleId/newRoleId/toDepartmentId select，oldRoleId先listUserRoles取用户已分配角色) / Q3=①提示+刷新当前页(对齐R14删除角色成功refresh模式) / Q4=①不做调岗历史(audit-logs无transfer实体类型，筛选语义模糊) / Q5=①RoleListPage行操作扩展(设置/解除父角色+查看继承链，复用既有RoleListPage) / Q6=①链形文本(祖先链线性展示，根角色空数组显示"无父角色") / Q7=③UserListPage行操作扩展(每行加"有效权限"按钮触发EffectivePermissionsPanel modal) / Q8=①弹窗选择父角色(SetParentModal，parentRoleId select从listRoles派生，禁用自继承+内置admin) / Q9=①组件测+API client契约测无E2E(对齐R12Q8②/R14Q12①/R15Q9①) / Q10=①扩展SPECIFIC_MESSAGES(transfer/inheritance码加中文，同步"未映射码"注释R14S-11)
owner: ba@team
created: 2026-07-03
extends: PRD-WEB-NOTIFICATION-REPORT-001
aligns: [PRD-TRANSFER-001, PRD-ROLE-INHERITANCE-001]
prd_ref: RETRO-ROUND16-001
---

# 前端调岗管理页 + 角色继承管理（R16 前端补齐后端能力前端化，闭合 transfer + role-inheritance 两域）

## BA 核验发现（contracts SSOT 优先，R10 S-2 / R13 S-1 教训闭合）

> 本节记录 PRD 起草阶段对 `packages/contracts/src/schemas/transfer.ts` + `role-inheritance.ts` + `role.ts` + `dept.ts` + `user.ts`（errorCodeSchema SSOT）+ `apps/api/src/server.ts` 路由表（L249-261 调岗 / L293-315 角色继承）的核验结果。任务编排描述与 contracts SSOT 存在 4 处须显式标注的偏离（T1~T4），BA 一律以 contracts SSOT 为准。

| # | 任务描述措辞 | contracts SSOT 实际 | PRD 采取 | 阻塞下游 |
|---|---|---|---|---|
| T1 | "调岗错误码 TRANSFER_USER_NOT_FOUND / TRANSFER_DEPT_NOT_FOUND / TRANSFER_ROLE_NOT_FOUND / TRANSFER_ROLE_BUILTIN_FORBIDDEN" | errorCodeSchema（user.ts L119-210）**无** TRANSFER_USER_NOT_FOUND / TRANSFER_DEPT_NOT_FOUND / TRANSFER_ROLE_NOT_FOUND / TRANSFER_ROLE_BUILTIN_FORBIDDEN 这些码——调岗时引用实体不存在复用各域既有码：`USER_NOT_FOUND` / `DEPT_NOT_FOUND` / `ROLE_NOT_FOUND`；oldRole 为内置角色复用 `ROLE_BUILTIN_FORBIDDEN`（非 transfer 专属码）；transfer 专属码仅 4 个：`TRANSFER_SAME_ROLE`（superRefine）、`TRANSFER_OLD_ROLE_NOT_ASSIGNED`、`TRANSFER_COMPENSATION_FAILED`、`TRANSFER_FAILED`（聚合码，校验阶段错误码直接传播不聚合） | F3 调岗错误处理 AC 用 contracts SSOT 真实码：USER_NOT_FOUND / DEPT_NOT_FOUND / ROLE_NOT_FOUND / ROLE_BUILTIN_FORBIDDEN / TRANSFER_SAME_ROLE / TRANSFER_OLD_ROLE_NOT_ASSIGNED / TRANSFER_FAILED（非臆造 TRANSFER_*_NOT_FOUND 码）；errorMapping 扩展仅追加实际触发的码中文提示 | Tech-Spec §3.2 表单校验、§11 错误码映射、impl errorMapping 扩展、test F3 用例 |
| T2 | "ROLE_INHERITANCE_NOT_FOUND" | errorCodeSchema **无** ROLE_INHERITANCE_NOT_FOUND 码——角色继承域错误码为 `ROLE_SELF_INHERITANCE`（superRefine 自继承）、`ROLE_BUILTIN_PARENT_FORBIDDEN`（父角色为内置 admin）、`ROLE_INHERITANCE_CYCLE`（环检测）、`ROLE_HAS_CHILDREN`（删除守卫，R16 不触发）；roleId/parentRoleId 不存在复用 `ROLE_NOT_FOUND` | F4/F5 角色继承错误处理 AC 用 contracts SSOT 真实码：ROLE_SELF_INHERITANCE / ROLE_BUILTIN_PARENT_FORBIDDEN / ROLE_INHERITANCE_CYCLE / ROLE_NOT_FOUND（非臆造 ROLE_INHERITANCE_NOT_FOUND） | Tech-Spec §11 错误码映射、impl errorMapping 扩展、test F4/F5 用例 |
| T3 | "GET /v1/roles/:roleId/inheritance-chain（cacheable）、GET /v1/users/:userId/effective-permissions（cacheable）" | server.ts L306-310 / L311-315 这两个 GET 端点 defineRoute 调用**未传第 6 参 cacheable=true**（仅 4 参：method/pattern/buildInput/procedure），即 cacheable=false，**不生成 ETag**；与 GET /v1/roles（L264 cacheable） / GET /v1/notifications（L347 cacheable）显式传第 6 参 true 不同 | F6/F7 AC 不依赖 ETag 协商（前端 R12 D15/Q12 已决策前端不启用协商缓存，不发 If-None-Match；cacheable 与否对前端行为无影响——前端始终 GET 取最新）；PRD 按 contracts SSOT 标注 cacheable=false，前端按"非 cacheable GET"处理（仅 GET + 渲染，无 304 协商） | Tech-Spec §4 API client（这两个 GET 不走 cacheable 路径，但 R12 D15 已统一不发 If-None-Match，行为一致）、impl api/role-inheritance.ts、test F6/F7 |
| T4 | "POST /v1/users/:userId/transfer（事务性，单端点）" + "调岗表单 userId + toDepartmentId + oldRoleId + newRoleId" | server.ts L249-261 确认 POST /v1/users/:userId/transfer **非 versioned**（defineRoute 第 5 参缺省 false）+ **非 cacheable**；buildInput 从 path 取 userId、从 body 取 toDepartmentId/oldRoleId/newRoleId 合并为 transferProcedureInputSchema 入参（path+body 合并风格，对齐 assignRoleInputSchema/assignUserDepartmentInputSchema）；transferInputSchema 含 superRefine（oldRoleId === newRoleId → 字段级 issue path=['newRoleId']，message 含 TRANSFER_SAME_ROLE） | F1/F2 AC 按"非 versioned POST 事务性单端点"处理——**不传 If-Match**（无 versioned 标记，对齐 R14 部门创建 POST /v1/departments 非 versioned 风格）；F2 superRefine AC 断言字段级错误 path=['newRoleId'] + 提示"新角色不能与原角色相同"；表单提交体为 `{toDepartmentId, oldRoleId, newRoleId}`（userId 在 path，body 不含 userId，对齐 server.ts buildInput） | Tech-Spec §3.1 TransferInput 消费、§4 API client（非 versioned 不传 If-Match）、impl api/transfer.ts + TransferForm、test F1/F2 |

> **核验结论**：transfer / role-inheritance 契约已在 R7/R8 就绪（contracts 冻结，本轮无新增 schema）。任务编排描述与 contracts SSOT 存在 4 处偏离（T1 错误码臆造前缀 / T2 臆造 ROLE_INHERITANCE_NOT_FOUND / T3 GET 端点 cacheable 标记 / T4 transfer 非 versioned），BA 一律以 contracts SSOT 为准。特别 T1/T2 错误码偏离影响 AC 断言精确性（不能用臆造码断言），T3 cacheable 标记对前端行为无实质影响（R12 D15 前端统一不发 If-None-Match），T4 非 versioned 决定前端不传 If-Match（区别于 R14/R15 versioned 写端点）。

## 背景

R12 首次引入前端（apps/web），闭合 ARCH-003「跨层只经契约」从 `[预留]` 到机器化 enforcement（R1-R11 唯一未机器化规则）。R13 固化 S-1~S-4 工作流改进（§3.2 区分自由文本表单 vs 类型派生操作、§10 advisory 文案同步边界、test-writer AC 覆盖矩阵自检 + 组合场景测试、CODE 扫描器覆盖前端）。R14 一次性扩展角色/部门/审计三域前端（5 域）+ R13 固化提示词多域首次大规模验证 + ①类显式影响处理范例 + 多约束组合副作用 7 条预判全部正确。R15 前端全域覆盖收尾（通知域 + 报表域，7 域）+ client.ts 既有基础设施扩展范例（D8 query 类型扩展）+ 通知状态机 + 4 versioned 端点组合 + R14 教训反推生效（特别是 R14 S-11 在 R15 D9 闭合）。R15 复盘 §6 列出的下一轮候选之首即"调岗 transfer 前端（POST /v1/users/:userId/transfer 端点存在但前端未做）+ 角色继承管理 UI（R14 Q10 out-of-scope，POST/DELETE /v1/roles/:roleId/parent + GET /v1/roles/:roleId/inheritance-chain 端点已就绪）"。

本期（R16）作为**前端补齐后端能力前端化轮次**，在 R12/R14/R15 既有前端基础设施上闭合 transfer + role-inheritance 两域前端，完成"前端覆盖全部后端写/读端点"的最后一公里。R15 完成前端 7 域（auth/user/role/dept/audit/notification/report）覆盖，但 transfer（事务性单端点）+ role-inheritance（versioned 写 + 链形/集合只读）两域后端端点已就绪但前端未消费——R16 闭合此前端缺口，验证以下未覆盖的工作流边界：

1. **事务性单端点前端模式（transfer）**：transfer 为后端事务性单端点（POST /v1/users/:userId/transfer，server.ts L249-261），withTransaction 包裹 A/B/C 三步（移除 oldRole + 分配 newRole + 变更 dept，R7 TECH-TRANSFER-001 §3.1）。前端须提交 4 字段表单（userId + toDepartmentId + oldRoleId + newRoleId）+ 处理事务聚合错误码（TRANSFER_FAILED 含失败步骤+底层原因）+ superRefine 字段级错误（oldRoleId === newRoleId → path=['newRoleId']）。R12/R14/R15 均为单步 CRUD/状态机/聚合，R16 首次验证前端对"事务性多步聚合错误码"的展示策略。
2. **versioned 写操作 + 自继承 superRefine 组合（role-inheritance）**：setParent（POST /v1/roles/:roleId/parent，versioned，server.ts L293-300）+ unsetParent（DELETE /v1/roles/:roleId/parent，versioned，L301-305）须 If-Match + 409 VERSION_CONFLICT 自动重试（复用 R12 D9）；setParentInputSchema 含 superRefine（roleId === parentRoleId → 自继承禁止，前端字段级错误）；ROLE_INHERITANCE_CYCLE（环检测，mock reject 提示"会形成继承环"）。R12/R14/R15 versioned 端点均无 superRefine（user status/role delete/notification 4 端点），R16 首次验证"versioned 写 + superRefine 字段级错误 + 环检测聚合码"组合。
3. **只读链形/集合展示（inheritance-chain / effective-permissions）**：inheritance-chain（GET /v1/roles/:roleId/inheritance-chain）返回 Role[] 祖先链（根角色 []，T3 非 cacheable）；effective-permissions（GET /v1/users/:userId/effective-permissions）返回 PermissionCode[] 集合（直接角色 ∪ 继承链父角色权限码并集，去重排序）。R12/R14 列表均为分页 envelope，R15 报表为聚合 record，R16 首次验证前端对"裸数组 Role[] 祖先链 + 裸数组 PermissionCode[] 权限码集合"两种无 envelope 只读响应的展示策略。
4. **R13 S-1 固化在事务表单 + 继承操作下落地**：R16 含混合表单（TransferForm：userId 自由文本 UUID + oldRoleId/newRoleId/toDepartmentId select，整体 safeParse transferInputSchema + superRefine）与类型派生操作（setParent/unsetParent 按钮、inheritance-chain/effective-permissions 查看按钮）。AC 措辞须精确区分两类（混合表单须 safeParse 覆盖 superRefine，类型派生 TS 类型保证），验证 R13 S-1 在事务表单 + 继承操作下的可操作性。
5. **R13 S-3 AC↔测试覆盖矩阵**：R16 PRD 验收标准须标注 AC↔测试用例覆盖矩阵（或注明由 test-writer 阶段补矩阵），验证 S-3 固化在 PRD 阶段的持续落地。
6. **R14 S-8~S-11 + R15 S-13~S-16 教训在本轮注意**：api 模块函数命名须对齐 Spec 声明（S-8，api/transfer.ts + api/role-inheritance.ts 命名对齐 §4.2）、文本输入筛选（S-9，transfer userId 文本输入须"提交"按钮触发非每键入，effective-permissions userId 同理——本轮均为表单提交按钮触发，无 debounce 需求）、aria-label 须域特定（S-10，TransferForm "用户 ID"/"目标部门"/"原角色"/"新角色"、SetParentModal "父角色"、EffectivePermissionsPanel "用户 ID"）、扩展既有模块同步注释（S-11，errorMapping 扩展 transfer/inheritance 码时同步"未映射码"注释——R15 D9 注释已更新为"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"，R16 扩展后该注释须移除，全码均映射）；测试 fixture 对齐 contracts 严格校验（S-13，UUID 用有效 hex）、组件 label 跨组件唯一（S-14，TransferForm/SetParentModal/EffectivePermissionsPanel 不与 RoleListPage 既有 label 冲突）。
7. **errorMapping 全码映射收尾**：R12 扩展 user/auth 域码、R14 扩展 role/dept 域码、R15 扩展 notification/report 域码，R15 后仅 TRANSFER/ROLE_INHERITANCE 域码保持 FALLBACK（R15 D9 注释明示）。R16 扩展 transfer/inheritance 码后，errorCodeSchema 全集所有码均映射具体中文提示，errorMapping.ts FALLBACK 仅作"未来新增码兜底"而非"已知域未映射"——R14 S-11 同步注释须再次更新（移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"注释）。

后端已就绪（R1-R15 1089 用例基线），**本轮不实现后端任何改动**，contracts 无新增 schema（transfer/role-inheritance 契约在 R7/R8 已就绪）。

## 业务目标

- **目标1（调岗表单）**：调岗独立页 /transfer（Q1 决策①），TransferForm 混合表单：userId 自由文本 UUID（safeParse uuid，对齐 R15 Q4① recipient_id 模式）+ oldRoleId/newRoleId/toDepartmentId select（Q2 决策②选择器混合，oldRoleId 须先 listUserRoles 取用户已分配角色，newRoleId/toDepartmentId 从 listRoles/getDepartmentTree 派生）；提交调 POST /v1/users/:userId/transfer（非 versioned，T4，不传 If-Match，body={toDepartmentId, oldRoleId, newRoleId}）；transferInputSchema.safeParse 覆盖 4 字段 + superRefine（oldRoleId === newRoleId → 字段级错误 path=['newRoleId']，T4）。
- **目标2（调岗校验）**：自由文本/选择器混合表单（R13 S-1），transferInputSchema.safeParse 整体校验（userId uuid + toDepartmentId/oldRoleId/newRoleId uuid + .strict() 拒绝多余字段 + superRefine oldRoleId !== newRoleId）；oldRoleId select 仅显示用户已分配角色（listUserRoles，前端防 TRANSFER_OLD_ROLE_NOT_ASSIGNED）；newRoleId select 与 oldRoleId 重复时前端字段级提示（superRefine 兜底）。
- **目标3（调岗错误处理）**：USER_NOT_FOUND（用户不存在）/ DEPT_NOT_FOUND（部门不存在）/ ROLE_NOT_FOUND（角色不存在）/ ROLE_BUILTIN_FORBIDDEN（oldRole 为内置角色）/ TRANSFER_SAME_ROLE（superRefine 字段级）/ TRANSFER_OLD_ROLE_NOT_ASSIGNED（用户未持有 oldRole，竞态）/ TRANSFER_FAILED（事务聚合失败，message 含失败步骤+底层原因）—— 均映射中文提示（T1 错误码 SSOT 核验）。
- **目标4（角色设置父角色）**：RoleListPage 行操作扩展（Q5 决策①，复用既有 RoleListPage）"设置父角色"按钮 → SetParentModal 弹窗（Q8 决策①），parentRoleId select 从 listRoles 派生（禁用自继承 roleId + 禁用内置 admin，前端防 ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN）；setParentInputSchema.safeParse 覆盖 superRefine（roleId === parentRoleId → 字段级错误）；POST /v1/roles/:roleId/parent versioned + If-Match=role.version（T3，versioned=true）+ 409 VERSION_CONFLICT 自动重试 1 次（复用 R12 D9）；ROLE_INHERITANCE_CYCLE（环检测，mock reject）→ 提示"会形成继承环"。
- **目标5（角色解除父角色）**：RoleListPage 行操作"解除父角色"按钮（仅 role.parent_role_id !== null 时显示，根角色不显示），DELETE /v1/roles/:roleId/parent versioned + If-Match=role.version + 409 VERSION_CONFLICT 自动重试 1 次；ROLE_NOT_FOUND 提示；unsetParentInputSchema 为类型派生操作（roleId 从列表派生，TS 类型保证，不调 safeParse）。
- **目标6（角色继承链查看）**：RoleListPage 行操作"查看继承链"按钮 → InheritanceChainPanel 渲染 GET /v1/roles/:roleId/inheritance-chain 返回 Role[] 祖先链（T3 非 cacheable，前端 GET 取最新）；根角色返回 [] → 显示"无父角色"；有父角色 → 链形文本渲染（Q6 决策①，如"角色 A → 父角色 B → 祖父角色 C"，根角色终止）。
- **目标7（用户有效权限查看）**：UserListPage 行操作"有效权限"按钮（Q7 决策③）→ EffectivePermissionsPanel modal 渲染 GET /v1/users/:userId/effective-permissions 返回 PermissionCode[] 集合（T3 非 cacheable）；权限码集合渲染（去重排序由后端保证，前端按返回顺序展示）+ 权限码中文化映射（纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录，如 user:read→"查看用户"、transfer:write→"调岗用户"）。
- **目标8（导航扩展）**：侧边栏新增"调岗"入口（角色继承管理嵌入 RoleListPage 不新增独立入口），路由守卫覆盖 /transfer（复用 R12 RouteGuard 白名单仅 /login）。
- **目标9（错误处理扩展）**：errorMapping 扩展 transfer/inheritance 相关 ErrorCode 中文提示（TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED/TRANSFER_COMPENSATION_FAILED/ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN）；映射表键仍从 errorCodeSchema SSOT 派生（R12 D11 沿用）；扩展后 errorCodeSchema 全集所有码均映射具体中文提示，FALLBACK 仅作"未来新增码兜底"，同步移除 R15 D9 注释"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（R14 S-11 教训闭合收尾）。
- **目标10（前端基础设施零新增）**：复用 R12/R14/R15 api/client.ts（Bearer/If-Match/401 拦截/409 重试/wire 适配 + D8 query 数组扩展）、auth/（tokenStore/AuthContext/RouteGuard）、components/ErrorBanner、lib/errorMapping；新增 api/transfer.ts、api/role-inheritance.ts；新增 pages/TransferPage.tsx；新增 components/TransferForm.tsx（混合表单）、SetParentModal.tsx（设置父角色弹窗）、InheritanceChainPanel.tsx（继承链展示）、EffectivePermissionsPanel.tsx（有效权限展示）；零新依赖。
- **目标11（ARCH-003 持续合规）**：新增 api/pages/components 模块继续受 ARCH-003 约束——只 import @admin/contracts + apps/web 内部 + 第三方，禁止 import apps/api/src/**。R12 已机器化的 check-rules.mjs ARCH-003 分支自动覆盖新增文件。
- **目标12（验证工作流后端能力前端化收尾适应性）**：验证 spec-first 工作流在 transfer + role-inheritance 两域前端化下的适应性——PRD（BA，本轮含 contracts SSOT 核验发现 T1~T4）→ Tech-Spec + 契约复用（TechLead，契约冻结无新增）→ 测试先行（含 AC↔测试覆盖矩阵，R13 S-3）→ 实现 → Review（ARCH-003 逐文件 + R13 S-1 混合表单/类型派生区分 + R14 S-8~S-11 + R15 S-13~S-16 教训注意）→ 门禁 G7。

## 用户故事

- 作为管理员，我希望在侧边栏切换进入调岗管理页，填写用户 ID + 选择目标部门 + 选择原角色 + 选择新角色后提交，完成事务性调岗（移除旧角色 + 分配新角色 + 变更部门），不必分别执行三步操作。
- 作为管理员，我希望调岗表单在选择原角色时仅显示该用户当前已分配的角色（避免选错），选择新角色时若与原角色相同被前端拦截提示"新角色不能与原角色相同"，避免无效请求。
- 作为管理员，我希望调岗失败时收到明确提示——用户/部门/角色不存在、原角色为内置角色不可移除、用户未持有原角色（竞态）、事务执行失败（含失败步骤+原因），而非笼统失败。
- 作为管理员，我希望在角色列表页对每个角色点击"设置父角色"打开弹窗选择父角色，弹窗中禁用自继承和内置 admin 角色，提交后角色继承关系生效；遇到并发冲突系统自动重试一次。
- 作为管理员，我希望设置父角色时若会形成继承环（如 A→B→A），能收到明确提示"会形成继承环"，而非笼统失败。
- 作为管理员，我希望对已有父角色的角色点击"解除父角色"将其变回根角色，遇到并发冲突系统自动重试一次。
- 作为管理员，我希望点击"查看继承链"看到该角色的祖先角色链（如"角色 A → 父角色 B → 祖父角色 C"），根角色显示"无父角色"，理解角色继承层级。
- 作为管理员，我希望在用户列表行点击"有效权限"看到该用户的有效权限码集合（直接角色权限 ∪ 继承链父角色权限并集），理解用户实际拥有的全部权限。
- 作为管理员，我希望未登录访问调岗页时被路由守卫拦截跳转登录页，与 R12/R14/R15 其他页一致。
- 作为系统负责人，我希望新增前端模块继续遵守 ARCH-003（只经契约，不直连后端），错误码映射从 SSOT 派生不漏枚举，且扩展 errorMapping 时同步更新注释（移除已扩展域的 FALLBACK 注释）。
- 作为系统负责人，我希望调岗 transfer 涉及 userId/deptId/roleId 引用 + effective-permissions 权限码集合均非 PII，前端不引入新的 PII 处理面。

## 功能点清单

- [ ] F1：调岗表单（TransferForm 混合表单：userId 自由文本 UUID + oldRoleId/newRoleId/toDepartmentId select；提交调 POST /v1/users/:userId/transfer 非 versioned 不传 If-Match，body={toDepartmentId, oldRoleId, newRoleId}，T4；oldRoleId 先 listUserRoles 取用户已分配角色，newRoleId 从 listRoles 派生，toDepartmentId 从 getDepartmentTree 派生，Q2 决策②）
- [ ] F2：调岗校验（混合表单，transferInputSchema.safeParse 整体校验 + superRefine oldRoleId !== newRoleId → 字段级错误 path=['newRoleId']；userId uuid + .strict() 拒绝多余字段；R13 S-1 区分自由文本 userId vs 类型派生 select）
- [ ] F3：调岗错误处理（USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_SAME_ROLE 字段级/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED 聚合码，T1 错误码 SSOT 核验非臆造码）
- [ ] F4：角色设置父角色（RoleListPage 行操作"设置父角色"按钮 → SetParentModal 弹窗 parentRoleId select 从 listRoles 派生禁用自继承+内置 admin；setParentInputSchema.safeParse 覆盖 superRefine roleId !== parentRoleId；POST /v1/roles/:roleId/parent versioned + If-Match=role.version + 409 VERSION_CONFLICT 自动重试 1 次复用 R12 D9；ROLE_INHERITANCE_CYCLE 提示"会形成继承环"；ROLE_BUILTIN_PARENT_FORBIDDEN 提示"内置角色不可设为父角色"；ROLE_NOT_FOUND 提示，T2 错误码 SSOT 核验）
- [ ] F5：角色解除父角色（RoleListPage 行操作"解除父角色"按钮仅 role.parent_role_id !== null 时显示；DELETE /v1/roles/:roleId/parent versioned + If-Match=role.version + 409 VERSION_CONFLICT 自动重试 1 次；unsetParentInputSchema 类型派生操作不调 safeParse；ROLE_NOT_FOUND 提示）
- [ ] F6：角色继承链查看（RoleListPage 行操作"查看继承链"按钮 → InheritanceChainPanel 渲染 GET /v1/roles/:roleId/inheritance-chain 返回 Role[] 祖先链；T3 非 cacheable 不发 If-None-Match；根角色 [] → "无父角色"；有父角色 → 链形文本渲染 Q6 决策①；cacheable=false 按 contracts SSOT，T3）
- [ ] F7：用户有效权限查看（UserListPage 行操作"有效权限"按钮 → EffectivePermissionsPanel modal 渲染 GET /v1/users/:userId/effective-permissions 返回 PermissionCode[] 集合；T3 非 cacheable；权限码集合渲染 + 权限码中文化映射 Q7 决策③；去重排序由后端保证前端按返回顺序展示）
- [ ] F8：导航扩展（侧边栏：用户/角色/部门/审计/通知/报表/调岗 7 入口 + 登出；角色继承管理嵌入 RoleListPage 不新增独立入口；路由守卫覆盖 /transfer 复用 R12 RouteGuard 白名单仅 /login）
- [ ] F9：错误处理（errorMapping 扩展 TRANSFER_*/ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN 中文提示；映射表键 SSOT 派生；扩展后全码映射收尾，同步移除 R15 D9 "TRANSFER/ROLE_INHERITANCE 域 FALLBACK" 注释 R14 S-11；401 拦截/网络错误复用 R12）
- [ ] F10：前端基础设施复用（API client / AuthContext / RouteGuard / ErrorBanner / tokenStore / lib 复用 R12/R14/R15；新增 api/transfer.ts、api/role-inheritance.ts；零新依赖；ARCH-003 持续合规）

## 数据实体草图

**前端无独立数据实体**——全部消费 `@admin/contracts` 经 `z.infer` 派生（ARCH-002/CODE-004 延伸，R12 D3 / R14 D3 / R15 D3 沿用）。本轮契约已就绪，无新增 schema。

### 调岗域类型（源自 `packages/contracts/src/schemas/transfer.ts`）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `TransferInput` | `z.infer<typeof transferInputSchema>` | 调岗表单提交体 `{userId(uuid), toDepartmentId(uuid), oldRoleId(uuid), newRoleId(uuid)}`，.strict() 拒绝多余字段 + superRefine（oldRoleId === newRoleId → path=['newRoleId'] 字段级 issue，message 含 TRANSFER_SAME_ROLE，T4） |

> **调岗事务性单端点设计**（T4）：POST /v1/users/:userId/transfer **非 versioned**（server.ts L249-261 defineRoute 第 5 参缺省 false，对齐 R14 部门创建 POST /v1/departments 非 versioned 风格），前端**不传 If-Match**；body 为 `{toDepartmentId, oldRoleId, newRoleId}`（userId 在 path，buildInput 从 path+body 合并，对齐 assignRoleInputSchema/assignUserDepartmentInputSchema 风格，T4）；后端 withTransaction 包裹 A/B/C 三步（R7 TECH-TRANSFER-001 §3.1），事务失败抛 `TRANSFER_FAILED`（聚合码，message 含失败步骤+底层原因；校验阶段错误码 USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED 直接传播不聚合，T1）。

### 角色继承域类型（源自 `packages/contracts/src/schemas/role-inheritance.ts` + `role.ts`）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `SetParentInput` | `z.infer<typeof setParentInputSchema>` | 设置父角色提交体 `{roleId(uuid), parentRoleId(uuid)}`，.strict() + superRefine（roleId === parentRoleId → 自继承禁止，message "parentRoleId 不能等于 roleId（自继承禁止）"，T2） |
| `UnsetParentInput` | `z.infer<typeof unsetParentInputSchema>` | 解除父角色提交体 `{roleId(uuid)}`，.strict()；类型派生操作（roleId 从列表派生，TS 类型保证，不调 safeParse） |
| `InheritanceChainResult` | `z.infer<typeof inheritanceChainResultSchema>` | 继承链返回 `Role[]` 祖先数组（从直接父角色到根角色，按继承顺序；根角色返回 []，D7 / AC-F2-3） |
| `EffectivePermissionsResult` | `z.infer<typeof effectivePermissionsResultSchema>` | 有效权限返回 `PermissionCode[]` 集合（直接角色 ∪ 沿继承链向上的父角色权限码并集，去重排序保证确定性，Q7 决策） |
| `Role` | `z.infer<typeof roleSchema>` | 角色实体 `{id, name, description, permission_codes, is_builtin, parent_role_id, created_at, version}`（复用 role.ts；parent_role_id 为 null 表示根角色；version 用于 setParent/unsetParent 乐观锁，T3 versioned） |
| `PermissionCode` | `z.infer<typeof permissionCodeSchema>` | 权限码枚举 11 项（user:read/user:write/role:read/role:write/dept:read/dept:write/audit:read/report:read/notification:read/notification:write/transfer:write），effective-permissions 渲染 + 中文化映射派生源 |

> **角色继承链展示策略**（Q6 决策①链形文本）：
> - inheritance-chain 返回 `Role[]` 祖先数组（直接父角色在前，根角色在后，按继承顺序）。
> - 链形文本渲染：`角色名 A → 父角色名 B → 祖父角色名 C`（用 " → " 分隔，根角色终止；纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录）。
> - 根角色返回 `[]` → 显示"无父角色"（D7 / AC-F2-3）。
> - 链形文本优于树形（继承链为单继承线性结构，非多分支树；树形过度渲染）+ 面包屑（面包屑语义偏导航，继承链非导航）。

> **用户有效权限集合展示策略**（Q7 决策③）：
> - effective-permissions 返回 `PermissionCode[]` 集合（后端去重排序保证确定性，前端按返回顺序展示，无需客户端排序）。
> - 渲染为权限码列表（每项中文化映射，如 `user:read`→"查看用户"、`transfer:write`→"调岗用户"；纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录）。
> - 空集合 → 显示"该用户暂无有效权限"（用户无角色或角色无权限码场景）。

### 共享类型（源自 `packages/contracts/src/schemas/user.ts`，R12/R14/R15 已消费）

| 类型 | 派生自 | 用途 |
|------|--------|------|
| `ErrorCode` | `z.infer<typeof errorCodeSchema>` | 全局错误码 SSOT（含 TRANSFER_*/ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN 等，T1/T2 核验），errorMapping 键派生源 |
| `ErrorResponse` | `z.infer<typeof errorResponseSchema>` | `{code, message, current_version?}`，API client 适配后对外暴露（R12 D10 wire 适配沿用） |

### 客户端表单校验 schema 复用清单（R13 S-1 区分两类）

| 功能点 | 类型 | 复用 schema | 校验点 | AC |
|--------|------|-------------|--------|----|
| F1/F2 调岗表单 userId（自由文本 UUID） | **自由文本表单**（须 safeParse） | `transferInputSchema.safeParse`（整体校验覆盖 userId uuid + .strict() + superRefine） | userId uuid 格式 + 拒绝多余字段 + superRefine oldRoleId !== newRoleId | AC-F2-1/2/3 |
| F1/F2 调岗表单 toDepartmentId/oldRoleId/newRoleId select | **类型派生操作**（值从 listRoles/listUserRoles/getDepartmentTree 派生，TS 类型保证 uuid ∈ 选项集） | 不单独调 safeParse（select 值经 options 派生保证合法）；但整体 safeParse 覆盖（混合表单模式，对齐 R15 NotificationForm） | 值合法性由 select options 保证 + 整体 safeParse 兜底 | AC-F2-1/3 |
| F4 设置父角色 parentRoleId select | **类型派生操作**（值从 listRoles 派生，禁用自继承+内置 admin） | 不单独调 safeParse；但 setParentInputSchema.safeParse 整体覆盖（混合表单模式，覆盖 superRefine roleId !== parentRoleId） | 值合法性由 select options + 禁用项保证 + 整体 safeParse 兜底 | AC-F4-2/3 |
| F5 解除父角色按钮 | **类型派生操作**（roleId 从列表派生，TS 类型保证 uuid；versioned 写） | 不调 safeParse（roleId/version 由列表派生，TS 类型保证；unsetParentInputSchema 校验冗余） | roleId/version 由列表派生 | AC-F5-1 |
| F6 查看继承链按钮 | **类型派生操作**（roleId 从列表派生） | 不调 safeParse（GET 只读） | roleId 由列表派生 | AC-F6-1 |
| F7 查看有效权限按钮 | **类型派生操作**（userId 从 UserListPage 行派生，TS 类型保证 uuid） | 不调 safeParse（GET 只读，userId 由行派生） | userId 由行派生 | AC-F7-1 |

> **R13 S-1 注**：调岗表单为"混合表单"（userId 自由文本 + 3 select），整体 `transferInputSchema.safeParse` 覆盖自由文本 uuid 校验 + superRefine + .strict()，对齐 R15 NotificationForm 混合表单模式（整体 safeParse 覆盖 title/content/recipient_id）；select 值虽经 SSOT options 派生保证合法（类型派生），但整体 safeParse 仍跑（防御性 + superRefine 必须经 schema 跑）。SetParentModal 同理（parentRoleId select + 整体 safeParse 覆盖 superRefine）。F5/F6/F7 为纯类型派生操作（roleId/userId/version 经 TS 类型派生），不调 safeParse；若 impl 不调须显式标注 [约束] 偏离 + 反向同步 Spec §3.2（R13 S-1）。

### 新增 api 模块设计（对齐 R12 api/users.ts / R14 api/roles.ts / R15 api/notifications.ts 风格，R14 S-8 命名须对齐 Spec §4.2）

- `apps/web/src/api/transfer.ts`：
  - `transferUser(input: TransferInput): Promise<void>` → POST /v1/users/:userId/transfer（**非 versioned** 不传 If-Match，T4；body={toDepartmentId, oldRoleId, newRoleId}，userId 在 path；事务性单端点；返回 void 或 200 + body，前端按 204/200 统一处理）
  - **注**：transfer 端点非 versioned 非 cacheable，无重试逻辑（事务失败抛 TRANSFER_FAILED 由调用方处理）；401 拦截复用 R12 D8。
- `apps/web/src/api/role-inheritance.ts`：
  - `setRoleParent(roleId: string, parentRoleId: string, expectedVersion: number): Promise<Role>` → POST /v1/roles/:roleId/parent（versioned=true，If-Match=expectedVersion，T3；body={parentRoleId}；409 VERSION_CONFLICT 由 client D9 自动重试 1 次；409 ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试抛 ApiError）
  - `unsetRoleParent(roleId: string, expectedVersion: number): Promise<Role>` → DELETE /v1/roles/:roleId/parent（versioned=true，If-Match=expectedVersion；409 VERSION_CONFLICT 由 client D9 自动重试 1 次）
  - `getInheritanceChain(roleId: string): Promise<InheritanceChainResult>` → GET /v1/roles/:roleId/inheritance-chain（T3 非 cacheable，不发 If-None-Match；返回 Role[] 裸数组）
  - `getEffectivePermissions(userId: string): Promise<EffectivePermissionsResult>` → GET /v1/users/:userId/effective-permissions（T3 非 cacheable；返回 PermissionCode[] 裸数组）
  - **注**：4 端点命名对齐 Spec §4.2 声明（R14 S-8 教训闭合）；versioned 端点 setRoleParent/unsetRoleParent 复用 R12 D9 重试 + R14 D7 DELETE 重试幂等模式（DELETE 409 表示未删除，重试语义安全）；非 versioned GET 端点无重试。

### PII / 敏感字段清单（安全域标注）

| 字段 | 来源 | 敏感等级 | 前端处理 |
|------|------|----------|----------|
| 调岗 `userId`/`toDepartmentId`/`oldRoleId`/`newRoleId` | transfer 域 | 低（uuid 引用，**非 PII**，contracts 注释明示"字段均为 uuid 引用各自域实体 id"） | 展示/输入用，无特殊处理 |
| 角色继承 `roleId`/`parentRoleId` | role-inheritance 域 | 低（uuid 引用，**非 PII**） | 展示/输入用，无特殊处理 |
| `Role` 实体 name/description/permission_codes/is_builtin/parent_role_id/version | role.ts | 低（业务标识/描述/权限码/状态/版本，**非 PII**） | 展示用 |
| `PermissionCode` 权限码集合 | role.ts | 低（权限码枚举，**非 PII**，contracts 注释明示"effective-permissions 返回权限码集合"） | 展示用 + 中文化映射 |
| `token` | R12 沿用 | 高 | 沿用 R12 D12（localStorage，禁止 console.log） |

> transfer / role-inheritance 域**无 PII 字段**（contracts 明示均为 uuid 引用 + 权限码集合）。R16 不引入新的 PII 处理面，SEC-003b 不延伸（无脱敏态/存储态区分）。transfer/role-inheritance 域须确认 `transfer:write`/`role:write` 权限由后端 SEC-002 强制（前端不预判权限，依赖后端 FORBIDDEN 返回时显示"无权限"）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

> 全部 AC 须可被前端测试覆盖（Vitest + Testing Library，Q9 决策①对齐 R12 Q8② / R14 Q12① / R15 Q9①）。AC 编号对齐功能点 F1~F10 + ARCH-003 合规专项 + R13 S-1 合规专项。
> **R13 S-3 固化**：每条 AC 标注覆盖它的测试文件（T#）+ 用例号占位（由 test-writer 阶段最终确认），未覆盖显式列 reason。覆盖矩阵汇总见本节末。
> **R13 S-1 固化**：AC 措辞精确区分"混合表单（须 safeParse 覆盖 superRefine）"与"类型派生操作（TS 类型保证，safeParse 冗余）"。
> **R14 S-9 教训**：调岗表单 userId 文本输入 + effective-permissions 入口须"提交"按钮触发请求（不可每键入触发，本轮均为表单提交按钮原子提交，无 debounce 需求）。
> **R14 S-10 教训**：aria-label 须域特定（TransferForm "用户 ID"/"目标部门"/"原角色"/"新角色"、SetParentModal "父角色"、InheritanceChainPanel "继承链"、EffectivePermissionsPanel "有效权限"）。
> **R15 S-13 教训**：测试 fixture 须符合 contracts schema 严格校验（UUID 用有效 hex 字符 0-9a-f，避免 safeParse 失败导致测试永不调用实现）。
> **R15 S-14 教训**：组件 label/aria-label 须跨组件唯一，避免 getByLabelText/getByText 部分匹配冲突（TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel 不与 RoleListPage/UserListPage 既有 label 冲突）。

### F1 调岗表单（混合表单，R13 S-1，T4 非 versioned）

- **AC-F1-1 表单字段渲染**：GIVEN 已登录访问 /transfer / THEN TransferForm 渲染 4 字段控件——userId 自由文本输入（aria-label="用户 ID"，R14 S-10）+ toDepartmentId select（aria-label="目标部门"，options 从 getDepartmentTree 派生）+ oldRoleId select（aria-label="原角色"，options 从 listUserRoles(userId) 派生，userId 未输入时为空）+ newRoleId select（aria-label="新角色"，options 从 listRoles 派生）+ "提交"按钮（aria-label="提交调岗"）。覆盖：T3 [test-writer 定号]
- **AC-F1-2 userId 输入触发 listUserRoles 加载 oldRoleId 选项**（Q2 决策②）：GIVEN 输入合法 userId（uuid 格式）/ WHEN userId 失焦或输入完整 uuid / THEN 调 GET /v1/users/:userId/roles 取用户已分配角色，oldRoleId select options 填充为该用户已分配角色集合（前端防 TRANSFER_OLD_ROLE_NOT_ASSIGNED）；userId 非法（非 uuid）→ oldRoleId select 保持空 + userId 字段级错误（AC-F2-2）。覆盖：T3、T1（API client 契约）
- **AC-F1-3 提交调岗成功**（T4 非 versioned）：GIVEN 4 字段均合法（userId uuid + oldRoleId !== newRoleId + 各 id 存在）/ WHEN 点击"提交调岗" / THEN `transferInputSchema.safeParse` 通过，调 POST /v1/users/:userId/transfer（**不传 If-Match**，T4 非 versioned；body={toDepartmentId, oldRoleId, newRoleId}），后端事务性执行成功，前端显示"调岗成功"提示 + 刷新当前页（Q3 决策①）。覆盖：T3、T1
- **AC-F1-4 提交按钮禁用**：GIVEN 任意字段未填（userId 空 / oldRoleId 空 / newRoleId 空 / toDepartmentId 空）/ THEN "提交调岗"按钮 disabled，不发请求。覆盖：T3

### F2 调岗校验（混合表单，须 safeParse，R13 S-1，T4 superRefine）

- **AC-F2-1 safeParse 整体校验通过**：GIVEN 4 字段均合法 + oldRoleId !== newRoleId / WHEN 提交 / THEN `transferInputSchema.safeParse` 通过（.strict() 不拒绝合法字段 + superRefine 不触发），调 POST /transfer。覆盖：T3
- **AC-F2-2 userId 非 uuid 字段级错误**（自由文本，须 safeParse）：GIVEN userId 非 uuid 格式（如 "abc"）/ WHEN 提交 / THEN `transferInputSchema.safeParse` 拦截（z.string().uuid()），userId 字段显示"用户 ID 须为 UUID 格式"，不发请求。覆盖：T3
- **AC-F2-3 superRefine oldRoleId === newRoleId 字段级错误**（T4 superRefine path=['newRoleId']）：GIVEN oldRoleId === newRoleId（用户在 newRoleId select 选了与 oldRoleId 相同的角色）/ WHEN 提交 / THEN `transferInputSchema.safeParse` 拦截（superRefine 触发，issue path=['newRoleId']），newRoleId 字段显示"新角色不能与原角色相同"（对应 TRANSFER_SAME_ROLE，T1），不发请求。覆盖：T3、T9（superRefine path 断言）
- **AC-F2-4 .strict() 拒绝多余字段**（防御性）：GIVEN 提交体含多余字段（如 status）/ THEN `transferInputSchema.safeParse` 拒绝（.strict()），显示"输入校验失败"，不发请求。覆盖：T3

### F3 调岗错误处理（T1 错误码 SSOT 核验，非臆造码）

- **AC-F3-1 USER_NOT_FOUND**：GIVEN userId 合法 uuid 但用户不存在 / WHEN 提交 / THEN 后端返回 USER_NOT_FOUND，前端 errorMapping 显示"用户不存在"（T1：复用 user 域既有码，非臆造 TRANSFER_USER_NOT_FOUND）。覆盖：T3、T9
- **AC-F3-2 DEPT_NOT_FOUND**：GIVEN toDepartmentId 合法 uuid 但部门不存在 / WHEN 提交 / THEN 后端返回 DEPT_NOT_FOUND，前端显示"部门不存在"（T1：复用 dept 域既有码）。覆盖：T3、T9
- **AC-F3-3 ROLE_NOT_FOUND**：GIVEN oldRoleId 或 newRoleId 合法 uuid 但角色不存在 / WHEN 提交 / THEN 后端返回 ROLE_NOT_FOUND，前端显示"角色不存在"（T1：复用 role 域既有码）。覆盖：T3、T9
- **AC-F3-4 ROLE_BUILTIN_FORBIDDEN**（oldRole 为内置角色）：GIVEN oldRoleId 为内置 admin 角色（is_builtin=true）/ WHEN 提交 / THEN 后端返回 ROLE_BUILTIN_FORBIDDEN，前端显示"内置角色不可删除"（T1：复用 role 域既有码，非臆造 TRANSFER_ROLE_BUILTIN_FORBIDDEN）。覆盖：T3、T9
- **AC-F3-5 TRANSFER_OLD_ROLE_NOT_ASSIGNED**（竞态，用户未持有 oldRole）：GIVEN 用户在 listUserRoles 加载后持有 oldRole，但提交前该角色被其他请求移除（竞态）/ WHEN 提交 / THEN 后端返回 TRANSFER_OLD_ROLE_NOT_ASSIGNED，前端显示"用户未持有原角色"（T1：transfer 专属码）。覆盖：T3、T9
- **AC-F3-6 TRANSFER_FAILED**（事务聚合失败，T1）：GIVEN 事务执行阶段失败（如 A 步移除 oldRole 成功 + B 步分配 newRole 失败 + 补偿回滚成功）/ WHEN 提交 / THEN 后端返回 TRANSFER_FAILED（聚合码，message 含失败步骤+底层原因），前端显示"调岗失败：<message>"（前端展示后端 message 含失败步骤+原因，T1）。覆盖：T3、T9
- **AC-F3-7 TRANSFER_SAME_ROLE 服务端兜底**：GIVEN 客户端 safeParse 未拦截（绕过前端直接调 API）+ oldRoleId === newRoleId / THEN 后端返回 TRANSFER_SAME_ROLE，前端 errorMapping 显示"新角色不能与原角色相同"（服务端兜底，T1）。覆盖：T9

### F4 角色设置父角色（POST /parent versioned，混合表单 superRefine，T2，T3 versioned）

- **AC-F4-1 设置父角色成功**（versioned + If-Match）：GIVEN 角色 role.version=N + 选定 parentRoleId（非自继承 + 非内置 admin）/ WHEN 点击"设置父角色"提交 / THEN `setParentInputSchema.safeParse` 通过（superRefine roleId !== parentRoleId），调 POST /v1/roles/:roleId/parent + If-Match: N（T3 versioned=true），返回 Role（parent_role_id=parentRoleId, version=N+1），弹窗关闭，RoleListPage 刷新。覆盖：T4、T1
- **AC-F4-2 自继承 superRefine 字段级错误**（T2，superRefine）：GIVEN parentRoleId === roleId（用户在 SetParentModal select 选了自己）/ WHEN 提交 / THEN `setParentInputSchema.safeParse` 拦截（superRefine 触发，message "parentRoleId 不能等于 roleId（自继承禁止）"），parentRoleId 字段显示"不能继承自身"（对应 ROLE_SELF_INHERITANCE，T2），不发请求。覆盖：T4、T9
- **AC-F4-3 内置 admin 父角色前端禁用 + 服务端兜底**：GIVEN SetParentModal parentRoleId select 选项中内置 admin 角色 disabled（前端防 ROLE_BUILTIN_PARENT_FORBIDDEN）；若绕过前端直接调 API 选 admin 作父 / THEN 后端返回 ROLE_BUILTIN_PARENT_FORBIDDEN，前端显示"内置角色不可设为父角色"（T2）。覆盖：T4、T9
- **AC-F4-4 ROLE_INHERITANCE_CYCLE**（环检测，T2）：GIVEN parentRoleId 选择会形成环（如 A→B→A，B 已是 A 的父角色，现 A 设 B 为父）/ WHEN 提交 / THEN 后端返回 ROLE_INHERITANCE_CYCLE（message 含环路径 A→B→A），前端显示"会形成继承环"（T2，前端 errorMapping 映射 ROLE_INHERITANCE_CYCLE → "会形成继承环"）。覆盖：T4、T9
- **AC-F4-5 VERSION_CONFLICT 自动重试**：GIVEN 列表 role.version=N 但实际已变 N+1 / WHEN POST /parent 返回 409 VERSION_CONFLICT（含 current_version=N+1）/ THEN API client 自动用 current_version=N+1 重试 POST /parent 一次（复用 R12 D9，不 GET 单条），成功后弹窗关闭 + RoleListPage 刷新。覆盖：T1（API client 契约）、T4
- **AC-F4-6 重试仍冲突提示**：GIVEN 重试后仍返回 409 / THEN 显示"数据已被修改，请刷新后重试"（沿用 R12 AC-F4-4），不无限重试（仅 1 次）。覆盖：T1、T4
- **AC-F4-7 ROLE_NOT_FOUND**：GIVEN roleId 或 parentRoleId 合法 uuid 但角色不存在（竞态，角色被其他请求删除）/ WHEN 提交 / THEN 后端返回 ROLE_NOT_FOUND，前端显示"角色不存在"（T2：复用 role 域既有码）。覆盖：T4、T9

### F5 角色解除父角色（DELETE /parent versioned，类型派生操作，R13 S-1，T3 versioned）

- **AC-F5-1 解除父角色成功**（类型派生操作，roleId/version 从列表派生，不调 safeParse）：GIVEN 角色 parent_role_id !== null（非根角色，"解除父角色"按钮显示）+ role.version=N / WHEN 点击"解除父角色" / THEN 调 DELETE /v1/roles/:roleId/parent + If-Match: N（T3 versioned=true），返回 Role（parent_role_id=null, version=N+1，变回根角色），RoleListPage 刷新。覆盖：T2、T1
- **AC-F5-2 根角色不显示解除按钮**：GIVEN 角色 parent_role_id === null（根角色）/ THEN "解除父角色"按钮不显示（Q5 决策①行操作扩展，按 parent_role_id 条件渲染）。覆盖：T2
- **AC-F5-3 VERSION_CONFLICT 自动重试**：GIVEN 列表 role.version=N 但实际 N+1 / WHEN DELETE /parent 返回 409 VERSION_CONFLICT / THEN API client 自动用 current_version=N+1 重试 DELETE /parent 一次（复用 R12 D9，DELETE 重试幂等——409 表示未删除），成功后 RoleListPage 刷新。覆盖：T1、T2
- **AC-F5-4 ROLE_NOT_FOUND**：GIVEN roleId 合法 uuid 但角色已被其他请求删除 / WHEN 解除 / THEN 后端返回 ROLE_NOT_FOUND，前端显示"角色不存在"，RoleListPage 刷新移除该行（沿用 R14 RoleListPage handleDelete 的 ROLE_NOT_FOUND → refresh 模式）。覆盖：T2、T9

### F6 角色继承链查看（GET /inheritance-chain，cacheable=false，T3，Q6 链形文本）

- **AC-F6-1 继承链查看-有父角色**（类型派生操作，roleId 从列表派生，不调 safeParse；T3 非 cacheable）：GIVEN 角色 role.parent_role_id !== null / WHEN 点击"查看继承链" / THEN 调 GET /v1/roles/:roleId/inheritance-chain（**不发 If-None-Match**，T3 非 cacheable），返回 Role[] 祖先数组（如 [父角色 B, 祖父角色 C]），InheritanceChainPanel 链形文本渲染"角色 A → 父角色 B → 祖父角色 C"（Q6 决策①）。覆盖：T2、T5
- **AC-F6-2 继承链查看-根角色空数组**：GIVEN 角色 parent_role_id === null（根角色）/ WHEN 点击"查看继承链" / THEN 调 GET 返回 [] 空数组，InheritanceChainPanel 显示"无父角色"（D7 / AC-F2-3，根角色返回 []）。覆盖：T2、T5
- **AC-F6-3 继承链渲染-多级祖先**：GIVEN 继承链 [B, C, D]（3 级祖先）/ THEN 链形文本"角色 A → 父角色 B → 祖父角色 C → 曾祖父角色 D"（" → " 分隔，按返回顺序）。覆盖：T5
- **AC-F6-4 ROLE_NOT_FOUND**：GIVEN roleId 合法 uuid 但角色已被删除 / WHEN 查看继承链 / THEN 后端返回 ROLE_NOT_FOUND，前端显示"角色不存在"。覆盖：T2、T9

### F7 用户有效权限查看（GET /effective-permissions，cacheable=false，T3，Q7 UserListPage 行操作）

- **AC-F7-1 有效权限查看-有权限**（类型派生操作，userId 从 UserListPage 行派生，不调 safeParse；T3 非 cacheable）：GIVEN 用户有有效权限 / WHEN 点击 UserListPage 行"有效权限"按钮 / THEN 调 GET /v1/users/:userId/effective-permissions（**不发 If-None-Match**，T3 非 cacheable），返回 PermissionCode[] 集合（如 ['user:read', 'role:read', 'transfer:write']），EffectivePermissionsPanel 渲染权限码列表 + 中文化映射（user:read→"查看用户"、role:read→"查看角色"、transfer:write→"调岗用户"）。覆盖：T6、T5
- **AC-F7-2 有效权限查看-空集合**：GIVEN 用户无角色或角色无权限码 / THEN GET 返回 [] 空数组，EffectivePermissionsPanel 显示"该用户暂无有效权限"。覆盖：T6、T5
- **AC-F7-3 权限码中文化映射 SSOT 派生**：GIVEN 权限码集合 / THEN 中文化映射表键从 `[...permissionCodeSchema.options]` SSOT 派生（11 项全集，AI-005，禁止硬编码）；中文化映射为纯 UI 文案（R13 S-2 不须同步 Spec §10 但须 Review 报告记录）。覆盖：T6、T9（SSOT 派生断言）
- **AC-F7-4 USER_NOT_FOUND**：GIVEN userId 合法 uuid 但用户已被删除 / WHEN 查看有效权限 / THEN 后端返回 USER_NOT_FOUND，前端显示"用户不存在"。覆盖：T6、T9

### F8 导航扩展

- **AC-F8-1 侧边栏 7 入口**：GIVEN 已登录任意受保护页 / THEN 侧边栏展示"用户/角色/部门/审计/通知/报表/调岗"7 个入口 + "登出"按钮（Q8 决策①侧边栏沿用，R15 6 入口扩展为 7 入口；角色继承管理嵌入 RoleListPage 不新增独立入口）。覆盖：T7（扩展 R15 navigation.test.tsx，①类显式影响）
- **AC-F8-2 调岗入口可达**：GIVEN 点击侧边栏"调岗" / THEN 跳转 /transfer 并渲染 TransferPage（含 TransferForm）。覆盖：T7
- **AC-F8-3 路由守卫覆盖新页**：GIVEN 未登录 / WHEN 访问 /transfer / THEN RouteGuard 跳转 /login（复用 R12 D13 白名单仅 /login）。覆盖：T7

### F9 错误处理

- **AC-F9-1 错误码映射扩展-transfer 域**：GIVEN TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED/TRANSFER_COMPENSATION_FAILED / THEN errorMapping 输出对应中文（"新角色不能与原角色相同"/"用户未持有原角色"/"调岗失败"/"调岗补偿失败，请联系运维"）。覆盖：T9
- **AC-F9-2 错误码映射扩展-继承域**：GIVEN ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN / THEN errorMapping 输出对应中文（"不能继承自身"/"内置角色不可设为父角色"/"会形成继承环"/"角色仍有子角色，请先解除子角色继承"）。覆盖：T9
- **AC-F9-3 SSOT 派生 + 全码映射收尾 + R14 S-11 同步注释 + 401/网络错误复用**：GIVEN errorMapping 映射表 / THEN 键从 `[...errorCodeSchema.options]` SSOT 派生（沿用 R12 D11），R16 扩展后 errorCodeSchema 全集所有码均映射具体中文提示，FALLBACK 仅作"未来新增码兜底"；扩展 SPECIFIC_MESSAGES 时**同步移除 R15 D9 注释"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"**（R14 S-11 教训闭合收尾，注释须反映扩展后无已知域保持 FALLBACK）。GIVEN 任意新页面请求返回 401（鉴权类 4 码）/ THEN API client 沿用 R12 D8 拦截跳 /login；GIVEN fetch 抛错 / THEN 沿用 R12 AC-F7-3 显示"网络异常，请稍后重试"。覆盖：T9、T1（沿用 R12/R14/R15 api-client 测）

### F10 前端基础设施复用 + ARCH-003 合规专项

- **AC-F10-1 API client 复用**：GIVEN 任意新页面 HTTP 调用 / THEN 经 R12 `apps/web/src/api/client.ts` 的 request() 发出，不直接调 fetch。覆盖：T1/T2
- **AC-F10-2 Bearer/If-Match 注入复用**：GIVEN 已登录 + versioned 写（POST /parent / DELETE /parent）/ THEN 请求头含 `Authorization: Bearer <token>`（R12 D6）+ `If-Match: <version>`（R12 D7，T3 versioned）；GIVEN 调岗 POST /transfer（T4 非 versioned）/ THEN 请求头含 Authorization 但**不含 If-Match**（非 versioned，T4）。覆盖：T1
- **AC-F10-3 零新依赖**：GIVEN apps/web/package.json / THEN 本轮无新增 dependencies/devDependencies（沿用 R12/R14/R15 依赖清单）。覆盖：T7（或工程核验，由 test-writer 定）
- **AC-ARCH-1 新增模块不直连后端**：GIVEN apps/web/src 新增文件（api/transfer.ts、api/role-inheritance.ts、pages/TransferPage.tsx、components/TransferForm.tsx、components/SetParentModal.tsx、components/InheritanceChainPanel.tsx、components/EffectivePermissionsPanel.tsx）+ 扩展文件（components/Sidebar.tsx、App.tsx、lib/errorMapping.ts、pages/RoleListPage.tsx、pages/UserListPage.tsx）/ THEN 无任何 import 指向 apps/api/src/**（repository/service/domain/router）或 @admin/api 包（ARCH-003，R12 check-rules.mjs 分支自动覆盖新增文件）。覆盖：T7（lint:rules 探针 + Reviewer 逐文件）
- **AC-ARCH-2 类型来自 contracts**：GIVEN 新增模块 / THEN 数据类型（TransferInput/SetParentInput/UnsetParentInput/InheritanceChainResult/EffectivePermissionsResult/Role/PermissionCode/ErrorCode 等）import 自 @admin/contracts，无手写 TS 类型副本。覆盖：T7（tsc + Reviewer）
- **AC-ARCH-3 客户端校验复用契约 schema（混合表单）**：GIVEN 调岗表单（userId 自由文本 + 3 select 混合）+ SetParentModal（parentRoleId select + roleId 派生）/ THEN 复用 transferInputSchema / setParentInputSchema 的 .safeParse()（SSOT 派生，AI-005，覆盖 superRefine + .strict()）。覆盖：T3、T4

### R13 S-1 合规专项

- **AC-S1-1 混合表单须 safeParse 覆盖 superRefine**：GIVEN F1/F2 调岗表单（userId 自由文本 + oldRoleId/newRoleId/toDepartmentId select 混合）+ F4 SetParentModal（parentRoleId select + roleId 派生混合）/ THEN 提交前调 transferInputSchema.safeParse / setParentInputSchema.safeParse（覆盖 superRefine oldRoleId !== newRoleId / roleId !== parentRoleId + .strict() 拒绝多余字段 + uuid 格式校验），失败显示字段级错误不发请求。覆盖：T3、T4
- **AC-S1-2 类型派生操作 TS 类型保证**：GIVEN F5 解除父角色按钮 + F6 查看继承链按钮 + F7 查看有效权限按钮（roleId/userId/version 从列表派生）/ THEN 值经 TS 类型派生（roleId/userId 为 uuid 字面量、version 为 number 字面量），无自由输入；safeParse 冗余可省略或保留 defensive。覆盖：T2、T6

### AC↔测试用例覆盖矩阵（R13 S-3 固化）

> 测试文件编号（T#）为本 PRD 预估，**最终用例号由 test-writer 阶段确认**（R13 S-3，R14 S-12 测试文件数是预估 test-writer 可调整须 AI-006 反向核实）。test-writer 须自检每条 AC 至少 1 个用例覆盖，未覆盖显式列 reason。

| AC | 覆盖测试文件 | 用例号（test-writer 定） | 备注 |
|----|-------------|------------------------|------|
| AC-F1-1~F1-4 | T3 transfer-form.test.tsx | 待定 | F1-2 userId 输入触发 listUserRoles 跨 T1+T3 |
| AC-F2-1~F2-4 | T3 transfer-form.test.tsx | 待定 | F2-3 superRefine path=['newRoleId'] 字段级错误跨 T9 |
| AC-F3-1~F3-7 | T3 transfer-form.test.tsx + T9 error-mapping-extend-3.test.ts | 待定 | F3-1~F3-7 各错误码跨 T3+T9，F3-6 TRANSFER_FAILED message 含失败步骤 |
| AC-F4-1~F4-7 | T4 set-parent-modal.test.tsx + T1 api-role-inheritance.test.ts | 待定 | F4-2 superRefine 自继承字段级跨 T9，F4-4 ROLE_INHERITANCE_CYCLE 跨 T4+T9，F4-5/F4-6 重试跨 T1+T4 |
| AC-F5-1~F5-4 | T2 role-list-page-extend.test.tsx + T1 | 待定 | F5-3 重试跨 T1+T2，F5-4 ROLE_NOT_FOUND → refresh 跨 T9 |
| AC-F6-1~F6-4 | T2 role-list-page-extend.test.tsx + T5 inheritance-chain-panel.test.tsx | 待定 | F6-1/F6-2/F6-3 链形文本渲染，F6-4 跨 T9 |
| AC-F7-1~F7-4 | T6 effective-permissions-panel.test.tsx + T5 | 待定 | F7-3 SSOT 派生断言跨 T9 |
| AC-F8-1~F8-3 | T7 navigation-extend-2.test.tsx（扩展 R15 navigation.test.tsx，①类显式影响） | 待定 | F8-3 沿用 R12 route-guard 测 |
| AC-F9-1~F9-3 | T9 error-mapping-extend-3.test.ts（扩展 R15 error-mapping-extend-2.test.ts，①类显式影响）+ T1 | 待定 | F9-3 R14 S-11 同步注释移除 + 401/网络错误沿用 |
| AC-F10-1~F10-3 | T1/T2 + T7 | 待定 | F10-3 工程核验 |
| AC-ARCH-1~ARCH-3 | T7 + lint:rules 探针 + Reviewer 逐文件 | 待定 | ARCH-3 跨 T3/T4 |
| AC-S1-1~S1-2 | T3/T4/T2/T6 | 待定 | R13 S-1 合规 |

**预估测试文件清单**（③类新增 + ①类显式影响扩展，对齐 R15 §9.3 风格 + R14 S-12 测试文件数预估可调整）：
1. `apps/web/test/api-transfer.test.ts`（T1，③类新增）—— 调岗 API client 契约（transferUser POST /transfer 非 versioned 不传 If-Match + body 字段 + 各错误码映射）
2. `apps/web/test/api-role-inheritance.test.ts`（T1，③类新增）—— 角色继承 API client 契约（setRoleParent/unsetRoleParent versioned + If-Match + 409 重试 + ROLE_INHERITANCE_CYCLE/ROLE_BUILTIN_PARENT_FORBIDDEN 不重试 + getInheritanceChain/getEffectivePermissions GET 非 cacheable 不发 If-None-Match + 裸数组响应）
3. `apps/web/test/transfer-form.test.tsx`（T3，③类新增）—— 调岗混合表单 safeParse 校验（userId uuid + superRefine oldRoleId === newRoleId 字段级 + .strict()）+ listUserRoles 加载 oldRoleId 选项 + 各错误码（USER_NOT_FOUND/DEPT_NOT_FOUND/ROLE_NOT_FOUND/ROLE_BUILTIN_FORBIDDEN/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED）组件测
4. `apps/web/test/set-parent-modal.test.tsx`（T4，③类新增）—— SetParentModal 弹窗（parentRoleId select 派生 + 禁用自继承+内置 admin + superRefine 字段级 + ROLE_INHERITANCE_CYCLE 提示"会形成继承环" + VERSION_CONFLICT 重试）组件测
5. `apps/web/test/role-list-page-extend.test.tsx`（T2，**①类显式影响**扩展 R14 role-list-page.test.tsx 或新增文件）—— RoleListPage 行操作扩展（设置/解除父角色 + 查看继承链按钮 + 按 parent_role_id 条件渲染解除按钮 + ROLE_NOT_FOUND → refresh）组件测
6. `apps/web/test/effective-permissions-panel.test.tsx`（T6，③类新增）—— EffectivePermissionsPanel（GET effective-permissions + 权限码集合渲染 + 中文化映射 SSOT 派生 + 空集合"该用户暂无有效权限" + USER_NOT_FOUND）组件测
7. `apps/web/test/inheritance-chain-panel.test.tsx`（T5，③类新增）—— InheritanceChainPanel（GET inheritance-chain + 链形文本渲染 + 根角色空数组"无父角色" + 多级祖先 + ROLE_NOT_FOUND）组件测
8. `apps/web/test/navigation-extend-2.test.tsx`（T7，**①类显式影响**扩展 R15 navigation.test.tsx 或新增文件）—— 侧边栏 7 入口 + 路由守卫 /transfer
9. `apps/web/test/error-mapping-extend-3.test.ts`（T9，**①类显式影响**扩展 R15 error-mapping-extend-2.test.ts 或新增文件）—— transfer/inheritance 错误码映射 + SSOT 派生断言 + R14 S-11 同步注释移除"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"

> test-writer 须做 AC 覆盖矩阵自检（R13 S-3）：每条 AC 至少 1 用例覆盖，未覆盖显式列 reason；组合场景（AC-F1-2 userId 输入触发 listUserRoles、AC-F3-6 TRANSFER_FAILED message 含失败步骤、AC-F4-5/F5-3 重试+刷新）须单独测。test-writer 可据覆盖质量调整测试文件数（R14 S-12），须 AI-006 反向核实注明理由 + Reviewer 判定合理性。
> **R15 S-13 教训**：测试 fixture 须用有效 hex UUID（如 `00000000-0000-4000-8000-000000000001`），避免 z.string().uuid() 严格校验拒绝非 hex 字符导致 safeParse 失败测试永不调用实现。
> **R15 S-14 教训**：组件 label/aria-label 跨组件唯一——TransferForm/SetParentModal/InheritanceChainPanel/EffectivePermissionsPanel 不与 RoleListPage/UserListPage 既有 label 冲突（如 RoleListPage 有"角色名称"label，SetParentModal 须用"父角色"消歧）。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · 调岗表单 UI 形态？**
BLOCKING（影响 F1 / AC-F1-1 / 组件设计 / 路由）。方案①独立页（路由 /transfer，TransferPage 含 TransferForm，对齐 R14 DeptTreePage 独立路由风格）；方案②弹窗（modal，从 UserListPage 行操作"调岗"触发）；方案③抽屉（drawer，从 UserListPage 行操作触发）。本期选哪个？推荐①（调岗为独立业务流程非用户详情子操作，独立页有清晰入口 + 历史可回溯 + 表单字段多——4 字段 + userId 输入触发 listUserSources 加载 oldRoleId 选项，独立页空间充足；弹窗在 UserListPage 行操作触发耦合用户列表 + 表单字段多弹窗拥挤；抽屉同弹窗问题。R14 DeptTreePage 独立页范例验证独立页模式可行）。**阻塞下游：Tech-Spec §6 TransferPage/TransferForm 设计（独立页 + 路由 /transfer）、impl App.tsx 路由扩展 + Sidebar 扩展（6→7 入口）+ TransferPage + TransferForm、test F1/F8 用例。**

**Q2 · 调岗 userId/toDepartmentId/oldRoleId/newRoleId 输入形态？**
BLOCKING（影响 F1/F2 / AC-F1-1/F1-2/F2-1~F2-4 / R13 S-1 分类 / 表单设计）。contract 核验（T4）：transferInputSchema 4 字段均为 uuid，superRefine oldRoleId !== newRoleId。方案①全自由文本 UUID 输入（4 字段都 safeParse uuid，最简，UX 差，用户须 copy-paste UUID）；方案②选择器混合（userId 自由文本 UUID safeParse + oldRoleId/newRoleId/toDepartmentId select，oldRoleId 先 listUserRoles 取用户已分配角色，newRoleId 从 listRoles 派生，toDepartmentId 从 getDepartmentTree 派生）；方案③全选择器（userId 也用 select，须全量加载用户列表，超 R16 范围且 UX 在大量用户下差）。本期选哪个？推荐②（userId 自由文本 UUID 对齐 R15 Q4① recipient_id 模式（用户可能多，select 全量不友好，free UUID + safeParse uuid 格式校验足够）；oldRoleId/newRoleId/toDepartmentId 为有限集合（角色通常 < 100、部门树通常 < 100），select 友好——oldRoleId 先 listUserRoles 取用户已分配角色确保前端防 TRANSFER_OLD_ROLE_NOT_ASSIGNED（用户只能选已持有的角色），newRoleId 从 listRoles 派生（前端可在 select 中禁用 oldRoleId 选项防 TRANSFER_SAME_ROLE，但 superRefine 兜底），toDepartmentId 从 getDepartmentTree 派生（部门树扁平化为 select options）；混合表单整体 safeParse 覆盖 superRefine + .strict()，R13 S-1 区分自由文本 userId vs 类型派生 select；方案① UX 差须 copy-paste 4 个 UUID；方案③全 select 须全量加载用户列表超 R16 范围）。**阻塞下游：Tech-Spec §3.2 表单校验分类（混合表单整体 safeParse）、impl TransferForm 4 字段控件 + listUserRoles 联动 oldRoleId 选项、test F1-1/F1-2/F2-1~F2-4。**

**Q3 · 调岗成功后行为？**
BLOCKING（影响 F1 / AC-F1-3 / UX）。方案①提示 + 刷新当前页（显示"调岗成功"toast/banner + TransferForm 重置，对齐 R14 删除角色成功 refresh 模式）；方案②跳转用户详情（须 GET /v1/users/:id 详情页，R14 Q9 决策②不消费 GET /:id，超范围）；方案③跳转调岗历史（须调岗历史端点，Q4 决策①不做调岗历史）。本期选哪个？推荐①（对齐 R14 删除角色成功 refresh 模式——R14 RoleListPage handleDelete 成功后 refresh()，调岗成功后刷新当前 TransferForm 重置 + 提示，让用户继续调岗下一个用户；方案②须 GET /:id R14 Q9 决策②不消费；方案③须调岗历史 Q4 决策①不做）。**阻塞下游：impl TransferForm 提交成功后 reset + 提示、test F1-3。**

**Q4 · 调岗是否做"调岗历史"？**
BLOCKING（影响 F1 / 数据实体 / 路由）。contract 核验：后端无专用"调岗历史"端点；audit-logs（GET /v1/audit-logs）entity_type 枚举为 `user/role/dept/notification/auth`（audit.ts L23），**无 "transfer" 实体类型**——调岗操作日志记录在 entity_type=user + action=update（与 user status update 混淆，无法按 entity_type 筛选调岗）。方案①不做调岗历史（无专用端点，audit-logs 无 transfer 实体类型，从 audit-logs 筛选语义模糊，超 R16 范围）；方案②从 audit-logs 按 entity_type=user + action=update 筛选（语义模糊，与 user status update 混淆，UX 差）；方案③待后端补端点（超 R16 范围，本轮不实现后端任何改动）。本期选哪个？推荐①（契约核验确认无 transfer 实体类型 + 无专用端点，方案②从 audit-logs 筛选语义模糊无法区分调岗与 status update，方案③超 R16 范围；调岗历史为未来后端补"GET /v1/audit-logs?entity_type=transfer"或"GET /v1/users/:userId/transfer-history"端点后的方向，本轮 Out of scope）。**阻塞下游：PRD 不含调岗历史功能点、Tech-Spec 不设计调岗历史 API client、impl 不实现调岗历史页、test 不覆盖调岗历史。**

**Q5 · 角色继承管理嵌入位置？**
BLOCKING（影响 F4/F5/F6 / 组件设计 / 路由）。方案①RoleListPage 行操作扩展（在既有 RoleListPage 每行加"设置父角色"/"解除父角色"/"查看继承链"按钮，复用既有列表）；方案②独立 RoleInheritancePage（新增路由 /role-inheritance，独立页管理继承）；方案③RoleDetailPanel（须 GET /v1/roles/:id 详情面板，R14 Q9 决策②不消费 GET /:id，超范围）。本期选哪个？推荐①（R14 RoleListPage 已存在且功能聚焦角色列表/创建/删除，行操作扩展继承管理是自然延伸——每行加 3 按钮即可，复用既有列表分页/搜索/删除逻辑；独立页须新增路由 + 重复列表逻辑；RoleDetailPanel 须 GET /:id R14 Q9 决策②不消费超范围；R14 RoleListPage 行操作已有"删除"按钮，加 3 按钮布局一致）。**阻塞下游：Tech-Spec §6 RoleListPage 行操作扩展设计、impl RoleListPage 扩展 3 按钮 + SetParentModal/InheritanceChainPanel 触发、test F4/F5/F6 用例。**

**Q6 · 角色继承链展示形态？**
BLOCKING（影响 F6 / AC-F6-1~F6-3 / InheritanceChainPanel 设计）。contract 核验（role-inheritance.ts）：inheritanceChainResultSchema = `Role[]` 祖先数组（从直接父角色到根角色，按继承顺序；根角色返回 []，D7）。方案①链形文本（"角色 A → 父角色 B → 祖父角色 C"，线性展示，" → " 分隔）；方案②树形（递归树渲染，但继承链为单继承线性结构，非多分支树，过度渲染）；方案③面包屑（"首页 / 角色 A / 父角色 B"，但面包屑语义偏导航，继承链非导航）。本期选哪个？推荐①（继承链为单继承线性结构——每个角色最多一个父角色，链形文本是最自然的展示，" → " 分隔按返回顺序；根角色返回 [] 显示"无父角色"；树形过度渲染（单继承非多分支），面包屑语义偏导航不适用；链形文本实现简单 + 可读性好）。**阻塞下游：impl InheritanceChainPanel 链形文本渲染、test F6-1/F6-2/F6-3。**

**Q7 · 用户有效权限查看入口位置？**
BLOCKING（影响 F7 / AC-F7-1 / 组件设计 / UX）。方案①UserRolesPanel 扩展（在 R14 UserRolesPanel 加"查看有效权限"按钮，userId 已知从 UserListPage 行）；方案②独立 EffectivePermissionsPanel + 路由（新增 /effective-permissions?userId=xxx，userId 自由文本输入）；方案③UserListPage 行操作扩展（每行加"有效权限"按钮触发 EffectivePermissionsPanel modal）。本期选哪个？推荐③（UserListPage 行操作直接触发 EffectivePermissionsPanel modal——userId 从行派生 TS 类型保证（R13 S-1 类型派生操作），无须用户输入 UUID，UX 最佳；与 R14 UserRolesPanel 同为 UserListPage 行操作触发 modal 模式一致；方案① UserRolesPanel 扩展会膨胀面板职责（角色分配 + 有效权限两职责混合），违反单一职责；方案②独立路由须用户输入 UUID UX 差且须新增路由）。**阻塞下游：Tech-Spec §6 UserListPage 行操作扩展 + EffectivePermissionsPanel modal 设计、impl UserListPage 扩展"有效权限"按钮 + EffectivePermissionsPanel、test F7 用例。**

**Q8 · 角色设置父角色 UI 形态？**
BLOCKING（影响 F4 / AC-F4-1 / 组件设计 / Q5 配套）。本 Q 与 Q5 配套——Q5 决策嵌入位置（RoleListPage 行操作），Q8 决策 UI 形态（弹窗 vs 行内 select）。方案①弹窗选择父角色（SetParentModal，从 RoleListPage 行"设置父角色"按钮触发，parentRoleId select 从 listRoles 派生 + 禁用自继承 roleId + 禁用内置 admin）；方案②行内 select（RoleListPage 每行展开 select 选父角色）；方案③独立页（须 GET /:id 详情，R14 Q9 决策②不消费超范围）。本期选哪个？推荐①（对齐 R14 RoleForm modal 风格 + R15 NotificationForm modal 风格，前端一致；parentRoleId select 在弹窗中空间充足 + 禁用项可视化清晰；行内 select 让列表过载且每行 select 交互复杂；独立页须 GET /:id 超范围；SetParentModal 复用 R14/R15 modal 模式，零新组件库）。**阻塞下游：Tech-Spec §6 SetParentModal 设计（modal + parentRoleId select + 禁用项 + superRefine 字段级）、impl SetParentModal、test F4 用例。**

**Q9 · 前端测试范围？**
BLOCKING（影响验收可测性 / 工作量）。方案①组件测 + API client 契约测，无 E2E（对齐 R12 Q8 决策② / R14 Q12 决策① / R15 Q9 决策①）；方案②组件测 + API client 契约测 + E2E（Playwright）；方案③仅组件测。本期选哪个？推荐①（对齐 R12/R14/R15 决策，组件测覆盖 UI 交互（TransferForm 混合表单 + SetParentModal + InheritanceChainPanel + EffectivePermissionsPanel），API client 契约测覆盖 endpoint 封装 + versioned/重试逻辑 + 错误码映射 + 非 versioned/cacheable 区分；E2E 引入 Playwright 重且慢，R12/R14/R15 已决策不引入，R16 沿用；后端 HTTP 层已在 R1-R15 端到端覆盖）。**阻塞下游：test-writer 测试矩阵（9 文件预估：6 新增 + 3 ①类显式影响扩展）、impl 测试实现。**

**Q10 · 错误码映射扩展？**
BLOCKING（影响 F9 / AC-F9-1~F9-3 / errorMapping 完整性 / R14 S-11 / R15 D9 注释闭合）。contract 核验（T1/T2）：transfer 域码 TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_COMPENSATION_FAILED/TRANSFER_FAILED + 继承域码 ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE/ROLE_HAS_CHILDREN 均在 errorCodeSchema 全集内（user.ts L180-195）。方案①扩展 SPECIFIC_MESSAGES 增加 transfer/inheritance 相关码中文提示 + 同步移除 R15 D9 注释"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（R14 S-11 教训闭合收尾，注释须反映扩展后无已知域保持 FALLBACK，仅"未来新增码兜底"）；方案②全部 FALLBACK（不单列具体提示）；方案③硬编码全集（违背 SSOT）。本期选哪个？推荐①（transfer/继承域码前端实际触发——TRANSFER_SAME_ROLE/TRANSFER_OLD_ROLE_NOT_ASSIGNED/TRANSFER_FAILED + ROLE_SELF_INHERITANCE/ROLE_BUILTIN_PARENT_FORBIDDEN/ROLE_INHERITANCE_CYCLE 均在 AC 中触发，单列具体提示提升 UX；映射表键仍从 errorCodeSchema SSOT 派生 R12 D11 沿用，新增码自动覆盖不漏；**R16 扩展后 errorCodeSchema 全集所有码均映射具体中文提示，FALLBACK 仅作"未来新增码兜底"**，同步移除 R15 D9 注释"TRANSFER/ROLE_INHERITANCE 域 FALLBACK"（R14 S-11 教训闭合收尾——R12 扩展 user/auth + R14 扩展 role/dept + R15 扩展 notification/report + R16 扩展 transfer/inheritance，全码映射收尾）；①类显式影响：R15 error-mapping-extend-2.test.ts 若断言"TRANSFER_SAME_ROLE → FALLBACK"会失效，impl-writer 须调整断言 toContain('新角色不能与原角色相同')，对齐 R14/R15 ①类显式影响处理范例）。**阻塞下游：impl lib/errorMapping.ts 扩展 + 注释同步移除、test F9-1~F9-3 + ①类显式影响 R15 error-mapping-extend-2.test.ts 调整。**

## Out of scope

- **调岗历史页** —— Q4 决策①不做（无专用端点，audit-logs 无 transfer 实体类型，从 audit-logs 筛选语义模糊无法区分调岗与 user status update）。待后端补"GET /v1/audit-logs?entity_type=transfer"或"GET /v1/users/:userId/transfer-history"端点后的未来方向。
- **调岗批量操作** —— 本轮仅单用户调岗（POST /v1/users/:userId/transfer 单端点单用户），批量调岗为未来方向（须后端补批量端点）。
- **调岗预览/dry-run** —— 本轮调岗为事务性直接执行（POST /transfer），dry-run 预览（展示将移除/分配的角色 + 变更的部门但不下发）为未来方向。
- **角色继承链可视化图表** —— 本轮仅链形文本展示（Q6 决策①），树形图/DAG 图/层级图为未来方向（须引入图表库，违背零新依赖）。
- **角色继承链深度限制前端校验** —— 继承链深度限制由后端 service 层裁决（ROLE_INHERITANCE_CYCLE 环检测兜底），前端不预判深度。
- **有效权限树形展示 / 权限码分组** —— 本轮仅权限码列表展示（Q7 决策③），按域分组（user:*/role:*/dept:* 等分组）或树形展示为未来方向。
- **有效权限实时刷新 / WebSocket 推送** —— 本轮为用户主动点击查看触发 GET，权限变更后不实时推送刷新，未来方向。
- **角色继承管理独立页** —— Q5 决策①嵌入 RoleListPage 行操作，独立 RoleInheritancePage 为未来方向（若继承管理复杂度增长可拆分）。
- **refresh token / 双 token 机制** —— 沿用 R12/R14/R15 Out of scope。
- **SSR / PWA / i18n / 暗色模式 / 骨架屏 / UI 组件库** —— 沿用 R12/R14/R15 Out of scope。
- **E2E 测试（Playwright）** —— 沿用 R12 Q8 决策② / R14 Q12 决策① / R15 Q9 决策①，组件测 + API client 契约测无 E2E。
- **后端任何改动** —— 后端已就绪（R1-R15 1089 用例基线），本轮仅前端，contracts 无新增 schema（transfer/role-inheritance 契约在 R7/R8 已就绪）。
- **check-rules.mjs 之外的新规则** —— ARCH-003 已机器化（R12），新增前端文件自动受其约束，本轮不新增规则。
- **R15 S-13~S-16 固化**（提示词层 S-13~S-15 + Spec 模板层 S-16）—— 本轮 PRD/impl 须**注意**这些教训（测试 fixture 对齐 contracts 严格校验、组件 label 跨组件唯一、长文本输入 per-test 超时、动态 schema 渲染兜底——本轮无 z.record 动态 schema，S-16 不适用），但规则/提示词的正式固化属元改进轮范畴，不在 R16 业务轮内。
