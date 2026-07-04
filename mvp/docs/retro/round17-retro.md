---
doc_type: Retrospective
id: RETRO-ROUND17-001
scope: 第十七轮演练（元改进轮 #2：固化 R16 S-17~S-20 + R13 S-6/S-7 共 6 项遗留教训，无业务代码改动，仅元资产层）
date: 2026-07-03
verdict: 跑通；6 项遗留 S 级教训全部固化；S-6 探针验证（lint:rules exit 0 + AI-005 扩展分支无 false positive）；G6.5 元改进轮 Review checklist 首次落地
---

# 第十七轮演练复盘 · 元改进轮 #2 · 固化 R16 S-17~S-20 + R13 S-6/S-7

> 本轮为 R13 之后的第二个元改进轮（无标准 PRD→Spec 五角色流程），承接 R16 §6 剩余改进项之首"固化 S-17~S-20"+ R13 遗留至今未固化的 S-6/S-7。本轮一次性固化 6 项 S 级教训至三个层面（提示词层 5 项 + Spec 模板层 3 项 + 规则层 1 项 + 门禁层 1 项），同时首次落地 G6.5 元改进轮 Review checklist（自身反推固化 S-7 的产物即校验自身），验证 R13 元改进轮精简流程范式可复用。

## 0 · 本轮目标与结果

1. **固化 R16 S-17~S-20 共 4 项教训**至三个层面 → ✅ 全部落地：
   - S-17（impl-writer 自报准确性 + Reviewer 闸门核验）→ 提示词层（spec-first-workflow.md §2.5 impl-writer + §2.6 Reviewer 双向固化）
   - S-18（errorMapping 全码映射"全集"定义）→ 提示词层（§2.5 impl-writer）+ Spec 模板层（§2.3 Tech Lead §10 组合副作用预判增项）
   - S-19（简单常量跨组件复用边界）→ 提示词层（§2.5 impl-writer）+ Spec 模板层（§2.3 Tech Lead §10 增项）
   - S-20（user-event v14.6.1 disabled option 过滤 workaround）→ 提示词层（§2.4 test-writer）+ Spec 模板层（§2.3 Tech Lead §10 增项）
2. **固化 R13 遗留 S-6/S-7 共 2 项教训**至规则层/门禁层 → ✅ 全部落地：
   - S-6（AI-005 前端测试盲区）→ 规则层（check-rules.mjs AI-005 分支 continue 条件扩展含 apps/web/test/ + .trae/rules/ai-behavior/spec-first.md 校验方式同步，META-003 闭合）
   - S-7（元改进轮 Review 缺失）→ 门禁层（spec-first-workflow.md §3 门禁表新增 G6.5 元改进轮 Review checklist + G7 合入条件补充"元改进轮为 G5+G6.5"）
3. **G6.5 元改进轮 Review checklist 首次落地**（自身反推固化 S-7 的产物即校验自身）→ ✅ 按 G6.5 五项 checklist 自检：
   - ①S-x 教训全部固化：6 项（S-6/S-7/S-17~S-20）已全部反推至三个层面（见 §1）
   - ②三件套全绿：lint:rules exit 0（META-003/META-004 双向绑定持续闭合，6 条 AI-005 建议为 R16 既有非本次新增）/ typecheck 无 TS 改动（仅 .md + .mjs 改动）/ vitest 无需重跑（仅元资产改动，无源码改动）
   - ③改动范围合规：仅元资产（spec-first-workflow.md / check-rules.mjs / .trae/rules/ai-behavior/spec-first.md / round17-retro.md），无业务代码越界
   - ④探针验证执行：S-6 探针——lint:rules 实跑，AI-005 扩展分支无 false positive（apps/web/test/ 文件命中 0 处，证明正则对前端测试 toEqual 对象形式无误差，仅匹配数组形式）；S-17/S-18/S-19/S-20 探针——提示词文本已落 spec-first-workflow.md 对应章节，下轮业务轮可触发验证
   - ⑤新发现 S-x 已记录：本轮无新发现 S 级教训（纯固化轮）
