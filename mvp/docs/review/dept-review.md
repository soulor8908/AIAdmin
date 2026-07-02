---
doc_type: Review-Report
id: REV-DEPT-001
tech_spec_ref: TECH-DEPT-001
verdict: pass
created: 2026-07-02
---
# 部门管理 · Code Review 报告（第三轮演练）

评审范围：本次"部门管理"PR 全部代码——新增 `apps/api/src/{domain,repository,service,router}/dept.ts` + `apps/api/test/dept.test.ts`；联动改动 `apps/api/src/errors.ts`、`apps/api/src/repository/user.ts`、`apps/api/src/router/index.ts`、`apps/api/test/role.test.ts`；契约层 `packages/contracts/src/schemas/{dept,user,role}.ts` + `packages/contracts/src/index.ts`（契约层已先期合入于 commit `2d8c656`，本轮 apps/api impl 为未提交批次）。对照 `.trae/rules` 全部规则与 `docs/spec/dept.tech.md` 逐条核查。

本轮重点验证：META-003/004 双向绑定复验（核心）、跨域契约一致性（新增）、advisory 偏离、测试先行、编排者修复评估。

## 汇总
- blocker 数：0
- suggestion 数：4
- verdict：**pass**（无阻断项；META-003/004 双向绑定条数一致且漂移/缺口双消除；跨域契约联动与 Spec 声明一致、errors.ts 穷举、userRepo 新方法被 dept service 正确消费、既有 user/role 测试无破坏；advisory 无实质偏离；测试五类覆盖精确；三件套全绿）
- 三件套门禁：typecheck pass（`tsc --noEmit` exit 0）/ lint:rules pass（`check-rules.mjs` exit 0，输出"双向绑定已校验"）/ test pass（`vitest run` 200 用例全绿：dept 92 + role 73 + user 35）
- 规则机器化覆盖率：12/19 = 63%（`.trae/rules` 下 19 条规则 ID，check-rules.mjs 专属 enforcement 覆盖 12 条；另 7 条 ARCH-003/SEC-003b/AI-001~004/META-002 显式声明非专属分支，不触发 META-003）

## 逐规则评审

### ARCH-001 · 单向依赖（四层扩面）
- 结论：pass
- 证据：逐文件核对 import 方向，均为单向 `router → service → repository → domain`，四层无反向依赖。
  - `apps/api/src/domain/dept.ts:4` 仅 `import type { Department } from '@admin/contracts'`，不 import 任何上层。
  - `apps/api/src/repository/dept.ts:4` import `../domain/dept.js`（repository → domain，合法）。
  - `apps/api/src/service/dept.ts:11-22` import `@admin/contracts`、`../repository/dept.js`、`../repository/user.js`、`../context.js`、`../domain/dept.js`、`../errors.js`（service → repository/domain，合法；无 router import）。
  - `apps/api/src/router/dept.ts:6-15` import `@admin/contracts`、`zod`、`../service/dept.js`、`./user.js`（router → service，合法；`./user.js` 为同层 `Procedure` 类型复用，合法）。
  - `apps/api/src/router/index.ts` 追加 `createDeptRouter` 聚合，依赖方向合法。
- check-rules.mjs ARCH-001 分支（四层 LAYER_RULES 扩面）扫描通过。

### ARCH-002 · 契约层纯净
- 结论：pass
- 证据：
  - `packages/contracts/src/schemas/dept.ts:11` 仅 `import { z } from 'zod'`，无 apps/ 引用。
  - `packages/contracts/src/index.ts:6-8` 追加 `export * from './schemas/dept.js'`，与 user/role 同构。
  - dept.ts 导出物全部为 Zod schema（6 个 `xxxSchema`）与 `z.infer` 派生类型；层级常量 `MAX_DEPARTMENT_DEPTH` 正确放 domain 层而非 contracts（Spec §影响的模块 [约束]）。
- check-rules.mjs ARCH-002 分支扫描通过。

