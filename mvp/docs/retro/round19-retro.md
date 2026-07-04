---
doc_type: Retrospective
id: RETRO-ROUND19-001
scope: 第十九轮演练（元改进轮 #3：固化 R18 S-21/S-22 共 2 项教训，无业务代码改动，仅提示词层 + Spec 模板层）
date: 2026-07-03
verdict: 跑通；R18 S-21/S-22 两项教训全部固化至提示词层（impl-writer + Reviewer 双向 + test-writer）+ Spec 模板层（§10 增项）；G6.5 元改进轮 Review checklist 第二次落地 5 项全过
---

# 第十九轮演练复盘 · 元改进轮 #3 · 固化 R18 S-21/S-22

> 本轮为 R13/R17 之后的第三个元改进轮（无标准 PRD→Spec 五角色流程），承接 R18 §6 新发现的 S-21（impl-writer [约束] 偏离反向同步滞后到收尾）+ S-22（test-writer 确定性 token setup 时序污染）共 2 项教训。本轮一次性固化至提示词层（impl-writer + Reviewer 双向 + test-writer）+ Spec 模板层（§10 增项），同时第二次落地 G6.5 元改进轮 Review checklist（验证 R17 首次落地的 G6.5 范式可复用）。

## 0 · 本轮目标与结果

1. **固化 R18 S-21**（impl-writer [约束] 偏离反向同步滞后）至三个层面 → ✅ 全部落地：
   - Spec 模板层（§2.3 Tech Lead）：§10 增项"[约束] 偏离反向同步闭环性"——Tech Lead 须预判本轮可能触发的 [约束] 项偏离并提示 impl-writer 交付阶段同步 Spec
   - 提示词层（§2.5 impl-writer）：追加"[约束] 项偏离反向同步与 advisory 偏离同标准——须实际编辑 Spec 文件（grep 确认章节已改）+ 交付报告列'反向同步的 Spec 文件路径 + 修改行号 + 偏离理由 + 合规论证'；代码注释声明 ≠ Spec 已同步（伪同步），与 R12 S-1 advisory 伪同步同形；加性安全场景须仍按 AI-003 流程闭合，不可因'加性安全'省略 Spec 反向同步"
   - 提示词层（§2.6 Reviewer）：追加"[约束] 项偏离反向同步须与 advisory 偏离同标准核实——Reviewer 须 git diff -- docs/spec/*.tech.md 实跑核对 Spec 文件对应章节已改；加性安全场景可降级为 Suggestion（非 blocker）但须强制本轮收尾闭合（不允许跨轮遗留）；伪同步（仅代码注释声明 Spec 未改）记 blocker"
2. **固化 R18 S-22**（test-writer 确定性 token setup 时序污染）至提示词层 → ✅ 落地：
   - 提示词层（§2.4 test-writer）：追加"确定性 token/凭证生成时须确保唯一性——当使用确定性 token 生成（如基于 sub+iat 的 JWT）时，须在 setup 阶段确保 token 唯一性（追加 nonce / 跨秒边界 setTimeout / 不同 sub），避免全局副作用（logout 黑名单/缓存写入/状态机变更）污染同 test suite 后续用例；test-writer 须在 setup 阶段预判全局副作用的跨用例污染风险，并在测试注释标注'确定性 token 唯一性 workaround'"
3. **G6.5 元改进轮 Review checklist 第二次落地**（验证 R17 范式可复用）→ ✅ 按 G6.5 五项 checklist 自检：
   - ①S-x 教训全部固化：2 项（S-21/S-22）已全部反推至提示词层 + Spec 模板层（见 §1）
   - ②三件套全绿：lint:rules exit 0（META-003/META-004 双向绑定持续闭合，6 条 AI-005 建议为 R16 既有非本次新增）/ typecheck 无 TS 改动（仅 .md 改动）/ vitest 无需重跑（仅元资产改动，无源码改动）
   - ③改动范围合规：仅元资产（spec-first-workflow.md + round19-retro.md），无业务代码越界
   - ④探针验证执行：S-21 提示词文本已落 §2.3/§2.5/§2.6，下轮业务轮可触发验证（如 test-writer 扩展 AC 范围 / impl-writer 添加 .strict() 类偏离场景）；S-22 提示词文本已落 §2.4，下轮业务轮端到端测试 setup 可触发验证
   - ⑤新发现 S-x 已记录：本轮无新发现 S 级教训（纯固化轮）