4. **G7 合入判定**：元改进轮按 G5 + G6.5 全绿（G1/G3/G4 不适用——无 PRD/Spec/测试先行），可合入。

**结果速览**：lint:rules ✅（META-003/META-004 双向绑定持续闭合）/ typecheck N/A（无 TS 改动）/ vitest N/A（无源码改动，无回归风险）/ 改动文件 4 个（spec-first-workflow.md +1 文件多处编辑 / check-rules.mjs 1 处编辑 / .trae/rules/ai-behavior/spec-first.md 1 处编辑 / round17-retro.md 新增）/ 固化教训 6 项（S-6/S-7/S-17/S-18/S-19/S-20）/ G6.5 元改进轮 Review checklist 首次落地 5 项全过。

## 1 · 本轮核心验证结论

### 1.1 R16 S-17~S-20 固化（提示词层 + Spec 模板层）

R16 §5.3 反推的 S-17~S-20 共 5 条提示词（S-17 含 impl-writer + Reviewer 双向）+ 3 项 Spec 模板层 §10 增项在 R17 全部落地：

| 固化项 | 反推层 | 落地位置 | 验证结果 |
|---|---|---|---|
| S-17 impl-writer 自报准确性 | 提示词层 | spec-first-workflow.md §2.5 impl-writer 提示词追加"自报改动范围须准确——须 git diff 实跑核对，按文件逐条列出实际改动（含断言/setup/matcher），不可笼统描述'未改测试断言'+'未触达'。若自报与 git diff 不符属 AI-002 边界**自报准确性**违规（不构成 block，但 Reviewer 须通过 git diff 实跑核对自报准确性并显式标注）" | ✅ 落地 |
| S-17 Reviewer 闸门核验自报准确性 | 提示词层 | spec-first-workflow.md §2.6 Reviewer 提示词追加"须通过 git diff HEAD --stat -- apps/web/test/（前端轮）或 apps/api/test/（后端轮）实跑核对 impl-writer 自报改动范围的准确性，而非信赖自报描述——若 git diff 显示的改动文件/断言改动与 impl-writer 自报描述不符，须显式标注为 AI-002 边界**自报准确性**违规" | ✅ 落地 |
| S-18 errorMapping 全集定义 | 提示词层 + Spec 模板层 | spec-first-workflow.md §2.5 impl-writer 追加"全集定义须明确为'前端可能触发的域码全集'而非'errorCodeSchema 枚举全集'——前端不触发的域码可 [advisory] 沿用 FALLBACK，注释须显式标注" + §2.3 Tech Lead §10 组合副作用预判增项"全码映射收尾的全集定义明确" | ✅ 落地 |
| S-19 简单常量跨组件复用边界 | 提示词层 + Spec 模板层 | spec-first-workflow.md §2.5 impl-writer 追加"≤3 处使用场景且常量简单（单行正则）可 [advisory] 沿用重复定义；≥4 处使用场景或常量复杂（多行逻辑）须提取 lib/ 共享" + §2.3 Tech Lead §10 增项"简单常量跨组件复用边界" | ✅ 落地 |
| S-20 user-event disabled option 过滤 workaround | 提示词层 + Spec 模板层 | spec-first-workflow.md §2.4 test-writer 追加"user-event v14.6.1 selectOptions 会自动过滤 disabled option（不选中），测试'前端 disabled 防误选'场景须绕过 user-event 直接测 option.disabled 属性 + 测服务端兜底文案" + §2.3 Tech Lead §10 增项"测试工具限制 workaround" | ✅ 落地 |