### ARCH-003 · 跨层只经契约（预留）
- 结论：N/A（预留项）
- 证据：规则校验方式段显式声明"本 MVP 暂无 apps/web，待 web 引入后新增校验；当前无专属 enforcement（不触发 META-003）"。本轮 PR 不涉及 apps/web。CI 整体脚本 + 人工 Review 保障。

### CODE-001 · 禁止 any
- 结论：pass
- 证据：dept 四层新文件 + 联动文件无 `: any` / `as any`。递归树节点用 `z.ZodType<DepartmentTreeNodeBase>` 注解 + `z.lazy` 打破循环，未用 any 绕过。
- check-rules.mjs CODE-001 分支扫描通过。

### CODE-002 · 禁止吞错
- 结论：pass
- 证据：新代码无 catch 块；错误一律 `throw new AppError(code, message)`（service/dept.ts 共 6 处抛出，均带错误码）。
- check-rules.mjs CODE-002 分支扫描通过。

### CODE-003 · 禁止 eval / 动态执行
- 结论：pass
- 证据：新代码无 `eval` / `new Function` / 裸 `Function(`。动态逻辑用 `Map`/对象字面量。
- check-rules.mjs CODE-003 分支扫描通过。

### CODE-004 · Zod schema 命名后缀
- 结论：pass
- 证据：dept.ts 导出的 `departmentSchema` / `createDepartmentInputSchema` / `departmentTreeQuerySchema` / `departmentTreeNodeSchema` / `departmentTreeResultSchema` / `assignUserDepartmentInputSchema` 与 router/dept.ts 的 `deptDeleteProcedureInputSchema` 均以 `Schema` 后缀命名；派生类型用裸名词（`Department` / `DepartmentTreeNode` 等）。递归 schema `departmentTreeNodeSchema` 虽用 `z.lazy`，仍由 `z.object(...)` 赋值的 `export const` 命中正则且带后缀。
- check-rules.mjs CODE-004 分支扫描通过。

### SEC-001 · 路由默认受保护（auth 元数据）
- 结论：pass
- 证据：`apps/api/src/router/dept.ts` 4 个 procedure（tree/create/delete/assignUserDepartment）均显式 `auth: 'admin'`（line 47/53/59/66）。部门管理全 admin，无 public 路由。额外声明 `permission: 'dept:read'|'dept:write'` 元数据（DeptProcedure 扩展），符合 Spec §API 契约 [约束]。
- check-rules.mjs SEC-001 分支扫描通过。

### SEC-002 · 越权校验在 service 层
- 结论：pass
- 证据：`service/dept.ts` 4 个 public 方法（create/delete/assignUserDepartment/tree）首行均调 `this.requireAdmin(ctx)`（line 38/67/95/119），非 admin 抛 `FORBIDDEN`。私有 `requireAdmin` 豁免。符合 Spec §鉴权说明 [advisory]（admin 桩下放行、非 admin 拒绝）。
- check-rules.mjs SEC-002 分支扫描通过。

### SEC-003a · 响应不返回未声明 PII
- 结论：pass
- 证据：输出 schema 均 `.strict()`——`departmentSchema`、`departmentTreeNodeSchema`、`departmentTreeResultSchema`、`userSchema`（line 28/80/92/34）。dept.test.ts 契约测断言 `departmentSchema.safeParse({...extra}).success === false`、`departmentTreeResultSchema.strict` 拒绝多余字段、递归节点 `.strict` 拒绝 `secret` 字段。assign 出参经 `userSchema.parse` 校验含 `department_id`。
- check-rules.mjs SEC-003a 分支扫描通过。

### SEC-003b · 错误消息与日志的 PII 边界
- 结论：pass
- 证据：人工审查 `throw new AppError(...)` 的 message 模板（6 处）：
  - `父部门不存在: ${parentId}` / `部门不存在: ${id}` / `部门不存在: ${departmentId}` / `用户不存在: ${userId}`——均为调用者自身提交的 uuid 或 path 参数，uuid 非 PII。
  - `部门名称已存在: ${input.name}`——name 为调用者自身提交值，允许回显。
  - `层级超限：第 ${newDepth} 层...`——无数值型 PII。
  - 无任何"他人邮箱/手机号"回显；代码无日志写入（无 pino/console），故无日志持久化 PII 风险。
