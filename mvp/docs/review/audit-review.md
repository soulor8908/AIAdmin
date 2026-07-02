---
doc_type: Review-Report
id: REV-AUDIT-001
tech_spec_ref: TECH-AUDIT-001
verdict: pass
created: 2026-07-02
---
# 操作日志 · Code Review 报告（第四轮演练）

评审范围：本次"操作日志"PR 全部代码——新增 `apps/api/src/{domain,repository,service,router}/audit.ts` + `apps/api/test/audit.test.ts`；联动改动 `apps/api/src/errors.ts`（补 `AUDIT_LOG_NOT_FOUND`）、`apps/api/src/router/index.ts`（追加 audit router）、`packages/contracts/src/schemas/role.ts`（`permissionCodeSchema` 加 `audit:read`）、`packages/contracts/src/schemas/user.ts`（`errorCodeSchema` 加 `AUDIT_LOG_NOT_FOUND`）、`packages/contracts/src/index.ts`（export audit）；契约层 `packages/contracts/src/schemas/audit.ts`。对照 `.trae/rules` 全部规则与 `docs/spec/audit.tech.md` 逐条核查。

本轮第四轮演练核心验证：①AI-002 tsc 自检 ②AI-005 禁止硬编码跨域可变集合 ③AI-006 受影响测试清单 ④SEC-003b PII 脱敏首次有实现落地。

## 汇总
- blocker 数：0
- suggestion 数：3
- verdict：**pass**（无阻断项；三个 P1 反推优化点全部真正生效，且与第三轮对比改进显著；PII 脱敏真实落地、存储原值/查询脱敏分离闭环；advisory 偏离均已反向同步；三件套全绿）
- 三件套门禁：typecheck pass（`tsc --noEmit` exit 0，含 audit.test.ts 0 错误）/ lint:rules pass（`check-rules.mjs` exit 0，AI-005 分支 0 suggestion，META-003/004 双向绑定已校验）/ test pass（`vitest run` 291 用例全绿：audit 91 + dept 92 + role 73 + user 35）
- 规则机器化覆盖率：13/19 = 68%（`.trae/rules` 下 19 条规则 ID，check-rules.mjs 专属 enforcement 覆盖 13 条——本轮新增 AI-005 enforcement；另 6 条 ARCH-003/SEC-003b/AI-001/003/004/META-002 显式声明非专属分支，不触发 META-003）
- 三大优化点验证结论（详见对应章节）：
  - **AI-002 tsc 自检**：✅ 真正生效。audit.test.ts 0 tsc 错误（grep audit 空），91 用例一次通过；对比第三轮 dept.test.ts 14 处类型错误需编排者救火，本轮零救火。
  - **AI-005 禁止硬编码**：✅ 真正生效。audit.test.ts 跨域枚举断言全用 `[...schema.options]` 派生，`permissionCodeSchema` 加 `audit:read` 后 role.test.ts/audit.test.ts 零改动；对比第三轮 role.test.ts:130 硬编码 4 码被击穿、编排者救火改 6 码，本轮该断言已升级为 SSOT 派生，零击穿。
  - **AI-006 受影响测试清单**：✅ 真正生效。audit.tech.md §受影响测试清单基于真实 grep，逐文件列断言位置 + 更新方向，正确预判"零测试改动"，与 vitest 291/291 绿一致；对比第三轮无清单、跨域联动击穿不可预测。

## 逐规则评审

### ARCH-001 · 单向依赖（四层扩面）
- 结论：pass
- 证据：逐文件核对 import 方向，均为单向 `router → service → repository → domain`，四层无反向依赖。
  - `apps/api/src/domain/audit.ts` 仅导出常量与纯函数，无任何 import（不 import 上层）。
  - `apps/api/src/repository/audit.ts:5` 仅 `import type { AuditLog, AuditLogEntityType } from '@admin/contracts'`（repository → contracts，合法；无 service/router import）。
  - `apps/api/src/service/audit.ts:8-16` import `@admin/contracts`、`../repository/audit.js`、`../context.js`、`../domain/audit.js`、`../errors.js`（service → repository/domain，合法；无 router import）。
  - `apps/api/src/router/audit.ts:6-12` import `@admin/contracts`、`zod`、`../service/audit.js`、`./user.js`（router → service，合法；`./user.js` 为同层 `Procedure` 类型复用，合法）。
  - `apps/api/src/router/index.ts:27-28` 追加 `createAuditRouter` 聚合，依赖方向合法。
- check-rules.mjs ARCH-001 分支扫描通过（exit 0）。

### ARCH-002 · 契约层纯净
- 结论：pass
- 证据：
  - `packages/contracts/src/schemas/audit.ts:11` 仅 `import { z } from 'zod'`，无 apps/ 引用。
  - `packages/contracts/src/index.ts:9` 追加 `export * from './schemas/audit.js'`，与 user/role/dept 同构。
  - audit.ts 导出物全部为 Zod schema（7 个 `xxxSchema`）与 `z.infer` 派生类型；脱敏纯函数 `redactEmail` 与保留期常量 `AUDIT_LOG_RETENTION_DAYS` 正确放 domain 层而非 contracts（Spec §影响的模块 [约束]），符合 ARCH-002。
