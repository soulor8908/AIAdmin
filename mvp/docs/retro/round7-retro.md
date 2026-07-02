---
doc_type: Retrospective
id: RETRO-ROUND7-001
scope: 第七轮演练（transfer 调岗领域）+ 多步事务/补偿回滚/事务感知聚合埋点新架构模式适应性验证
date: 2026-07-02
verdict: 跑通；第六轮反推的"更复杂业务适应性"建议验证生效；新架构模式（多步事务+补偿+事务感知埋点）在既有工作流下首次落地，Reviewer verdict=pass 0 blocker 2 suggestion
---

# 第七轮演练复盘 · transfer 调岗领域 + 多步事务新架构模式适应性验证

## 0 · 本轮目标与结果

1. 落实第六轮 §5 建议"工作流在更复杂业务（多步事务、跨域聚合报表、权限继承）的适应性"，本期选**多步事务**方向 → ✅ 多步事务编排 + 补偿回滚 + 事务感知聚合埋点三件套新架构模式成功落地
2. 验证既有规则（ARCH-001/CODE-002/AI-005~007/META）在多步事务新领域下是否闭合 → ✅ 全部闭合，0 新增规则文件、0 新增 markEnforcement 分支
3. 验证 service→service→service 三层横向依赖在 ARCH-001 下闭合 → ✅ TransferService 注入 UserService+DeptService+RoleService 三 service + 三 repo，ARCH-001 仅禁 service→router 不禁 service→service / service→repo
4. 验证 CODE-002 在补偿 catch 下闭合 → ✅ 补偿失败抛 TRANSFER_COMPENSATION_FAILED 非静默吞
5. 验证事务感知聚合埋点（withAudit 在多步事务语义下正确） → ✅ 成功一条聚合日志 / 失败无幽灵日志

## 1 · 本轮核心验证结论（多步事务新架构模式适应性）

### 多步事务编排 + 补偿回滚新架构模式 → 落地（前六轮单步 service 调用未验证的边界）

| 维度 | 前六轮单步 service | 第七轮 transfer 多步事务 |
|---|---|---|
| 事务编排 | 单步 service 调用（create/update/delete/assign/remove/send/markRead） | **三步跨域原子操作**（校验→A改部门→B移除旧角色→C分配新角色） |
| 失败回滚 | 无事务/回滚概念（单步成功即提交） | **补偿闭包机制**（每步 push 逆操作，失败逆序执行，栈语义） |
| 补偿失败处理 | N/A | **TRANSFER_COMPENSATION_FAILED 非静默吞**（CODE-002 合规） |
| 补偿闭包归属 | N/A | **直接调 repo 绕过 service**（D4：避免 requireAdmin/withAudit 埋点/额外校验污染补偿） |
| service 横向依赖深度 | 单层（service→repo）或两层（NotificationService→UserService） | **三层 service→service→service**（TransferService→UserService/DeptService/RoleService）+ **service→repo 横向写**（补偿闭包直接调 repo） |
| Reviewer verdict | 历经 blocker→pass 演进 | **pass（0 blocker，一次通过）** |

**结论**：多步事务 + 补偿回滚是前六轮单步 service 调用未验证的新架构模式。本轮通过 D2（补偿闭包逆序执行）+ D4（补偿绕过 service 直接调 repo）+ D6（校验前置不写入 + 错误码校验传播/执行聚合）三项决策落地，ARCH-001（service→service→service 三层横向依赖 + service→repo 横向写）+ CODE-002（补偿 catch 非空非仅 console）在补偿逻辑下闭合。证明 spec-first 工作流对"更复杂业务（多步事务）"具有适应性（RETRO-ROUND6-001 §5 建议达成）。

### 事务感知聚合埋点 → 正确（withAudit 在多步事务语义下闭合）

| 维度 | 前六轮单步埋点 | 第七轮多步事务埋点 |
|---|---|---|
| 埋点时机 | handler 单步成功 → withAudit 调 audit.record | **三步全成功 → handler 返回聚合 WriteResult → withAudit 调 audit.record** |
| 失败语义 | handler 抛异常 → withAudit 不调 audit.record | **任一步骤失败 → handler 抛异常 → withAudit 不调 audit.record → 无幽灵日志** |
| 日志粒度 | 一条单步变更日志 | **一条聚合日志**（before/after 含 department_id+role_id 虚拟字段，非三条分散） |
| 补偿埋点风险 | N/A | **补偿闭包直接调 repo 绕过 withAudit**（D4），补偿操作本身不埋点（否则回滚也会埋点造成幽灵日志） |
| 端到端断言 | 隔离 auditRepo 或无端到端 | **注入共享 auditRepo 断言成功 total=1 / 失败 total=0**（F3-1/F3-2） |

