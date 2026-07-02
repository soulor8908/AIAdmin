---
doc_type: Retrospective
id: RETRO-ROUND5-001
scope: 第五轮演练（跨域埋点 + 报表聚合 + PII 结构化）+ 工作流在非 CRUD 领域适应性验证
date: 2026-07-02
verdict: 跑通（经 1 轮 blocker 修复）；三个架构方向全部落地；首次暴露"测试通过 ≠ 验收对齐"新边界并闭环
---

# 第五轮演练复盘 · 跨域埋点 + 报表聚合 + PII 结构化

## 0 · 本轮目标与结果
1. 落实第四轮三个待探索方向：跨域旁路埋点架构、PII 脱敏结构化契约、非 CRUD 报表领域 → ✅ 三方向全部落地
2. 验证工作流在"非 CRUD 领域（纯读+聚合）"的适应性 → ✅ report 领域 86 用例，group by/date 桶/排序/分页全绿
3. 三个反推优化点（AI-002/005/006）在新场景下是否仍生效 → ✅ AI-002/005 生效；AI-006 暴露覆盖盲区（仅 contracts 联动，未覆盖 service 签名变更）

## 1 · 三个架构方向落地结论

### 方向1：跨域旁路埋点的架构模式 → 落地（router 层 withAudit HOF）
**架构决策**：router 层 `withAudit` 高阶函数包装写操作 handler（D1）。
- service 不 import AuditLogService（保持纯粹，ARCH-001 不破坏）
- 调用方零感知（wrapper 提取 entity 返回，不暴露 changes）
- best-effort：try/catch + console.warn 吞异常不抛调用方（不空 catch 满足 CODE-002）
- service 写操作返回 `WriteResult<E> = {entity, changes, before?}`，wrapper 据此组装 AuditLogRecordInput

**8 个写操作全覆盖**：user.create/updateStatus、role.create/delete/assign/remove、dept.create/delete/assignUserDepartment。

**关键收益**：审计旁路与业务主流程完全解耦——三域 service 零改动业务逻辑即可获得审计能力，埋点失败不拖垮主操作。

### 方向2：PII 脱敏的结构化契约 → 落地（ChangeField + 双层 SSOT PII 清单）
**契约升级**：before/after 从 `z.record(z.unknown())` → `z.array(changeFieldSchema)`，ChangeField = {field, value, pii}。
- **双层 SSOT**：shape 在 contracts（piiFieldRegistrySchema），data 在 domain（PII_FIELD_REGISTRY，本期 {user: Set(['email'])}）
- **markPii 辅助函数**（domain）：查 PII_FIELD_REGISTRY 标 pii=true/false
- **D7 脱敏**：service/audit.ts 移除运行时正则兜底（EMAIL_LIKE_RE），按 ChangeField.pii 标记套 redactEmail
- **一刀切迁移**：无 z.record 残留，脱敏单一路径可静态推理

**关键收益**：消除第四轮 retro P2 的"值级兜底灰区"——脱敏不再靠运行时正则双判断（键名+值格式），而是静态字段标记，可静态推理。

### 方向3：非 CRUD 领域（报表聚合）的适应性 → 落地（report 领域）
**新增 report 领域**：纯读 + 聚合，无 create/update/delete。
- ReportService.query：读 auditRepo.listAll → 内存 group by（按 group_by 维度）→ date 桶 slice(0,10) → count 降序+维度值升序 tiebreaker → 分页
- 契约：reportQuerySchema（group_by optional, time range, 过滤, 分页）/ reportResultSchema（items: reportAggItem[]）
- 错误码：group_by 缺失→REPORT_GROUP_BY_REQUIRED；时间范围无效→REPORT_TIME_RANGE_INVALID
- 权限：新增 report:read 权限码

**工作流适应性结论**：7 阶段流水线（PRD→Spec→Test→Impl→Review）对非 CRUD 领域完全适用，无阶段缺失。唯一差异：report 领域无 service 写操作返回签名变更、无 withAudit 埋点、无 PII（聚合维度均为非 PII 字段）。