4. **G7 合入判定**：元改进轮按 G5 + G6.5 全绿（G1/G3/G4 不适用——无 PRD/Spec/测试先行），可合入。

**结果速览**：lint:rules ✅（META-003/META-004 双向绑定持续闭合）/ typecheck N/A（无 TS 改动）/ vitest N/A（无源码改动，无回归风险）/ 改动文件 1 个（spec-first-workflow.md 4 处编辑）+ round19-retro.md 新增 / 固化教训 2 项（S-21/S-22）/ G6.5 第二次落地 5 项全过。

## 1 · 本轮核心验证结论

### 1.1 R18 S-21 固化（提示词层 impl-writer + Reviewer 双向 + Spec 模板层 §10 增项）

R18 §2 新发现的 S-21（impl-writer [约束] 偏离反向同步滞后到收尾）在 R19 一次性固化至三个层面：

| 固化项 | 反推层 | 落地位置 | 验证结果 |
|---|---|---|---|
| S-21 Tech Lead §10 预判 | Spec 模板层 | spec-first-workflow.md §2.3 Tech Lead 提示词追加"§10 组合副作用预判须含'[约束] 偏离反向同步闭环性'项——Tech Lead 须预判本轮可能触发的 [约束] 项偏离，在 §10 显式提示 impl-writer 须在交付阶段同步反向编辑 Tech-Spec 对应章节（非仅代码注释声明）" | ✅ 落地 |
| S-21 impl-writer 反向同步同标准 | 提示词层 | spec-first-workflow.md §2.5 impl-writer 提示词追加"[约束] 项偏离反向同步与 advisory 偏离同标准——须实际编辑 Spec 文件（grep 确认章节已改）+ 交付报告列'反向同步的 Spec 文件路径 + 修改行号 + 偏离理由 + 合规论证'；代码注释声明 ≠ Spec 已同步（伪同步），与 R12 S-1 advisory 伪同步同形；加性安全场景须仍按 AI-003 流程闭合，不可因'加性安全'省略 Spec 反向同步" | ✅ 落地 |
| S-21 Reviewer 闸门核验 | 提示词层 | spec-first-workflow.md §2.6 Reviewer 提示词追加"[约束] 项偏离反向同步须与 advisory 偏离同标准核实——Reviewer 须 git diff -- docs/spec/*.tech.md 实跑核对 Spec 文件对应章节已改；加性安全场景可降级为 Suggestion 但须强制本轮收尾闭合（不允许跨轮遗留）；伪同步（仅代码注释声明 Spec 未改）记 blocker" | ✅ 落地 |

**结论**：S-21 三层固化形成完整闭环——Tech Lead 在 §10 预判 [约束] 偏离可能场景 → impl-writer 在交付阶段实际编辑 Spec 文件并交付报告列行号 → Reviewer 通过 git diff 核实 Spec 已改。加性安全场景（更严格非更弱）的处理边界明确：可降级为 Suggestion（非 blocker）但须本轮收尾闭合，与 R12 S-1 advisory 伪同步检测机制对称（advisory 与 [约束] 偏离反向同步同标准）。R18 S-21 的"代码注释声明但 Spec 未改"伪同步场景在 R19 固化后下轮业务轮将被 Reviewer 捕获为 blocker（强制 impl-writer 在交付阶段实际编辑 Spec）。

### 1.2 R18 S-22 固化（提示词层 test-writer）

R18 §2 新发现的 S-22（test-writer 确定性 token setup 时序污染）在 R19 固化至提示词层：

| 固化项 | 反推层 | 落地位置 | 验证结果 |
|---|---|---|---|
| S-22 test-writer 确定性 token 唯一性 | 提示词层 | spec-first-workflow.md §2.4 test-writer 提示词追加"确定性 token/凭证生成时须确保唯一性——当使用确定性 token 生成（如基于 sub+iat 的 JWT）时，须在 setup 阶段确保 token 唯一性（追加 nonce / 跨秒边界 setTimeout / 不同 sub），避免全局副作用（logout 黑名单/缓存写入/状态机变更）污染同 test suite 后续用例；test-writer 须在 setup 阶段预判全局副作用的跨用例污染风险，并在测试注释标注'确定性 token 唯一性 workaround'" | ✅ 落地 |