- 校验方式段声明"脚本不精确扫描，由 Reviewer 人工审查"——本项即人工审查结论。

### AI-001 · 先读 Spec 再写码
- 结论：pass
- 证据：新代码全部可溯源至 TECH-DEPT-001——domain 常量（Spec §DB 变更）、repository 方法集（Spec §测试矩阵单测列）、service 守卫序列（Spec §边界与异常 B1-B11）、router procedure 表（Spec §API 契约表）、契约 schema（Spec §API 契约）。无凭对话记忆臆造符号。
- 校验方式段声明"由 Reviewer 流程校验"——本项即 Reviewer 比对结论。

### AI-002 · 测试先行（test-writer 与 impl-writer 分离）
- 结论：pass（含粒度观察，见"测试先行验证"节）
- 证据：dept.test.ts 头部注释（line 1-36）显式声明 test-writer 先行产出 + "impl-writer 须遵循，禁止改测试断言"。92 用例覆盖五类矩阵，impl-writer 的 domain/repo/service/router 实现使全部 92 用例由红转绿。编排者修复的 2 处（role.test.ts:130、dept.test.ts `!`）可识别且非断言语义改动（详见"编排者修复评估"节）。
- 粒度观察：本 PR 为单批未提交变更，无 per-author commit 粒度，无法用 `git diff` 字面证明 impl-writer 未触碰断言行；可观察证据支持 test-first 成立（见"测试先行验证"节 S-4）。

### AI-003 · 禁止越界发挥（advisory 偏离须反向同步）
- 结论：suggestion（S-2）
- 证据：advisory 主路径均按 Spec 实现（Map 内存存储、递归节点私有接口模式、departmentId 必填+可空、name 64 上限），无实质 advisory 偏离，impl-writer 报告"无实质偏离"基本属实。唯一 Spec 未提及项：`service/dept.ts:139-142` tree() 的"孤儿节点兜底挂根"防御分支（父缺失时挂根避免数据丢失），Spec §边界与异常 tree 流程仅声明"B1→B2/B3→返回"，未提及孤儿处理。该分支 benign（正常流程不触发，注释亦声明），但严格按 AI-003 属"Spec 未提及项一律禁止"。
- 反向同步：该分支有内联注释但无正式"反向同步 Spec"声明。
- 建议（S-2）：移除该兜底分支（让孤儿节点静默丢失更贴合内存实现一致性），或反向同步 Spec 在 tree 流程补"孤儿兜底"说明。

### AI-004 · 每次改动必跑三件套
- 结论：pass
- 证据：本轮实跑三件套全绿（见"门禁复核"节）。规则校验方式段声明"AI-004 无专属 enforcement，由 CI 整体执行保障（不触发 META-003）"。

### META-001 · 无校验不立规
- 结论：pass
- 证据：`.trae/rules` 下 19 条规则均含"校验方式"段且含机器校验关键词（check-rules/tsc/vitest/ci/pino/git diff/契约测/Reviewer subagent/编排者实跑/扫描）。META 自身豁免 META-001 关键词检查（脚本 line 206 `if (id.startsWith('META-')) continue`）。check-rules.mjs META-001 分支扫描通过，无 META-001 违规报错。

### META-002 · 规则 PR 准入
- 结论：N/A
- 证据：本 PR（apps/api impl 批次）未改动 `.trae/rules/` 或 `scripts/check-rules.mjs`（git status 仅 apps/api 文件 + 新增 dept 文件）。规则与脚本已于先期 commit `2d8c656`/`8bdde52` 定型。META-002 触发条件不满足。

### META-003 · 声明即实现（无声明漂移）
- 结论：pass（详见"META-003/004 双向绑定复验"节）
- 证据：规则文档声称用 check-rules.mjs 专属分支的规则 ID 共 12 条，脚本内 markEnforcement 注册的 enforcement ID 共 12 条，二者集合完全一致，差集为空，无声明漂移。脚本输出"双向绑定：META-003(声明即实现) 已校验"。