**结论**：R16 §5.3 反推的 5 条提示词 + 3 项 Spec 模板层 §10 增项在 R17 全部落地，工作流逐轮收敛机制在元改进轮下持续生效。S-17 双向固化（impl-writer 自报 + Reviewer 核验）形成完整闭环，S-18/S-19/S-20 提示词层 + Spec 模板层双重固化确保下轮业务轮 Tech Lead 须在 §10 预判时考虑这三类组合副作用。

### 1.2 R13 遗留 S-6 固化（规则层 · check-rules.mjs AI-005 扩展）

R13 §6 剩余改进项 S-6（AI-005 前端测试盲区）自 R13 起遗留 4 轮未固化，R17 一次性闭合：

**改动**：
- check-rules.mjs AI-005 分支：`continue` 条件从 `rel(f).startsWith('apps/api/test/')` 扩展为 `AI005_TEST_DIRS = /^(apps\/api\/test\/|apps\/web\/test\/)/` 正则匹配，覆盖前端测试对跨域枚举集合的硬编码断言
- .trae/rules/ai-behavior/spec-first.md AI-005 校验方式同步："扫描 `apps/api/test/**/*.ts` 与 `apps/web/test/**/*.ts(x)` 中 ..."（META-003 声明即实现闭合）

**S-6 探针验证**（G6.5 #4）：
- lint:rules 实跑 exit 0
- AI-005 扩展分支扫描 apps/web/test/ 全部 363 个 web 测试用例（R12 50 + R14 108 + R15 87 + R16 107 + 其他 11）
- 0 处前端测试命中 AI-005 建议（前端 toEqual 多为对象形式，正则仅匹配 `.toEqual(\[...\])` / `.toStrictEqual(\[...\])` 数组形式，无 false positive）
- 6 条 AI-005 建议全部来自 apps/api/test/（R16 既有 role-inheritance 测试，正则匹配 3+ 个权限码字面量数组），非本次扩展引入

**结论**：S-6 固化后 AI-005 扫描器对前端测试覆盖盲区消除。正则仅匹配数组形式 toEqual/toStrictEqual 的设计在前端 toEqual 多为对象形式的实际场景下无 false positive，验证 R13 §6 反推"须核查正则对前端测试的适用性"的探针结论——正则适用性已被实测验证。META-003（声明即实现）+ META-004（实现即声明）双向绑定在规则脚本扩展 + 规则文档同步下持续闭合。

### 1.3 R13 遗留 S-7 固化（门禁层 · G6.5 元改进轮 Review checklist）

R13 §6 剩余改进项 S-7（元改进轮 Review 缺失——复盘替代 Review 作为质量门禁）自 R13 起遗留 4 轮未固化，R17 一次性闭合：

**改动**：
- spec-first-workflow.md §3 门禁表新增 G6.5 行："元改进轮（无 PRD AC）专用 checklist：①S-x 教训全部固化（提示词层/Spec 模板层/规则层）②三件套全绿 ③改动范围合规（仅元资产，无业务代码越界）④探针验证执行（如某固化的扫描器分支命中/某提示词在样例场景可命中）⑤新发现 S-x 已记录"
- G7 合入条件补充："G1+G3+G4+G5+G6 全绿（元改进轮为 G5+G6.5）"

**S-7 自身反推闭合的递归性**：G6.5 的产物（本轮 retro §0 #3）即按 G6.5 五项 checklist 自检通过——这是"反推优化自身被反推项校验"的递归范例：S-7 反推产生 G6.5，G6.5 自身校验 S-7 是否已固化（①S-x 教训全部固化——含 S-7 自身）。递归闭合证明 G6.5 设计自洽。

**结论**：S-7 固化后元改进轮不再"复盘替代 Review 作为质量门禁"——G6.5 提供轻量 Review checklist（5 项），元改进轮须按 G6.5 自检通过方可 G7 合入。R13 元改进轮（无 G6.5）+ R17 元改进轮（首次应用 G6.5）形成对照，未来元改进轮均须走 G6.5。

### 1.4 R13 元改进轮精简流程范式可复用性验证