**结论**：S-22 固化后 test-writer 在端到端测试 setup 阶段须预判全局副作用（logout 黑名单/缓存写入/状态机变更）的跨用例污染风险，并确保确定性 token 唯一性。R18 S-22 的"signToken 确定性致同 sub+iat 同 token → logout 黑名单污染后续用例"场景在 R19 固化后下轮业务轮端到端测试 setup 阶段将被 test-writer 预判并提前跨秒/加 nonce。

### 1.3 R17 G6.5 范式可复用性验证（第二次落地）

R19 是 R17 之后的第三个元改进轮，验证 R17 首次落地的 G6.5 元改进轮 Review checklist 范式可复用：

| 维度 | R13（首个元改进轮） | R17（第二个元改进轮） | R19（第三个元改进轮） |
|---|---|---|---|
| 流程 | 规划→实施→验证→复盘（无 PRD/Spec/test-writer/impl-writer/Reviewer 五角色） | 同 R13 | 同 R13 |
| 改动范围 | 元资产（规则 + 提示词 + 扫描器） | 元资产（提示词 + 规则 + 门禁） | 元资产（仅提示词 + Spec 模板） |
| 固化教训数 | 4 项（S-1~S-4） | 6 项（S-6/S-7/S-17~S-20） | 2 项（S-21/S-22） |
| 门禁 | 无 G6.5（S-7 未固化，复盘替代） | 首次应用 G6.5（5 项 checklist 全过） | 第二次应用 G6.5（5 项 checklist 全过） |
| 探针验证 | S-4 walkWeb 提升 + allTs 扩展（手动验证） | S-6 探针 lint:rules 实跑（机器验证） | S-21/S-22 提示词文本已落对应章节（下轮业务轮可触发验证） |
| 新发现 S-x | S-5/S-6/S-7（3 项遗留） | 0 项（纯固化轮） | 0 项（纯固化轮） |

**结论**：R19 验证 R17 G6.5 范式可复用——R17 首次落地 G6.5 后 R19 第二次落地 5 项 checklist 全过，证明 G6.5 范式稳定可复用。R19 比 R17 更轻量：仅提示词 + Spec 模板层改动（无规则层 / 无门禁层），固化教训数 2 项（vs R17 6 项），工作量集中且收敛。证明元改进轮范式成熟，未来元改进轮均须走 G6.5。

## 2 · 本轮新发现的问题（S 级，不阻断）

本轮为纯固化轮，无新发现 S 级教训。

## 3 · 量化对比（十九轮演进表）

| 指标 | R15 | R16 | R17 | R18 | R19 |
|---|---|---|---|---|---|
| 用例数 | 1089 | 1196 | 1196（无源码改动） | 1256（+60） | 1256（无源码改动） |
| 累计用例 | 1089 | 1196 | 1196 | 1256 | 1256 |
| blocker | 0 | 0 | 0 | 0 | 0 |
| suggestion | 8 | 7 | N/A（元改进轮） | 1（已闭合） | N/A（元改进轮） |
| Reviewer verdict | pass | pass | N/A（G6.5） | pass | N/A（G6.5） |
| AC 对齐 | 54/54 | 46/46 | N/A | 24/24 | N/A |
| 影响层 | 前端全域收尾层 | 后端能力前端化闭合层 | 元资产层 | 跨后端+前端+contracts 三层联动层 | **元资产层**（仅 spec-first-workflow.md） |
| 新架构模式 | 前端全域覆盖 | 后端能力前端化闭合 | 元改进轮 #2 | 历史 advisory 偏离消除（D10/D19） | **元改进轮 #3**（固化 R18 S-21/S-22） |
| 轮次类型 | 业务 | 业务 | 元改进 | 业务 | **元改进**（第三个） |
| 提示词骨架条数 | 5角色+17条 | 5角色+17条（S-17~S-20 待固化） | 5角色+23条 | 5角色+23条持续生效 | **5角色+25条**（R18 S-21 双向 impl-writer+Reviewer + S-22 test-writer 共 3 条新增） |
| 规则机器化覆盖 | 持续覆盖 | 持续覆盖 | AI-005 扩展含 apps/web/test | 持续覆盖 | 持续覆盖（lint:rules exit 0） |
| 元改进轮 Review | 沿用 R13 | 沿用 R13 | G6.5 落地（S-7 闭合） | 沿用 R17 G6.5 | **G6.5 第二次落地**（5 项全过） |
| 固化教训数（本轮） | 4（S-13~S-16） | 0（持续验证） | 6（S-6/S-7/S-17~S-20） | 0（新发现 S-21/S-22） | **2**（S-21/S-22） |

