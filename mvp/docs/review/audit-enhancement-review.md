---
doc_type: Review-Report
id: REVIEW-AUDIT-ENHANCEMENT-001
tech_spec_ref: TECH-AUDIT-ENHANCEMENT-001
prd_ref: PRD-AUDIT-ENHANCEMENT-001
verdict: blocker
created: 2026-07-02
---
# 操作日志增强 · Code Review 报告（第五轮演练）

评审范围：第五轮"操作日志增强"PR 全部代码——跨域旁路埋点（F1）+ PII 脱敏结构化（F3）+ 报表聚合（F2）。对照 `docs/prd/audit-enhancement.md`（验收标准）、`docs/spec/audit-enhancement.tech.md`（Tech-Spec，含 AI-006 受影响测试清单）与 `.trae/rules` 全部规则逐条核查。

本轮第五轮演练核心验证：①AI-006 受影响测试清单校验（test-writer 已发现 dept.test.ts 9 处遗漏）②跨域埋点架构（router 层 withAudit HOF，service 保持纯粹）③PII 脱敏从运行时正则灰区迁至契约层标记驱动 ④报表聚合验证工作流对"纯读 + 聚合"非 CRUD 领域的适应性 ⑤AI-003 advisory 偏离反向同步。

## 汇总
- blocker 数：**2**
- suggestion 数：**7**
- verdict：**blocker**（2 项 PRD [约束] 验收偏离未报告且未被测试捕获；三件套虽全绿，但 F1 端到端验证缺失使偏离隐身）
- 三件套门禁复核（Reviewer 实跑）：
  - typecheck：`npx tsc --noEmit` exit 0，0 错误 ✅
  - lint:rules：`node scripts/check-rules.mjs` exit 0，13 项 enforcement + META-003/004 双向绑定 ✅
  - test：`npx vitest run` exit 0，5 文件 390/390（report 86 + audit 104 + dept 92 + role 73 + user 35）✅
- 规则机器化覆盖率：13/19 = 68%（与第四轮持平，本轮不新增 enforcement 分支，Tech-Spec §9 已声明）

## 总体结论

三件套全绿，三个方向均有产物落地，PII 标记驱动脱敏与报表聚合契约实现质量较高。**但 F1 跨域埋点存在 2 项偏离 PRD 验收标准 [约束] 的实现缺陷**（role assign/remove 的 action 与字段、dept assignUserDepartment 的 entity_type），impl-writer 未将其作为 advisory 报告，且因 **F1 端到端测试覆盖缺失**（无任何测试注入共享 AuditLogService 验证 withAudit 产出的日志内容）而未被测试捕获。按 AI-003"对 [约束] 项禁止偏离，偏离即越界"，记为 blocker。

此外，AI-006 规则在本轮暴露新边界：Tech Lead 清单基于 contracts 符号 grep 产出，**遗漏了 service 签名变更（D3）对 dept.test.ts 的 9 处影响**（test-writer 亲自核实并修正），说明 AI-006 当前仅覆盖"contracts 联动"维度，未覆盖"apps/api 内部签名变更"维度，规则需增强。

## 逐维度审查结果

### 1. AI-006 受影响测试清单校验（本轮重点）—— warn（清单遗漏 dept 9 处，已被 test-writer 修正）

- **章节存在**：Tech-Spec §8 受影响测试清单存在，基于真实 grep（命令与命中明列），逐文件列断言位置 + 更新方向。✅ 满足 AI-006 基本要求。
- **清单准确性复核**：
  - **audit.test.ts ~30 处**：✅ 准确。Tech-Spec §8.1 逐行列出 L31-35/L71-85/L340-341/.../L996-1004 共 ~30 处 before/after 从 `z.record` 迁移为 `ChangeField[]` 的断言。Reviewer 抽查 audit.test.ts（现 104 用例）已全部迁移为 `before: []` / `after: [{field,value,pii}]` 形态，与清单一致。
  - **role.test.ts 零改动**：✅ 准确。role.test.ts 对 service 写操作的调用均在 `expectAppError(...)` 上下文（仅断言 reject，不消费返回值），D3 签名变更（返回 `{entity, changes}`）不破坏既有断言。permissionCode 加 `report:read` 后 SSOT 派生自动跟随。
  - **user.test.ts 零改动**：✅ 准确。user.test.ts 不直接消费 `service.create/updateStatus` 返回值（grep `\.entity|service\.(create|updateStatus)` 0 命中），D3 签名变更不影响。
  - **dept.test.ts 零改动**：❌ **遗漏 9 处**。Tech-Spec §8.3 仅列出 permissionCode 引用（L45/L47/L122/L482-490）并判"零改动"，**未识别 D3 service 签名变更对 dept.test.ts 的影响**。实测 dept.test.ts 有 9+ 处需改为 `.entity` 访问（L108/109/110/243/251/284-287/305/308-309/333/983 等，如 `(await service.create({...})).entity`、`deleteResult.entity`）。test-writer 亲自核实并修正，Reviewer 复核确认 dept.test.ts 现含 `.entity` 访问且 92/92 绿。