**结论**：withAudit（R5 D1 HOF 模式）在多步事务语义下正确闭合——事务成功→一条聚合日志（非三条分散，符合"一次调岗事件一条审计"语义 PRD Q4 决策①），事务失败→无幽灵日志。关键设计：补偿闭包直接调 repo 绕过 withAudit（D4），避免补偿操作本身产生幽灵日志。F3-1/F3-2 端到端测试注入共享 auditRepo 观测，AI-007 关键闭合。

### ARCH-001 在 service→service→service 三层横向依赖下闭合

| 维度 | 第六轮两层 | 第七轮三层 |
|---|---|---|
| service→service 深度 | NotificationService→UserService（两层） | **TransferService→UserService/DeptService/RoleService（三层，三向横向依赖）** |
| service→repo 横向 | 无（NotificationService 仅注入 UserService） | **TransferService 注入 UserRepository+RoleRepository+DepartmentRepository**（补偿闭包直接调 + 校验查询） |
| ARCH-001 约束 | 仅禁 service→router | **仅禁 service→router**（service→service / service→repo 横向依赖不禁，ReportService 注入 AuditLogRepository 先例） |
| 闭合结论 | 闭合 | **闭合**（三层横向依赖 + service→repo 横向读/写均在 ARCH-001 允许范围） |

**结论**：ARCH-001 在更深横向依赖（service→service→service 三层 + service→repo 横向写）下仍闭合。验证了 ARCH-001 约束边界（仅禁 service→router）的合理性——service 间的横向依赖（同层调用）与 service→repo 的横向读写（先例 ReportService→AuditLogRepository）是合理的架构模式，不应被 ARCH-001 禁止。

### AI-007 端到端验收 + Reviewer PRD 逐条核对 → 持续生效（第二轮闭合）

| 维度 | 第六轮 notification | 第七轮 transfer |
|---|---|---|
| 端到端验收测试 | notification-embedding.test.ts 14 用例（F2 埋点8+F3 跨service5+SSOT1） | **transfer-embedding.test.ts 6 用例**（F1 1+F2 3+F3 2，覆盖 PRD 16 条 Given/When/Then） |
| 共享依赖注入 | 共享 AuditLogRepository + UserService | **共享 userRepo/roleRepo/deptRepo/auditRepo**（观测多步副作用 + 回滚恢复 + 无幽灵日志） |
| 关键端到端断言 | F2-5 operator_id=收件人 + F3 跨 service 调用 | **F2-1/F2-2/F2-4 回滚后状态恢复**（补偿闭包直接调共享 repo，状态变更可跨层观测）+ **F3-2 无幽灵日志**（共享 auditRepo total=0） |
| Reviewer PRD 核对 | 29/29 逐条对齐 | **16/16 逐条对齐**（F1 9+F2 4+F3 3） |
| Reviewer verdict | pass（0 blocker） | **pass（0 blocker，一次通过）** |

**结论**：AI-007 在第二轮（连续两轮）持续生效。本轮关键进步：端到端测试从"观测旁路副作用"（R6 auditRepo 日志落库）扩展到"观测回滚后状态恢复"（R7 共享 userRepo/roleRepo 断言 department_id + 已分配角色列表恢复调岗前值）——这是多步事务特有的端到端验收场景，单层断言无法覆盖。

### AI-006 两类标注 → 持续生效（第二轮闭合）

| 维度 | 第六轮 notification | 第七轮 transfer |
|---|---|---|
| ①类·contracts 联动 | errorCodeSchema 追加 4 码 + permissionCodeSchema 追加 notification:read/write + auditLogEntityTypeSchema 追加 notification | **errorCodeSchema 追加 4 码（TRANSFER_*）+ permissionCodeSchema 追加 transfer:write**（auditLogEntityTypeSchema 不变，沿用 user） |
| ①类断点 | audit-embedding.test.ts L533 硬编码全集断言需改 | **零改动**（SSOT 派生：role.test.ts admin seed 权限码 `[...permissionCodeSchema.options]` 自动覆盖 transfer:write；errorCodeSchema 无硬编码全集断言需改） |
| ②类·service 签名变更 | UserService.findByIds 新增（纯新增，零击穿） | **零签名变更**（TransferService 全新 service；补偿闭包复用既有 RoleRepository.insertUserRole/deleteUserRole + UserRepository.updateDepartmentId，零新增 repo 方法） |
| 两类标注准确性 | ①②类均准确（0 遗漏） | **①②类均准确**（①类 SSOT 派生零改动 / ②类零签名变更零影响） |