- check-rules.mjs ARCH-002 分支扫描通过。

### ARCH-003 · 跨层只经契约（预留）
- 结论：N/A（预留项）
- 证据：规则校验方式段显式声明"本 MVP 暂无 apps/web，待 web 引入后新增校验；当前无专属 enforcement（不触发 META-003）"。本轮 PR 不涉及 apps/web。CI 整体脚本 + 人工 Review 保障。

### CODE-001 · 禁止 any
- 结论：pass
- 证据：audit 四层新文件 + 联动文件无 `: any` / `as any`。测试中 `result.items[0]!.after as { email?: string }` / `repo as unknown as { update?: unknown }` 使用 `unknown` + 具体类型断言，非 `any`，符合规则期望行为。`before/after` 用 `z.record(z.unknown())` 承载异构快照，符合 forbidden-patterns.md 期望的"用 unknown + 类型守卫"。
- check-rules.mjs CODE-001 分支扫描通过。

### CODE-002 · 禁止吞错
- 结论：pass
- 证据：新代码无 catch 块；错误一律 `throw new AppError(code, message)`（service/audit.ts 共 2 处抛出：`requireAdmin` 抛 `FORBIDDEN`；router 不抛错，校验失败由调用方 `callProc` 转 `VALIDATION_ERROR`）。
- check-rules.mjs CODE-002 分支扫描通过。

### CODE-003 · 禁止 eval / 动态执行
- 结论：pass
- 证据：新代码无 `eval` / `new Function` / 裸 `Function(`。动态逻辑用对象字面量与数组方法（`map`/`filter`/`sort`/`slice`）。
- check-rules.mjs CODE-003 分支扫描通过。

### CODE-004 · Zod schema 命名后缀
- 结论：pass
- 证据：audit.ts 导出的 7 个 schema 均以 `Schema` 后缀命名——`auditLogEntityTypeSchema` / `auditLogActionSchema` / `auditLogSchema` / `redactedEmailSchema` / `redactedAuditLogSchema` / `listAuditLogQuerySchema` / `auditLogListResultSchema`；派生类型用裸名词（`AuditLog` / `RedactedEmail` / `AuditLogListResult` 等）。联动文件 role.ts 的 `permissionCodeSchema`、user.ts 的 `errorCodeSchema` 均带后缀。
- check-rules.mjs CODE-004 分支扫描通过。

### SEC-001 · 路由默认受保护（auth 元数据）
- 结论：pass
- 证据：`apps/api/src/router/audit.ts` list procedure 显式 `auth: 'admin'`（line 37）。操作日志查询全 admin，无 public 路由。额外声明 `permission: 'audit:read'` 元数据（AuditProcedure 扩展，line 20-22/38），符合 Spec §API 契约 [约束] 与 SEC-001（TECH-AUDIT-001 扩展）。
- check-rules.mjs SEC-001 分支扫描通过。

### SEC-002 · 越权校验在 service 层
- 结论：pass
- 证据：`service/audit.ts` 2 个 public 方法（`list` / `record`）首行均调 `this.requireAdmin(ctx)`（line 48 / 69），非 admin 抛 `FORBIDDEN`。私有 `requireAdmin`（line 31）、`redactLog`、`redactSnapshot` 豁免。符合 Spec §鉴权说明 [advisory]（admin 桩下放行、非 admin 拒绝）。
- check-rules.mjs SEC-002 分支扫描通过。

### SEC-003a · 响应不返回未声明 PII
- 结论：pass
- 证据：输出 schema 均 `.strict()`——`auditLogSchema`（audit.ts:54）、`redactedAuditLogSchema`（audit.ts:89）、`auditLogListResultSchema`（audit.ts:130）。`listAuditLogQuerySchema` 非 strict（与既有 listUserQuerySchema/listRoleQuerySchema 约定一致，advisory：未知 query 键被 strip）。audit.test.ts 契约测断言 `auditLogListResultSchema.safeParse({...extra}).success === false`（line 318-329）、`auditLogSchema.strict` 拒绝 `secret` 字段（line 347-362）、`redactedAuditLogSchema.parse(result.items[0])` 不抛（line 310-316）。
- check-rules.mjs SEC-003a 分支扫描通过（`auditLogListResultSchema` 匹配 `*Result*Schema` 模式且带 `.strict()`，无 warning）。

### SEC-003b · 错误消息与日志的 PII 边界
- 结论：pass（详见"PII 脱敏落地验证"节，本轮为首次有实现落地）
- 证据：人工审查 `throw new AppError(...)` 的 message 模板（2 处）：
  - `requireAdmin` 抛 `'需要管理员权限'`——无数值型 PII，无回显。
  - 测试 `callProc` helper 抛 `parsed.error.message`（Zod 解析失败 detail）——为调用者自身提交的入参错误，允许回显；且测试 helper 非生产路径。
  - 生产 service 无任何日志写入（无 pino/console），故无日志持久化 PII 风险。
  - **审计 before/after 中的 PII 须脱敏**：redactEmail 实现覆盖边缘场景，service.list 返回脱敏态、存储保留原值（详见 PII 节）。