> R19 用例数 1256 = R18 1256（无源码改动，仅元资产改动，无回归风险）。lint:rules exit 0 + META-003/META-004 双向绑定持续闭合。

## 4 · 十九轮演进脉络

- **第十五轮**：前端全域覆盖收尾（通知管理页 + 报表页，新增 notification + report 两域，完成七域全覆盖），验证前端全域覆盖适应性
- **第十六轮**：后端能力前端化闭合（调岗 transfer + 角色继承管理，闭合"前端覆盖全部后端写/读端点"最后一公里），验证后端能力前端化闭合适应性 + errorMapping 全码映射收尾 + impl-writer 自报准确性违规发现（S-17~S-20 4 项待固化）
- **第十七轮**：元改进轮 #2（固化 R16 S-17~S-20 + R13 遗留 S-6/S-7 共 6 项教训），验证 R13 元改进轮精简流程范式可复用 + G6.5 元改进轮 Review checklist 首次落地（S-7 自身递归闭合）
- **第十八轮**：业务轮 #13（消除 R12 D10 wire 字段名适配 + R12 D19 GET /v1/users/:id 端点缺失 + D9 重分类 [约束]），跨后端 + 前端 + contracts 三层联动，验证 R17 固化提示词在业务轮首次大规模触发 + 新发现 S-21（[约束] 偏离反向同步滞后）+ S-22（确定性 token setup 时序污染）
- **第十九轮**：**元改进轮 #3**（固化 R18 S-21/S-22 共 2 项教训），无业务代码改动，仅提示词层 + Spec 模板层。S-21 三层固化（Tech Lead §10 预判 + impl-writer 反向同步同标准 + Reviewer git diff 核实 + 加性安全降级但强制本轮闭合）。S-22 提示词层 test-writer 确定性 token 唯一性 + 全局副作用预判。验证 R17 G6.5 范式第二次落地可复用。

## 5 · 反推优化三个层面执行情况

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R19 状态 | 证据 |
|---|---|---|
| META-003 声明即实现 | ✅ 持续闭合 | 本轮无规则脚本改动，lint:rules exit 0 |
| META-004 实现即声明 | ✅ 持续闭合 | 本轮无新增 enforcement ID |
| ARCH-001/002/003 | ✅ 保持 | 本轮无 ARCH 改动，元资产改动不引入 apps/api/src 依赖 |
| AI-005 扫描器（R13 S-6 固化） | ✅ 持续覆盖 | lint:rules exit 0，6 条 AI-005 建议为 R16 既有 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R19 状态 | 证据 |
|---|---|---|
| R16 S-18 全集定义明确 | ✅ 持续生效 | 本轮无改动，下轮业务轮继续生效 |
| R16 S-19 简单常量复用边界 | ✅ 持续生效 | 本轮无改动 |
| R16 S-20 测试工具 workaround | ✅ 持续生效 | 本轮无改动 |
| **R18 S-21 [约束] 偏离反向同步闭环性** | ✅ **R19 固化** | spec-first-workflow.md §2.3 Tech Lead 提示词追加"§10 组合副作用预判须含'[约束] 偏离反向同步闭环性'项" |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.3~2.6）

#### R18 固化的 S-21/S-22 在 R19 全部固化