## 2 · 本轮新发现的问题（核心：首次 blocker）

### P0 · "测试通过 ≠ 验收对齐"——Reviewer 抓出 2 个 PRD [约束] 偏离
**现象**：impl-writer 三件套全绿（390/390），但 Reviewer 对照 PRD F1 验收标准逐条核对，发现 2 个 [约束] 偏离：
- **B-1**：role assign/remove 的 action 应为 `update`（impl 用了 create/delete），before/after 应含虚拟字段 `assigned_user_ids: string[]`（impl 用了 user_id/role_id 标量）
- **B-2**：dept assignUserDepartment 的 entity_type 应为 `user`（impl 用了 dept）

**根因（双重失效）**：
1. **F1 端到端测试缺失**：test-writer 未按 Tech-Spec §10 测试矩阵产出 F1 验收测试（既有测试用隔离的 auditRepo，无法验证"写操作后日志真的被记录且内容正确"）
2. **AI-006 受影响测试清单覆盖盲区**：清单仅 grep contracts 符号联动，未覆盖 service 方法签名变更对测试的影响（dept.test.ts 9 处因 service 返回 {entity, changes} 需改，Tech Lead 原判断"零改动"不准，test-writer 亲自核实修正）

**为什么三件套没抓出**：tsc/check-rules/vitest 校验的是"代码正确性"（类型/规则/断言），不校验"业务验收对齐"。impl-writer 的 B-1/B-2 是类型正确、规则合规、断言通过，但语义偏离 PRD——这种偏离只有"对照 PRD Given/When/Then 逐条核对"才能发现。

**反推优化（本轮已闭环）**：
- 修复 B-1/B-2（impl-writer 改 action/entity_type/虚拟字段）
- 补 F1 端到端测试（test-writer 新建 audit-embedding.test.ts 14 用例，把 B-1/B-2 修复固化为断言）
- **新规则 AI-007（待下一轮落实）**：测试矩阵每类必产出端到端验收测试（对照 PRD Given/When/Then），Reviewer 须按 PRD 验收逐条核对（非仅查规则合规）

### P1 · AI-006 受影响测试清单覆盖盲区
**现象**：AI-006 清单生成方式仅 grep contracts 符号联动，未覆盖 apps/api 内部 service 方法签名变更对测试的影响。dept.test.ts 9 处因 service 返回签名从 `Promise<Entity>` 变 `Promise<{entity, changes}>` 需改，Tech Lead 原清单判断"零改动"不准。

**为什么仍可控**：test-writer 亲自核实并修正（本轮自发行为），未导致测试漏改。

**反推优化（AI-006 增强，待下一轮落实）**：
1. 扩展触发面：除 contracts 联动外，当 Tech-Spec 涉及"既有 service/repository 方法签名变更"时，Tech Lead 须额外 grep `apps/api/test/**/*.ts` 中消费该方法返回值/参数的断言点
2. 要求 test-writer 交叉核实：test-writer 据清单同步后，须反向核实清单完整性，发现清单外影响点须在交付报告显式列出差异并修正（本轮已自发，建议固化为规则）
3. 清单格式增强：分两类标注——①contracts 联动驱动（grep 命中）②apps/api 内部签名变更驱动（Tech Lead 手动分析）
4. 不机器化：service 签名变更影响需语义判断，机器化误报率高，维持 Reviewer 流程校验 + test-writer 交叉核实的人机协同

### P2 · check-rules.mjs SEC-002 静态扫描 bug
**现象**：SEC-002 扫描器在 `if(...)` 行误判为方法声明截断 body，导致 requireAdmin 落出 body 被误报。impl-writer 为规避此 bug，将 ReportService.query 的校验逻辑提取到私有方法 parseAndValidate（advisory 偏离，已反向同步 Spec）。

**反推优化（待下一轮落实）**：修复 check-rules.mjs SEC-002 扫描器的方法识别正则（排除 `if/for/while/switch/catch` 等控制流关键字作为方法名），消除误判，使 impl-writer 无需为规避扫描器而重组代码结构。

## 3 · 三个反推优化点在本轮的验证

