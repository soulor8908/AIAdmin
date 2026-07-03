---
doc_type: Review-Report
id: REVIEW-WEB-ROLE-DEPT-AUDIT-001
tech_spec_ref: TECH-WEB-ROLE-DEPT-AUDIT-001
prd_ref: PRD-WEB-ROLE-DEPT-AUDIT-001
verdict: pass
created: 2026-07-03
---
# 前端角色/部门/审计管理页 · Code Review 报告（R14 前端多域扩展，验证前端对更多管理域的适应性）

评审范围：R14 前端多域扩展全部交付——`apps/web/src/` 11 个新增实现文件（api/roles.ts、api/departments.ts、api/audit-logs.ts、pages/RoleListPage.tsx、pages/DeptTreePage.tsx、pages/AuditLogPage.tsx、components/RoleForm.tsx、components/DeptForm.tsx、components/UserRolesPanel.tsx、components/DeptNode.tsx、components/Sidebar.tsx）+ 2 个 R12 既有文件改动（pages/UserListPage.tsx 行操作扩展 D24、components/UserRow.tsx 新增"角色"按钮 D24、lib/errorMapping.ts 扩展 SPECIFIC_MESSAGES D9、App.tsx 路由扩展 D24）+ `apps/web/test/` 11 个新增测试文件 + 1 处 R12 既有测试断言 matcher 调整（error-mapping.test.ts ROLE_NOT_FOUND）。对照 `docs/prd/web-role-dept-audit.md`（13 BLOCKING Q&A + BA 核验 B1~B5 + 68 条 AC = 56 功能 AC F1-F10 + 4 ARCH-003 专项 + 2 R13 S-1 专项 + AC↔测试覆盖矩阵）、`docs/spec/web-role-dept-audit.tech.md`（D1~D24 决策 + §10 7 条多[约束]组合副作用预判 + §9 测试清单+AC 矩阵）与 `.trae/rules` 全部规则逐条核查。

本轮 R14 核心验证点：①前端多域扩展适应性（角色扁平分页 / 部门递归树 / 审计只读，三域数据形态各异验证 R12 基础设施复用性）②versioned DELETE 多端点复用（DELETE /v1/roles/:id versioned + 409 重试复用 R12 D9，与 DELETE /v1/departments/:id 非 versioned 有意分歧 D7/D8）③递归 Zod schema 前端渲染（departmentTreeNodeSchema z.lazy 递归，DeptNode 组件递归渲染无深度限制 D12）④R13 S-1 自由文本/类型派生区分在多域下落地（RoleForm/DeptForm safeParse vs UserRolesPanel/DeptTreePage 类型派生）⑤R13 S-3 AC↔测试覆盖矩阵 PRD/Spec 阶段固化 ⑥只读域前端模式（审计 append-only 无写入口）⑦ARCH-003 在新增模块下持续合规（R12 机器化 enforcement 自动覆盖新增文件）。

## §0 速览

- **verdict**：**pass**
- **blocker 数**：**0**
- **suggestion 数**：**8**
- **AC 对齐数**：**68/68 ✅**（功能 56/56 ✅ + ARCH-003 专项 4/4 ✅ + R13 S-1 专项 2/2 ✅；0 ⚠️ 偏离；0 ❌ 未实现）
- **三件套门禁复核（编排者实跑，Reviewer 信赖）**：
  - typecheck：`npx tsc --noEmit` exit 0，0 错误 ✅（impl-writer 自报 tsc 修复 ReactFormEvent → FormEvent 实现笔误已闭合）
  - lint:rules：`node scripts/check-rules.mjs` exit 0，ARCH-003 + CODE 扫描器全过，META-003/META-004 闭合 ✅（R13 S-4 已让 CODE 扫描器覆盖前端 apps/web/src + apps/web/test）
  - test：`npx vitest run` exit 0，991/991（web 158 + api 833，无回归）✅
- **ARCH-003 机器化结论**：**持续合规**——逐文件核对 R14 新增 11 文件 import 全部来自 `@admin/contracts` + 第三方（react/react-router-dom）+ apps/web 内部相对模块，0 处 `apps/api/src/**` 或 `@admin/api` 实际引用（grep 5 命中均为 R12 既有文件的 `[约束] ARCH-003` 注释文字，R14 新增文件无命中即无 apps/api/src 字样更无实际 import）。lint:rules ARCH-003 分支 + R13 S-4 CODE 扫描器（CODE-001/002/003/004/AI-005）自动覆盖新增前端文件，exit 0。
- **advisory 偏离反向同步状态**：impl-writer 自报 4 项（UserRow 按钮文案"禁用"沿用 R12 S-1 / AuditLogPage PII 信任后端脱敏 / RoleListPage 客户端搜索 D11 已同步 Spec / DeptTreePage 创建根部门入口）+ Reviewer 发现 4 项（getDeptTree 命名偏离 Spec §4.2.2 getDepartmentTree / RoleForm·DeptForm aria-label="名称"非"角色名称""部门名称" / AuditLogPage useEffect 依赖数组每键入触发请求无"应用筛选"按钮 / errorMapping.ts L62-63 注释"未映射码（ROLE/DEPT 域等）"过时）。均记 suggestion（R13 S-2 固化：纯 UI 文案偏离不须同步 Spec §10 但须 Review 报告记录）。
- **①类显式影响核对结论**：**pass**——`git diff HEAD --stat -- apps/web/test/` 仅 1 文件改动（error-mapping.test.ts，+8/-3 行），唯一改动是 ROLE_NOT_FOUND 断言 matcher `toContain('操作失败')` → `toContain('角色不存在')`，根因是 D9 扩展 SPECIFIC_MESSAGES 使 ROLE_NOT_FOUND 从 FALLBACK 升级为具体提示。判定：matcher 文本改动但语义不弱化（从通用 FALLBACK 升级为精准具体提示，更贴合 AC-F9-1）+ SSOT 派生机制保留（键仍从 `[...errorCodeSchema.options]` 派生，R12 D11 沿用）+ ①类显式影响注释标注完整（受影响文件 + 改动性质 + 理由）。AI-002 边界判定 pass。D24 UserListPage 行操作扩展未破坏 R12 user-list-page.test.tsx（10 测试全绿，编排者确认 web 158 全绿）。
- **多[约束]组合副作用**：§10 末 7 条预判全部正确实现（角色删除 versioned+409重试+列表刷新 / 部门删除非 versioned+DEPT_HAS_CHILDREN/NOT_EMPTY / 审计脱敏+SEC-003b+禁用 auditLogSchema / errorMapping 扩展+SSOT 派生+R12 既有测试 / 401 拦截+新增域请求 / 自由文本 safeParse+类型派生混合 / UserListPage 行操作+UserRolesPanel 触发）。

## §1 PRD 验收逐条核对（AI-007，68 条 AC = 56 功能 + 4 ARCH-003 专项 + 2 R13 S-1 专项）

对照 PRD `docs/prd/web-role-dept-audit.md` §验收标准（F1 角色列表 6 + F2 角色创建 6 + F3 角色删除 7 + F4 用户角色分配 6 + F5 部门树 9 + F6 用户部门分配 4 + F7 审计日志 11 + F8 导航 4 + F9 错误处理 6 + F10 基础设施 3 = 56 功能 AC + ARCH-003 专项 4 + R13 S-1 专项 2 = 68），逐条核对实现行为是否对齐。测试覆盖两层：11 个新增 web 测试文件（3 API client 契约测 mock fetch + 8 组件测 jsdom + Testing Library）+ 1 处 R12 既有断言 matcher 调整。

### F1：角色列表页（6 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F1-1 | 首次加载 GET /v1/roles?page=1&pageSize=20 + 渲染行 | `RoleListPage.tsx:23` PAGE_SIZE=20；L44-50 useEffect listRoles({page:1,pageSize:20})；L162-177 渲染 name/description/is_builtin 标识 + 删除按钮 | `role-list-page.test.tsx` 首次加载用例 | ✅ |
| F1-2 | 分页切换 → GET page=2 | `RoleListPage.tsx:107-113` handleNextPage/PrevPage → setPage | `role-list-page.test.tsx` 分页用例 | ✅ |
| F1-3 | 空状态 → "暂无角色" | `RoleListPage.tsx:149`（!loading && filteredItems.length===0 → "暂无角色"） | `role-list-page.test.tsx` 空状态用例 | ✅ |
| F1-4 | 加载态 loading 文案 | `RoleListPage.tsx:147`（loading && "加载中..."） | `role-list-page.test.tsx` 加载态用例 | ✅ |
| F1-5 | 内置角色标识 + 删除按钮 disabled | `RoleListPage.tsx:166`（is_builtin ? '内置' : '自定义'）+ L171 `disabled={role.is_builtin}` | `role-list-page.test.tsx` 内置角色用例 | ✅ |
| F1-6 | [advisory] 客户端名称搜索仅过滤当前页 | `RoleListPage.tsx:122-125` keyword 过滤当前页 items（非服务端筛选，D11） | `role-list-page.test.tsx` advisory 可选测 | ✅ |

**F1 小结：6/6 ✅**。pageSize=20 显式传（D21）、内置角色 disabled 预禁用优化 UX（后端 ROLE_BUILTIN_FORBIDDEN 兜底）、客户端搜索仅过滤当前页（D11 advisory 已同步 Spec §10）均落地。

### F2：角色创建（自由文本表单 + 权限码多选，6 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F2-1 | 创建成功 → 弹窗关闭 + 列表刷新含新角色 | `RoleForm.tsx:79-81` createRole → onCreated + onClose；`RoleListPage.tsx:115-119` handleCreated → setShowCreateModal(false) + setPage(1) + refresh() | `role-form.test.tsx` + `role-list-page.test.tsx` 创建用例 | ✅ |
| F2-2 | permission_codes 多选 SSOT 派生（11 项） | `RoleForm.tsx:31` ALL_PERMISSION_CODES = [...permissionCodeSchema.options]；L119-123 select multiple options 派生 | `role-form.test.tsx` SSOT 派生断言 | ✅ |
| F2-3 | name 空 → safeParse 拦截"角色名称必填" | `RoleForm.tsx:63` createRoleInputSchema.safeParse；L66-67 !trimmedName → "角色名称必填" | `role-form.test.tsx` name 空用例 | ✅ |
| F2-4 | name > 64 → safeParse 拦截"角色名称不超过 64 字符" | `RoleForm.tsx:68-69` trimmedName.length > 64 → "角色名称不超过 64 字符" | `role-form.test.tsx` name 超长用例 | ✅ |
| F2-5 | description > 512 → safeParse 拦截"描述不超过 512 字符" | `RoleForm.tsx:70-71` description.length > 512 → "描述不超过 512 字符" | `role-form.test.tsx` description 超长用例 | ✅ |
| F2-6 | ROLE_NAME_DUPLICATE → "角色名称已存在"（B1 非 ROLE_CODE_DUPLICATE） | `RoleForm.tsx:83` catch ApiError → resolveErrorMessage → mapErrorToMessage；errorMapping L36 ROLE_NAME_DUPLICATE='角色名称已存在' | `role-form.test.tsx` + `error-mapping-extend.test.ts` | ✅ |

**F2 小结：6/6 ✅**。自由文本表单 safeParse 复用 createRoleInputSchema（D4/R13 S-1）、permission_codes 多选 SSOT 派生（AI-005）、ROLE_NAME_DUPLICATE 非 ROLE_CODE_DUPLICATE（B1 contracts SSOT 遵循）均落地。