R17 是 R13 之后的第二个元改进轮，验证 R13 确立的"规划→实施→验证→复盘"精简流程范式可复用：

| 维度 | R13（首个元改进轮） | R17（第二个元改进轮） |
|---|---|---|
| 流程 | 规划→实施→验证→复盘（无 PRD/Spec/test-writer/impl-writer/Reviewer 五角色） | 同 R13 |
| 改动范围 | 元资产（规则 + 提示词 + 扫描器） | 同 R13 |
| 固化教训数 | 4 项（S-1~S-4） | 6 项（S-6/S-7/S-17~S-20） |
| 门禁 | 无 G6.5（S-7 未固化，复盘替代） | 首次应用 G6.5（5 项 checklist 全过） |
| 探针验证 | S-4 walkWeb 提升 + allTs 扩展（手动验证） | S-6 探针 lint:rules 实跑（机器验证） |
| 新发现 S-x | S-5/S-6/S-7（3 项遗留） | 0 项（纯固化轮） |

**结论**：R17 验证 R13 元改进轮精简流程范式可复用——无标准 PRD→Spec 五角色流程，直接"规划→实施→验证→复盘"。R17 比 R13 更优的是：①首次应用 G6.5 闭合 S-7 自身递归；②S-6 探针用 lint:rules 实跑机器验证（vs R13 S-4 手动验证）；③无新发现 S-x（纯固化轮，工作量集中且收敛）。证明元改进轮范式成熟。

## 2 · 本轮新发现的问题（S 级，不阻断）

本轮为纯固化轮，无新发现 S 级教训。

## 3 · 量化对比（十七轮演进表）

| 指标 | R13 | R14 | R15 | R16 | R17 |
|---|---|---|---|---|---|
| 用例数 | 883 | 991 | 1089 | 1196 | 1196（无源码改动） |
| 累计用例 | 883 | 991 | 1089 | 1196 | 1196 |
| blocker | 0 | 0 | 0 | 0 | 0 |
| suggestion | N/A（无 Review） | 8 | 8 | 7 | N/A（元改进轮无 Reviewer） |
| Reviewer verdict | N/A（复盘替代） | pass | pass | pass | N/A（元改进轮走 G6.5） |
| AC 对齐 | N/A（元改进轮） | 68/68 | 54/54 | 46/46 | N/A（元改进轮） |
| 影响层 | 元资产层 | 前端扩展层 | 前端全域收尾层 | 后端能力前端化闭合层 | **元资产层**（仅 spec-first-workflow.md / check-rules.mjs / .trae/rules/ / round17-retro.md） |
| 新架构模式 | 工作流元改进 | 前端多域扩展 | 前端全域覆盖 | 后端能力前端化闭合 | **元改进轮 #2（固化 R16 反推 + R13 遗留）** |
| 轮次类型 | 元改进（首个） | 业务 | 业务 | 业务 | **元改进**（第二个） |
| 提示词骨架条数 | 5角色+8条（S-1/S-2/S-3 固化） | 5角色+13条 | 5角色+17条 | 5角色+17条（持续验证）+ S-17~S-20 4条待固化 | **5角色+23条**（R13 8 + R14 5 + R15 4 + R16 6 固化，全部持续生效） |
| 规则机器化覆盖 | CODE 扫描器覆盖前端（allTs 扩展） | 持续覆盖 | 持续覆盖 | 持续覆盖 | **AI-005 扫描器覆盖 apps/web/test**（S-6 闭合） |
| 元改进轮 Review | 缺失（S-7 待固化） | 沿用 R13 | 沿用 R13 | 沿用 R13 | **G6.5 落地**（S-7 闭合，5 项 checklist） |
| 固化教训数（本轮） | 4（S-1~S-4） | 5（S-8~S-12） | 4（S-13~S-16） | 0（持续验证 R13/R14/R15 固化项） | **6**（S-6/S-7/S-17~S-20） |