- 校验方式段声明"脚本不精确扫描，由 Reviewer 人工审查"——本项即人工审查结论。

### AI-001 · 先读 Spec 再写码
- 结论：pass
- 证据：新代码全部可溯源至 TECH-AUDIT-001——domain 常量与 redactEmail（Spec §DB 变更代码块）、repository 方法集（Spec §测试矩阵单测列）、service 守卫序列（Spec §边界与异常 B1-B4 + 校验顺序）、router procedure 表（Spec §API 契约表）、契约 schema（Spec §API 契约 + §影响的模块）。无凭对话记忆臆造符号。audit.ts 注释显式标注"派生自 Tech-Spec TECH-AUDIT-001"。
- 校验方式段声明"由 Reviewer 流程校验"——本项即 Reviewer 比对结论。

### AI-002 · 测试先行（test-writer 与 impl-writer 分离 + tsc 自检）
- 结论：pass（详见"AI-002 tsc 自检验证"节，本轮核心验证点）
- 证据：audit.test.ts 头部注释（line 1-27）显式声明 test-writer 先行产出 + "impl-writer 须遵循，禁止改测试断言"。91 用例覆盖五类矩阵。**test-writer 交付前自跑 `tsc --noEmit` 0 错误**（实跑确认 audit.test.ts 0 tsc 错误），impl-writer 实现使全部 91 用例由红转绿，编排者零救火。
- 校验方式段声明"编排者实跑 vitest + git diff + test-writer 附 tsc 自检结果"——本项即实跑结论。

### AI-003 · 禁止越界发挥（advisory 偏离须反向同步）
- 结论：pass（含 1 项 suggestion，见"advisory 偏离"节）
- 证据：advisory 主路径均按 Spec 实现：
  - repository 用数组内存存储——Spec §影响的模块 [advisory] 允许，按主路径实现。
  - `redactEmail` 对 local<2 字符 / 无 @ / 多 @ 边缘场景原样返回——Spec §DB 变更 [advisory] + domain/audit.ts:15-16 注释显式标注"advisory 边缘场景，Dev 须反向同步 Spec"，已反向同步。
  - `AUDIT_LOG_NOT_FOUND` 为预留码本期不触发——Spec §边界与异常 B4 [advisory] + errors.ts:41 注释标注，已反向同步。
  - `DEPT_HAS_USERS` 预留码同上（errors.ts:38）。
  - 既有 OpenAPI 片段未同步——Spec §Out of scope [advisory] 显式记为遗留同步项，非本期验收阻塞。
  - audit:read 端到端鉴权待 Auth 富化——Spec §Out of scope [advisory] 记为遗留风险。
  - 唯一 Spec 未明确提及项：`service/audit.ts:25,101` 的 `EMAIL_LIKE_RE` 值级兜底（key 不含 email 但值匹配邮箱格式时也脱敏）——Spec §API 契约 F3 措辞为"邮箱字段"，实现额外做了值级检测。属"更安全的方向"（多脱敏而非少脱敏），benign，但严格按 AI-003 属 Spec 未提及项。见 S-1。

### AI-004 · 每次改动必跑三件套
- 结论：pass
- 证据：本轮实跑三件套全绿（见"门禁复核"节）。规则校验方式段声明"AI-004 无专属 enforcement，由 CI 整体执行保障（不触发 META-003）"。

### AI-005 · 禁止硬编码跨域可变数据
- 结论：pass（详见"AI-005 禁止硬编码验证"节，本轮核心验证点）
- 证据：audit.test.ts 跨域枚举断言全用 SSOT 派生——`for (const t of auditLogEntityTypeSchema.options)`（line 419-422 / 457-460）、`for (const a of auditLogActionSchema.options)`（line 447-450）、`expect([...permissionCodeSchema.options]).toContain('audit:read')`（line 467-469）。无硬编码权限码列表 / 错误码全集 / 实体类型枚举字面量。`permissionCodeSchema` 加 `audit:read` 后 role.test.ts/audit.test.ts 零改动。
- check-rules.mjs AI-005 分支扫描通过（0 suggestion，输出 enforcement 覆盖含 AI-005）。

### AI-006 · Tech Lead 须产出受影响测试清单
- 结论：pass（详见"AI-006 受影响测试清单验证"节，本轮核心验证点）
- 证据：audit.tech.md §受影响测试清单（line 180-209）章节存在，基于真实 grep（命令与命中明列），逐文件列断言位置 + 受影响判定 + 同步更新方向，正确预判"零测试改动"。
- 校验方式段声明"Reviewer subagent 检查 Tech-Spec 是否含'受影响测试清单'章节；脚本无专属 enforcement，由 Reviewer 流程校验（不触发 META-003）"——本项即 Reviewer 流程结论。

### META-001 · 无校验不立规
- 结论：pass
- 证据：`.trae/rules` 下 19 条规则均含"校验方式"段且含机器校验关键词。本轮新增 AI-005/006 规则文本已含"check-rules.mjs AI-005 分支"/"Reviewer subagent"机器校验关键词。META 自身豁免 META-001 关键词检查。check-rules.mjs META-001 分支扫描通过，无 META-001 违规报错。