### META-004 · 实现即声明（无反向缺口）
- 结论：pass（详见"META-003/004 双向绑定复验"节）
- 证据：脚本内 12 个 enforcement ID 全部能在 `.trae/rules` 找到同名 `## XXX-NNN` 规则块，差集为空，无反向缺口。脚本输出"双向绑定：META-004(实现即声明) 已校验"。

## META-003/004 双向绑定复验（本轮核心）

### 跑校验
`node scripts/check-rules.mjs` 输出：
```
✅ 规则校验通过
   enforcement 覆盖：ARCH-001/ARCH-002/CODE-001/CODE-002/CODE-003/CODE-004/META-001/META-003/META-004/SEC-001/SEC-002/SEC-003a
   双向绑定：META-003(声明即实现) + META-004(实现即声明) 已校验
```
退出码 0，"双向绑定已校验"字样确认存在。

### 统计（条数一致性）
| 维度 | 计数 | 明细 |
|---|---|---|
| `.trae/rules` 下规则 ID 总数（`## XXX-NNN`） | **19** | ARCH-001/002/003、CODE-001/002/003/004、SEC-001/002/003a/003b、AI-001/002/003/004、META-001/002/003/004 |
| 校验方式段声称用 check-rules.mjs 专属分支（触发 META-003） | **12** | ARCH-001/002、CODE-001/002/003/004、SEC-001/002/003a、META-001/003/004 |
| 脚本内 markEnforcement 分支 | **12** | 与上一行完全同集 |
| 显式声明"非专属分支/不触发 META-003"的规则 | **7** | ARCH-003（预留 apps/web）、SEC-003b（Reviewer 人工）、AI-001（Reviewer 流程）、AI-002（编排者实跑+git diff）、AI-003（Reviewer 扫描）、AI-004（CI 整体）、META-002（CI 同 PR 关联检测） |

- **双向一致性**：声称专属分支 12 条 == 脚本 enforcement 12 条，集合完全相同。
- **META-003 差集**（声明 − 实现）= ∅ → **声明漂移消除**。
- **META-004 差集**（实现 − 声明）= ∅（12 个 enforcement ID 全部在 19 条规则文档内有同名块）→ **反向缺口消除**。
- 7 条非专属分支规则均显式声明替代校验载体（Reviewer/编排者/CI 整体/契约测/pino），正确不触发 META-003，且均通过 META-001 机器关键词检查（ci/tsc/vitest/pino/git diff/契约测/Reviewer subagent/编排者实跑/扫描 命中）。

### 漂移/缺口是否真正消除
**是。** META-003（声明漂移）与 META-004（反向缺口）在本轮均通过脚本差集校验，且本轮 PR 未改动规则/脚本，绑定关系稳定。第三轮演练的核心验证点达成。

### 元级观察（S-3，不阻断）
META-003/META-004 规则文档的"校验方式"段描述机制为"提取脚本内所有 `// === (\w+-\d+) ===` 注释 ID，与规则文档 `## XXX-NNN` 集合做差集"（rule-meta.md line 19/24），但脚本实际通过 `markEnforcement(id)` 函数调用注册 ID 到 `SCRIPT_ENFORCEMENT_IDS` 集合（line 30-32），而非正则扫描 `// ===` 注释。脚本内的 `// ============ ARCH-001 扩面 ============` 仅作分段注释，未参与差集运算。**绑定语义正确**（META-003/004 双向均基于 markEnforcement 集合），但文档描述的载体（注释）与实现载体（函数调用）字面不一致。建议对齐措辞，或并陈两种载体（在 markEnforcement 调用旁补 `// === ID ===` 注释使二者皆可提取），消除元规则自身的描述漂移。

## 跨域一致性（本轮新增验证）