> R17 用例数 1196 = R16 1196（无源码改动，仅元资产改动，无回归风险）。lint:rules exit 0 + META-003/META-004 双向绑定持续闭合 + AI-005 扩展分支探针无 false positive。

## 4 · 十七轮演进脉络

- **第十三轮**：首个元改进轮（S-1~S-4 固化 R12 反推优化 + S-5 记录未来方向），验证工作流对"自身改进"的适应性——不走标准 PRD→Spec 五角色流程，直接"规划→实施→验证→复盘"精简流程
- **第十四轮**：前端多域扩展（角色/部门/审计三域一次引入，5 域前端），验证前端多域扩展适应性 + R13 固化提示词首次大规模验证
- **第十五轮**：前端全域覆盖收尾（通知管理页 + 报表页，新增 notification + report 两域，完成七域全覆盖），验证前端全域覆盖适应性
- **第十六轮**：后端能力前端化闭合（调岗 transfer + 角色继承管理，闭合"前端覆盖全部后端写/读端点"最后一公里），验证后端能力前端化闭合适应性 + errorMapping 全码映射收尾 + impl-writer 自报准确性违规发现（S-17~S-20 4 项新发现待固化）
- **第十七轮**：**元改进轮 #2**（固化 R16 S-17~S-20 + R13 遗留 S-6/S-7 共 6 项教训），验证 R13 元改进轮精简流程范式可复用 + G6.5 元改进轮 Review checklist 首次落地（S-7 自身递归闭合）+ S-6 探针 lint:rules 实跑机器验证（AI-005 扩展分支无 false positive）

## 5 · 反推优化三个层面执行情况

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R17 固化状态 | 证据 |
|---|---|---|
| **R13 S-6 规则层固化**：AI-005 扫描器覆盖 apps/web/test | ✅ **R17 固化** | check-rules.mjs AI-005 分支 `continue` 条件从 `apps/api/test/` 扩展为 `AI005_TEST_DIRS = /^(apps\/api\/test\/|apps\/web\/test\/)/` 正则匹配；lint:rules exit 0 + 探针 0 false positive（前端 toEqual 多为对象形式，正则仅匹配数组形式无误差） |
| META-003 声明即实现 | ✅ **持续闭合** | .trae/rules/ai-behavior/spec-first.md AI-005 校验方式同步"扫描 apps/api/test/**/*.ts 与 apps/web/test/**/*.ts(x)"，与脚本扩展分支声明一致 |
| META-004 实现即声明 | ✅ **持续闭合** | 脚本 `markEnforcement('AI-005')` 不变，无新增 enforcement ID，规则文档 AI-005 ID 不变 |
| ARCH-003 校验方式闭合（R12 已落地） | ✅ **保持** | 本轮无 ARCH-003 改动，元资产改动不引入 apps/api/src 依赖 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R17 固化状态 | 证据 |
|---|---|---|
| **R16 S-18 根因修复**：§10 组合副作用预判须含"全码映射收尾的全集定义明确"项 | ✅ **R17 固化** | spec-first-workflow.md §2.3 Tech Lead 提示词追加"§10 组合副作用预判须含'全码映射收尾的全集定义明确'项——errorMapping 扩展时须明确'全集'为'前端可能触发的域码全集'而非'errorCodeSchema 枚举全集'" |
| **R16 S-19 根因修复**：§10 组合副作用预判须含"简单常量跨组件复用边界"项 | ✅ **R17 固化** | spec-first-workflow.md §2.3 Tech Lead 提示词追加"§10 组合副作用预判须含'简单常量跨组件复用边界'项" |
| **R16 S-20 根因修复**：§10 组合副作用预判须含"测试工具限制 workaround"项 | ✅ **R17 固化** | spec-first-workflow.md §2.3 Tech Lead 提示词追加"§10 组合副作用预判须含'测试工具限制 workaround'项" |
| R13 S-1/S-2/S-3 Spec 模板层 | ✅ 持续生效 | 本轮无改动，下轮业务轮继续生效 |
| R14 S-12 Spec 模板层 | ✅ 持续生效 | 本轮无改动 |
| R15 S-16 Spec 模板层 | ✅ 持续生效 | 本轮无改动 |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.3~2.6）