- **遗漏根因分析**：AI-006 规则的清单生成方式为"grep 引用被改 contracts 符号的测试文件"，仅覆盖 **contracts 联动**维度。D3（service 写操作返回签名从 `Entity` 扩展为 `{entity, changes}`）是 **apps/api 内部签名变更**，非 contracts 改动，不在 AI-006 grep 范围内。Tech-Spec §8.1 末尾虽提到"service 写操作签名扩展为 `{entity, changes}`（D3）"，但仅在 audit.test.ts 小结中以"待 impl-writer 联动"提及，**未将 dept.test.ts/role.test.ts/user.test.ts 的 service 返回值消费点纳入清单**。
- **AI-006 是否真正生效**：部分生效。清单存在且 audit/role/user 判定准确，但 dept 9 处遗漏说明规则覆盖面不足。
- **结论**：warn（清单遗漏已被 test-writer 人工兜底修正，未导致测试漏改；但暴露 AI-006 规则覆盖盲区，见改进建议 S-6）。

### 2. 跨域埋点架构（方向1）—— blocker

- **withAudit 在 router 层**：✅ `apps/api/src/router/audit.ts:55-87` 定义 withAudit HOF；service/user.ts、role.ts、dept.ts 均 **不 import AuditLogService**（仅 import `markPii`/`WriteResult` from domain/audit），service 保持纯粹，符合 ARCH-001 与 PRD Q5(b)。
- **best-effort 处理**：✅ wrapper 内 `try { audit.record(...) } catch (e) { console.warn(...) }`，主操作先成功（`await handler` 在 try 之前），audit 异常被吞不影响主操作成败（PRD Q2）。
- **调用方透明**：✅ withAudit 返回 `R['entity']`（仅 entity），调用方不感知 `{entity, changes}`，符合 PRD Q5(a)。
- **before/after 组装**：✅ create → `before: before ?? []`（service 不传 before 时为 []）；delete → service 返回 `changes: []`（after=[]）+ before 快照；update → before/changes 均非空。语义正确。
- **8 个写操作包装**：✅ user.create/updateStatus、role.create/delete/assign/remove、dept.create/delete/assignUserDepartment 共 8 个均经 withAudit 包装。
- **🔴 B-1（blocker）：role assign/remove 偏离 PRD [约束] 验收**：
  - PRD F1 验收："Given 管理员为用户分配角色（UserRole 关联变更）…Then 系统自动生成一条日志，entity_type=role、**action=update**（沿用 PRD-AUDIT-001 Q7），before/after 含**虚拟字段 assigned_user_ids（string[]）**的旧值/新值"。
  - Tech-Spec D3 [约束]："RoleService.assign / remove → …（虚拟字段 assigned_user_ids: string[] 的旧值/新值）"；§跨域依赖："role.assignRole·removeRole（…沿用 PRD-AUDIT-001 Q7 归类 entity_type=role,action=update）"。
  - 实现：`router/role.ts:89` assign 用 `{ entityType: 'role', action: 'create', ... }`、`:103` remove 用 `{ action: 'delete', ... }`（应为 `update`）；`service/role.ts:131-134` assign 的 changes 为 `[{field:'user_id'},{field:'role_id'}]`、`:148-151` remove 的 before 同理（应为虚拟字段 `assigned_user_ids: string[]`）。
  - 偏离 PRD 验收 [约束] + Tech-Spec D3 [约束]，impl-writer 未作为 advisory 报告。按 AI-003 记 blocker。