### F3：角色删除（versioned + 409 重试复用 R12 D9，7 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F3-1 | 删除成功 → DELETE + If-Match + 列表刷新 | `RoleListPage.tsx:92-93` deleteRole(role.id, role.version) → refresh()；`api/roles.ts:42-47` versioned=true + expectedVersion | `role-list-page.test.tsx` 删除成功用例 | ✅ |
| F3-2 | VERSION_CONFLICT 自动重试 1 次（用 current_version） | 复用 R12 client.ts D9 重试；`api/roles.ts:42-47` deleteRole versioned=true 触发 client 409 重试路径 | `api-roles.test.ts` 409 重试用例 | ✅ |
| F3-3 | 重试仍 409 → "数据已被修改，请刷新后重试" | 复用 R12 client.ts 重试仅 1 次；errorMapping L33 VERSION_CONFLICT='数据已被修改，请刷新后重试' | `api-roles.test.ts` 重试仍冲突用例 | ✅ |
| F3-4 | ROLE_BUILTIN_FORBIDDEN → "内置角色不可删除" | errorMapping L37 ROLE_BUILTIN_FORBIDDEN='内置角色不可删除' | `role-list-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F3-5 | ROLE_IN_USE → "角色已分配给用户，请先解除分配" | errorMapping L38 ROLE_IN_USE='角色已分配给用户，请先解除分配' | `role-list-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F3-6 | ROLE_NOT_FOUND → "角色不存在" + 列表刷新 | `RoleListPage.tsx:98-100` err.code==='ROLE_NOT_FOUND' → refresh()；errorMapping L35 ROLE_NOT_FOUND='角色不存在' | `role-list-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F3-7 | API client 始终带 If-Match | `api/roles.ts:42-47` deleteRole versioned=true + expectedVersion → client 注入 If-Match（R12 D7） | `api-roles.test.ts` If-Match 注入断言 | ✅ |

**F3 小结：7/7 ✅**。versioned DELETE 复用 R12 D9 重试策略（用 409 body current_version，不 GET 单条）、ROLE_NOT_FOUND 列表刷新（移除已不存在行）均落地。D7 [约束] 合规。

### F4：用户角色分配面板（类型派生 toggle，6 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F4-1 | 面板打开加载用户角色（UserRole[] 裸数组 B5） | `UserRolesPanel.tsx:45-49` Promise.all([listUserRoles, listRoles]) → setAssignedRoleIds(new Set(userRoles.map(ur=>ur.role_id)))；`api/roles.ts:50-52` listUserRoles 返回 Promise<UserRole[]> | `user-roles-panel.test.tsx` 加载用例 | ✅ |
| F4-2 | toggle 勾选分配（类型派生，不调 safeParse） | `UserRolesPanel.tsx:76` assignRole(userId, role.id)；L63 注释"roleId 从 allRoles 派生，TS 类型保证 uuid，不调 safeParse" | `user-roles-panel.test.tsx` 分配用例 | ✅ |
| F4-3 | toggle 取消移除（类型派生） | `UserRolesPanel.tsx:69` removeRole(userId, role.id) | `user-roles-panel.test.tsx` 移除用例 | ✅ |
| F4-4 | USER_ROLE_ALREADY_ASSIGNED → "用户已持有该角色" | errorMapping L39 USER_ROLE_ALREADY_ASSIGNED='用户已持有该角色' | `user-roles-panel.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F4-5 | ROLE_NOT_FOUND → "角色不存在" | errorMapping L35 ROLE_NOT_FOUND='角色不存在' | `user-roles-panel.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F4-6 | USER_NOT_FOUND → "用户不存在" | errorMapping L22 USER_NOT_FOUND='用户不存在'（R12 既有码） | `user-roles-panel.test.tsx` + `error-mapping-extend.test.ts` | ✅ |

**F4 小结：6/6 ✅**。UserRole[] 裸数组消费（B5）、类型派生 toggle 不调 safeParse（D5/R13 S-1/AC-ARCH-4）、并行 listRoles 取全量角色作 toggle 选项（roleId 从列表派生 TS 类型保证）均落地。

### F5：部门树页（递归渲染 + 创建 + 删除，9 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F5-1 | 树首次加载递归渲染（无深度限制 D12） | `DeptTreePage.tsx:40-44` getDeptTree() → setTree(res.items)；L88-93 tree.map(<DeptNode>)；`DeptNode.tsx:107-113` children 递归渲染 <DeptNode> 无深度限制 | `dept-tree-page.test.tsx` 递归渲染用例 | ✅ |
| F5-2 | 创建根部门（parentId 缺省） | `DeptTreePage.tsx:96-102` showCreateRoot → <DeptForm parentId={null}>；`DeptForm.tsx:52-55` parentId===null → raw 不含 parent_id | `dept-tree-page.test.tsx` 创建根部门用例 | ✅ |
| F5-3 | 创建子部门（自由文本 name safeParse） | `DeptNode.tsx:100-106` showCreateChild → <DeptForm parentId={node.id}>；`DeptForm.tsx:57` createDepartmentInputSchema.safeParse | `dept-tree-page.test.tsx` + `dept-form.test.tsx` 创建子部门用例 | ✅ |
| F5-4 | name 空 → safeParse 拦截"部门名称必填" | `DeptForm.tsx:60-61` !trimmedName → "部门名称必填" | `dept-form.test.tsx` name 空用例 | ✅ |
| F5-5 | DEPT_NAME_DUPLICATE → "同级别下部门名称已存在" | errorMapping L41 DEPT_NAME_DUPLICATE='同级别下部门名称已存在' | `dept-tree-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F5-6 | DEPT_DEPTH_EXCEEDED → "部门层级超过上限" | errorMapping L43 DEPT_DEPTH_EXCEEDED='部门层级超过上限' | `dept-tree-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F5-7 | 删除叶部门成功（非 versioned 无 If-Match D8） | `DeptNode.tsx:47` deleteDepartment(node.id)（无 versioned）；`api/departments.ts:37-39` deleteDepartment 无 versioned/expectedVersion | `dept-tree-page.test.tsx` + `api-departments.test.ts` 非 versioned 断言 | ✅ |
| F5-8 | DEPT_HAS_CHILDREN → "请先删除子部门" | errorMapping L42 DEPT_HAS_CHILDREN='请先删除子部门' | `dept-tree-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F5-9 | DEPT_NOT_FOUND → "部门不存在" | errorMapping L40 DEPT_NOT_FOUND='部门不存在' | `dept-tree-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |

**F5 小结：9/9 ✅**。递归渲染无深度限制（D12，后端 DEPT_DEPTH_EXCEEDED 已限 3 层）、parentId 可选（D13，缺省/null=根部门）、DELETE 非 versioned（D8，与 D7 角色删除 versioned 有意分歧）均落地。

### F6：用户部门分配（类型派生 + 幂等，4 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F6-1 | 分配成功（类型派生 departmentId 从树派生） | `DeptNode.tsx:61` assignUserDepartment(node.id, assignUserId.trim())；`api/departments.ts:42-44` path 参数 | `dept-tree-page.test.tsx` 分配用例 | ✅ |
| F6-2 | DEPT_NOT_FOUND → "部门不存在" | errorMapping L40 DEPT_NOT_FOUND='部门不存在' | `dept-tree-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |
| F6-3 | 重复分配幂等成功（无"已在该部门"码 B4） | `DeptNode.tsx:62` 成功 → setError('部门归属已更新')（无"已在该部门"提示）；`api/departments.ts:42` 覆盖式幂等 | `dept-tree-page.test.tsx` 幂等用例 | ✅ |
| F6-4 | USER_NOT_FOUND → "用户不存在" | errorMapping L22 USER_NOT_FOUND='用户不存在' | `dept-tree-page.test.tsx` + `error-mapping-extend.test.ts` | ✅ |

**F6 小结：4/4 ✅**。覆盖式幂等（B4，无"已在该部门"码，errorCodeSchema 无此码）、类型派生 departmentId 从树派生（D5/R13 S-1）均落地。

### F7：审计日志页（只读 + 筛选，11 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F7-1 | 首次加载 GET /v1/audit-logs?page=1&pageSize=20 + 渲染行 | `AuditLogPage.tsx:31` PAGE_SIZE=20；L70-84 useEffect listAuditLogs({page:1,pageSize:20})；L192-204 渲染 operated_at/operator_name/entity_type/action/变更摘要 | `audit-log-page.test.tsx` 首次加载用例 | ✅ |
| F7-2 | 分页切换 → GET page=2 | `AuditLogPage.tsx:103-108` handleNextPage/PrevPage → setPage | `audit-log-page.test.tsx` 分页用例 | ✅ |
| F7-3 | entity_type 筛选 SSOT 派生（5 项） | `AuditLogPage.tsx:34` ALL_ENTITY_TYPES = [...auditLogEntityTypeSchema.options]；L129-133 select options 派生 | `audit-log-page.test.tsx` entity_type 筛选用例 | ✅ |
| F7-4 | operator_id 筛选 | `AuditLogPage.tsx:74-75` query.operator_id = operatorId；L136-147 input | `audit-log-page.test.tsx` operator_id 用例 | ✅ |
| F7-5 | date_range 筛选 datetime-local + ISO 归一 | `AuditLogPage.tsx:49-54` normalizeDatetime（new Date(...).toISOString()）；L77-80 query.operated_from/operated_to | `audit-log-page.test.tsx` date_range 用例 | ✅ |
| F7-6 | 筛选+分页复合（翻页保持筛选 R13 S-3） | `AuditLogPage.tsx:101` useEffect 依赖 [page, entityType, operatorId, operatedFrom, operatedTo]，翻页时筛选条件保留 | `audit-log-page.test.tsx` 组合场景用例 | ✅ |
| F7-7 | 无 action 筛选控件（B3） | `AuditLogPage.tsx:117-172` 筛选区仅 entity_type/operator_id/operated_from/operated_to，无 action 控件 | `audit-log-page.test.tsx` 无 action 断言 | ✅ |
| F7-8 | 空状态 → "暂无审计日志" | `AuditLogPage.tsx:178`（!loading && items.length===0 → "暂无审计日志"） | `audit-log-page.test.tsx` 空状态用例 | ✅ |
| F7-9 | 加载态 loading 文案 | `AuditLogPage.tsx:176`（loading && "加载中..."） | `audit-log-page.test.tsx` 加载态用例 | ✅ |
| F7-10 | PII 脱敏展示（不展示完整邮箱） | `AuditLogPage.tsx:199-201` log.after.map(f => String(f.value))（后端已脱敏，前端直接展示脱敏值，不还原）；消费 RedactedAuditLog（D10） | `audit-log-page.test.tsx` PII 脱敏用例 | ✅ |
| F7-11 | 只读无写入口（append-only） | `AuditLogPage.tsx` 无创建/编辑/删除按钮（仅筛选 + 分页 + 列表） | `audit-log-page.test.tsx` 只读断言 | ✅ |

**F7 小结：11/11 ✅**。entity_type SSOT 派生（AI-005）、无 action 筛选（B3 contracts SSOT 遵循）、datetime-local ISO 归一（D15）、PII 脱敏展示（D10/SEC-003b，信任后端脱敏不还原）、只读无写入口（append-only）均落地。

### F8：导航扩展（4 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F8-1 | 侧边栏 4 入口 + 登出 | `Sidebar.tsx:21-37` Link to /users /roles /departments /audit-logs + 登出按钮（Q8 决策①） | `navigation.test.tsx` 侧边栏用例 | ✅ |
| F8-2 | 入口可达（点击跳转渲染页面） | `Sidebar.tsx:22-33` Link to 对应路由；`App.tsx:33-56` /roles /departments /audit-logs 路由 | `navigation.test.tsx` 入口跳转用例 | ✅ |
| F8-3 | 路由守卫覆盖新页（白名单仅 /login） | `App.tsx:33-56` /roles /departments /audit-logs 均经 RouteGuard；R12 RouteGuard 白名单仅 /login 沿用 | `navigation.test.tsx` 未登录跳 /login 用例 | ✅ |
| F8-4 | 登出复用 R12（POST /v1/auth/logout + 清 token + 跳 /login） | `Sidebar.tsx:35` onClick={() => logout()}；R12 AuthContext.logout 沿用 | `navigation.test.tsx` 登出用例 | ✅ |

**F8 小结：4/4 ✅**。侧边栏导航（Q8 决策①）、路由守卫白名单仍仅 /login（R12 D13 沿用）、登出复用 R12 AC-F6-2 均落地。

### F9：错误处理（6 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F9-1 | 角色域码中文（ROLE_*/USER_ROLE_ALREADY_ASSIGNED） | `errorMapping.ts:35-39` ROLE_NOT_FOUND/ROLE_NAME_DUPLICATE/ROLE_BUILTIN_FORBIDDEN/ROLE_IN_USE/USER_ROLE_ALREADY_ASSIGNED 中文提示 | `error-mapping-extend.test.ts` 角色域码用例 | ✅ |
| F9-2 | 部门域码中文（DEPT_*） | `errorMapping.ts:40-43` DEPT_NOT_FOUND/DEPT_NAME_DUPLICATE/DEPT_HAS_CHILDREN/DEPT_DEPTH_EXCEEDED 中文提示 | `error-mapping-extend.test.ts` 部门域码用例 | ✅ |
| F9-3 | SSOT 派生（键从 [...errorCodeSchema.options]） | `errorMapping.ts:54-59` ERROR_MESSAGES = Object.fromEntries([...errorCodeSchema.options].map(...)) | `error-mapping-extend.test.ts` SSOT 派生断言 | ✅ |
| F9-4 | AUDIT_LOG_NOT_FOUND FALLBACK（本期不触发） | `errorMapping.ts:46-47` AUDIT_LOG_NOT_FOUND 未列 SPECIFIC_MESSAGES → FALLBACK='操作失败，请稍后重试' | `error-mapping-extend.test.ts` AUDIT_LOG_NOT_FOUND FALLBACK 用例 | ✅ |
| F9-5 | 401 拦截复用 R12 | R12 client.ts D8 401 拦截沿用；R14 新增 api 模块不传 skipAuth（全部需鉴权） | `api-roles.test.ts` 401 拦截沿用 | ✅ |
| F9-6 | 网络错误兜底复用 R12 | R12 client.ts fetch 抛 → ApiError('NETWORK_ERROR') 沿用 | `api-roles.test.ts` 网络错误沿用 | ✅ |

**F9 小结：6/6 ✅**。errorMapping 扩展 SPECIFIC_MESSAGES（D9）、SSOT 派生机制保留（R12 D11 沿用）、AUDIT_LOG_NOT_FOUND FALLBACK 兜底（审计域只读无写本期不触发）、401 拦截/网络兜底复用 R12 均落地。