### META-002 · 规则 PR 准入
- 结论：N/A
- 证据：本 PR（apps/api impl + contracts 联动批次）未改动 `.trae/rules/`。`scripts/check-rules.mjs` 已含 AI-005 enforcement 分支（先期合入）。META-002 触发条件不满足。

### META-003 · 声明即实现（无声明漂移）
- 结论：pass
- 证据：规则文档声称用 check-rules.mjs 专属分支的规则 ID 共 13 条（本轮新增 AI-005），脚本内 markEnforcement 注册的 enforcement ID 共 13 条，二者集合完全一致，差集为空，无声明漂移。脚本输出"双向绑定：META-003(声明即实现) 已校验"。

### META-004 · 实现即声明（无反向缺口）
- 结论：pass
- 证据：脚本内 13 个 enforcement ID 全部能在 `.trae/rules` 找到同名 `## XXX-NNN` 规则块（含本轮新增 AI-005），差集为空，无反向缺口。脚本输出"双向绑定：META-004(实现即声明) 已校验"。

## AI-002 tsc 自检验证（本轮核心验证点 ①）

### 验证方法
1. 实跑 `npx tsc --noEmit 2>&1 | grep audit.test.ts`，确认 audit.test.ts 是否有语法/noUncheckedIndexedAccess 类型错误。
2. 对比第三轮 dept.test.ts 14 处类型错误需编排者救火（见 RETRO-ROUND3 P1）。

### 验证结果
- **tsc 全量**：`npx tsc --noEmit` exit 0，**0 错误**（含 contracts + apps/api 全量）。
- **audit.test.ts 专项 grep**：`grep audit.test.ts` 输出为空，**audit.test.ts 0 tsc 错误**。
- **noUncheckedIndexedAccess 适配**：tsconfig.json 设 `noUncheckedIndexedAccess: true`，audit.test.ts 全部数组索引访问均正确加 `!` 非空断言（如 line 159 `result.items[0]!.id`、line 175-177 `result.items[0/1/2]!.operated_at`、line 315 `redactedAuditLogSchema.parse(result.items[0])`、line 380 `result.items[0]!.after.email` 等），无 TS2532 报错。
- **vitest 实跑**：audit.test.ts 91 用例一次通过，无因类型/语法导致的运行时失败。

### 对比第三轮
| 维度 | 第三轮 dept.test.ts | 第四轮 audit.test.ts |
|---|---|---|
| tsc 错误数 | 14 处（1 语法 + 14 noUncheckedIndexedAccess，RETRO-ROUND3 P1 记录） | **0** |
| 编排者救火 | 是（补 `!` 9 处分布于 7 行，模糊 test-writer/编排者边界） | **否（零救火）** |
| test-writer 自检 | 未自跑 tsc（提示词缺陷） | **自跑 tsc 0 错误方交付**（AI-002 复盘拆分落地） |

### 结论
**AI-002 tsc 自检真正消除了"语法/类型错误漏到编排者"问题。** test-writer 交付前自跑 `tsc --noEmit` 的硬约束（spec-first.md AI-002 第三段）在本轮首次落地并生效：audit.test.ts 0 tsc 错误、91 用例一次通过、编排者零救火。对比第三轮 dept.test.ts 14 处类型错误需编排者补 `!` 救火、模糊角色边界，本轮角色边界清晰，AI-002 复盘 RETRO-ROUND3 P1 反推优化点真正生效。

## AI-005 禁止硬编码验证（本轮核心验证点 ②）

### 验证方法
1. 实跑 `node scripts/check-rules.mjs`，看 AI-005 分支是否有 suggestion（应无）。
2. 扫描 audit.test.ts 是否有硬编码跨域可变集合（权限码列表、错误码全集、实体类型枚举）——应全用 `[...schema.options]` 派生。
3. 对比第三轮 role.test.ts:130 硬编码 4 个权限码被击穿（RETRO-ROUND3 P1），本轮 `permissionCodeSchema` 加 `audit:read` 后是否零测试改动。

### 验证结果
- **check-rules.mjs AI-005 分支**：exit 0，**0 suggestion**（输出"enforcement 覆盖：AI-005/..."，无 warning 行）。
- **audit.test.ts 跨域枚举断言扫描**：
  - line 419-422 `for (const t of auditLogEntityTypeSchema.options)` → SSOT 派生 ✓
  - line 447-450 `for (const a of auditLogActionSchema.options)` → SSOT 派生 ✓
  - line 457-460 `for (const t of auditLogEntityTypeSchema.options)` → SSOT 派生 ✓
  - line 467-469 `expect([...permissionCodeSchema.options]).toContain('audit:read')` → SSOT 派生 ✓
  - `.toEqual([...])` / `.toStrictEqual([...])` 命中 7 处（line 148/191/208/275/666/768/911），均为空数组 `[]` 或 ISO 时间戳数组（如 `['2024-01-03T10:00:00.000Z', ...]`），**无权限码/错误码/实体类型枚举字面量**，不触发 AI-005 跨域枚举模式。