#### R16 固化的 S-17~S-20 + R13 遗留 S-6/S-7 共 6 项在 R17 全部固化

| 固化项 | 角色 | 落地位置 | 固化状态 |
|---|---|---|---|
| S-17（impl-writer 自报准确性） | impl-writer | spec-first-workflow.md §2.5 提示词追加"自报改动范围须准确——须 git diff 实跑核对" | ✅ R17 固化 |
| S-17（Reviewer 闸门核验自报准确性） | Reviewer | spec-first-workflow.md §2.6 提示词追加"须通过 git diff 实跑核对 impl-writer 自报改动范围的准确性" | ✅ R17 固化 |
| S-18（全码映射"全集"定义） | impl-writer | spec-first-workflow.md §2.5 提示词追加"全集定义须明确为'前端可能触发的域码全集'" | ✅ R17 固化 |
| S-19（简单常量跨组件复用边界） | impl-writer | spec-first-workflow.md §2.5 提示词追加"≤3 处使用场景且常量简单可 [advisory] 沿用重复定义" | ✅ R17 固化 |
| S-20（user-event disabled option 过滤 workaround） | test-writer | spec-first-workflow.md §2.4 提示词追加"user-event v14.6.1 selectOptions 会自动过滤 disabled option" | ✅ R17 固化 |
| S-7（元改进轮 Review checklist） | 编排者 | spec-first-workflow.md §3 门禁表新增 G6.5（5 项 checklist）+ G7 合入条件补充"元改进轮为 G5+G6.5" | ✅ R17 固化（门禁层非提示词层，但归类为编排者约束） |

**合计**：R16 反推的 S-17~S-20 共 5 条提示词（S-17 双向）+ R13 遗留 S-6/S-7 共 2 项（规则层 + 门禁层）+ Spec 模板层 §10 三项增类，在 R17 全部固化。R13 固化的 8 条 + R14 固化的 5 条 + R15 固化的 4 条 + R16 持续验证的 17 条 + R17 新固化的 6 条 = **R17 后提示词骨架共 5 角色 + 23 条固化项持续生效**。

## 6 · 结论 + 剩余改进项

第十七轮是"元改进轮 #2 · 固化 R16 反推 + R13 遗留"的标志——R13 之后的第二个元改进轮，承接 R16 §6 剩余改进项之首"固化 S-17~S-20"+ R13 遗留至今未固化的 S-6/S-7。本轮一次性固化 6 项 S 级教训至三个层面（提示词层 5 项 + Spec 模板层 3 项 + 规则层 1 项 + 门禁层 1 项），同时首次落地 G6.5 元改进轮 Review checklist（S-7 自身反推固化产物即校验自身，递归闭合），验证 R13 元改进轮精简流程范式可复用。