### F10：前端基础设施复用（3 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| F10-1 | API client 复用（经 request() 不直连 fetch） | `api/roles.ts:25`/`api/departments.ts:20`/`api/audit-logs.ts:12` 均 import request from './client.js'，pages/components 不直连 fetch | `api-roles.test.ts` + `api-departments.test.ts` + `api-audit-logs.test.ts` | ✅ |
| F10-2 | Bearer/If-Match 注入复用 | R12 client.ts D6 Bearer + D7 If-Match 沿用；R14 deleteRole versioned=true 触发 If-Match 注入 | `api-roles.test.ts` Bearer/If-Match 断言 | ✅ |
| F10-3 | 零新依赖 | `apps/web/package.json` R12 依赖清单沿用，R14 无新增 dependencies/devDependencies | `navigation.test.tsx` 工程核验 | ✅ |

**F10 小结：3/3 ✅**。API client 复用 R12（零新增基础设施）、Bearer/If-Match 注入复用、零新依赖（无 axios/ky/Redux/Zustand/UI 框架/Playwright）均落地。

### ARCH-003 合规专项（4 条）

| # | PRD 验收点 | 实现行为 | 测试/校验覆盖 | 对齐 |
|---|---|---|---|---|
| ARCH-1 | 新增模块不直连后端 | grep `apps/api/src\|@admin/api` in apps/web/src：5 命中均为 R12 既有文件 `[约束] ARCH-003` 注释文字，R14 新增 11 文件 0 命中（无 apps/api/src 字样更无实际 import） | lint:rules ARCH-003 分支 exit 0 + Reviewer 逐文件核对 | ✅ |
| ARCH-2 | 类型来自 contracts | R14 新增模块全部 import type from '@admin/contracts'（Role/CreateRoleInput/ListRoleQuery/RoleListResult/UserRole/Department/CreateDepartmentInput/DepartmentTreeResult/RedactedAuditLog/AuditLogListResult/ListAuditLogQuery/ErrorCode/DepartmentTreeNode/PermissionCode 等）；0 手写 TS 类型副本 | tsc 0 错误 + API client 契约测类型断言 | ✅ |
| ARCH-3 | 客户端校验复用契约 schema（自由文本表单） | `RoleForm.tsx:63` createRoleInputSchema.safeParse（覆盖 name/description/permission_codes 整体校验）；`DeptForm.tsx:57` createDepartmentInputSchema.safeParse（覆盖 name + parent_id） | `role-form.test.tsx` + `dept-form.test.tsx` safeParse 拦截断言 | ✅ |
| ARCH-4 | 类型派生操作不强制 safeParse（R13 S-1） | `UserRolesPanel.tsx:63` 注释"roleId 从 allRoles 派生，TS 类型保证 uuid，不调 safeParse"；`DeptNode.tsx:61` assignUserDepartment 直接派发（departmentId 从树派生）；`RoleForm.tsx:31` permission_codes 多选 options SSOT 派生（值 ∈ 枚举编译期保证） | `user-roles-panel.test.tsx` 类型派生断言 | ✅ |

**ARCH-003 小结：4/4 ✅**。R12 机器化 enforcement 持续覆盖新增文件、类型 z.infer 派生、自由文本表单 safeParse（D4）、类型派生操作不强制 safeParse（D5/R13 S-1）均落地。**相比 R12 AC-ARCH-4 partial（F4 toggle 未调 safeParse），R14 在 UserRolesPanel/DeptTreePage 类型派生操作上显式标注不调 safeParse + 理由（D5 [约束] + R13 S-1 固化），AC-ARCH-4 完全对齐**。

### R13 S-1 合规专项（2 条）

| # | PRD 验收点 | 实现行为 | 测试覆盖 | 对齐 |
|---|---|---|---|---|
| S1-1 | 自由文本表单须 safeParse | `RoleForm.tsx:63` createRoleInputSchema.safeParse（name/description 自由文本）；`DeptForm.tsx:57` createDepartmentInputSchema.safeParse（name 自由文本） | `role-form.test.tsx` + `dept-form.test.tsx` safeParse 拦截用例 | ✅ |
| S1-2 | 类型派生操作 TS 类型保证 | `UserRolesPanel.tsx` toggle（roleId 从 allRoles 派生）；`DeptNode.tsx` 用户分配（departmentId 从树派生）；`RoleForm.tsx:31` permission_codes 多选（options SSOT 派生） | `user-roles-panel.test.tsx` + `role-form.test.tsx` | ✅ |

**R13 S-1 小结：2/2 ✅**。R13 S-1 在多域下落地：自由文本表单（RoleForm name/description、DeptForm name）调 safeParse；类型派生操作（UserRolesPanel toggle、DeptNode 用户分配、RoleForm permission_codes 多选）值经 TS 类型/SSOT 派生保证合法，不强制 safeParse。**RoleForm 混合表单按 §3.2 提示处理：整体 createRoleInputSchema.safeParse 覆盖 name/description，permission_codes 字段值经多选 options 派生保证合法（safeParse 不会在此字段失败）**。

### AI-007 PRD 逐条核对总结

- F1 角色 6/6 ✅ + F2 创建 6/6 ✅ + F3 删除 7/7 ✅ + F4 用户角色 6/6 ✅ + F5 部门树 9/9 ✅ + F6 部门分配 4/4 ✅ + F7 审计 11/11 ✅ + F8 导航 4/4 ✅ + F9 错误 6/6 ✅ + F10 基础设施 3/3 ✅ = **功能 56/56 ✅**
- ARCH-003 专项 **4/4 ✅**（R14 AC-ARCH-4 完全对齐，优于 R12 partial）
- R13 S-1 专项 **2/2 ✅**
- **合计 68/68 ✅ + 0 ⚠️ + 0 ❌**

**AI-007 是否生效**：✅ **生效**。11 测试文件对照 PRD F1-F10 + ARCH-003 + R13 S-1 每条 Given/When/Then 产出断言（含 mock fetch 验 API client 行为 + jsdom 组件测验交互）。Reviewer 逐条核对实现行为对齐，0 ❌ 未实现，0 ⚠️ 偏离。

## §2 规则合规审查

### AI 系列（spec-first 工作流）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| AI-001 | 先读 Spec 再写码 | R14 实现严格对齐 Tech-Spec §2~§12（分层/契约消费/API client 复用/状态管理/路由/页面组件/错误矩阵）；每文件头注释引用 TECH-WEB-ROLE-DEPT-AUDIT-001 章节号 | ✅ 合规 |
| AI-002 | 测试先行，impl-writer 禁改测试断言（仅可改 setup/import 路径并注明理由） | `git diff HEAD --stat -- apps/web/test/` 仅 1 文件改动（error-mapping.test.ts，+8/-3 行）。唯一改动是 ROLE_NOT_FOUND 断言 matcher `toContain('操作失败')` → `toContain('角色不存在')`，属 ①类显式影响（D9 扩展 SPECIFIC_MESSAGES 使 ROLE_NOT_FOUND 从 FALLBACK 升级为具体提示）。**边界判定**：matcher 文本改动但语义不弱化（通用 FALLBACK → 精准具体提示）+ SSOT 派生机制保留 + ①类显式影响注释标注完整（受影响文件 + 改动性质 + 理由）。详见 §8 ①类显式影响专项 | ✅ 合规（边界 pass） |
| AI-003 | advisory 偏离须反向同步 Spec；[约束] 偏离须显式标注+反向同步+Reviewer 确认 | D11 客户端名称搜索 + D15 datetime-local ISO 归一已同步 Spec §10 ✅；4 项纯 UI 文案 advisory 偏离（UserRow 按钮文案沿用 R12 S-1 / AuditLogPage PII 信任后端脱敏 / RoleListPage 客户端搜索 / DeptTreePage 创建根部门入口）+ Reviewer 发现 4 项（getDeptTree 命名偏离 / RoleForm·DeptForm aria-label="名称" / AuditLogPage useEffect 每键入触发请求 / errorMapping L62-63 注释过时）均记 suggestion（R13 S-2 固化：纯 UI 文案偏离不须同步 Spec §10 但须 Review 报告记录） | ⚠️ suggestion（8 项 advisory 偏离记录见 §4） |
| AI-004 | 每次改动必跑三件套 | 编排者实跑 typecheck 0 错误 + lint:rules exit 0 + vitest 991/991 | ✅ 合规 |
| AI-005 | 跨域可变集合用 SSOT 派生断言 | `errorMapping.ts:54` `[...errorCodeSchema.options]` SSOT 派生映射表键；`RoleForm.tsx:31` `[...permissionCodeSchema.options]` SSOT 派生权限码选项；`AuditLogPage.tsx:34` `[...auditLogEntityTypeSchema.options]` SSOT 派生 entity_type 选项；`error-mapping-extend.test.ts:21` `[...errorCodeSchema.options]` SSOT 派生测试断言 | ✅ 合规 |
| AI-006 | Tech Lead 须产出受影响测试清单 | Tech-Spec §9 三类标注完整（①类 0~2 显式边缘：user-list-page.test.tsx + error-mapping.test.ts / 0 隐式 / ②类 0 / ③类 9 文件预估）；test-writer 实际新增 11 文件（多出 dept-form.test.tsx、role-form.test.tsx、error-mapping-extend.test.ts），偏离 Spec §9.3 的 9 文件预估，理由：更细粒度测试覆盖 + error-mapping-extend 独立文件避免改 R12 既有断言（仅 ①类显式影响改 R12 error-mapping.test.ts 一处）。test-writer 反向核实：识别 ①类显式影响（ROLE_NOT_FOUND 断言需调整）已在 error-mapping-extend.test.ts 注释中列出 | ✅ 合规（test-writer 偏离 Spec §9 文件数有理由，③类新增文件数扩充合理） |
| AI-007 | 端到端验收 + Reviewer PRD 逐条核对 | 11 测试文件覆盖 + Reviewer 68 条 AC 逐条核对（§1） | ✅ 合规 |

### ARCH 系列（分层）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| ARCH-001 | 后端单向依赖 router→service→repo→domain | 前端不触后端；既有 ARCH-001 扫描器（allTs 含 apps/api/src）exit 0 | ✅ 合规（前端无关，既有验证） |
| ARCH-002 | contracts 纯净 | 前端不触 contracts；R14 契约层零新增（PRD 明示 contracts 已就绪）；ARCH-002 扫描器 exit 0 | ✅ 合规 |
| ARCH-003 | 跨层只经契约（前端禁 import 后端模块） | **逐文件核对**：R14 新增 11 文件 import 全部来自 `@admin/contracts` + 第三方（react/react-router-dom）+ apps/web 内部相对模块（`./`、`../`）；0 处 `apps/api/src/**` 或 `@admin/api` 实际引用。grep `apps/api/src\|@admin/api` in apps/web/src：5 命中均为 R12 既有文件 `[约束] ARCH-003` 注释文字（AuthContext.tsx:8、api/roles.ts:11、api/auth.ts:7、api/client.ts:9、api/users.ts:8），R14 新增 api/departments.ts、api/audit-logs.ts、pages、components 0 命中（注释措辞略不同但无 apps/api/src 字样）。lint:rules ARCH-003 分支 + R13 S-4 CODE 扫描器自动覆盖新增文件 exit 0 | ✅ 合规（持续合规，详见 §7） |

### CODE 系列（命名/禁用模式，R13 S-4 已让 CODE 扫描器覆盖前端）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| CODE-001 | 禁止 any | R13 S-4 已让 CODE-001 扫描器覆盖 apps/web/src + apps/web/test；lint:rules exit 0。手动核对 R14 新增文件：0 处 `: any` 或 `as any`；类型守卫用 `unknown` + `as` 断言（如 `e.target.value as PermissionCode` 经 SSOT options 派生保证合法） | ✅ 合规（机器化覆盖 + 手动核对） |
| CODE-002 | 禁止空 catch / 仅 console catch | R13 S-4 CODE-002 扫描器覆盖前端；lint:rules exit 0。手动核对 R14 新增文件：catch 块均含 setError/resolveErrorMessage 语义处理（如 RoleForm L82-86 catch → setFormError；DeptNode L49-53 catch → setError），0 空 catch | ✅ 合规 |
| CODE-003 | 禁止 eval / new Function | R13 S-4 CODE-003 扫描器覆盖前端；lint:rules exit 0。手动核对：0 处 eval/new Function | ✅ 合规 |
| CODE-004 | Zod schema 命名后缀 Schema | 前端不定义 Zod schema（全部复用 contracts），N/A；R13 S-4 CODE-004 扫描器覆盖前端 exit 0 | ✅ 合规（N/A） |

> **R13 S-4 闭合状态**：R12 S-6 建议"扩展 allTs 含 apps/web/src + apps/web/test"已在 R13 S-4 落地（check-rules.mjs walkWeb 提升为顶层函数 + allTs 含 apps/web/src + apps/web/test）。R14 新增前端文件自动受 CODE-001/002/003/004/AI-005 扫描器覆盖，lint:rules exit 0。R12 S-6 改进项闭合。