- **role.test.ts:130 当前形态**（第三轮被击穿点）：`expect(ALL_PERMISSION_CODES).toEqual([...permissionCodeSchema.options])`——**已升级为 SSOT 派生**（非第三轮的硬编码 4 码 / 救火后的硬编码 6 码）。
- **本轮 `permissionCodeSchema` 加 `audit:read` 后 role.test.ts/audit.test.ts 改动**：**零改动**（vitest 291/291 绿，含 role 73 + audit 91）。
  - role.test.ts:130 `[...permissionCodeSchema.options]` 自动含 `audit:read`，断言自动跟随。
  - role.test.ts:141 `expect(admin.permission_codes).toEqual(ALL_PERMISSION_CODES)`，`ALL_PERMISSION_CODES = [...permissionCodeSchema.options]`（domain/role.ts:23）自动含 `audit:read`，admin seed 自动覆盖。
  - audit.test.ts:467-469 `[...permissionCodeSchema.options]` 自动含 `audit:read`，断言自动跟随。

### 对比第三轮
| 维度 | 第三轮（dept 加 dept:read/dept:write） | 第四轮（audit 加 audit:read） |
|---|---|---|
| role.test.ts:130 形态 | 硬编码 `['user:read','user:write','role:read','role:write']`（4 码） | **`[...permissionCodeSchema.options]` SSOT 派生** |
| 被击穿后救火 | 是（编排者改 4→6 码硬编码） | **否（零改动）** |
| AI-005 enforcement | 无 | **有（本轮新增 check-rules.mjs AI-005 分支）** |
| AI-005 suggestion | N/A | **0** |

### 结论
**AI-005 真正消除了"跨域联动击穿既有测试"问题。** 第三轮 role.test.ts:130 硬编码 4 码被 dept 跨域扩展击穿、编排者救火改 6 码（仍硬编码、对下一轮扩展仍脆弱）；本轮该断言升级为 `[...permissionCodeSchema.options]` SSOT 派生，audit 跨域扩展 `audit:read` 后自动跟随、零测试改动。AI-005 的"禁止硬编码跨域可变集合 + 改用 SSOT 派生"反推优化点（spec-first.md AI-005）真正生效，且 check-rules.mjs AI-005 分支机器化兜底（扫描 `.toEqual([≥3 个枚举字面量])` 标记 suggestion）已落地。

## AI-006 受影响测试清单验证（本轮核心验证点 ③）

### 验证方法
1. 检查 audit.tech.md 是否含"受影响测试清单"章节。
2. 清单是否基于真实 grep（列出受影响的测试文件 + 断言位置 + 更新方向）。
3. 本轮 `permissionCodeSchema` 加 `audit:read`，清单是否正确预判"零测试改动"（因已是 SSOT 派生）。

### 验证结果
- **章节存在**：audit.tech.md §受影响测试清单（AI-006 · 本轮核心验证点）位于 line 180-209，章节标题显式标注 AI-006。
- **基于真实 grep**：清单明列 grep 命令与命中（line 183-186）：
  - `grep -rn 'permissionCodeSchema\|ALL_PERMISSION_CODES' apps/api` → 命中 `test/role.test.ts`、`test/dept.test.ts`、`src/domain/role.ts`、`src/repository/role.ts`（实测：本轮还命中新增的 `test/audit.test.ts`，清单 line 205 advisory 项已说明 test-writer 另行产出）。
  - `grep -rn 'errorCodeSchema\|ErrorCode\|errorResponseSchema' apps/api` → 命中 `test/user.test.ts`、`test/dept.test.ts`、`test/role.test.ts`、`src/errors.ts`（实测一致，本轮还命中 `test/audit.test.ts`）。
  - **Reviewer 实跑 grep 复核**：与清单声明一致（命令、命中文件集合吻合）。
- **逐文件列断言位置 + 更新方向**：清单表格（line 187-199）逐行列——role.test.ts L21/L36/L129-131/L141/L309-313、dept.test.ts L45/L47/L122/L482-490、user.test.ts L14/L79，每行含"引用符号/断言"+"受影响判定"+"同步更新方向"。
- **预判"零测试改动"**：清单结论（line 201-205）显式声明"所有引用 `permissionCodeSchema` 的测试断言均已用 SSOT 派生，追加 `audit:read` 后自动跟随，零测试改动""所有引用 `errorCodeSchema`/`ErrorCode` 的测试均为类型级引用，追加 `AUDIT_LOG_NOT_FOUND` 不破坏类型兼容，零测试改动"。
- **预判正确性复核**：vitest 实跑 291/291 绿（role 73 + dept 92 + user 35 + audit 91），role.test.ts/dept.test.ts/user.test.ts **零改动**，与清单预判一致。

### 对比第三轮
| 维度 | 第三轮（dept 跨域） | 第四轮（audit 跨域） |
|---|---|---|
| Tech-Spec 受影响测试清单章节 | 无 | **有（§受影响测试清单，基于真实 grep）** |
| 跨域联动测试影响可预测性 | 不可预测（编排者实跑才发现 role.test.ts 碎） | **可预测（清单预判零改动，实测一致）** |
| 跨域联动击穿 | 是（role.test.ts:130 碎） | **否（零击穿）** |