### 1. contracts 改动 vs dept Tech-Spec §跨域契约联动声明
逐项核对，**全部一致**：
| Spec 声明（§跨域契约联动 已落地项） | contracts 实际改动 | 一致性 |
|---|---|---|
| user.ts · userSchema 追加 `department_id: z.string().uuid().nullable().optional()` | `user.ts:30` 字段定义一致（snake_case，可空可选） | ✓ |
| user.ts · createUserInputSchema **不加** department_id（Q5） | `user.ts:41-46` 仅 email+name，.strict() 拒绝该字段 | ✓ |
| user.ts · errorCodeSchema 追加 5 个部门码 | `user.ts:123-134` 追加 DEPT_NOT_FOUND/DEPT_NAME_DUPLICATE/DEPT_HAS_CHILDREN/DEPT_HAS_USERS/DEPT_DEPTH_EXCEEDED，VALIDATION_ERROR 复用不重复 | ✓ |
| role.ts · permissionCodeSchema 追加 dept:read/dept:write | `role.ts:17-24` 枚举 6 项含两码 | ✓ |
| index.ts · 追加 `export * from './schemas/dept.js'` | `index.ts:8` 一致 | ✓ |
| dept.ts · assignUserDepartmentInputSchema 新增 | `dept.ts:104-109` userId+departmentId（必填+可空），归属维护归属 dept 域 | ✓ |
| dept.ts · 不重复定义 errorCodeSchema（避免 export * 重名） | dept.ts 仅 import zod，无 errorCodeSchema 定义 | ✓ |

### 2. errors.ts 错误码映射是否穷举 errorCodeSchema
**穷举。** `errorCodeSchema` 共 18 个枚举值（8 user + 5 role + 5 dept）。`errors.ts:19` 的 `errorCodeToHttpStatus: Record<ErrorCode, number>` 逐一映射 18 个键（8 user + 5 role + 5 dept），其中 5 个部门码映射为 DEPT_NOT_FOUND=404 / DEPT_NAME_DUPLICATE=409 / DEPT_HAS_CHILDREN=409 / DEPT_HAS_USERS=409（[advisory] 预留码仍穷举以维持 Record）/ DEPT_DEPTH_EXCEEDED=409，与 Spec §跨域联动建议映射一致。`Record<ErrorCode, number>` 类型签名由 tsc 强制穷举（缺键报 TS2739），本轮 tsc exit 0 证明穷举完整。

### 3. userRepo 新增方法是否被 dept service 正确使用
**正确使用。** `repository/user.ts` 新增 `findByDepartmentId(deptId)` 与 `updateDepartmentId(userId, departmentId, updatedAt)`：
- `service/dept.ts:80` delete 调 `userRepo.findByDepartmentId(id)` 取归属用户 → line 84 循环 `userRepo.updateDepartmentId(u.id, null, now)` 解除归属（Q1 闭环）。
- `service/dept.ts:97` assign 调 `userRepo.findById(userId)`（既有方法，B9）→ line 110 调 `userRepo.updateDepartmentId(userId, departmentId, now)` 覆盖写。
两新方法签名、返回类型（`UserEntity[]` / `UserEntity | undefined`）与 service 消费契约一致，无悬空调用。

### 4. 跨域改动是否破坏既有 user/role 测试
**未破坏。** `vitest run` 全量 200 用例全绿（dept 92 + role 73 + user 35）。role.test.ts 因枚举扩展由编排者同步更新（4→6 码，见"编排者修复评估"），更新后 73 用例全绿；user.test.ts 35 用例未改且全绿。

### 5. 跨域联动遗留项（S-1，不阻断但需跟踪）
Tech-Spec §跨域契约联动 "待 impl-writer 联动修复" 列 4 项，本轮完成情况：
| 待联动项 | 完成情况 |
|---|---|
| errors.ts 补 5 个部门码映射 | ✅ 已完成（见上 #2） |
| domain/role.ts ALL_PERMISSION_CODES 由枚举派生 + admin seed 覆盖新码 | ✅ 已完成（`domain/role.ts:23` `[...permissionCodeSchema.options]` 自动含两码；role.test.ts:130 验证 6 码） |
| user service/repository 返回 user 显式携带 department_id（含 null） | ⚠️ 部分完成（repository 侧加两新方法 ✅；**service/user.ts 未改**，create/list/updateStatus 仍不显式 set department_id） |
| role.openapi.yaml PermissionCode + user/role.openapi.yaml ErrorCode 同步 | ⏸ 未做（Spec §Out of scope 明列遗留同步项，非本期验收阻塞） |