### SEC 系列（鉴权/PII）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| SEC-001 | 路由声明式 auth 元数据 | 前端为客户端路由（React Router），非后端 procedure；SEC-001 适用于后端 router（R11 已验证）。前端 RouteGuard 实现客户端鉴权拦截 | ✅ 合规（前端 N/A，后端既有验证） |
| SEC-002 | service 层越权校验（逐个 public 方法独立核对） | 前端无 service 层；SEC-002 适用于后端（R11 已逐方法核对）。前端不涉越权判定（依赖后端 FORBIDDEN 返回时显示"无权限"，PRD §PII 清单明示"前端不预判权限"）。R14 不改后端 service，SEC-002 既有验证沿用 | ✅ 合规（前端 N/A，后端既有验证，R14 后端冻结） |
| SEC-003a | 响应不返回未声明 PII（输出 schema .strict()） | 前端消费 redactedAuditLogSchema（.strict()，before/after 中 pii=true 字段已脱敏）；前端不定义输出 schema，N/A。auditLogSchema（存储态含未脱敏 PII）前端禁用（D3/D10），实现未 import | ✅ 合规 |
| SEC-003b | 错误消息与日志 PII 边界（password/token 不入日志 + 审计 before-after PII 脱敏） | **重点核对**：(1) 审计 before/after PII 脱敏——前端 AuditLogPage 直接展示 `f.value`（后端已脱敏为 ab***@example.com，前端不还原，AC-F7-10）；(2) password 不入日志——R14 无登录表单改动，沿用 R12（password 仅内存，提交后清 state，0 console.log）；(3) token 不入日志——R14 沿用 R12 tokenStore（localStorage，0 console.log）；(4) operator_id/operator_name 禁止 console.log——R14 新增文件 0 console.log 调用（grep 确认）；(5) 禁用 auditLogSchema（存储态含未脱敏 PII）——R14 AuditLogPage 仅 import RedactedAuditLog/AuditLogListResult/ListAuditLogQuery，0 处 import auditLogSchema/AuditLog/piiFieldRegistrySchema | ✅ 合规 |

### META 系列（规则元数据）

| 规则 | 要求 | 实现核查 | 结论 |
|---|---|---|---|
| META-001 | 规则文档须含"校验方式"段 + 机器校验关键词 | layering.md ARCH-003 块含"校验方式"段 + `check-rules.mjs ARCH-003 分支` 关键词；META-001 扫描器 exit 0 | ✅ 合规 |
| META-002 | 规则 PR 准入（rules 改动须同 PR 含 check-rules.mjs 改动） | R14 无规则文件改动（R12 已落地 ARCH-003 分支 + R13 S-4 已扩展 allTs 含前端），layering.md/check-rules.mjs 无改动 | ✅ 合规（R14 无规则改动） |
| META-003 | 声明即实现（规则声称用 check-rules.mjs 专属分支 → 脚本有 markEnforcement） | layering.md ARCH-003 校验方式含"check-rules.mjs ARCH-003 分支"措辞 ↔ check-rules.mjs markEnforcement('ARCH-003')；META-003 扫描器 exit 0 | ✅ 合规（闭合） |
| META-004 | 实现即声明（脚本 markEnforcement → 规则文档有对应规则 ID 块） | check-rules.mjs markEnforcement('ARCH-003') ↔ layering.md `## ARCH-003` 块存在；META-004 扫描器 exit 0 | ✅ 合规（闭合） |

**META-003/META-004 双向绑定闭合结论**：R12 已闭合，R14 无规则改动，双向绑定持续闭合。lint:rules 输出"双向绑定：META-003(声明即实现) + META-004(实现即声明) 已校验"。

## §3 语义审查（重点项逐个分析）

### 重点项 1：BA 核验 B1-B5 是否遵循契约 SSOT

| # | BA 核验点 | 实现遵循 | 结论 |
|---|---|---|---|
| B1 | 角色无 code 字段，冲突码 ROLE_NAME_DUPLICATE（非 ROLE_CODE_DUPLICATE） | `RoleForm.tsx:61` raw={name, description, permission_codes}（无 code）；`errorMapping.ts:36` ROLE_NAME_DUPLICATE='角色名称已存在'（非 ROLE_CODE_DUPLICATE）；contracts roleSchema/createRoleInputSchema 无 code 字段 | ✅ 遵循 |
| B2 | listRoleQuerySchema 无筛选字段，客户端名称搜索仅过滤当前页 | `RoleListPage.tsx:122-125` keyword 过滤当前页 items（非服务端筛选）；`api/roles.ts:28-30` listRoles(query) 仅传 page/pageSize | ✅ 遵循 |
| B3 | 审计筛选无 action（contract listAuditLogQuerySchema 明示不支持） | `AuditLogPage.tsx:117-172` 筛选区仅 entity_type/operator_id/operated_from/operated_to，无 action 控件；`api/audit-logs.ts:15` listAuditLogs(query) query 类型 ListAuditLogQuery 无 action 字段 | ✅ 遵循 |
| B4 | 部门分配覆盖式幂等（无"已在该部门"码，重复分配同部门=200） | `DeptNode.tsx:62` 成功 → setError('部门归属已更新')（无"已在该部门"提示）；`api/departments.ts:42` assignUserDepartment path 参数覆盖式幂等；errorCodeSchema 无"已在该部门"码 | ✅ 遵循 |
| B5 | GET /v1/users/:userId/roles 返回裸 UserRole[]（无 envelope） | `api/roles.ts:50-52` listUserRoles 返回 Promise<UserRole[]>；`UserRolesPanel.tsx:46-49` userRoles 直接 .map(ur => ur.role_id)（裸数组消费，非 items 包装） | ✅ 遵循 |

**B1-B5 小结**：5/5 ✅ 全部遵循 contracts SSOT。PRD BA 核验发现的 5 处任务描述偏离均以 contracts SSOT 为准，Tech-Spec §1.3 + impl 实现一致遵循。

### 重点项 2：D7 角色删除 versioned + 409 重试（复用 R12 D9）是否正确

**实现位置**：`api/roles.ts:42-47`
```ts
export function deleteRole(id: string, expectedVersion: number): Promise<void> {
  return request<void>('DELETE', `/v1/roles/${id}`, {
    versioned: true,
    expectedVersion,
  });
}
```

**判定**：✅ **正确**
- versioned=true + expectedVersion → client 注入 If-Match（R12 D7 沿用，AC-F3-7）。
- 409 VERSION_CONFLICT 由 client 自动重试 1 次（用 409 body current_version，不 GET 单条，R12 D9 沿用，AC-F3-2）。
- 重试仍 409 抛 ApiError → errorMapping VERSION_CONFLICT='数据已被修改，请刷新后重试'（AC-F3-3）。
- ROLE_IN_USE（409 但非 VERSION_CONFLICT）不重试——client 仅对 VERSION_CONFLICT 重试，ROLE_IN_USE 抛 ApiError 由调用方处理（api/roles.ts L40 注释明示）。
- 删除成功（含重试成功）→ RoleListPage refresh() 取最新 version（多约束组合 #1 闭合）。
- ROLE_NOT_FOUND → refresh() 移除已不存在行（AC-F3-6）。
- 测试覆盖：`api-roles.test.ts` If-Match 注入 + 409 重试 + 重试仍冲突用例。

### 重点项 3：D8 部门删除非 versioned（无 If-Match）是否正确

**实现位置**：`api/departments.ts:37-39`
```ts
export function deleteDepartment(id: string): Promise<void> {
  return request<void>('DELETE', `/v1/departments/${id}`);
}
```

**判定**：✅ **正确**
- 不传 versioned/expectedVersion → client 不注入 If-Match（D8，AC-F5-7）。
- server.ts L320-324 DELETE /v1/departments/:id 无第 5 参 true（非 versioned）✅。
- DEPT_HAS_CHILDREN / DEPT_NOT_FOUND 由调用方处理（DeptNode handleDelete catch → setError）。
- client 仅对 VERSION_CONFLICT 重试，DEPT_* 码不重试（多约束组合 #2 闭合）。
- **D8 与 D7 有意分歧**：部门域 contract departmentSchema 无 version 字段（后端未启用乐观锁），impl 不得对部门删除传 versioned=true（api/departments.ts L33 注释明示）。
- 测试覆盖：`api-departments.test.ts` DELETE 非 versioned 无 If-Match 断言。

### 重点项 4：D9 errorMapping 扩展是否覆盖角色/部门/审计码 + R12 既有码不破坏

**实现位置**：`lib/errorMapping.ts:19-44`

**判定**：✅ **正确**
- **角色域码**（L35-39）：ROLE_NOT_FOUND/ROLE_NAME_DUPLICATE/ROLE_BUILTIN_FORBIDDEN/ROLE_IN_USE/USER_ROLE_ALREADY_ASSIGNED 中文提示，对齐 §11.1 矩阵 ✅。
- **部门域码**（L40-43）：DEPT_NOT_FOUND/DEPT_NAME_DUPLICATE/DEPT_HAS_CHILDREN/DEPT_DEPTH_EXCEEDED 中文提示，对齐 §11.2 矩阵 ✅。
- **审计域码**：AUDIT_LOG_NOT_FOUND 未列 SPECIFIC_MESSAGES → FALLBACK 兜底（AC-F9-4，本期只读无写不触发）✅。
- **R12 既有码不破坏**（L20-33）：VALIDATION_ERROR/FORBIDDEN/USER_NOT_FOUND/USER_EMAIL_DUPLICATE/USER_DISABLE_SELF_FORBIDDEN/USER_ALREADY_DISABLED/USER_ALREADY_ACTIVE/INVALID_CREDENTIALS/TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED/UNAUTHORIZED/VERSION_REQUIRED/VERSION_CONFLICT 均保留 ✅。
- **SSOT 派生机制保留**（L54-59）：ERROR_MESSAGES = Object.fromEntries([...errorCodeSchema.options].map(...))，键仍从 SSOT 派生（R12 D11 沿用，AC-F9-3）✅。
- **errorCodeSchema 枚举未扩展**：角色/部门/审计码本就在 errorCodeSchema 全集内（contracts user.ts L138-163 核验），非新增枚举键，SSOT 派生断言不失效 ✅。
- 测试覆盖：`error-mapping-extend.test.ts` 角色域码 + 部门域码 + AUDIT_LOG_NOT_FOUND FALLBACK + SSOT 派生 + R12 既有码不破坏断言。

> **①类显式影响**：R12 error-mapping.test.ts 既有断言 `ROLE_NOT_FOUND → toContain('操作失败')`（FALLBACK）在 R14 扩展后失效（ROLE_NOT_FOUND 改为具体提示"角色不存在"）。impl-writer 调整为 `toContain('角色不存在')`，详见 §8。

### 重点项 5：D10 审计用 redactedAuditLogSchema（禁用 auditLogSchema 存储态）

**实现核查**：
- `AuditLogPage.tsx:23` import type { RedactedAuditLog } from '@admin/contracts' ✅。
- `api/audit-logs.ts:11` import type { AuditLogListResult, ListAuditLogQuery } from '@admin/contracts'（AuditLogListResult.items 为 RedactedAuditLog[]）✅。
- **0 处 import auditLogSchema/AuditLog/piiFieldRegistrySchema**：grep 确认 R14 新增文件无 import 存储态 schema ✅。
- AuditLogPage L199-201 直接展示 `f.value`（后端已脱敏，前端不还原）✅。
- operator_id/operator_name/before-after 禁止 console.log（R14 新增文件 0 console.log）✅。

**判定**：✅ **合规**。D10 [约束] + SEC-003b 延伸落地：前端只消费脱敏态，禁用存储态，PII 不还原不入日志。

### 重点项 6：D11 客户端名称搜索 advisory（仅过滤当前页）

**实现位置**：`RoleListPage.tsx:122-125`
```ts
const keyword = searchKeyword.trim().toLowerCase();
const filteredItems = keyword
  ? items.filter((r) => r.name.toLowerCase().includes(keyword))
  : items;
```

**判定**：✅ **正确**
- 仅过滤当前页 items（非服务端筛选，listRoleQuerySchema 无筛选字段 B2）。
- 不发新请求（无 useEffect 依赖 searchKeyword）。
- D11 [advisory] 已同步 Spec §10 ✅。
- advisory 测试可选（PRD AC-F1-6 注明"advisory 增强非核心验收"）。

### 重点项 7：D12 DeptNode 递归无限制

**实现位置**：`DeptNode.tsx:107-113`
```tsx
{node.children.length > 0 && (
  <ul>
    {node.children.map((child) => (
      <DeptNode key={child.id} node={child} onRefresh={onRefresh} />
    ))}
  </ul>
)}
```

**判定**：✅ **正确**
- 递归渲染 DepartmentTreeNode 全部层级，无前端深度限制（Q4 决策①，D12）。
- 后端已限层级上限 3（DEPT_DEPTH_EXCEEDED 强制），前端无须重复限制。
- 叶节点 children=[] 不渲染子节点容器（L107 `node.children.length > 0` 判断）。
- 递归 Zod schema（departmentTreeNodeSchema z.lazy）前端正确消费。

### 重点项 8：D13 parentId 可选

**实现位置**：`DeptForm.tsx:52-55`
```ts
const raw: { name: string; parent_id?: string | null } = { name: trimmedName };
if (parentId !== undefined && parentId !== null) {
  raw.parent_id = parentId;
}
```