### 结论
**AI-006 真正让跨域联动的测试影响"可预测"。** 第三轮无清单、跨域联动击穿 role.test.ts 不可预测、编排者实跑才发现；本轮 audit.tech.md §受影响测试清单基于真实 grep 逐文件列断言位置 + 更新方向，正确预判"零测试改动"（因 test-writer 已用 SSOT 派生），与 vitest 291/291 绿一致。AI-006 的"Tech Lead 改 contracts 时产出受影响测试清单"反推优化点（spec-first.md AI-006）真正生效，且与 AI-005 形成闭环：AI-005 让断言不碎、AI-006 让影响可预测。

## PII 脱敏落地验证（SEC-003b 真实检验场景）

> 本轮为 SEC-003b 首次有实现落地（前三轮均为规则定义无实现）。验证 redactEmail 实现覆盖边缘场景、service.list 返回脱敏、存储保留原值。

### redactEmail 实现边缘场景覆盖
实现位于 `apps/api/src/domain/audit.ts:19-24`：
```ts
export function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 2) return email; // local<2 / 无@ / 首@在<2 位置 → 原样返回
  return email.slice(0, 2) + '***' + email.slice(at);
}
```
逐场景验证（audit.test.ts line 117-142）：
| 场景 | 输入 | 期望输出 | 实测 | 结论 |
|---|---|---|---|---|
| 正常邮箱 | `abcdef@example.com` | `ab***@example.com` | ✓（line 119） | pass |
| local 恰好 2 字符 | `ab@example.com` | `ab***@example.com` | ✓（line 123，at=2 不<2，slice(0,2)+***+slice(2)） | pass |
| local < 2 字符 | `a@example.com` | `a@example.com`（原样） | ✓（line 127，at=1<2） | pass（advisory） |
| 无 @ | `no-at-sign` | `no-at-sign`（原样） | ✓（line 131，at=-1<2） | pass（advisory） |
| 多 @ 且首个 @ 在 <2 位置 | `a@b@example.com` | `a@b@example.com`（原样） | ✓（line 135，at=1<2） | pass（advisory） |
| 输出可被 redactedEmailSchema 解析 | `redactEmail('abcdef@example.com')` | `safeParse.success===true` | ✓（line 138-141） | pass |

**边缘场景全部覆盖**，advisory 边缘场景（local<2 / 无@ / 多@首@<2）原样返回，已在 domain/audit.ts:15-16 注释 + audit.tech.md §DB 变更 [advisory] 反向同步 Spec。

> 注：`redactedEmailSchema` 正则为 `/^.{2}\*\*\*@[^\s@]+$/`，要求 *** 后恰好一个 @。`ab@b@example.com`（local=2 + 多@）会产出 `ab***@b@example.com`（两个 @）无法过 schema，但该输入本身为非法邮箱格式，不在合法邮箱脱敏范围内，非 blocker。

### service.list 返回脱敏 + 存储保留原值
- **存储保留原值**：`service/audit.ts:68-83` `record()` 构造 `AuditLog` 时直接写入 `input.before`/`input.after`（含原 PII），无脱敏；`repository/audit.ts:35-38` `insert()` 原样 push。audit.test.ts:954-956 验证 `auditRepo.list(...).items[0].after.email === 'abcdef@example.com'`（存储原值）。
- **查询返回脱敏**：`service/audit.ts:44-60` `list()` 调 `this.redactLog(l)`（line 58）对每条日志套用脱敏；`redactLog`（line 86-92）返回新对象（不修改存储态）；`redactSnapshot`（line 98-108）遍历字段，对邮箱字段（key 含 'email' 或值匹配 `EMAIL_LIKE_RE`）调 `redactEmail`。audit.test.ts:958-959 验证 `service.list(...).items[0].after.email === 'ab***@example.com'`（查询脱敏）。
- **before/after 双脱敏**：audit.test.ts:791-805 验证 update 场景 before.email='old@example.com' → 'ol***@example.com'、after.email='new@example.com' → 'ne***@example.com'。
- **非邮箱字段不误伤**：audit.test.ts:807-816 验证 name/status 原样返回。
- **多条日志批量脱敏无遗漏**：audit.test.ts:704-715 验证 3 条日志邮箱均匹配 `/^.{2}\*\*\*@[^\s@]+$/`。
- **未脱敏原值被契约拒绝**：audit.test.ts:368-370 验证 `redactedEmailSchema.safeParse('abcdef@example.com').success === false`（防漂移）。

### 结论
**SEC-003b PII 脱敏真实落地。** redactEmail 实现 5 类边缘场景全覆盖（正常/local=2/local<2/无@/多@首@<2），advisory 边缘原样返回已反向同步 Spec；service.list 返回脱敏态、存储保留原值，分离闭环经测试断言（存储原值 + 查询脱敏 + 契约拒绝未脱敏值）；before/after 双脱敏、非邮箱字段不误伤、批量无遗漏均覆盖。本轮为 SEC-003b 前三轮"仅规则定义"后首次有实现落地，规则与实现一致，无漂移。

## advisory 偏离