- **🔴 B-2（blocker）：dept assignUserDepartment 偏离 PRD [约束] 验收**：
  - PRD F1 验收："Given 管理员维护用户部门归属（assignUserDepartment）…Then 系统自动生成一条日志，**entity_type=user**、action=update（沿用 PRD-AUDIT-001 跨域依赖：归属变更视为 user 的 update），before=[{field:department_id,…}]、after=[{field:department_id,…}]"。
  - Tech-Spec §跨域依赖："dept.assignUserDepartment（…归类 entity_type=user,action=update）"。
  - 实现：`router/dept.ts:85` 用 `{ entityType: 'dept', action: 'update' }`（entity_type 应为 `user`）。entity_id 取 `entity.id`（service 返回 updated User，故 entity_id=user.id 正确），但 entity_type 标 'dept' 导致日志归属错误（按 entity_type 聚合报表时该日志被计入 dept 而非 user）。
  - 偏离 PRD 验收 [约束] + Tech-Spec [约束]，impl-writer 未作为 advisory 报告。按 AI-003 记 blocker。

### 3. PII 脱敏结构化（方向2）—— pass

- **ChangeField 结构 {field, value, pii}**：✅ `contracts/schemas/audit.ts:49-55` changeFieldSchema = `{field: z.string().min(1), value: changeFieldValueSchema, pii: z.boolean()}.strict()`，符合 Tech-Spec D5。value 限定标量|null|同类型标量数组（Q18），不支持对象/嵌套数组。
- **PII 清单双层 SSOT**：✅ shape 在 contracts（`piiFieldRegistrySchema = z.record(auditLogEntityTypeSchema, z.set(z.string().min(1)))`），data 在 domain（`PII_FIELD_REGISTRY = { user: new Set(['email']) }`，经 `piiFieldRegistrySchema.parse` 校验）。符合 D6 + ARCH-002 调和。
- **markPii 查 registry 标 pii**：✅ `domain/audit.ts:54-64` markPii 遍历 fields，`pii = piiFields?.has(f.field)`，未注册 entity_type 全 false。返回新数组不 mutate。
- **脱敏按 pii 标记**：✅ `service/audit.ts:99-106` redactFields 对 `f.pii && typeof f.value === 'string'` 套 redactEmail，pii=false 或非 string 原样返回。符合 D7。
- **运行时正则兜底移除**：✅ service/audit.ts 无 `EMAIL_LIKE_RE` 常量、无键名/值双判断。grep `EMAIL_LIKE_RE` 在 apps/api/src 0 命中。符合 PRD Q15"信任标记不做运行时正则兜底"。
- **既有日志一刀切迁移**：✅ audit.test.ts makeLog 工厂已用 `before: []` / `after: [{field,value,pii}]`，无 `z.record` 残留；auditLogSchema.before/after 已改型为 `z.array(changeFieldSchema)`。符合 PRD Q16。
- **契约测覆盖**：✅ audit.test.ts 含"未标记 pii 但值像邮箱 → 原样返回（不兜底）"断言（L861-866 注入 entity_type='role' 的 note 字段值像邮箱但 pii=false，断言原样返回）。

### 4. 报表聚合（方向3）—— pass

- **group by 维度组合**：✅ 1~4 维交叉，`reportGroupByDimSchema` 枚举 4 维，`reportQuerySchema.group_by` max(4)。report.test.ts 覆盖单维/2 维/3 维/4 维上限。
- **date 桶**：✅ `service/report.ts:146` `log.operated_at.slice(0, 10)`。report.test.ts 覆盖同日不同时刻聚同桶、UTC 自然日边界。
- **排序**：✅ `service/report.ts:76-84` count 降序 + 维度值升序 tiebreaker（按 group_by 声明顺序）。report.test.ts 覆盖 count 降序、count 相同维度值升序、多维 tiebreaker、date 字典序。
- **时间范围闭区间**：✅ `repository/audit.ts:82-85` `operated_at >= from` / `<= to`。report.test.ts 覆盖闭区间边界相等合法。
- **空结果**：✅ `service/report.ts:87-88` total=0 → totalPages=0，items=[]。report.test.ts 覆盖无日志 + 过滤无匹配。
- **分页**：✅ slice + totalPages=ceil(total/pageSize)。report.test.ts 覆盖 page=2、page 超范围。
- **错误码**：✅ group_by 缺省/空 → REPORT_GROUP_BY_REQUIRED（`service/report.ts:125-127`）；时间范围非法 → REPORT_TIME_RANGE_INVALID（`:115-120` 据 superRefine issue 的 path 含 operated_from 区分）；其余 → VALIDATION_ERROR。校验顺序：schema parse + 语义判定 → requireAdmin → 聚合（D10）。report.test.ts 覆盖三种码 + 校验先于鉴权。
- **pageSize 钳制**：✅ transform `Math.min(n, 100)`，返回 pageSize 反映钳制值。report.test.ts 覆盖 pageSize=200 → 100。
- **报表不涉及 PII**：✅ 聚合维度均为非 PII 字段，report.test.ts SEC-003b 断言 items 仅含维度键 + count，不含 email/name。