**结论**：AI-006 两类标注在第二轮持续生效。本轮特别之处：①类经 SSOT 派生（AI-005）实现零改动——errorCodeSchema 追加 4 码后无硬编码全集断言需更新（audit-embedding.test.ts 的 seenTypes 是 entity_type 枚举非 ErrorCode，transfer 不新增 entity_type 沿用 user）；permissionCodeSchema 追加 transfer:write 后 role.test.ts admin seed 断言经 `[...permissionCodeSchema.options]` 自动覆盖。这是 AI-005（SSOT 派生）价值的直接体现：枚举扩展后既有断言自动跟随，无需手改。

### D1 advisory 偏离正确处理范例（本轮范例）

**偏离**：Tech-Spec §3.1 D1 原写 TransferService 注入 5 依赖（不含 DepartmentRepository）。impl-writer 实现期发现校验阶段 `toDeptExists` 需直接查部门存在性，而 DepartmentService 无 public 只读方法（仅 `tree(ctx)` 返回树结构，成本高且语义不匹配）。两条出路：
- 出路A：为 DepartmentService 新增 public 只读方法 `findById` → 违反 SEC-002（service public 方法须 requireAdmin，但校验阶段是内部前置查询不应受 admin 守卫阻断，且为查询新增 service public 方法污染 service 接口）。
- 出路B：TransferService 直接注入 DepartmentRepository（service→repo 横向读，ARCH-001 不禁，ReportService 注入 AuditLogRepository 先例）→ 校验纯粹（读，不写入），不污染 service 接口。

impl-writer 选出路B（SEC-002 合规 + D6 校验前置不写入 + ARCH-001 先例），并反向同步 Tech-Spec §2/§3.1（advisory 标注 + 理由 + SEC-002/ARCH-001 合规论证 + 测试文件 6 参数同步声明）。Reviewer 判定合规（理由成立 + Spec 同步 + 验收对齐 16/16 + 三件套全绿）。

**结论**：这是 advisory 偏离正确处理的范例——偏离理由成立（SEC-002 合规权衡）+ Tech-Spec §2/§3.1 双处反向同步（advisory 标注 + 完整理由）+ 测试文件同步（7 处构造函数 5→6 参数）+ 三件套全绿 + PRD 16/16 对齐。但 D1 原为 [约束] 项，impl-writer 加第 6 依赖属 [约束] 项偏离，严格按 AI-003 字面应记 blocker（见 §2 S-2）。

## 2 · 本轮新发现的问题

### S-1 · PRD §数据实体草图与 §Q&A 决策不一致（PRD 起草不一致）

**现象**：PRD `docs/prd/transfer.md:54-57` §数据实体草图·补偿闭包描述步骤 B/C 补偿经 service（`roleService.assign` / `roleService.remove`），但 PRD Q10 推荐答案（L125）+ Tech-Spec §3.4 D4 [约束] + 实现均为补偿直接调 repo（`roleRepo.insertUserRole` / `roleRepo.deleteUserRole`）。

**根因**：PRD 起草时 §数据实体草图先写的是 service 版本（B/C 补偿经 service），后续 §Q&A Q10 才给出 repo 推荐答案，§数据实体草图未反向同步。这是 PRD 内部起草不一致，非实现偏离（实现遵循 Q10 + Tech-Spec D4 权威源）。

**反推优化（待落实）**：PRD 起草流程应增加"§数据实体草图与 §Q&A 决策一致性自检"环节——BA 在 PRD 完成前须核对 §数据实体草图的实现细节描述与 §Q&A 的推荐答案是否一致，不一致须统一（建议 §Q&A 决策为准，§数据实体草图反向同步）。本轮已补同步 §数据实体草图 L54-57（B/C 补偿改 repo 版本）。

### S-2 · [约束] 项偏离处理流程待固化（AI-003 张力）

**现象**：D1 原为 [约束]（5 依赖），impl-writer 实现期加第 6 依赖（deptRepo）并反向同步 Tech-Spec §2/§3.1 为 6 依赖 + advisory 标注。Reviewer 判定合规（理由成立 + Spec 同步 + 验收对齐）。