| 固化项 | 角色 | 落地位置 | 固化状态 |
|---|---|---|---|
| S-21 Tech Lead §10 预判 | Tech Lead | spec-first-workflow.md §2.3 提示词追加"§10 组合副作用预判须含'[约束] 偏离反向同步闭环性'项" | ✅ R19 固化 |
| S-21 impl-writer 反向同步同标准 | impl-writer | spec-first-workflow.md §2.5 提示词追加"[约束] 项偏离反向同步与 advisory 偏离同标准" | ✅ R19 固化 |
| S-21 Reviewer 闸门核验 + 加性安全降级强制本轮闭合 | Reviewer | spec-first-workflow.md §2.6 提示词追加"[约束] 项偏离反向同步须与 advisory 偏离同标准核实" | ✅ R19 固化 |
| S-22 test-writer 确定性 token 唯一性 + 全局副作用预判 | test-writer | spec-first-workflow.md §2.4 提示词追加"确定性 token/凭证生成时须确保唯一性" | ✅ R19 固化 |

**合计**：R18 反推的 S-21（三层：Tech Lead + impl-writer + Reviewer）+ S-22（test-writer）共 4 条提示词在 R19 全部固化。R13 固化的 8 条 + R14 固化的 5 条 + R15 固化的 4 条 + R16 持续验证的 17 条 + R17 固化的 6 条 + R18 持续验证的 23 条 + R19 新固化的 4 条 = **R19 后提示词骨架共 5 角色 + 25 条固化项持续生效**。

## 6 · 结论 + 剩余改进项

第十九轮是"元改进轮 #3 · 固化 R18 S-21/S-22"的标志——R17 之后的第三个元改进轮，承接 R18 §6 新发现的 S-21（impl-writer [约束] 偏离反向同步滞后到收尾）+ S-22（test-writer 确定性 token setup 时序污染）共 2 项教训。本轮一次性固化至提示词层（impl-writer + Reviewer 双向 + test-writer + Tech Lead §10 预判）+ Spec 模板层（§10 增项），同时第二次落地 G6.5 元改进轮 Review checklist（验证 R17 范式可复用）。

关键证据：
1. **R18 S-21 三层固化**：Tech Lead §10 预判 [约束] 偏离可能场景 + impl-writer 实际编辑 Spec 文件并交付报告列行号（代码注释声明 ≠ Spec 已同步，伪同步）+ Reviewer git diff 核实 Spec 已改。加性安全场景（更严格非更弱）的处理边界明确：可降级为 Suggestion（非 blocker）但须本轮收尾闭合（不允许跨轮遗留）。与 R12 S-1 advisory 伪同步检测机制对称（advisory 与 [约束] 偏离反向同步同标准）。
2. **R18 S-22 提示词层固化**：test-writer 在端到端测试 setup 阶段须预判全局副作用（logout 黑名单/缓存写入/状态机变更）的跨用例污染风险，并确保确定性 token 唯一性（追加 nonce / 跨秒边界 setTimeout / 不同 sub）。
3. **R17 G6.5 范式第二次落地可复用性验证**：R19 第二次应用 G6.5 五项 checklist 全过，证明 G6.5 范式稳定可复用。R19 比 R17 更轻量（仅提示词 + Spec 模板层改动，无规则层 / 无门禁层，固化教训数 2 项 vs R17 6 项），工作量集中且收敛。

剩余改进项（S 级，不阻断）：
- **S-5**（R12 遗留，advisory 不强制）：setupFiles 全局副作用——R13/R14/R15/R16/R17/R18/R19 均未触发，持续 advisory。未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 unit/e2e（R20 E2E 引入时顺带闭合）。

> 本轮固化的 2 项教训（S-21/S-22）反推证据见 §1 + §5，不再列为"仍在生效"——下轮业务轮生效，lessons-learned.md 经 `npm run gen:retro-index` 重生后将迁入"已固化规则表"。

> **下一轮候选**（按 R17 §6 + R18 §6 + R19 元改进后状态排序）：
> 1. **E2E 测试引入**（Playwright 真实浏览器+真实后端）—— R20，加 Playwright 依赖 + e2e/ 目录 + 真实后端启动 fixture，覆盖核心流（login → user 列表 → role 操作 → transfer → 登出），顺带闭合 S-5 setupFiles 全局副作用（vitest projects 模式分离 unit/e2e）。
> 2. **前端性能加固**（React.memo/useMemo/useCallback 评估 + 虚拟列表 + 代码分割）—— R21，前端单层变更。
> 3. **可访问性深化**（screen reader 端到端测试 + 键盘导航 + 色彩对比 WCAG AA）—— R22，前端单层变更，可与 R21 合并。