### AI-002 tsc 自检 → 生效（延续第四轮）
test-writer 交付时 93 个 tsc error 全部归因为预期导入红，0 产物缺陷。impl-writer 实现后 0 error。

### AI-005 禁止硬编码 → 生效（延续第四轮）
8 处全集断言用 `[...schema.options]` 派生（权限码/错误码/维度枚举/实体类型/动作）。permissionCodeSchema 加 report:read 后，role.test.ts SSOT 派生断言自动跟随，零改动。

### AI-006 受影响测试清单 → 部分生效（暴露盲区）
清单覆盖 contracts 联动（audit.test.ts ~30 处改、role/dept/user 零改动判断准确），但未覆盖 service 签名变更（dept.test.ts 9 处遗漏，test-writer 亲自核实修正）。详见 §2 P1。

## 4 · 量化对比（五轮）

| 指标 | R1 user | R2 role | R3 dept | R4 audit | R5 enhance |
|---|---|---|---|---|---|
| 用例数 | 35 | 73 | 92 | 91 | 404（含 F1 端到端 14） |
| 累计用例 | 35 | 108 | 200 | 291 | 404 |
| blocker | 1 | 0 | 0 | 0 | **2（修复后 0）** |
| suggestion | 6 | 6 | 4 | 3 | 7 |
| Reviewer verdict | pass | pass | pass | pass | **blocker→pass** |
| 跨域联动击穿测试 | N/A | N/A | 是 | 否（零改动） | 否（零改动） |
| test-writer tsc 自检 | 无 | 无 | 14错漏出 | 0错漏出 | 0错漏出 |
| 受影响测试清单 | 无 | 无 | 无 | 有（准确） | **有（dept 9处遗漏）** |
| 编排者救火次数 | 1 | 0 | 2 | 0 | **2（B-1/B-2 修复）** |
| 新方向验证 | CRUD | CRUD | CRUD | append-only | **非CRUD+埋点+结构化** |

## 5 · 五轮演进脉络
- **第一轮**：建立主干，暴露规则可校验性 P0 缺口
- **第二轮**：规则机器化 100%，暴露声明漂移
- **第三轮**：META-003/004 双向绑定消除漂移，暴露跨域联动代价与 test-writer 自检缺口
- **第四轮**：三个反推优化点闭环生效，跨域联动从"击穿救火"转向"零改动可预测"
- **第五轮**：三个架构方向落地（埋点/结构化/非CRUD），首次暴露"测试通过 ≠ 验收对齐"新边界——Reviewer 按 PRD 验收逐条核对抓出 2 个 [约束] 偏离，反推 AI-006 盲区与端到端验收测试缺口

## 6 · 结论
第五轮是"工作流进入深水区"的标志——前三轮是建骨架补肌肉，第四轮是肌肉自主收缩，第五轮首次面对"复合场景"（跨域埋点+结构化+非CRUD三方向交织）。三个架构方向全部落地，但首次出现 Reviewer blocker，暴露一个比前几轮更深的问题：**类型正确 + 规则合规 + 断言通过 ≠ 业务验收对齐**。

根因是 F1 端到端测试缺失（test-writer 漏产出测试矩阵的一类）+ AI-006 清单未覆盖 service 签名变更影响。这双重失效让 impl-writer 的语义偏离（B-1/B-2）隐身于"全绿"假象之下，直到 Reviewer 对照 PRD Given/When/Then 逐条核对才被抓出。

这证明：**AI 原生工作流的下一道质量门禁，是"验收对齐"而非"代码正确"**。tsc/check-rules/vitest 校验代码正确性，Reviewer 对照 PRD 验收校验业务语义——两者缺一不可。下一轮须落实 AI-007（端到端验收测试 + Reviewer PRD 逐条核对）与 AI-006 增强（覆盖 service 签名变更 + test-writer 交叉核实），闭合这道新门禁。

> 前四轮解决"代码怎么写对"，第五轮开始解决"写对的代码是不是业务要的"。这是工作流从"工程质量"迈向"业务正确性"的转折。