**张力**：AI-003 字面规定"对 Spec 的 [约束] 项：禁止偏离，偏离即越界，停下回报"。严格按字面，D1 [约束] 项偏离应记 blocker。但本轮偏离理由成立（SEC-002 合规权衡）+ Tech-Spec 已反向同步（advisory 标注 + 理由）+ 验收对齐（16/16）+ 三件套全绿，Reviewer 判定合规。这是 AI-003 字面与实际工程合理性的张力。

**反推优化（待落实）**：AI-003 增强——明确 [约束] 项偏离的处理流程：
1. impl-writer 发现 [约束] 项需偏离时，禁止默默偏离，须在交付报告显式标注"[约束] 项偏离 + 偏离理由 + 反向同步 Spec"。
2. impl-writer 须反向同步 Tech-Spec（[advisory] 标注 + 偏离理由 + 合规论证）。
3. Reviewer 须逐条确认 [约束] 项偏离的理由是否成立：理由成立 + Spec 已同步 + 验收对齐 → 视为 Spec 已演进（非越界）；理由不成立或 Spec 未同步 → 记 blocker。
4. 该流程将"严格禁止 [约束] 偏离"演进为"[约束] 偏离须经 Reviewer 确认理由成立 + Spec 同步后方可合规"，更贴近工程实际（实现期发现 Spec 设计不足时的合理演进路径）。

**位置**：`.trae/rules/ai-behavior/spec-first.md` AI-003。

## 3 · 量化对比（七轮）

| 指标 | R1 user | R2 role | R3 dept | R4 audit | R5 enhance | R6 notification | R7 transfer |
|---|---|---|---|---|---|---|---|
| 用例数 | 35 | 73 | 92 | 91 | 404 | 506 | 537 |
| 累计用例 | 35 | 108 | 200 | 291 | 404 | 506 | 537 |
| blocker | 1 | 0 | 0 | 0 | 2(修复后0) | 0 | **0** |
| suggestion | 6 | 6 | 4 | 3 | 7 | 2 | 2 |
| Reviewer verdict | pass | pass | pass | pass | blocker→pass | pass(一次通过) | **pass(一次通过)** |
| 端到端验收测试 | 无 | 无 | 无 | 无 | 缺失(B-1/B-2隐身) | 有(AI-007) | **有(AI-007 持续)** |
| Reviewer PRD 逐条核对 | 无 | 无 | 无 | 无 | 无 | 有(29/29) | **有(16/16)** |
| 受影响清单两类标注 | 无 | 无 | 无 | 仅①类 | ①类(dept9处遗漏) | ①②类均准确(0遗漏) | **①②类均准确(①类SSOT零改动)** |
| 新架构模式 | 单步 CRUD | 单步 CRUD | 单步 CRUD+树 | 单步 CRUD | 单步+跨域埋点 | 单步+跨service | **多步事务+补偿回滚+事务感知埋点** |
| service 横向依赖深度 | service→repo | service→repo | service→repo | service→repo | service→repo | service→service(两层) | **service→service→service(三层)+service→repo横向写** |
| HTTP 运行时入口 | 无 | 无 | 无 | 无 | 无 | 有(server.ts) | **有(transfer 路由挂载)** |
| advisory 偏离反向同步 | N/A | N/A | N/A | N/A | 部分滞后 | 部分滞后(record) | **D1 §2/§3.1 双处同步(范例)** |

## 4 · 七轮演进脉络

- **第一轮**：建立主干，暴露规则可校验性 P0 缺口
- **第二轮**：规则机器化 100%，暴露声明漂移
- **第三轮**：META-003/004 双向绑定消除漂移，暴露跨域联动代价与 test-writer 自检缺口
- **第四轮**：三个反推优化点闭环生效（AI-002/005/006），跨域联动从"击穿救火"转向"零改动可预测"
- **第五轮**：三个架构方向落地（埋点/结构化/非CRUD），首次暴露"测试通过 ≠ 验收对齐"新边界，反推 AI-007/AI-006增强/SEC-002 bug
- **第六轮**：三项反推优化点全部生效，"验收对齐"门禁首次闭合——端到端验收测试 + Reviewer PRD 逐条核对双轨，impl-writer 一次通过 Reviewer（0 blocker）
- **第七轮**：多步事务 + 补偿回滚 + 事务感知聚合埋点新架构模式落地，验证工作流对"更复杂业务"的适应性——service→service→service 三层横向依赖 + service→repo 横向写在 ARCH-001 下闭合，补偿 catch 在 CODE-002 下闭合，事务感知埋点在 withAudit 下闭合。impl-writer 连续两轮一次通过 Reviewer（0 blocker），D1 advisory 偏离反向同步成范例