### 已实现的 advisory 项（均按 Spec 主路径 + 反向同步）
| advisory 项 | Spec 来源 | 实现 | 反向同步 |
|---|---|---|---|
| repository 用数组内存存储 | §影响的模块 [advisory] | repository/audit.ts 数组 | 代码注释 + Spec |
| redactEmail local<2 原样返回 | §DB 变更 [advisory] | domain/audit.ts:22 | 代码注释 line 15-16 + Spec |
| AUDIT_LOG_NOT_FOUND 预留码本期不触发 | §边界与异常 B4 [advisory] | errors.ts:41 穷举映射 | 代码注释 + Spec |
| DEPT_HAS_USERS 预留码（既有） | §边界与异常 [advisory] | errors.ts:38 穷举映射 | 代码注释（第三轮已同步） |
| 既有 OpenAPI 片段未同步 | §Out of scope [advisory] | 未改 user/role/dept.openapi.yaml | Spec §Out of scope 显式记遗留 |
| audit:read 端到端鉴权待 Auth 富化 | §Out of scope [advisory] | admin 桩下放行 | Spec §Out of scope 显式记遗留 |
| 未脱敏返回入口本期不提供 | §Out of scope [advisory] Q2 | list 仅返回脱敏态 | Spec §Out of scope 显式记遗留 |
| before/after 弱类型 z.record(z.unknown()) | §影响的模块 [advisory] | audit.ts:50-51 | 代码注释 + Spec |

### Spec 未明确提及项（S-1）
- **`service/audit.ts:25,101` `EMAIL_LIKE_RE` 值级兜底**：Spec §API 契约 F3 措辞为"before/after 中邮箱字段由 service 层套用 redactEmail"，"邮箱字段"暗示 key 维度；实现额外做了值级检测（key 不含 'email' 但值匹配 `xxx@xxx.xxx` 格式时也脱敏）。属"更安全方向"（多脱敏而非少脱敏），benign，但严格按 AI-003 属 Spec 未提及项。
- **建议（S-1）**：在 Spec §API 契约 F3 反向同步补充"service 层对 before/after 字段做 key + 值级双重邮箱检测"，或显式降级为仅 key 维度（移除 `EMAIL_LIKE_RE`）。当前实现保留更安全，不阻断。

## 测试先行验证

### audit.test.ts 断言行是否被 impl-writer 改动
- audit.test.ts 为本轮新增文件，无 per-author commit 粒度，无法用 `git diff` 字面区分 test-writer 原稿与 impl-writer 改动（同第三轮局限）。
- 可观察证据支持 test-first 成立：
  1. 头部注释（line 9-27）明令"impl-writer 须遵循，禁止改测试断言，仅可改 setup/import 路径并注明理由"，并列出 11 条设计说明（构造签名、方法集、AuditLogRecordInput、router 导出、AuditProcedure 形状、redactEmail 边界、守卫顺序）。
  2. impl-writer 交付的 domain/repo/service/router 使全部 91 用例由红转绿（vitest 全绿）。
  3. 断言精确覆盖五类矩阵（见下），无弱断言。
  4. **test-writer 自跑 tsc 0 错误**（AI-002 自检硬约束首次落地），编排者零救火——这是本轮相对第三轮的关键改进证据。
- 粒度局限（S-2，沿用第三轮 S-4）：建议后续演练保留 test-writer/impl-writer 分离提交，获得可审计的 `git diff` 轨迹。

### 测试覆盖五类且断言精确
对照 Spec §测试矩阵，audit.test.ts 91 用例覆盖：
1. **单测**（domain 常量 + redactEmail 纯函数 + repository append-only + service 裁决）：AUDIT_LOG_RETENTION_DAYS===90；redactEmail 5 边缘场景 + 输出可被 redactedEmailSchema 解析；repo insert/list（按 operated_at 倒序、operated_from/operated_to 闭区间、operator_id、entity_type 过滤、page/pageSize 分页）、append-only（无 update/delete 方法、重复 insert 不去重）；service 钳制 pageSize=200→100、空库 items=[]/total=0/totalPages=0、非 admin FORBIDDEN。
2. **契约测**（出参 schema + 入参 safeParse + redactedEmailSchema）：list 返回匹配 auditLogListResultSchema.strict；items 元素匹配 redactedAuditLogSchema；auditLogSchema.strict 拒绝多余字段；redactedEmailSchema 通过/拒绝（ab***通过、abcdef 拒绝、a***@x.com 拒绝）；入参 safeParse 覆盖 page<1/pageSize<1/pageSize=200 钳制/operated_from 非 datetime/operated_to 非 datetime/operator_id 非 uuid/entity_type 非法/空对象默认值/合法全维度；entity_type/action/entityType 各值 SSOT 派生遍历（AI-005）；permissionCodeSchema.options 含 audit:read（SSOT 派生）。
3. **边界**（F1-F4）：F1 record 写 create/delete 日志、before/after 含原邮箱（存储态）、list 查回脱敏、多次 record 倒序；F2 25 条 page=2 pageSize=10 → 11-20 条 + total=25 + totalPages=3、时间范围/operator_id/entity_type 过滤、无过滤默认 pageSize=20、pageSize=200 钳制、空库 items=[]；F3 after/before 邮箱脱敏、非邮箱字段原样、多条批量无遗漏；F4 repository 无 update/delete、router 无 update/delete/patch、重复 insert 不去重。
4. **权限**：SEC-002 非 admin 调 list/router.list → FORBIDDEN；admin 调 list 正常返回；SEC-003a 出参 .strict；SEC-003b before/after 邮箱脱敏、非邮箱字段不脱敏；SEC-001 procedure 元数据（auth='admin'/permission='audit:read'）。
5. **状态机**（append-only 不可变 + list 守卫序列 B1→B2/B3 + F1 旁路闭环）：repository/service/router 无 update/delete/patch/create；B1 先于 B3（page=0+非admin→VALIDATION_ERROR、entity_type=unknown+非admin→VALIDATION_ERROR）；B3 在 B1 通过后触发（合法入参+非admin→FORBIDDEN）；B1→B3→数据正常返回；空结果不触发 B4；F1 闭环 record→list、存储原值/查询脱敏分离、多次 record 倒序、delete 日志 before 含原值 after={}。