**判定**：✅ **正确**
- parentId 缺省/null → raw 不含 parent_id（根部门，AC-F5-2）。
- parentId 提供 uuid → raw.parent_id（子部门，AC-F5-3）。
- 对齐 createDepartmentInputSchema parent_id optional nullable（Q5 决策①，D13）。
- 单一表单覆盖根/子部门两种场景。

### 重点项 9：R13 S-1 区分两类表单（RoleForm/DeptForm safeParse vs UserRolesPanel/DeptTreePage 类型派生）

**判定**：✅ **正确**
- **自由文本表单（须 safeParse，D4）**：
  - `RoleForm.tsx:63` createRoleInputSchema.safeParse（覆盖 name 1..64 + description max512 + permission_codes 数组 + .strict() 拒多余字段）。
  - `DeptForm.tsx:57` createDepartmentInputSchema.safeParse（覆盖 name 1..64 + parent_id uuid|null 可选 + .strict()）。
- **类型派生操作（TS 类型保证，safeParse 冗余，D5）**：
  - `UserRolesPanel.tsx:63` toggle（roleId 从 allRoles 派生，Role.id 为 uuid 字面量 TS 类型保证，不调 safeParse）。
  - `DeptNode.tsx:61` 用户分配（departmentId 从树派生，DepartmentTreeNode.id 为 uuid 字面量 TS 类型保证，不调 safeParse）。
  - `RoleForm.tsx:31` permission_codes 多选（options 从 [...permissionCodeSchema.options] SSOT 派生，值 ∈ 枚举编译期保证）。
- **RoleForm 混合表单**（§3.2 提示）：整体 createRoleInputSchema.safeParse 覆盖 name/description 自由文本，permission_codes 字段值经多选 options 派生保证合法（safeParse 不会在此字段失败）。单一 safeParse 调用同时覆盖两类字段，非"类型派生字段单独跳过 safeParse"。
- **AC-ARCH-4 完全对齐**（优于 R12 partial）：impl 显式标注类型派生操作不调 safeParse + 理由（D5 [约束] + R13 S-1 固化）。

### 重点项 10：多约束组合副作用 7 条是否全部规避

详见 §9 多[约束]组合副作用核对。7 条预判全部正确实现，无副作用 bug。

## §4 advisory 偏离核对（AI-003 / R13 S-2 固化）

### impl-writer 自报 4 项 + Reviewer 发现 4 项

| # | 偏离项 | Spec 预判/同步状态 | 判定 |
|---|---|---|---|
| 1 | **UserRow 按钮文案"禁用"沿用 R12 S-1**（R14 新增"角色"按钮文案偏离） | R12 S-1 已记录 UserRow 按钮文案统一"禁用"（双向切换，功能完整）。R14 新增"角色"按钮文案为"角色"（非"用户角色"等），UserRow.tsx:15-18 注释详细说明不破坏 R12 user-list-page.test.tsx（getByRole('button', { name: /禁用/i }) 单匹配，"角色"不匹配）。**Tech-Spec §10 未列此项**（R12 既有偏离沿用，R14 新增按钮文案为纯 UI label） | ⚠️ **合理偏离（纯 UI 文案，R13 S-2 不须同步 Spec §10 但须 Review 报告记录）**——S-1。功能不弱化（双向切换 + 角色按钮触发 UserRolesPanel） |
| 2 | **AuditLogPage PII 信任后端脱敏**（直接展示 f.value 不还原） | `AuditLogPage.tsx:199-201` log.after.map(f => String(f.value))，后端已脱敏为 ab***@example.com，前端直接展示脱敏值。**对齐 AC-F7-10**（展示脱敏值，不展示完整邮箱）。**Tech-Spec §10 D10 已记录**"前端展示脱敏值不还原" | ✅ **合理偏离（已同步 Spec §10 D10）**——D10/§6.7 明确，前端信任后端脱敏不还原 |
| 3 | **RoleListPage 客户端搜索**（仅过滤当前页，D11 advisory） | `RoleListPage.tsx:122-125` keyword 过滤当前页 items。**Tech-Spec §10 D11 已同步**（[advisory] 客户端名称搜索仅过滤当前页，非服务端筛选） | ✅ **合理偏离（已同步 Spec §10 D11）**——D11/§6.1 明确 |
| 4 | **DeptTreePage 创建根部门入口**（页面级"创建根部门"按钮） | `DeptTreePage.tsx:77-79` "创建根部门"按钮 → <DeptForm parentId={null}>。**对齐 AC-F5-2**（创建根部门 parentId 缺省）。Spec §6.4 描述"创建根部门按钮 → 打开 DeptForm（parentId 缺省）"，实现 parentId={null}（对齐 optional nullable 语义，raw 不含 parent_id）。**Tech-Spec §10 未列此项**（纯 UI 入口设计，对齐 AC） | ⚠️ **合理偏离（纯 UI 入口，不须同步 Spec §10 但须 Review 报告记录）**——S-2。功能对齐 AC-F5-2 |
| 5 | **getDeptTree 函数名偏离 Spec §4.2.2 getDepartmentTree**（Reviewer 发现） | `api/departments.ts:23` 函数名 `getDeptTree`，Spec §4.2.2 设计为 `getDepartmentTree`。`DeptTreePage.tsx:14` import { getDeptTree }。函数名简写偏离 Spec 字面，但语义一致（GET /v1/departments/tree）。**Tech-Spec §10 未列此项** | ⚠️ **合理偏离（纯命名偏离，不须同步 Spec §10 但须 Review 报告记录）**——S-3。功能不弱化，建议 Spec §4.2.2 同步函数名为 getDeptTree 或 impl 改回 getDepartmentTree |
| 6 | **RoleForm·DeptForm aria-label="名称"**（非"角色名称""部门名称"）（Reviewer 发现） | `RoleForm.tsx:98` aria-label="名称"；`DeptForm.tsx:91` aria-label="名称"。AC-F2-3 字面"角色名称必填"，AC-F5-4 字面"部门名称必填"，但表单 input label 文案仅"名称"（错误提示文案对齐 AC，input label 简写）。**Tech-Spec §10 未列此项** | ⚠️ **合理偏离（纯 UI label 文案，不须同步 Spec §10 但须 Review 报告记录）**——S-4。功能不弱化（错误提示文案对齐 AC），建议 aria-label 改为"角色名称"/"部门名称"提升可访问性 |
| 7 | **AuditLogPage useEffect 依赖 [page, entityType, operatorId, operatedFrom, operatedTo] 每键入触发请求**（Reviewer 发现） | `AuditLogPage.tsx:101` useEffect 依赖数组含 operatorId/operatedFrom/operatedTo，用户每键入一个字符（operatorId）或修改日期（operatedFrom/operatedTo）就触发一次请求。AC-F7-4/F7-5 字面"WHEN 应用筛选"暗示有"应用筛选"按钮，但实现无按钮（每输入即请求）。**Tech-Spec §10 未列此项**。属 advisory UX 问题（非 AC 强制要求"应用筛选"按钮，每键入触发请求功能上可达筛选效果，但 UX 不佳——频繁请求 + 无防抖） | ⚠️ **合理偏离（advisory UX，不须同步 Spec §10 但须 Review 报告记录）**——S-5。功能对齐 AC-F7-4/F7-5（筛选生效），建议未来加"应用筛选"按钮或 debounce |
| 8 | **errorMapping.ts L62-63 注释"未映射码（ROLE/DEPT 域等）"过时**（Reviewer 发现） | `errorMapping.ts:62-63` 注释"未映射码（ROLE/DEPT 域等）返回通用'操作失败'"，但 L34-43 已将 ROLE_*/DEPT_* 域码映射到 SPECIFIC_MESSAGES（不再 FALLBACK）。注释过时（ROLE/DEPT 域已映射，仅 NOTIFICATION/TRANSFER/ROLE_INHERITANCE 等域未映射）。**Tech-Spec §10 未列此项** | ⚠️ **合理偏离（注释瑕疵，不须同步 Spec §10 但须 Review 报告记录）**——S-6。功能不弱化（映射表正确），建议注释更新为"未映射码（NOTIFICATION/TRANSFER/ROLE_INHERITANCE 等域）" |

### advisory 偏离核对小结

- **已反向同步 Spec §10**：2 项（#2 D10 PII 信任后端脱敏、#3 D11 客户端搜索）✅
- **纯 UI 文案/命名/UX 偏离（R13 S-2 不须同步 Spec §10 但须 Review 报告记录）**：6 项（#1 UserRow 按钮文案沿用 R12 S-1、#4 DeptTreePage 创建根部门入口、#5 getDeptTree 命名偏离、#6 RoleForm·DeptForm aria-label="名称"、#7 AuditLogPage useEffect 每键入触发请求、#8 errorMapping 注释过时）⚠️——均为 suggestion，不阻断合入（功能不弱化 + AC 对齐）。

## §5 [约束] 偏离核对

**0 处 [约束] 偏离需记 blocker**。逐条核对 D1~D24 [约束] 项落地：

- D1 前端分层复用 R12 + 新增三域 ✅（apps/web/src 分层 api/pages/components/auth/lib 沿用，新增模块依赖方向单向）
- D2 ARCH-003 持续合规 ✅（见 §7）
- D3 类型 z.infer 派生 + 禁用存储态类型 ✅（全部 import type from @admin/contracts，未 import auditLogSchema/userEntitySchema/piiFieldRegistrySchema）
- D4 自由文本表单须 safeParse ✅（RoleForm createRoleInputSchema.safeParse + DeptForm createDepartmentInputSchema.safeParse，AC-ARCH-3 完全对齐）
- D5 类型派生操作不强制 safeParse ✅（UserRolesPanel toggle + DeptNode 用户分配 + RoleForm permission_codes 多选，AC-ARCH-4 完全对齐，impl 显式标注理由）
- D6 API client 复用 R12 ✅（新增 api 模块仅调 request<T>，不重复封装 fetch）
- D7 角色删除 versioned + If-Match + 409 重试 ✅（api/roles.ts deleteRole versioned=true + expectedVersion，AC-F3-7）
- D8 部门删除非 versioned ✅（api/departments.ts deleteDepartment 无 versioned/expectedVersion，AC-F5-7）
- D9 errorMapping 扩展 SPECIFIC_MESSAGES ✅（角色/部门码中文 + SSOT 派生保留，AC-F9-1/2/3）
- D10 审计 PII 脱敏类型 ✅（消费 redactedAuditLogSchema，禁用 auditLogSchema，AC-F7-10）
- D11 客户端名称搜索 advisory ✅（仅过滤当前页，已同步 Spec §10）
- D12 部门树递归无深度限制 ✅（DeptNode 递归渲染无限制，AC-F5-1）
- D13 部门创建 parentId 可选 ✅（DeptForm parentId 缺省/null=根部门，AC-F5-2/3）
- D14 审计筛选对齐 contract（无 action）✅（AuditLogPage 筛选区无 action 控件，AC-F7-7）
- D15 审计 date_range datetime-local + ISO 归一 ✅（normalizeDatetime new Date(...).toISOString()，AC-F7-5，归一逻辑 advisory 已记录 Review 报告）
- D16 侧边栏导航 ✅（Sidebar 4 入口 + 登出，AC-F8-1）
- D17 角色详情页不做 ✅（无 /roles/:id 路由，Q9 决策②）
- D18 角色继承管理 out-of-scope ✅（无继承 UI，Q10 决策②）
- D19 effective-permissions out-of-scope ✅（无 effective-permissions UI，Q11 决策②）
- D20 测试范围对齐 R12 Q8 ✅（组件测 + API client 契约测，无 E2E，Q12 决策①）
- D21 列表 pageSize 默认 20 ✅（RoleListPage/AuditLogPage PAGE_SIZE=20 显式传）
- D22 用户角色分配 GET 返回裸 UserRole[] ✅（api/roles.ts listUserRoles 返回 Promise<UserRole[]>，B5）
- D23 用户部门分配幂等 ✅（DeptNode handleAssign 成功提示"部门归属已更新"无"已在该部门"，B4）
- D24 UserListPage 行操作扩展 + errorMapping 扩展属 R12 既有文件改动 ✅（UserRow 新增"角色"按钮 + UserListPage handleToggleRoles 弹 UserRolesPanel + errorMapping 扩展 SPECIFIC_MESSAGES；①类显式影响 error-mapping.test.ts ROLE_NOT_FOUND 断言调整，详见 §8）

**[约束] 偏离小结**：0 blocker。D1~D24 全部 [约束] 项落地，AC-ARCH-4 完全对齐（优于 R12 partial，impl 显式标注类型派生操作不调 safeParse + 理由）。

## §6 测试覆盖核对（AI-006 + R13 S-3）

### §9 测试清单 9 文件预估 vs 实际 11 文件（test-writer 偏离 Spec §9.3）