### 5. advisory 偏离反向同步校验（AI-003）—— 详见下表

impl-writer 报告 3 个 advisory 偏离，逐一评估：

| # | advisory 偏离 | 评估 | 反向同步 | 处置 |
|---|---|---|---|---|
| A-1 | operator_name 硬编码 'admin' | **合理**。Ctx 无姓名字段，Tech-Spec §13 遗留 #5 已显式允许"MVP 桩下 admin 可硬编码 'admin'，advisory 须反向同步 Spec"。wrapper 无 UserRepository 注入，读姓名需改 withAudit 签名，MVP 桩可接受。 | Spec §13 #5 已预留该 advisory（视为已同步） | pass |
| A-2 | reportAggItemSchema 不加 .strict()（count 子 object） | **理由成立**。`z.object({count}).strict()` 与 `z.record(...)` 交集后 .strict() 会拒绝 group_by 维度键（operator_id/entity_type 等），导致多维 item 校验失败。report.test.ts L338 多维 item 通过断言佐证。 | ❌ Tech-Spec D8 示例仍写 `.and(z.object({count}).strict())`，Spec 未反向同步 | **S-3** suggestion（反向同步 Spec D8 示例，移除 count 子 object 的 .strict() 或注明与 z.record 交集冲突） |
| A-3 | SEC-002 适配：ReportService.query 校验提取到私有 parseAndValidate | **为规避 check-rules.mjs SEC-002 静态扫描误判**。SEC-002 body 收集的 break 条件 `/^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*[:{]/` 会把 `if (...) {` 误判为方法声明并提前截断 body，使 `requireAdmin`（位于 if 块之后）落出 body → 误报。提取 parseAndValidate 后 requireAdmin 紧随其后、先于任何 if 块，扫描通过。 | ❌ Tech-Spec 未记载此 workaround | **S-4** suggestion（根因是 check-rules.mjs SEC-002 break 条件 bug，应修复扫描器排除控制流关键字；该 workaround 需反向同步 Spec） |

> 注：B-1/B-2 两项 PRD [约束] 偏离**不在** impl-writer 报告的 3 个 advisory 之内，属未报告的 [约束] 越界，记 blocker（见维度 2）。

### 6. 规则合规（META + ARCH + CODE + SEC）—— pass（含 2 项 suggestion）

- **META-001**：✅ 本轮不新增规则文件，既有 19 条规则均含"校验方式"段 + 机器校验关键词。check-rules.mjs META-001 分支通过。
- **META-003/004**：✅ Tech-Spec §9 声明不新增 check-rules.mjs 分支，引用的 13 项既有 enforcement 均有规则文档块（双向绑定）。check-rules.mjs 输出"META-003+META-004 已校验"。
- **ARCH-001**：✅ service 不 import router/AuditLogService；domain 不 import 上层；repository 不 import service/router。check-rules.mjs ARCH-001 通过。
  - **S-5（suggestion）**：`router/user.ts:14`、`router/role.ts:16`、`router/dept.ts:17` 直接 import `AuditLogRepository` 并在 auditService 缺省时 `new AuditLogService(new AuditLogRepository())`。router→repository 跨层（跳过 service）虽未被 ARCH-001 扫描器捕获（扫描器仅查反向依赖），但导致每个 router 持有**独立隔离的 AuditLogRepository**，F1 日志写入后无法被 audit list / report 读路径聚合（见 S-1）。建议注入共享 AuditLogService 而非各自 new。
- **ARCH-002**：✅ contracts 仅导出 Zod schema 与 z.infer 类型；PII_FIELD_REGISTRY 数据放 domain。audit.ts/report.ts 仅 import zod + 同目录 schema。
- **CODE-001**：✅ 无 `: any` / `as any`。
- **CODE-002**：✅ 无空 catch。withAudit catch 含 `console.warn` + 注释。
  - **S-7（suggestion）**：CODE-002"禁止仅 console 的 catch"与 PRD Q2/Tech-Spec D4"best-effort 吞掉 audit 异常用 console.warn"存在张力。当前 catch 因注释行位于 console.warn 之前而绕过扫描器的"仅 console"正则（`\s*console\.` 要求 console 紧随 `{`），属脆弱绕过。建议调和规则：为 best-effort audit catch 显式豁免，或要求结构化 logger。