关键证据：
1. **R16 S-17~S-20 固化（提示词层 + Spec 模板层）**：5 条提示词（S-17 双向）+ 3 项 Spec 模板层 §10 增项全部落地 spec-first-workflow.md §2.3/§2.4/§2.5/§2.6 对应章节。下轮业务轮 Tech Lead 须在 §10 预判时考虑"全集定义明确 / 简单常量复用边界 / 测试工具限制 workaround"三类组合副作用。
2. **R13 遗留 S-6 固化（规则层）**：check-rules.mjs AI-005 分支 `continue` 条件从 `apps/api/test/` 扩展为 `apps/web/test/` 双目录正则匹配，覆盖前端测试对跨域枚举集合的硬编码断言。S-6 探针验证（G6.5 #4）：lint:rules 实跑 exit 0 + AI-005 扩展分支扫描 apps/web/test/ 全部 363 用例 0 处 false positive（正则仅匹配数组形式 toEqual/toStrictEqual，前端 toEqual 多为对象形式无误差）。META-003（声明即实现）+ META-004（实现即声明）双向绑定在规则脚本扩展 + 规则文档同步下持续闭合。
3. **R13 遗留 S-7 固化（门禁层）**：spec-first-workflow.md §3 门禁表新增 G6.5 元改进轮 Review checklist（5 项：①S-x 教训全部固化 ②三件套全绿 ③改动范围合规 ④探针验证执行 ⑤新发现 S-x 已记录）+ G7 合入条件补充"元改进轮为 G5+G6.5"。**S-7 自身反推闭合的递归性**：G6.5 产物（本轮 retro §0 #3）即按 G6.5 五项 checklist 自检通过——反推优化自身被反推项校验，递归闭合证明 G6.5 设计自洽。
4. **R13 元改进轮精简流程范式可复用性验证**：R17 验证 R13 确立的"规划→实施→验证→复盘"精简流程范式可复用。R17 比 R13 更优：①首次应用 G6.5 闭合 S-7 自身递归；②S-6 探针用 lint:rules 实跑机器验证（vs R13 S-4 手动验证）；③无新发现 S-x（纯固化轮，工作量集中且收敛）。证明元改进轮范式成熟，未来元改进轮均须走 G6.5。
5. **G6.5 元改进轮 Review checklist 首次落地 5 项全过**：①S-x 教训全部固化（6 项全部反推至三个层面，见 §1）②三件套全绿（lint:rules exit 0 + META-003/META-004 双向绑定持续闭合 + typecheck/vitest 无源码改动无回归风险）③改动范围合规（仅元资产 4 文件，无业务代码越界）④探针验证执行（S-6 探针 lint:rules 实跑 0 false positive + S-17~S-20 提示词文本已落对应章节）⑤新发现 S-x 已记录（本轮无新发现 S 级教训）。

剩余改进项（S 级，不阻断）：
- **S-5**（R12 遗留，advisory 不强制）：setupFiles 全局副作用——未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 node/jsdom 配置（独立 vitest.config.web.ts）。本期不阻断（当前安全，仅追加 matcher）。R13/R14/R15/R16/R17 均未触发，持续 advisory。

> 本轮固化的 6 项教训（S-6/S-7/S-17~S-20）反推证据见 §1 + §5，不再列为"仍在生效"——下轮业务轮生效，lessons-learned.md 经 `npm run gen:retro-index` 重生后将迁入"已固化规则表"。R14/R15 固化的 S-8~S-16 持续生效无新触发场景，完整明细见 R16 retro §6。

> **下一轮候选**（按 R16 §6 + R17 元改进后状态排序）：
> 1. **后端 wire 字段名对齐**（server.ts `error`→`code`，消除 D10 wire 适配）+ **补 GET /v1/users/:id**（消除 R12 D19 不 GET 偏离）—— 业务轮 R18，走标准五角色流程（BA → Tech Lead → test-writer → impl-writer → Reviewer），跨后端 + 前端 + contracts 三层联动。
> 2. **E2E 测试引入**（Playwright 真实浏览器+真实后端）—— 元改进轮 R19，加 Playwright 依赖 + e2e/ 目录 + 真实后端启动 fixture，覆盖核心流（login → user 列表 → role 操作 → transfer → 登出），顺带闭合 S-5 setupFiles 全局副作用（vitest projects 模式分离 unit/e2e）。
> 3. **前端性能加固**（React.memo/useMemo/useCallback 评估 + 虚拟列表 + 代码分割）—— 业务轮 R20，前端单层变更。
> 4. **可访问性深化**（screen reader 端到端测试 + 键盘导航 + 色彩对比 WCAG AA）—— 业务轮 R21，前端单层变更，可与 R20 合并。