| # | Spec §9.3 文件 | 实际存在 | 覆盖 AC（Spec 声明） | 实际测试数 |
|---|---|---|---|---|
| 1 | `apps/web/test/api-roles.test.ts`（T1） | ✅ | AC-F3-2/F3-3/F3-7、AC-F4-1、AC-F9-5/F9-6、AC-F10-1/F10-2 | ✅ |
| 2 | `apps/web/test/api-departments.test.ts`（T2） | ✅ | AC-F5-7、AC-F5-1、AC-F6-1 | ✅ |
| 3 | `apps/web/test/api-audit-logs.test.ts`（T3） | ✅ | AC-F7-1~F7-6 | ✅ |
| 4 | `apps/web/test/role-list-page.test.tsx`（T4） | ✅ | AC-F1-1~F1-6、AC-F2-1~F2-6、AC-F3-1/F3-3~F3-6、AC-ARCH-3、AC-S1-1 | ✅ |
| 5 | `apps/web/test/dept-tree-page.test.tsx`（T5） | ✅ | AC-F5-1~F5-9、AC-F6-1~F6-4、AC-ARCH-3、AC-S1-1 | ✅ |
| 6 | `apps/web/test/audit-log-page.test.tsx`（T6） | ✅ | AC-F7-1~F7-11、AC-F7-6、AC-F7-10 | ✅ |
| 7 | `apps/web/test/user-roles-panel.test.tsx`（T7） | ✅ | AC-F4-1~F4-6、AC-ARCH-4、AC-S1-2 | ✅ |
| 8 | `apps/web/test/navigation.test.tsx`（T8） | ✅ | AC-F8-1~F8-4、AC-ARCH-1、AC-ARCH-2、AC-F10-3 | ✅ |
| 9 | `apps/web/test/error-mapping.test.ts`（T9，扩展 R12 既有） | ✅（R12 既有 + R14 改 1 处断言） | AC-F9-1~F9-4、AC-F9-3 | ✅ |
| 10 | `apps/web/test/error-mapping-extend.test.ts`（**test-writer 新增，偏离 Spec §9.3**） | ✅ | AC-F9-1~F9-4、AC-F9-3、R12 既有码不破坏 | ✅ |
| 11 | `apps/web/test/role-form.test.tsx`（**test-writer 新增，偏离 Spec §9.3**） | ✅ | AC-F2-1~F2-6、AC-ARCH-3、AC-S1-1 | ✅ |
| 12 | `apps/web/test/dept-form.test.tsx`（**test-writer 新增，偏离 Spec §9.3**） | ✅ | AC-F5-3/4、AC-ARCH-3、AC-S1-1 | ✅ |

**test-writer 偏离 Spec §9.3 的 9 文件预估 → 实际 11 文件**：
- **偏离 1**：Spec §9.3 T9 预估"扩展 R12 既有 error-mapping.test.ts"，实际 test-writer 新增独立文件 `error-mapping-extend.test.ts` + 仅改 R12 error-mapping.test.ts 一处断言（①类显式影响）。**理由合理**：AI-002 禁止改既有测试断言，test-writer 选择新增独立文件覆盖 R14 扩展码 + 仅对 ①类显式影响（ROLE_NOT_FOUND FALLBACK→具体提示）调整 R12 既有断言 matcher（注释标注完整）。
- **偏离 2**：Spec §9.3 T4/T5 将 RoleForm/DeptForm 校验测并入 role-list-page/dept-tree-page 组件测，实际 test-writer 拆出独立 `role-form.test.tsx`/`dept-form.test.tsx`。**理由合理**：更细粒度测试覆盖（RoleForm/DeptForm 为独立组件，独立测试更聚焦 safeParse 校验逻辑）。

**判定**：test-writer 偏离 Spec §9.3 文件数有合理理由（AI-002 边界 + 细粒度测试），③类新增文件数扩充合理，不记 blocker。test-writer 反向核实 ①类显式影响（ROLE_NOT_FOUND 断言需调整）已在 error-mapping-extend.test.ts 注释中列出。

### 68 AC 全覆盖核对（AC↔测试覆盖矩阵）

- F1-1~F1-6 → T4 role-list-page.test.tsx ✅（F1-6 advisory 可选测）
- F2-1~F2-6 → T4 + T11 role-form.test.tsx ✅
- F3-1~F3-7 → T4 + T1 api-roles.test.ts ✅（F3-2/F3-3/F3-7 跨 T1+T4）
- F4-1~F4-6 → T7 user-roles-panel.test.tsx ✅
- F5-1~F5-9 → T5 dept-tree-page.test.tsx + T12 dept-form.test.tsx ✅
- F6-1~F6-4 → T5 dept-tree-page.test.tsx ✅
- F7-1~F7-11 → T6 audit-log-page.test.tsx ✅（F7-6 组合场景、F7-10 PII 脱敏）
- F8-1~F8-4 → T8 navigation.test.tsx ✅
- F9-1~F9-4 → T9 error-mapping.test.ts + T10 error-mapping-extend.test.ts ✅
- F9-5/F9-6 → T1 api-roles.test.ts（沿用 R12）✅
- F10-1/F10-2 → T1/T2/T3 + T8 ✅
- F10-3 → T8 navigation.test.tsx（工程核验）✅
- ARCH-1 → T8 + lint:rules 探针 + Reviewer 逐文件 ✅
- ARCH-2 → T1/T2/T3 + Reviewer ✅
- ARCH-3 → T4/T5/T11/T12 ✅
- ARCH-4 → T7/T4 ✅
- S1-1 → T4/T5/T11/T12 ✅
- S1-2 → T7/T4 ✅

**68 AC 全覆盖 ✅**，无未覆盖 AC（test-writer AC 覆盖矩阵自检 R13 S-3 闭合）。

### ①类显式影响：R12 error-mapping.test.ts ROLE_NOT_FOUND 断言改动是否合理（AI-002 边界判定）

详见 §8 ①类显式影响专项。**判定：合理**（根因 D9 扩展 SPECIFIC_MESSAGES 使 ROLE_NOT_FOUND 从 FALLBACK 升级为具体提示，matcher 文本改动但语义不弱化 + SSOT 派生机制保留 + ①类显式影响注释标注完整）。

### D24 UserListPage 扩展是否破坏 R12 user-list-page.test.tsx

**判定：未破坏**。
- `UserRow.tsx:15-18` 注释详细说明不破坏 R12 user-list-page.test.tsx：
  - L165/L187/L203 用 `getByRole('button', { name: /禁用/i })` 单匹配禁用按钮，"角色"不匹配该正则；
  - L95 `getByText(/启用|active/i)` 匹配 status 文案，"角色"按钮文案不匹配；
  - L107/L121 `getByRole('button', { name: /下一页|>|next/i })` / `getByRole('combobox', { name: /状态|筛选/i })` 亦不与"角色"冲突。
- 编排者实跑 vitest 全量 991/991（web 158 全绿），R12 user-list-page.test.tsx 10 测试全绿 ✅。

### 断言 matcher 改动核对（git diff test/ 确认仅 ①类显式影响一处）

**判定：pass（仅 ①类显式影响一处）**。
- `git diff HEAD --stat -- apps/web/test/` 输出：仅 `error-mapping.test.ts | 11 ++++++++---`（1 文件改动，+8/-3 行）。
- `git diff HEAD -- apps/web/test/error-mapping.test.ts` 显示唯一改动：
  - 原：`it('未映射码（如 ROLE_NOT_FOUND）→ 通用"操作失败"提示（AC-F7-2）', () => { const msg = mapErrorToMessage('ROLE_NOT_FOUND'); expect(msg).toContain('操作失败'); });`
  - 新：`it('ROLE_NOT_FOUND → "角色不存在"提示（R14 D9 扩展后从 FALLBACK 升级为具体提示，AC-F9-1）', () => { const msg = mapErrorToMessage('ROLE_NOT_FOUND'); expect(msg).toContain('角色不存在'); });`
  - 注释标注完整：①类显式影响 + 改动性质=断言 matcher 调整 + 理由=D9 扩展使 ROLE_NOT_FOUND 从 FALLBACK 升级为具体提示 + Reviewer 确认提示。
- 其他 R12 测试文件（api-client.test.ts、login-page.test.tsx、create-user-modal.test.tsx、route-guard.test.tsx、user-list-page.test.tsx、setup.ts）零修改。
- impl-writer 自报"未改 setup/import 路径，仅 ①类显式影响改 matcher 文本"属实，AI-002 合规。

### AI-006 是否生效

✅ **生效**。Tech-Spec §9 三类标注完整（①类 0~2 显式边缘 + 0 隐式 / ②类 0 / ③类 9 文件预估），test-writer 实际新增 11 文件（偏离有理由），68 AC 全覆盖，①类显式影响识别 + 反向核实闭合。

## §7 ARCH-003 专项（R14 持续合规验证）

### 7.1 逐文件核对 apps/web/src 新增模块 import（11 文件）

| 文件 | import 来源 | ARCH-003 合规 |
|---|---|---|
| api/roles.ts | @admin/contracts (type), ./client.js | ✅ |
| api/departments.ts | @admin/contracts (type), ./client.js | ✅ |
| api/audit-logs.ts | @admin/contracts (type), ./client.js | ✅ |
| pages/RoleListPage.tsx | react, @admin/contracts (type), ../api/roles.js, ../api/client.js, ../components/ErrorBanner.js, ../components/RoleForm.js, ../lib/errorMapping.js | ✅ |
| pages/DeptTreePage.tsx | react, @admin/contracts (type), ../api/departments.js, ../api/client.js, ../components/ErrorBanner.js, ../components/DeptNode.js, ../components/DeptForm.js, ../lib/errorMapping.js | ✅ |
| pages/AuditLogPage.tsx | react, @admin/contracts (auditLogEntityTypeSchema + type), ../api/audit-logs.js, ../api/client.js, ../components/ErrorBanner.js, ../lib/errorMapping.js | ✅ |
| components/RoleForm.tsx | react (useState + FormEvent type), @admin/contracts (createRoleInputSchema + permissionCodeSchema + type), ../api/roles.js, ../api/client.js, ../lib/errorMapping.js | ✅ |
| components/DeptForm.tsx | react (useState + FormEvent type), @admin/contracts (createDepartmentInputSchema + type), ../api/departments.js, ../api/client.js, ../lib/errorMapping.js | ✅ |
| components/UserRolesPanel.tsx | react (useEffect + useState), @admin/contracts (type), ../api/roles.js, ../api/client.js, ../lib/errorMapping.js | ✅ |
| components/DeptNode.tsx | react (useState), @admin/contracts (type), ../api/departments.js, ../api/client.js, ../lib/errorMapping.js, ./ErrorBanner.js, ./DeptForm.js | ✅ |
| components/Sidebar.tsx | react-router-dom (Link), ../auth/AuthContext.js | ✅ |

**结论**：11 文件全部仅 import `@admin/contracts` + 第三方（react/react-router-dom）+ apps/web 内部相对模块（`./`、`../`）。**0 处 `apps/api/src/**` 或 `@admin/api` 实际引用**。

### 7.2 apps/api/src 或 @admin/api 引用 grep 确认

```
grep "apps/api/src|@admin/api" apps/web/src → 5 命中，全部为 R12 既有文件注释：
  auth/AuthContext.tsx:8  // [约束] ARCH-003：...禁止 import apps/api/src/**。
  api/roles.ts:11         // [约束] ARCH-003：...禁止 import apps/api/src/**。
  api/auth.ts:7           // [约束] ARCH-003：...禁止 import apps/api/src/**。
  api/client.ts:9         // [约束] ARCH-003：...禁止 import apps/api/src/**。
  api/users.ts:8          // [约束] ARCH-003：...禁止 import apps/api/src/**。
```

R14 新增文件（api/departments.ts、api/audit-logs.ts、pages/*、components/*）0 命中（注释措辞略不同，无 apps/api/src 字样更无实际 import）。✅

### 7.3 lint:rules ARCH-003 + CODE 扫描器是否通过（R13 S-4 已覆盖前端）

- R12 §8 已落地 ARCH-003 分支（check-rules.mjs walkWeb 收集 .ts + .tsx，ARCH003_FORBIDDEN_RE 三条禁止规则 `^@admin/api\b` / `api/src/` / `^apps/api\b`）。
- R13 S-4 已将 walkWeb 提升为顶层函数 + allTs 含 apps/web/src + apps/web/test，使 CODE-001/002/003/004/AI-005 扫描器自动覆盖前端。
- R14 新增 11 前端文件位于 `apps/web/src/`，自动受 ARCH-003 分支 + CODE 扫描器覆盖，lint:rules exit 0 ✅。
- **Reviewer 逐文件核对**（7.1）+ grep 确认（7.2）+ lint:rules exit 0 三重验证 ARCH-003 持续合规。

### 7.4 layering.md 校验方式 + META-003/META-004 闭合

- `layering.md` ARCH-003 校验方式已机器化（含 `check-rules.mjs ARCH-003 分支` + `apps/web/src/**/*.{ts,tsx}` 措辞）✅。
- META-003（声明即实现）：layering.md 校验方式含"check-rules.mjs ARCH-003 分支"措辞 ↔ check-rules.mjs markEnforcement('ARCH-003') ✅。
- META-004（实现即声明）：check-rules.mjs markEnforcement('ARCH-003') ↔ layering.md `## ARCH-003` 块存在 ✅。
- lint:rules 输出"双向绑定：META-003(声明即实现) + META-004(实现即声明) 已校验" ✅。
- R14 无规则文件改动，双向绑定持续闭合。