- **CODE-003**：✅ 无 eval/new Function。
- **CODE-004**：✅ 新增 schema 均带 Schema 后缀（changeFieldSchema/changeFieldValueSchema/piiFieldRegistrySchema/reportGroupByDimSchema/reportQuerySchema/reportResultSchema/reportAggItemSchema）。
- **SEC-001**：✅ report.query procedure 声明 `auth: 'admin'` + `permission: 'report:read'`。
- **SEC-002**：✅ ReportService.query 调 requireAdmin（经 parseAndValidate 提取后扫描通过）；AuditLogService.list/record 调 requireAdmin。
- **SEC-003a**：✅ reportResultSchema / redactedAuditLogSchema / auditLogSchema / auditLogListResultSchema 均 .strict()。reportAggItemSchema 非 *Result/*Response 模式，不在 SEC-003a 扫描范围（其 count 子 object 的 .strict() 见 A-2）。
- **SEC-003b**：✅ PII 按标记脱敏（维度 3 已验证）。

### 7. AI-001 越界检查 —— pass（含 1 项 suggestion）

- diff 新增导出符号（changeFieldSchema/piiFieldRegistrySchema/reportGroupByDimSchema/reportQuerySchema/reportResultSchema/reportAggItemSchema/ReportService/createReportRouter/withAudit/PII_FIELD_REGISTRY/markPii/WriteResult/REPORT_* 错误码/report:read 权限码）均可溯源至 Tech-Spec §4.1 符号清单或 §2 影响模块。✅
- **S-2（suggestion）**：`domain/audit.ts:73-77` WriteResult 接口含 `before?: ChangeField[]` 字段，而 Tech-Spec D3 [约束] 声明返回类型为 `Promise<{ entity: Entity; changes: ChangeField[] }>`（无 before）。impl 额外引入 before 字段供 wrapper 直接取用（D4 示意用 `extractBefore(changes)` 从 changes 派生）。功能等价但属 Spec 未提及字段，建议反向同步 Spec D3/D4。
- **观察（不入 suggestion 计数）**：`service/user.ts:63` user.create 的 changes 含 `department_id` 字段（null），PRD F1 验收示例仅列 email/name/status。PRD 用"含"非"仅含"，department_id 为业务字段，可接受，但建议 Spec 明确是否纳入 create 快照。

### 8. 测试覆盖 —— warn（F1 端到端缺失，隐匿 B-1/B-2）

- **三件套真绿**：✅ Reviewer 实跑 tsc 0 错误 / check-rules exit 0 / vitest 390-390。
- **F2 报表 + F3 结构化覆盖充分**：✅ report.test.ts 86 用例覆盖契约/聚合/排序/分页/空结果/权限/错误码/SSOT 派生 15 类；audit.test.ts 104 用例覆盖 ChangeField 迁移/脱敏标记/append-only。
- **🔴 F1 端到端覆盖缺失（S-1）**：Tech-Spec §10 测试矩阵明确要求"边界 | F1：8 个写操作成功后自动生成日志（entity_type/action/before/after 符合 PRD 验收）…埋点异常（mock audit.record 抛错）→ 主操作仍成功返回"。**实测无任何测试注入共享 AuditLogService 验证 withAudit 产出的日志**：
  - user.test.ts / role.test.ts / dept.test.ts 的 setup 均以 `createXxxRouter(service)` 调用（未传 auditService），router 各自 `new AuditLogService(new AuditLogRepository())`，日志写入隔离 repo，无测试读取。
  - audit.test.ts 不 import withAudit / createUserRouter 等，仅直接测 AuditLogService.record + list。
  - 后果：B-1（role assign action/field 错误）、B-2（dept entity_type 错误）均无测试捕获，390/390 绿掩盖了偏离。
  - **S-1（suggestion → 但与 blocker 强相关）**：补 F1 端到端测试——setup 注入共享 auditRepo/AuditLogService 至三域 router，调用 router 写操作后断言 auditRepo 中日志的 entity_type/action/before/after 符合 PRD 验收；并补 mock audit.record 抛错 → 主操作仍成功的 best-effort 测试。

## 本轮亮点

1. **三个方向均有产物落地**：F1 withAudit HOF 在 router 层实现、service 保持纯粹（不 import AuditLogService）；F3 PII 标记驱动脱敏彻底移除 EMAIL_LIKE_RE 正则兜底，契约层 shape SSOT + domain data SSOT 双层结构清晰；F2 报表聚合在 service 层内存 group by + date 桶 + 多级排序 + 分页，契约与算法实现质量高，report.test.ts 86 用例覆盖充分。
2. **AI-006 清单遗漏被 test-writer 亲自核实并修正**：test-writer 未盲信 Tech Lead 的"dept.test.ts 零改动"判断，亲自核实后发现 9 处 service 签名变更影响并修正，体现 test-writer 的独立验证价值。这正是 AI-002"测试先行 + 独立角色"设计的预期收益。
3. **PII 脱敏从运行时正则灰区迁至标记驱动**：移除 EMAIL_LIKE_RE 后，"未标记 pii 但值像邮箱 → 原样返回"经测试断言固化（audit.test.ts L861-866），消除 retro P2 灰区，脱敏行为可静态推理。
4. **报表领域验证工作流对非 CRUD 适应性**：report 领域纯读 + 聚合，无 create/update/delete 路由，procedure 仅 query；ReportService 依赖 AuditLogRepository.listAll 读投影，无独立 repo，符合 D8/D9 决策。

## 本轮问题

### Blocker（2）
- **B-1**：role assign/remove 偏离 PRD F1 验收 [约束]——action 应为 `update`（impl 用 create/delete），before/after 应含虚拟字段 `assigned_user_ids: string[]`（impl 用 user_id/role_id 标量）。位于 `router/role.ts:89,103` + `service/role.ts:131-134,148-151`。impl-writer 未报告。修复方向：router meta action 改 'update'；service 构造 `{field:'assigned_user_ids', value: string[], pii:false}` 的旧值/新值（assign: before=旧角色id集合/after=新集合；remove: before=旧集合/after=新集合）。
- **B-2**：dept assignUserDepartment 偏离 PRD F1 验收 [约束]——entity_type 应为 `user`（impl 用 'dept'）。位于 `router/dept.ts:85`。修复方向：meta entityType 改 'user'（entity_id 已正确取 user.id）；service markPii 应按 'user' 标记（department_id 非 PII，结果不变但语义对齐）。

### Suggestion（7）
- **S-1**：F1 端到端测试缺失（Tech-Spec §10 测试矩阵要求未落地）。补注入共享 auditService 的端到端断言 + best-effort mock 测试。**此项是 B-1/B-2 隐身的直接原因**，建议与 B-1/B-2 一并修复后回归。
- **S-2**：WriteResult 增加 `before?` 字段未反向同步 Tech-Spec D3 [约束]（D3 声明 `{entity, changes}` 无 before）。建议反向同步 D3/D4。
- **S-3**：reportAggItemSchema 移除 count 子 object 的 .strict()（A-2）未反向同步 Tech-Spec D8 示例。建议更新 D8 示例。
- **S-4**：SEC-002 parseAndValidate 提取（A-3）为规避 check-rules.mjs break 条件 bug；根因是扫描器把 `if(...)` 误判为方法声明截断 body。建议修复 check-rules.mjs SEC-002 break 条件（排除控制流关键字），并反向同步 Spec。
- **S-5**：router 直接 `new AuditLogRepository()` 持有隔离 repo（S-5），导致 F1 日志无法被 audit list/report 聚合。建议 createRouter 接受共享 auditService 注入。
- **S-6**：AI-006 规则覆盖盲区——仅 grep contracts 符号，未覆盖 apps/api 内部签名变更（如 D3 service 返回签名变更）对测试的影响。建议增强（见下节）。
- **S-7**：CODE-002"禁止仅 console catch"与 PRD Q2 best-effort 吞错用 console.warn 存在张力，当前以注释绕过扫描器正则，属脆弱。建议调和规则。

## 对工作流的改进建议

### 对 AI-006 规则的改进建议（S-6）

**问题**：AI-006 当前清单生成方式为"grep 引用被改 contracts 符号的测试文件"，仅覆盖 contracts 联动维度。本轮 D3（service 写操作返回签名从 `Entity` 扩展为 `{entity, changes}`）是 apps/api 内部签名变更，非 contracts 改动，不在 grep 范围，导致 dept.test.ts 9 处影响遗漏（test-writer 兜底修正）。

**改进建议**（记为 suggestion 供复盘）：
1. **扩展 AI-006 触发面**：除 contracts 联动外，当 Tech-Spec 涉及"既有 service/repository 方法签名变更"时，Tech Lead 须额外 grep `apps/api/test/**/*.ts` 中**消费该方法返回值/参数**的断言点（如 `await service.create(...)` 的返回值访问 `.xxx`），纳入受影响清单。
2. **要求 test-writer 交叉核实**：在 AI-006 规则中补充"test-writer 据清单同步更新后，须反向核实清单完整性——若发现清单外的影响点，须在交付报告中显式列出差异并修正"（本轮 test-writer 已自发这么做，建议固化为规则要求）。
3. **清单格式增强**：受影响测试清单须分两类标注——①contracts 联动驱动（grep 命中）②apps/api 内部签名变更驱动（Tech Lead 手动分析），避免第二类被遗漏。

**不建议**将 AI-006 改为机器化 enforcement（grep contracts 符号可机器化，但"service 签名变更影响"需语义判断，机器化误报率高）。维持 Reviewer 流程校验 + test-writer 交叉核实的人机协同模式。

### 其他工作流建议
- **F1 端到端测试应纳入 Tech-Spec 测试矩阵的强制项**：本轮 §10 列了 F1 边界测试要求但 test-writer 未产出，说明"测试矩阵列了 ≠ test-writer 必产出"。建议 AI-002 增加"测试矩阵每类须有对应 describe/it，缺类须在交付报告中说明"的约束。
- **advisory 偏离须显式反向同步 Spec 文件**：A-2/A-3 均在代码注释中说明但未更新 Tech-Spec 文件，AI-003 要求"相应更新 Tech-Spec"。建议 Reviewer 将"advisory 偏离未更新 Spec 文件"统一记为 suggestion（本轮 A-1 因 Spec §13 已预留视为已同步；A-2/A-3 记 S-3/S-4）。

## 门禁复核（Reviewer 实跑）
| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `npx tsc --noEmit` | exit 0，0 错误 |
| lint:rules | `node scripts/check-rules.mjs` | exit 0，13 项 enforcement + META-003/004 双向绑定，0 warning |
| test | `npx vitest run` | exit 0，5 文件 390/390（report 86 / audit 104 / dept 92 / role 73 / user 35），1.47s |

三件套全绿，但**全绿不等于无缺陷**——B-1/B-2 因 F1 端到端测试缺失而隐身，证明"测试通过"不能替代"验收标准对齐"。

## 最终结论

**verdict: blocker**。

- **2 项 blocker（B-1/B-2）**：role assign/remove 与 dept assignUserDepartment 的审计日志属性偏离 PRD F1 验收 [约束]（action/entity_type/字段），impl-writer 未报告，按 AI-003 记为越界。须修复使日志属性符合 PRD 验收，并补 F1 端到端测试（S-1）回归。
- **三个方向实现质量**：F2 报表聚合 + F3 PII 标记脱敏实现质量高、测试充分；F1 withAudit 架构（router 层 HOF、service 纯粹、best-effort）方向正确，但 8 个写操作中 3 个（role assign/remove、dept assignUserDepartment）的日志属性实现错误。
- **AI-006 规则**：部分生效，清单遗漏 dept 9 处暴露覆盖盲区（仅 contracts 联动，未覆盖 service 签名变更），test-writer 交叉核实兜底；建议增强（S-6）。
- **advisory 偏离**：A-1 合理（Spec 已预留）；A-2/A-3 理由成立但未反向同步 Spec（S-3/S-4）。
- **最值得关注的发现**：**三件套全绿却隐匿 2 项 PRD 验收偏离**——根因是 F1 端到端测试缺失（test-writer 未按 Tech-Spec §10 测试矩阵产出 F1 边界测试）+ AI-006 清单未覆盖 service 签名变更影响。这表明"测试通过"需与"验收标准对齐"双轨验证：前者由 vitest 保障，后者需 Reviewer 对照 PRD Given/When/Then 逐条核查（本审查即据此发现 B-1/B-2）。下一轮应强化"测试矩阵每类必产出"与"Reviewer 按 PRD 验收逐条核对"两个环节。