断言精确：错误码断言用 `expectAppError(promise, code)` 校验 `AppError` 实例 + 精确 code；守卫顺序用"同时命中两条件验先返码"区分优先级；契约测用 `.safeParse(...).success === false` 精确拒绝；SSOT 派生遍历用 `for (const x of schema.options)`。无 `toBeTruthy`/`toBeFalsy` 等弱断言滥用。

## 门禁复核
| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npx tsc --noEmit` | exit 0（无类型错误，含 audit.test.ts 0 错误） |
| lint:rules | `node scripts/check-rules.mjs` | exit 0，输出"✅ 规则校验通过 / enforcement 覆盖：AI-005/ARCH-001/ARCH-002/CODE-001/CODE-002/CODE-003/CODE-004/META-001/META-003/META-004/SEC-001/SEC-002/SEC-003a / 双向绑定：META-003+META-004 已校验"，**0 warning（AI-005 分支 0 suggestion）** |
| test | `npx vitest run` | exit 0，4 文件 291 用例全绿（audit 91 / dept 92 / role 73 / user 35），1.76s |

三件套全绿，符合 AI-004 提交前置条件。本轮 AI-005 enforcement 新增后，机器化覆盖率从第三轮 12/19=63% 提升至 13/19=68%（AI-005 转为专属分支）。

## 最终结论
**verdict: pass**。

- **三个 P1 反推优化点全部真正生效**（本轮核心验证）：
  - **AI-002 tsc 自检**：audit.test.ts 0 tsc 错误、91 用例一次通过、编排者零救火；对比第三轮 dept.test.ts 14 处类型错误需编排者补 `!` 救火，test-writer/编排者边界清晰。
  - **AI-005 禁止硬编码**：audit.test.ts 跨域枚举断言全用 `[...schema.options]` 派生，`permissionCodeSchema` 加 `audit:read` 后 role.test.ts/audit.test.ts 零改动；对比第三轮 role.test.ts:130 硬编码 4 码被击穿、编排者救火改 6 码（仍脆弱），本轮该断言升级为 SSOT 派生、零击穿，且 check-rules.mjs AI-005 分支机器化兜底已落地。
  - **AI-006 受影响测试清单**：audit.tech.md §受影响测试清单基于真实 grep、逐文件列断言位置 + 更新方向、正确预判"零测试改动"，与 vitest 291/291 绿一致；对比第三轮无清单、跨域联动击穿不可预测。
- **PII 脱敏真实落地**（SEC-003b 首次有实现）：redactEmail 5 边缘场景全覆盖（advisory 边缘原样返回已反向同步）；service.list 返回脱敏态、存储保留原值，分离闭环经测试断言（存储原值 + 查询脱敏 + 契约拒绝未脱敏值）；before/after 双脱敏、非邮箱字段不误伤、批量无遗漏均覆盖。
- 逐规则评审：19 条规则全部 pass 或 N/A（ARCH-003/META-002 预留/未触发），无 blocker。
- advisory 偏离：8 项已实现 advisory 均按 Spec 主路径 + 反向同步；1 项 Spec 未提及项（EMAIL_LIKE_RE 值级兜底，S-1）benign 不阻断。
- 测试先行：91 用例覆盖五类矩阵、断言精确；test-writer 自跑 tsc 0 错误首次落地（相对第三轮关键改进）。
- 3 条 suggestion（S-1 EMAIL_LIKE_RE 值级兜底未反向同步 / S-2 缺 per-author commit 粒度 / S-3 既有 OpenAPI 片段未同步——Spec 已记遗留）均不阻断。
- **最值得关注的发现**：**三个 P1 反推优化点形成闭环**——AI-002 让 test-writer 产物自带类型质量（不漏到编排者）、AI-005 让断言不碎（SSOT 派生）、AI-006 让影响可预测（清单预判）。三者协同使本轮跨域联动（`permissionCodeSchema` 加 `audit:read` + `errorCodeSchema` 加 `AUDIT_LOG_NOT_FOUND`）实现"零测试改动、零救火、可预测"，彻底消除第三轮"跨域联动击穿既有测试 + 编排者救火模糊边界"的痛点。这是 AI 原生工作流从"每轮暴露新边界"转向"反推优化点真正生效"的标志。