**S-1**：`service/user.ts` 本期未被触碰（git status 未列），其 `create()`（line 46-53）构造 user 时未 set `department_id`，`list()` 返回 repo 项亦无该字段。因 `userSchema` 中 `department_id` 为 `.optional()`，`userSchema.parse` 仍通过、tsc 不报、user.test.ts 35 用例全绿（无断言 department_id 存在性），**影响 nil**。但 Tech-Spec §跨域联动 [约束] 明确要求"返回 user 时显式携带 department_id（含 null），保 SEC-003a 出参 1:1"，该意图未达成。注意：dept PR 自身返回 user 的路径（assign）经 `updateDepartmentId` 正确 set 了 department_id，故 dept 域 SEC-003a 不受影响；缺口仅在 user 域 create/list 的"显式 1:1"。建议补 `department_id: null` 于 user create，或显式降级并反向同步 Spec。

## advisory 偏离

### impl-writer 报告"无实质偏离"核查
**基本属实。** 逐项核对 advisory 主路径：
- repository 用 Map 内存存储——Spec §影响的模块 [advisory] 允许，按主路径实现。
- 递归树节点用「私有 `DepartmentTreeNodeBase` 接口 + `z.ZodType` 注解 + `z.lazy`」——Spec §API 契约 [advisory] 处方一致，未改用扁平邻接表。
- `departmentId` 取"必填+可空"而非 optional——Spec §API 契约 [advisory] 一致。
- name 长度上限 64——Spec [advisory] 允许 Dev 调整，取 64 与 DB 列宽对齐。
- computeDepth 父不存在保守返回 1——Spec §DB 变更注释"service 层 B4 已先校验"一致，非偏离。

唯一 Spec 未提及项为 `service/dept.ts:139-142` tree() 孤儿节点兜底分支（见 AI-003 / S-2），属防御性 benign 添加而非 advisory 偏离。

### advisory 偏离是否有反向同步说明
- 已实现的 advisory 项均在代码注释与 Spec 内双向标注（[advisory] 标记 + 实现注释），无单向漂移。
- 孤儿兜底分支（S-2）有内联注释但**无正式"反向同步 Spec"声明**，建议补。

## 测试先行验证

### dept.test.ts 断言行是否被 impl-writer 改动
- dept.test.ts 为 untracked 新文件（git log --follow 无历史），无 per-author commit 粒度，无法用 `git diff` 字面区分 test-writer 原稿与 impl-writer 改动。
- 可观察证据支持 test-first 成立：
  1. 头部注释（line 9）明令"impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由"。
  2. impl-writer 交付的 domain/repo/service/router 使全部 92 用例由红转绿（vitest 全绿）。
  3. 断言精确覆盖五类矩阵（见下），无弱断言。
  4. 编排者修复的 2 处（role.test.ts:130、dept.test.ts `!`）可识别且非断言语义改动（详见下节）。
- 粒度局限（S-4）：建议后续演练保留 test-writer/impl-writer 分离提交，获得可审计的 `git diff` 轨迹以字面证明断言未被触碰。