### 7.5 ARCH-003 专项结论

**ARCH-003 在 R14 新增模块下持续合规**：
- 逐文件核对 0 违规 ✅
- grep 确认 0 实际 import 命中 ✅
- lint:rules ARCH-003 分支 + R13 S-4 CODE 扫描器 exit 0 ✅
- META-003/META-004 双向绑定持续闭合 ✅
- layering.md 校验方式机器化描述持续有效 ✅

R12 最大未验证缺口（ARCH-003 机器化 enforcement）在 R14 多域扩展下持续有效，新增 11 文件自动受约束，无须新增校验逻辑。

## §8 ①类显式影响专项（R14 关键）

### 8.1 R12 error-mapping.test.ts ROLE_NOT_FOUND 断言改动判定

**改动内容**（git diff 确认）：
- 原 R12 断言：`it('未映射码（如 ROLE_NOT_FOUND）→ 通用"操作失败"提示（AC-F7-2）', () => { expect(mapErrorToMessage('ROLE_NOT_FOUND')).toContain('操作失败'); });`
- 新 R14 断言：`it('ROLE_NOT_FOUND → "角色不存在"提示（R14 D9 扩展后从 FALLBACK 升级为具体提示，AC-F9-1）', () => { expect(mapErrorToMessage('ROLE_NOT_FOUND')).toContain('角色不存在'); });`

**判定：合理（AI-002 边界 pass）**。

**判定依据**：
1. **根因是枚举扩展且保留 SSOT 派生**：R14 D9 扩展 SPECIFIC_MESSAGES 追加 `ROLE_NOT_FOUND: '角色不存在'`，使 ROLE_NOT_FOUND 从 FALLBACK（'操作失败，请稍后重试'）升级为具体提示。但映射表键仍从 `[...errorCodeSchema.options]` SSOT 派生（R12 D11 沿用，errorMapping.ts L54-59），errorCodeSchema 枚举未扩展（ROLE_NOT_FOUND 本就在枚举内），SSOT 派生机制不变。
2. **语义不弱化**：从通用 FALLBACK"操作失败，请稍后重试"升级为精准具体提示"角色不存在"，更贴合 AC-F9-1（角色域码中文提示）。语义增强而非弱化。
3. **①类显式影响注释标注完整**：error-mapping.test.ts L52-57 注释明示"原 R12 断言 toContain('操作失败')（ROLE_NOT_FOUND 当年未映射→FALLBACK）；R14 D9 扩展 SPECIFIC_MESSAGES 追加 ROLE_NOT_FOUND: '角色不存在'，ROLE_NOT_FOUND 不再走 FALLBACK；改 setup/断言 matcher 为 toContain('角色不存在') 以对齐扩展后映射（AI-002 已显式列出：受影响文件 + 改动性质=断言 matcher 调整 + 理由=D9 扩展使 ROLE_NOT_FOUND 从 FALLBACK 升级为具体提示）；Reviewer 确认：此为 test-writer 识别的 ①类显式影响，用户在 R14 任务中明确允许调整"。
4. **AI-002 边界判定**：matcher 文本改动（toContain('操作失败') → toContain('角色不存在')）属"断言 matcher 改动"边界，但根因是 D9 扩展使 FALLBACK 失效（非 impl-writer 主观弱化断言），且 SSOT 派生机制保留 + 语义不弱化 + 注释标注完整 → pass。
5. **test-writer 反向核实**：error-mapping-extend.test.ts L8-11 注释明示"①类显式影响：R12 error-mapping.test.ts 既有断言 ROLE_NOT_FOUND → toContain('操作失败')（FALLBACK），R14 扩展 SPECIFIC_MESSAGES 后 ROLE_NOT_FOUND 返回'角色不存在'，R12 既有断言将失败。impl-writer 须调整 R12 error-mapping.test.ts 的 ROLE_NOT_FOUND 断言（matcher 改动须 Reviewer 判定，AI-002 须显式列出受影响文件 + 改动性质 + 理由）。此为 D24 ①类显式影响边缘场景。"——test-writer 反向核实闭合。

**对照 Tech-Spec §9.1 ①类显式影响预估**：Spec §9.1 预估"①类显式影响 0~2 文件（边缘）：user-list-page.test.tsx + error-mapping.test.ts"。实际 ①类显式影响 1 文件（error-mapping.test.ts，ROLE_NOT_FOUND 断言调整）；user-list-page.test.tsx 未受影响（D24 UserListPage 扩展未破坏 R12 既有断言，UserRow 注释详细说明）。Spec 预估准确。

### 8.2 D24 UserListPage 行操作扩展是否破坏 R12 既有测试

**判定：未破坏**。
- `UserRow.tsx:15-18` 注释详细说明 D24 影响核验：新增"角色"按钮不破坏 R12 user-list-page.test.tsx（getByRole('button', { name: /禁用/i }) 单匹配禁用按钮，"角色"不匹配；getByText(/启用|active/i) 匹配 status 文案，"角色"不匹配；getByRole('button', { name: /下一页|>|next/i }) / getByRole('combobox', { name: /状态|筛选/i }) 亦不与"角色"冲突）。
- `UserListPage.tsx:26` import { UserRolesPanel } + L44 rolesPanelUserId state + L135-138 handleToggleRoles + L219-224 条件渲染 <UserRolesPanel>。
- 编排者实跑 vitest 全量 991/991（web 158 全绿），R12 user-list-page.test.tsx 10 测试全绿 ✅。
- D24 ①类显式影响预估（Spec §9.1）准确：user-list-page.test.tsx 未受影响（D24 扩展为新增按钮，未改既有断言）。

### 8.3 AI-002 边界：断言 matcher 改动 vs 断言语义弱化的区分

**判定标准**（R14 固化）：
- **断言 matcher 改动（pass 边界）**：根因是 Spec/契约扩展使原断言失效（如枚举扩展、SPECIFIC_MESSAGES 扩展），matcher 文本改动以对齐扩展后语义，SSOT 派生机制保留，语义不弱化（从通用 → 精准 或从 FALLBACK → 具体提示），①类显式影响注释标注完整。
- **断言语义弱化（blocker 边界）**：impl-writer 主观弱化断言以绕过实现缺陷（如 toEqual → toContain 降级匹配范围、toBe → toBeNull 掩盖返回值变化、删除关键断言），无 Spec/契约扩展根因，无 ①类显式影响标注。

**R14 error-mapping.test.ts ROLE_NOT_FOUND 断言改动**：属"断言 matcher 改动（pass 边界）"——根因 D9 扩展 SPECIFIC_MESSAGES，matcher 文本 toContain('操作失败') → toContain('角色不存在')（同 toContain matcher，仅文本改动，未降级匹配范围），SSOT 派生保留，语义从 FALLBACK 升级为具体提示（增强非弱化），①类显式影响注释标注完整。**pass**。

## §9 多[约束]组合副作用核对（Tech-Spec §10 末 7 条）

| # | 组合 | Spec §10 预判 | 实现核查 | 结论 |
|---|---|---|---|---|
| 1 | 角色删除 versioned (D7) + 409 重试复用 R12 D9 + 列表刷新 | 重试成功后须刷新列表取最新 version（避免下次对同一角色操作用旧 version 又触发 409）；DELETE 重试幂等（重试发生在同次冲突未删成功的场景，409 表示未删除），重试 DELETE 语义安全；若重试时已被其他请求删除则 404 ROLE_NOT_FOUND，前端显示"角色不存在"并刷新 | `RoleListPage.tsx:92-93` deleteRole 成功 → refresh()；L98-100 ROLE_NOT_FOUND → refresh()（移除已不存在行）。client.ts D9 重试仅 1 次（防活锁）。api/roles.ts L40 注释"409 ROLE_IN_USE 不重试（非 VERSION_CONFLICT）" | ✅ 正确 |
| 2 | 部门删除非 versioned (D8) + DEPT_HAS_CHILDREN/DEPT_NOT_FOUND | DELETE department 无 If-Match，无 409 重试路径；DEPT_HAS_CHILDREN/DEPT_NOT_FOUND 由调用方处理；impl 须保证部门删除错误不触发 409 重试逻辑（client 仅对 VERSION_CONFLICT 重试，DEPT_* 码不重试）；impl 不得对部门删除传 versioned=true | `api/departments.ts:37-39` deleteDepartment 无 versioned/expectedVersion；`DeptNode.tsx:47` deleteDepartment(node.id)（无 versioned）；client.ts 仅对 VERSION_CONFLICT 重试，DEPT_HAS_CHILDREN（409 但非 VERSION_CONFLICT）不重试；api/departments.ts L33 注释"409 DEPT_HAS_CHILDREN 不触发 client 409 重试（仅 VERSION_CONFLICT 重试）" | ✅ 正确 |
| 3 | 审计脱敏类型 (D10) + SEC-003b + 禁用 auditLogSchema (D3) | 前端只消费 redactedAuditLogSchema，before/after 中 pii=true 字段已脱敏；impl 须保证：(1) api/audit-logs.ts 返回类型为 AuditLogListResult（items 为 RedactedAuditLog[]）；(2) AuditLogPage 展示 before/after 时直接渲染脱敏值，禁止尝试还原；(3) 禁止 import auditLogSchema | `api/audit-logs.ts:11` import type { AuditLogListResult }（items 为 RedactedAuditLog[]）；`AuditLogPage.tsx:199-201` log.after.map(f => String(f.value))（直接展示脱敏值，不还原）；grep 确认 R14 新增文件 0 处 import auditLogSchema/AuditLog/piiFieldRegistrySchema | ✅ 正确 |
| 4 | errorMapping 扩展 (D9) + SSOT 派生 (R12 D11) + R12 既有测试 (D24) | R14 扩展 SPECIFIC_MESSAGES 新增角色/部门码中文提示，但映射表键仍从 [...errorCodeSchema.options] SSOT 派生；errorCodeSchema 枚举未扩展（角色/部门码本就在枚举内），SSOT 派生断言不失效；但 R12 error-mapping.test.ts 若断言"ROLE_NOT_FOUND → FALLBACK"会失效，impl-writer 须调整断言（D24，AI-002 须显式列出） | `errorMapping.ts:54-59` ERROR_MESSAGES 键从 [...errorCodeSchema.options] SSOT 派生（R12 D11 沿用）；R12 error-mapping.test.ts ROLE_NOT_FOUND 断言已调整为 toContain('角色不存在')（①类显式影响，§8.1 判定 pass）；error-mapping-extend.test.ts L82-92 断言 R12 既有码不破坏（INVALID_CREDENTIALS/VERSION_CONFLICT/USER_DISABLE_SELF_FORBIDDEN） | ✅ 正确 |
| 5 | 401 拦截 (R12 D8) + 新增角色/部门/审计域请求 | R14 新增请求自动受 R12 D8 401 拦截覆盖（鉴权类 4 码清 token + 跳 /login）；impl 须保证新增 api 模块不传 skipAuth（全部需鉴权）；审计页只读，若用户无 audit:read 权限，后端返回 FORBIDDEN（非 401），前端显示"无权限"（errorMapping FORBIDDEN 沿用 R12），不跳登录 | R14 新增 api/roles.ts、api/departments.ts、api/audit-logs.ts 均 import request from './client.js'，不传 skipAuth（全部需鉴权）；R12 client.ts D8 401 拦截沿用；errorMapping L21 FORBIDDEN='无权限执行此操作'（R12 既有） | ✅ 正确 |
| 6 | 自由文本表单 safeParse (D4) + 类型派生操作 (D5) 在 RoleForm 混合 | RoleForm 同时含自由文本（name/description，须 safeParse）与类型派生（permission_codes 多选，safeParse 冗余）；impl 须对整体表单调 createRoleInputSchema.safeParse（覆盖 name/description 校验），permission_codes 值经多选 options 派生保证合法（safeParse 不会在此字段失败）；AC-ARCH-4 针对"独立的类型派生操作"（如 UserRolesPanel toggle），不针对 RoleForm 内的 permission_codes 字段 | `RoleForm.tsx:63` createRoleInputSchema.safeParse(raw)（整体校验覆盖 name/description/permission_codes）；L31 ALL_PERMISSION_CODES = [...permissionCodeSchema.options]（permission_codes 值经 SSOT options 派生保证合法）；L119-123 select multiple options 派生（值 ∈ 枚举编译期保证，safeParse 不会在此字段失败）；UserRolesPanel.tsx L63 独立类型派生 toggle 不调 safeParse（AC-ARCH-4 针对此场景） | ✅ 正确 |
| 7 | UserListPage 行操作扩展 (D24) + UserRolesPanel 触发 | R14 在 R12 UserListPage.tsx 新增"角色"行操作按钮（触发 UserRolesPanel）；impl 须保证：(1) UserRow 组件新增"角色"按钮（onClick 打开 UserRolesPanel，传 userId）；(2) R12 既有 user-list-page.test.tsx 若断言"操作列仅含启停按钮"须调整；(3) UserRolesPanel 独立组件测覆盖 toggle 逻辑，UserListPage 测不覆盖 UserRolesPanel 内部 | `UserRow.tsx:52-54` 新增"角色"按钮 onClick={() => onToggleRoles(user)}；`UserListPage.tsx:135-138` handleToggleRoles → setRolesPanelUserId(user.id)；L219-224 条件渲染 <UserRolesPanel>；R12 user-list-page.test.tsx 10 测试全绿（未破坏，UserRow 注释详细说明）；user-roles-panel.test.tsx 独立测覆盖 toggle 逻辑 | ✅ 正确 |