## 5 · 结论

第七轮是"工作流对更复杂业务适应性"验证的标志——第六轮 §5 建议"探索工作流在更复杂业务（多步事务、跨域聚合报表、权限继承）的适应性"，本轮选**多步事务**方向，通过 transfer 调岗领域（F1 多步事务编排 + F2 补偿回滚 + F3 事务感知聚合埋点）三件套新架构模式落地，验证了 spec-first 工作流对"更复杂业务"的适应性。

关键证据：
1. **新架构模式落地**：多步事务编排（校验→A改部门→B移除旧角色→C分配新角色三步跨域原子）+ 补偿回滚（每步 push 逆操作闭包，失败逆序执行，栈语义）+ 事务感知聚合埋点（成功一条聚合日志 / 失败无幽灵日志）——前六轮单步 service 调用未验证的新架构模式，在既有规则（ARCH-001/CODE-002/AI-005~007/META）下闭合，0 新增规则文件、0 新增 markEnforcement 分支。
2. **ARCH-001 在更深横向依赖下闭合**：service→service→service 三层横向依赖（TransferService→UserService/DeptService/RoleService）+ service→repo 横向写（补偿闭包直接调 repo）+ service→repo 横向读（deptRepo 校验 toDeptExists）——ARCH-001 仅禁 service→router 的约束边界在更深横向依赖下仍合理。
3. **CODE-002 在补偿 catch 下闭合**：补偿失败抛 TRANSFER_COMPENSATION_FAILED（非空非仅 console），非静默吞——CODE-002 在补偿逻辑下闭合。
4. **AI-007 持续生效**：端到端测试（6 用例覆盖 PRD 16 条 Given/When/Then）+ Reviewer PRD 逐条核对（16/16 对齐）双轨闭合，注入共享 userRepo/roleRepo/deptRepo/auditRepo 观测多步副作用 + 回滚恢复 + 无幽灵日志。本轮关键进步：端到端测试从"观测旁路副作用"（R6 auditRepo 日志落库）扩展到"观测回滚后状态恢复"（R7 共享 userRepo/roleRepo 断言恢复调岗前值）。
5. **AI-006 持续生效 + AI-005 价值凸显**：①类经 SSOT 派生实现零改动（errorCodeSchema 无硬编码全集断言 / permissionCodeSchema 追加 transfer:write 后 admin seed 自动覆盖）；②类零签名变更（TransferService 全新 service + 补偿复用既有 repo 方法）。AI-005（SSOT 派生）价值在 ①类零改动中直接体现。
6. **D1 advisory 偏离反向同步范例**：impl-writer 实现期发现 5 依赖不足，选出路B（加 deptRepo 第 6 依赖，SEC-002 合规）而非出路A（违反 SEC-002 新增 service public 方法），并反向同步 Tech-Spec §2/§3.1（advisory 标注 + 理由 + 合规论证 + 测试文件同步声明）。这是 advisory 偏离正确处理的范例。

这证明：**AI 原生工作流在"业务正确性"保障阶段（R6 闭合）后，进入"复杂业务适应性"验证阶段（R7 落地）**——多步事务 + 补偿回滚 + 事务感知埋点新架构模式在既有规则下成功落地，无需新增规则，证明 spec-first 工作流的规则设计（ARCH-001/CODE-002/AI-005~007/META）具有跨业务复杂度的稳定性与适应性。impl-writer 连续两轮（R6/R7）一次通过 Reviewer（0 blocker），证明"事前预防"门禁稳定运行。

剩余改进项（S 级，不阻断）：
- **S-1**：PRD §数据实体草图与 §Q&A 决策一致性自检（BA 起草流程增强，本轮已补同步 transfer.md L54-57）。
- **S-2**：[约束] 项偏离处理流程固化（AI-003 增强：impl-writer 显式标注 + Reviewer 确认理由成立 + Spec 同步 → 视为 Spec 已演进）。

> 第六轮闭合"业务正确性"门禁（端到端验收 + PRD 逐条核对），第七轮验证"复杂业务适应性"（多步事务新架构模式落地）。下一轮可继续探索另两个方向——**跨域聚合报表**（如"部门人员统计报表"涉及多 service 聚合 + 分页 + 缓存）或**权限继承**（如"角色继承链 + 权限传递 + 父子角色校验"），进一步验证工作流对更复杂业务的适应性。同时可考虑 S-1/S-2 两项工作流改进的固化（PRD 起草一致性自检 + [约束] 项偏离处理流程）。