### 测试覆盖五类且断言精确
对照 Spec §测试矩阵，dept.test.ts 92 用例覆盖：
1. **单测**（domain 常量 + repository CRUD + service 裁决）：MAX_DEPARTMENT_DEPTH===3；repo insert/findById/findByParent/list/delete/existsByNameUnderParent/computeDepth（根=1→grandchild=4 逐层 +1）；service create/delete/assign 守卫序列（B4→B5→B6、B7→B8、B9→B10）、根跳过 B4/B5、跨父同名成功、Q1 解除归属置空。
2. **契约测**（出参 schema + 入参 safeParse）：tree/create/assign 出参经 `.parse` 不抛；`.strict()` 拒绝多余字段；递归节点 3 层与第 4 层样本可解析、节点多余字段被拒；入参 safeParse 覆盖 name 空/超 64、parent_id 非 uuid、departmentId 非 uuid 且非 null、departmentId 缺省非法、create 携带 department_id/id 非法等。
3. **边界**（F1-F4）：F1 合法父/根/层级超限/同父同名/跨父同名/父不存在/name 空与超 64；F2 空树/多层级/叶节点 children=[]/多根；F3 无子无用户/无子有用户(Q1)/有子/不存在/含子+含用户先 B8/B11 预留不触发；F4 归属/覆盖写/解除/用户不存在/部门不存在/部门被删后原归属 null 闭环。
4. **权限**：非 admin 调 4 procedure → FORBIDDEN；SEC-003 出参 .strict；SEC-001 procedure 元数据（permission===dept:read/dept:write）。
5. **状态机**（守卫序列顺序 + 删除前置链 + Q1 闭环）：B4 优先 B5、B5 优先 B6、B7 优先 B8、B9 优先 B10；有子→DEPT_HAS_CHILDREN→逐个删子→再删本→204；Q1 删除含用户部门→用户 department_id=null→再查确认无归属→幂等解除。

断言精确：错误码断言用 `expectAppError(promise, code)` 校验 `AppError` 实例 + 精确 code；状态机顺序用"同时命中两条件验先返码"区分优先级；契约测用 `.safeParse(...).success === false` 精确拒绝。107 处 `expect(`，无 `toBeTruthy`/`toBeFalsy` 等弱断言滥用。

## 编排者修复评估（任务 D）

### 修复 1：role.test.ts:130 权限码断言从 4 个改 6 个
- **diff 确认**（`git diff HEAD -- apps/api/test/role.test.ts`）：
  ```diff
  -  it('ALL_PERMISSION_CODES 包含全部 4 个权限码', () => {
  -    expect(ALL_PERMISSION_CODES).toEqual(['user:read', 'user:write', 'role:read', 'role:write']);
  +  it('ALL_PERMISSION_CODES 包含全部 6 个权限码', () => {
  +    expect(ALL_PERMISSION_CODES).toEqual(['user:read', 'user:write', 'role:read', 'role:write', 'dept:read', 'dept:write']);
  ```
- **合理性**：合理且必要。`ALL_PERMISSION_CODES` 由 `[...permissionCodeSchema.options]` 派生（domain/role.ts:23），dept PR 跨域扩展枚举至 6 项后，该断言必须同步为 6 项，否则 toEqual 精确匹配失败。这是**契约 SSOT 扩展驱动的同步**，非为让实现通过而弱化断言——断言仍为精确 toEqual，覆盖反而更全。
- **是否破坏测试先行**：否。AI-002 禁止的是 impl-writer 改断言以让实现通过；此处由**编排者**（非 impl-writer）更新断言以反映跨域契约扩展，属不同关切，且未削弱覆盖。
- **暴露的新问题**：test-writer 写 role.test.ts 时基于旧 4 码枚举硬编码 `toEqual([...4 项])`，对枚举扩展**脆弱**。跨域联动一改，既有域测试即碎，需人工救火。更健壮写法应为 `expect(ALL_PERMISSION_CODES).toEqual([...permissionCodeSchema.options])`（从 SSOT 派生）或 `toHaveLength(6)` + `toContain('dept:read'/'dept:write')`。暴露工作流缺口：**跨域契约变更无自动"受影响测试"可追溯性**，且 test-writer 的全量 toEqual 与枚举 SSOT 耦合过紧。

### 修复 2：dept.test.ts 索引访问加 `!` 非空断言
- **实际清点**（任务称"14 处"，**实测为 9 处 `!` 非空断言，分布于 7 行**）：
  - line 193 `repo.list()[0]!.name`
  - line 662 `const r = result.items[0]!`
  - line 665 `r.children[0]!.id`
  - line 666 `r.children[0]!.children`
  - line 667 `r.children[0]!.children[0]!.id`（2 处）
  - line 668 `r.children[0]!.children[0]!.children`（2 处）
  - line 675 `result.items[0]!.children`
  - 注：任务简报"14 处"为概数，实测 9 处；不影响评估结论。