**多约束组合小结**：7 条预判全部正确实现，无副作用 bug。组合 #1（角色删除 versioned+409重试+列表刷新）+ #2（部门删除非 versioned+DEPT_* 不重试）是 D7/D8 有意分歧的关键正确性保证，实现均满足。组合 #4（errorMapping 扩展+SSOT 派生+R12 既有测试）的 ①类显式影响（ROLE_NOT_FOUND 断言调整）经 §8.1 判定 pass。

## §10 结论与剩余改进项

### 总体结论

三件套全绿（tsc 0 错误 + check-rules.mjs exit 0 ARCH-003 + CODE 扫描器全过 + vitest 991/991 = web 158 + api 833），R14 前端多域扩展交付质量高：
- **AI-007 PRD 逐条核对**：68 条 AC 全对齐（56 功能 + 4 ARCH-003 + 2 R13 S-1），0 ⚠️ 偏离，0 ❌ 未实现。
- **ARCH-003 持续合规**（R14 验证点）：逐文件 0 违规 + grep 0 实际 import + lint:rules ARCH-003 + R13 S-4 CODE 扫描器 exit 0 + META-003/META-004 双向绑定持续闭合。R12 机器化 enforcement 在新增 11 文件下持续有效。
- **多约束组合副作用 7 条预判全部正确实现**（角色删除 versioned+409重试+列表刷新 / 部门删除非 versioned+DEPT_* 不重试 / 审计脱敏+SEC-003b+禁用 auditLogSchema / errorMapping 扩展+SSOT 派生+R12 既有测试 / 401 拦截+新增域请求 / 自由文本 safeParse+类型派生混合 / UserListPage 行操作+UserRolesPanel 触发）。
- **BA 核验 B1-B5 全部遵循 contracts SSOT**（角色无 code/审计无 action 筛选/部门分配幂等/listUserRoles 裸数组/redactedAuditLogSchema）。
- **R13 S-1 在多域下落地**（RoleForm/DeptForm safeParse vs UserRolesPanel/DeptTreePage 类型派生，AC-ARCH-4 完全对齐优于 R12 partial）。
- **R13 S-3 AC↔测试覆盖矩阵自检闭合**（68 AC 全覆盖，test-writer 偏离 Spec §9.3 9 文件 → 实际 11 文件有合理理由）。
- **①类显式影响判定 pass**（error-mapping.test.ts ROLE_NOT_FOUND 断言 matcher 改动，根因 D9 扩展 SPECIFIC_MESSAGES，SSOT 派生保留 + 语义不弱化 + 注释标注完整）。
- **D24 UserListPage 行操作扩展未破坏 R12 user-list-page.test.tsx**（10 测试全绿）。
- **SEC-003b 前端延伸落地**：审计 PII 信任后端脱敏不还原 + 禁用 auditLogSchema + operator_id/operator_name 不入日志 + password/token 沿用 R12 不入日志。

**相比 R12 首轮前端（48 AC + 7 suggestion + AC-ARCH-4 partial）**，本轮 68 AC（56 功能 + 4 ARCH + 2 S-1）+ 8 suggestion，无 blocker，无 [约束] 偏离需记 blocker，AC-ARCH-4 完全对齐。R14 前端多域扩展在 versioned DELETE 重试复用、递归契约渲染、R13 S-1 自由文本/类型派生区分、只读域模式、ARCH-003 持续合规上均验证通过。

### 剩余改进项（8 项 suggestion，不阻断合入）

#### S-1：UserRow 按钮文案"禁用"沿用 R12 S-1 + R14 新增"角色"按钮文案（suggestion）

**位置**：`apps/web/src/components/UserRow.tsx:50-54`（按钮文案）+ `docs/spec/web-auth-user.tech.md` §10（R12 S-1 已记录）
**问题**：R12 S-1 已记录 UserRow 按钮文案统一"禁用"（双向切换，功能完整）。R14 新增"角色"按钮文案为"角色"（非"用户角色"等），UserRow.tsx:15-18 注释详细说明不破坏 R12 user-list-page.test.tsx。R13 S-2 固化：纯 UI 文案偏离不须同步 Spec §10 但须 Review 报告记录。
**建议**：本期接受（功能不弱化 + 测试全绿 + 注释说明完整）。未来可拆双按钮或用 aria-label 区分目标动作。

#### S-2：DeptTreePage 创建根部门入口纯 UI 设计（suggestion）

**位置**：`apps/web/src/pages/DeptTreePage.tsx:77-79`（"创建根部门"按钮）
**问题**：实现"创建根部门"按钮 → <DeptForm parentId={null}>，对齐 AC-F5-2。Spec §6.4 描述"创建根部门按钮 → 打开 DeptForm（parentId 缺省）"，实现 parentId={null}（对齐 optional nullable 语义）。Tech-Spec §10 未列此项（纯 UI 入口设计，对齐 AC）。R13 S-2 固化：纯 UI 文案偏离不须同步 Spec §10 但须 Review 报告记录。
**建议**：本期接受（功能对齐 AC-F5-2）。无须 Spec 同步。

#### S-3：getDeptTree 函数名偏离 Spec §4.2.2 getDepartmentTree（suggestion）

**位置**：`apps/web/src/api/departments.ts:23`（函数名 getDeptTree）+ `docs/spec/web-role-dept-audit.tech.md` §4.2.2（Spec 设计 getDepartmentTree）
**问题**：impl 函数名 `getDeptTree`，Spec §4.2.2 设计为 `getDepartmentTree`。函数名简写偏离 Spec 字面，但语义一致（GET /v1/departments/tree）。DeptTreePage.tsx:14 import { getDeptTree } 一致使用。Tech-Spec §10 未列此项。
**建议**：二选一——(a) Spec §4.2.2 同步函数名为 getDeptTree（反向同步）；(b) impl 改回 getDepartmentTree（对齐 Spec 字面）。推荐 (a)（getDeptTree 更简洁，与 api/users.ts listUsers 风格一致）。非 blocker（语义一致，功能不弱化）。

#### S-4：RoleForm·DeptForm aria-label="名称"（非"角色名称""部门名称"）（suggestion）

**位置**：`apps/web/src/components/RoleForm.tsx:98`（aria-label="名称"）+ `apps/web/src/components/DeptForm.tsx:91`（aria-label="名称"）
**问题**：AC-F2-3 字面"角色名称必填"，AC-F5-4 字面"部门名称必填"，但表单 input label/aria-label 文案仅"名称"（错误提示文案对齐 AC，input label 简写）。Tech-Spec §10 未列此项。R13 S-2 固化：纯 UI label 文案偏离不须同步 Spec §10 但须 Review 报告记录。
**建议**：aria-label 改为"角色名称"/"部门名称"提升可访问性（screen reader 读出更精准）。非 blocker（错误提示文案对齐 AC，功能不弱化）。

#### S-5：AuditLogPage useEffect 依赖数组每键入触发请求（advisory UX）（suggestion）

**位置**：`apps/web/src/pages/AuditLogPage.tsx:101`（useEffect 依赖 [page, entityType, operatorId, operatedFrom, operatedTo]）
**问题**：useEffect 依赖数组含 operatorId/operatedFrom/operatedTo，用户每键入一个字符（operatorId）或修改日期（operatedFrom/operatedTo）就触发一次请求。AC-F7-4/F7-5 字面"WHEN 应用筛选"暗示有"应用筛选"按钮，但实现无按钮（每输入即请求）。属 advisory UX 问题（非 AC 强制要求"应用筛选"按钮，每键入触发请求功能上可达筛选效果，但 UX 不佳——频繁请求 + 无防抖）。Tech-Spec §10 未列此项。
**建议**：未来加"应用筛选"按钮（点击触发请求，而非每键入触发）或 debounce（如 300ms 防抖）。非 blocker（功能对齐 AC-F7-4/F7-5 筛选生效）。

#### S-6：errorMapping.ts L62-63 注释"未映射码（ROLE/DEPT 域等）"过时（suggestion）

**位置**：`apps/web/src/lib/errorMapping.ts:62-63`（注释）
**问题**：注释"未映射码（ROLE/DEPT 域等）返回通用'操作失败'"，但 L34-43 已将 ROLE_*/DEPT_* 域码映射到 SPECIFIC_MESSAGES（不再 FALLBACK）。注释过时（ROLE/DEPT 域已映射，仅 NOTIFICATION/TRANSFER/ROLE_INHERITANCE 等域未映射）。Tech-Spec §10 未列此项。
**建议**：注释更新为"未映射码（NOTIFICATION/TRANSFER/ROLE_INHERITANCE 等域）返回通用'操作失败'"。非 blocker（映射表正确，仅注释瑕疵）。

#### S-7：AuditLogPage 变更摘要仅展示 after 不展示 before（suggestion）

**位置**：`apps/web/src/pages/AuditLogPage.tsx:199-201`（log.after.map(f => String(f.value))）
**问题**：变更摘要仅展示 after 字段值，不展示 before 字段值（AC-F7-1 字面"变更摘要"未明确要求 before/after 都展示）。审计日志 before/after 为结构化变更快照（changeFieldSchema {field, value, pii}），实现仅 String 化 after.value 展示，未展示 field 名 + before/after 对比。属 advisory UX 问题（功能上展示变更后值，但未展示变更前后对比 + 字段名）。
**建议**：未来优化变更摘要展示（如 `field: before → after` 格式），提升审计可读性。非 blocker（AC-F7-1 字面"变更摘要"未明确要求 before/after 对比，功能上展示 after 值可达摘要效果）。

#### S-8：test-writer 偏离 Spec §9.3 的 9 文件预估 → 实际 11 文件（suggestion）

**位置**：`apps/web/test/error-mapping-extend.test.ts` + `apps/web/test/role-form.test.tsx` + `apps/web/test/dept-form.test.tsx`（test-writer 新增，偏离 Spec §9.3）+ `docs/spec/web-role-dept-audit.tech.md` §9.3
**问题**：Spec §9.3 预估 9 测试文件，test-writer 实际新增 11 文件（多出 error-mapping-extend.test.ts、role-form.test.tsx、dept-form.test.tsx）。test-writer 偏离有合理理由（AI-002 边界 + 细粒度测试覆盖），但 Spec §9.3 未同步实际文件清单。
**建议**：Spec §9.3 反向同步实际 11 文件清单（闭合 AI-006 受影响测试清单准确性）。非 blocker（test-writer 偏离有理由，68 AC 全覆盖）。

### verdict 判定

- **AC 对齐**：68/68 ✅ + 0 ⚠️ + 0 ❌ ✅
- **规则合规**：AI-001~007 + ARCH-001/002/003 + CODE-001~004 + SEC-001/002/003a/003b + META-001~004 全部合规；ARCH-003 机器化持续合规（lint:rules exit 0 + 逐文件核对 0 违规 + grep 0 实际 import）+ META-003/004 双向绑定持续闭合 + R13 S-4 CODE 扫描器覆盖前端 ✅（无 blocker）
- **advisory 偏离**：8 项（2 项已同步 Spec §10 D10/D11 + 6 项纯 UI 文案/命名/UX 偏离 R13 S-2 不须同步 Spec §10 但须 Review 报告记录）⚠️（suggestion）
- **[约束] 偏离**：0 blocker（D1~D24 全部落地，AC-ARCH-4 完全对齐优于 R12 partial）✅
- **多约束组合副作用**：7 条预判全部正确实现 ✅
- **①类显式影响**：error-mapping.test.ts ROLE_NOT_FOUND 断言改动判定 pass（根因 D9 扩展 + SSOT 派生保留 + 语义不弱化 + 注释标注完整）✅
- **D24 UserListPage 扩展**：未破坏 R12 user-list-page.test.tsx（10 测试全绿）✅
- **blocker**：0 ✅

**verdict**：**pass**（68 AC 全对齐 + ARCH-003 持续合规 + 规则合规无 blocker + 多约束组合副作用全部正确 + ①类显式影响判定 pass + D24 未破坏 R12 既有测试 + 8 项 suggestion 均为文案/命名/UX/注释/Spec 同步类改进不阻断合入）

### 是否需要 impl-writer 修复后复验

**不需要立即复验**。8 项 suggestion 均为改进类（纯 UI 文案偏离记录 / 函数名同步 / aria-label 可访问性 / useEffect 防抖 UX / 注释更新 / 变更摘要展示 / Spec §9.3 文件清单同步），不影响功能正确性、AC 对齐、规则合规性（lint:rules exit 0 + ARCH-003 持续合规 + ①类显式影响判定 pass）。建议在下一轮演练前由 impl-writer 补齐 8 项 suggestion（特别是 S-3 getDeptTree 命名同步 + S-6 注释更新 + S-8 Spec §9.3 文件清单同步，闭合 AI-003/AI-006 可验证性要求），但不阻断本轮合入。