- **合理性**：合理且必要。`tsconfig.json:7` 设 `noUncheckedIndexedAccess: true`，索引访问 `arr[0]` 类型为 `T | undefined`，直接 `.id` 报 TS2532。`!` 非空断言是 TS 语法层适配，**不改变断言语义**——`result.items[0]!.id` 与（若 TS 允许的）`result.items[0].id` 断言同一目标与同一期望值。本轮 tsc exit 0 证明适配完整。
- **是否破坏测试先行**：否。`!` 是类型层断言而非行为断言改动，`expect()` 的目标与值未变。
- **暴露的新问题**：test-writer 产出测试时**未对测试文件跑 tsc**（或未考虑 noUncheckedIndexedAccess），导致测试本身不通过类型检查，须编排者补 `!` 救火。这使**编排者介入了测试代码编辑**——AI-002 保留给 test-writer（impl-writer 仅可改 setup/import）。`!` 虽属"语法/setup"灰区而非"断言"，但已模糊角色边界。暴露工作流缺口：**test-writer 交付前未强制跑 tsc**，且编排者的测试编辑未显式登记理由。建议：test-writer 交付测试时须自跑 `tsc --noEmit` 通过；编排者任何测试编辑须注明理由并限定于 setup/类型层。

### 综合评估
两修复均**合理、必要、不破坏 test-first 语义**，但共同暴露一个工作流新问题：**跨域联动与 TS 严格配置的副作用会击穿 test-writer 的初始产出，迫使编排者在测试代码上救火**，模糊 test-writer/编排者/impl-writer 三者边界。建议第四轮演练引入：(a) test-writer 交付前自跑 tsc + vitest（导入级绿）；(b) 跨域契约变更附"受影响测试清单"；(c) 编排者测试编辑登记理由。

## 门禁复核
| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npx tsc --noEmit` | exit 0（无类型错误） |
| lint:rules | `node scripts/check-rules.mjs` | exit 0，输出"✅ 规则校验通过 / 双向绑定：META-003+META-004 已校验" |
| test | `npx vitest run` | exit 0，3 文件 200 用例全绿（dept 92 / role 73 / user 35），1.26s |

三件套全绿，符合 AI-004 提交前置条件。

## 最终结论
**verdict: pass**。

- META-003/004 双向绑定复验通过：规则文档 12 条声称 check-rules.mjs 专属分支 == 脚本 12 条 markEnforcement enforcement，双向差集为空，**声明漂移与反向缺口双消除**；7 条非专属分支规则正确声明替代载体，不触发 META-003。
- 跨域一致性通过：contracts 6 项改动与 Spec §跨域联动声明逐项一致；errors.ts 穷举 18 个错误码（Record 强制）；userRepo 两新方法被 dept service 正确消费；既有 user/role 测试无破坏（200/200 绿）。
- advisory 偏离：impl-writer"无实质偏离"基本属实，仅 tree() 孤儿兜底为 Spec 未提及项（S-2）。
- 测试先行：92 用例覆盖五类矩阵、断言精确；编排者 2 修复合理且不破坏 test-first 语义，但暴露 test-writer 交付未自跑 tsc、跨域契约变更无受影响测试清单的工作流缺口。
- 4 条 suggestion（S-1 user service 显式 department_id 未完成 / S-2 tree 孤儿兜底未反向同步 / S-3 META-003/004 文档描述载体与实现载体字面不一致 / S-4 缺 per-author commit 粒度）均不阻断。
- 最值得关注的发现：**S-1**——Tech-Spec §跨域联动 [约束] "user service 返回 user 显式携带 department_id" 为 impl-writer 未完成的联动项（repo 侧已做、service 侧未做），因字段 optional 而 nil 影响、门禁全绿，但 Spec 的"SEC-003a 出参 1:1 显式携带"意图未达成，建议跟踪补齐或显式降级。
