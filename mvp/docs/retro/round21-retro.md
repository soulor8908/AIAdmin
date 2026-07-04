---
doc_type: Retrospective
id: RETRO-ROUND21-001
scope: 第二十一轮演练（元改进轮 #4：固化 R20 S-23 共 1 项教训，无业务代码改动，仅提示词层 + Spec 模板层）
date: 2026-07-04
verdict: 跑通；R20 S-23 一项教训全部固化至提示词层（Tech Lead + BA）+ Spec 模板层（§10 增项）；G6.5 元改进轮 Review checklist 第三次落地 5 项全过
---

# 第二十一轮演练复盘 · 元改进轮 #4 · 固化 R20 S-23

> 本轮为 R13/R17/R19 之后的第四个元改进轮（无标准 PRD→Spec 五角色流程），承接 R20 retro §2 新发现的 S-23（Tech Lead 第三方库版本 API 核验缺口——spec §3.5 写 test.projects 但 vitest 1.6.1 不支持，impl 阶段才发现并改 vitest.workspace.ts）+ S-23 衍生（BA 凭据/seed 值核验延伸——PRD AC-E1 写 Admin@123 但 server.ts 实际 seed 是 admin123）。本轮一次性固化至提示词层（Tech Lead + BA）+ Spec 模板层（§10 增项），同时第三次落地 G6.5 元改进轮 Review checklist（验证 R17 首次落地的 G6.5 范式第三次可复用）。

## 0 · 本轮目标与结果

1. **固化 R20 S-23**（Tech Lead 第三方库版本 API 核验缺口）至三个层面 → ✅ 全部落地：
   - Spec 模板层（§2.3 Tech Lead）：§10 增项"第三方库版本 API 差异"——Tech Lead 须预判本轮可能触发的第三方库版本 API 差异（如 vitest 1.6.1 vs 2.x test.projects / react-window 不同版本 API 签名差异），在 §10 显式标注"已核验 package.json 固定版本 + 该版本 API 可用"或"版本差异须 impl-writer 注意（含替代方案）"
   - 提示词层（§2.3 Tech Lead）：追加"第三方库版本 API 核验——Tech-Spec 写涉及第三方库 API 字段（如 vitest test.projects、playwright webServer、react-window FixedSizeList）时，须先核验 package.json 固定版本 + 该版本 API 文档（不可凭高版本文档假设 API 可用）。impl 阶段发现 spec 写了不存在 API 字段（被静默忽略）属 Tech Lead 版本核验缺口，须按 §10.6 'impl-writer 须修复（非静默跳过）'落地并反向同步 Spec"
2. **固化 S-23 衍生（BA 凭据/seed 值核验延伸）**至提示词层 → ✅ 落地：
   - 提示词层（§2.2 BA）：追加"凭据/seed 值核验——PRD 写凭据/seed 值（如登录凭据、初始 admin 密码、seed 数据）前，须 grep server.ts seedDemoData 确认实际 seed 值，不可凭主观假设（如 R20 BA 写 Admin@123 但 server.ts 实际 seed 是 admin123，编排者修正 PRD + Tech-Spec 声明 advisory）"
3. **G6.5 元改进轮 Review checklist 第三次落地**（验证 R17 范式第三次可复用）→ ✅ 按 G6.5 五项 checklist 自检：
   - ①S-x 教训全部固化：1 项（S-23）已全部反推至提示词层（Tech Lead + BA）+ Spec 模板层（§10 增项）（见 §1）
   - ②三件套全绿：lint:rules exit 0（META-003/META-004 双向绑定持续闭合，6 条 AI-005 + 3 条 SEC-002 均既有非本次新增）/ typecheck N/A（无 TS 改动）/ vitest N/A（仅元资产改动，无源码改动）
   - ③改动范围合规：仅元资产（spec-first-workflow.md 3 处编辑），无业务代码越界
   - ④探针验证执行：S-23 提示词文本已落 §2.2 BA + §2.3 Tech Lead（§10 增项 + 版本核验约束），下轮业务轮（R22 前端性能加固）涉及第三方库（react-window 虚拟列表 / react.lazy 代码分割等）可触发验证
   - ⑤新发现 S-x 已记录：本轮无新发现 S 级教训（纯固化轮，S-23 来源于 R20 retro 耗时根因分析）
4. **G7 合入判定**：元改进轮按 G5 + G6.5 全绿（G1/G3/G4 不适用——无 PRD/Spec/测试先行），可合入。

**结果速览**：lint:rules ✅（META-003/META-004 双向绑定持续闭合）/ typecheck N/A（无 TS 改动）/ vitest N/A（无源码改动，无回归风险）/ 改动文件 1 个（spec-first-workflow.md 3 处编辑）+ round21-retro.md 新增 / 固化教训 1 项（S-23）/ G6.5 第三次落地 5 项全过。

## 1 · 本轮核心验证结论

### 1.1 R20 S-23 固化（提示词层 Tech Lead + Spec 模板层 §10 增项）

R20 retro §2 耗时根因分析新发现的 S-23（Tech Lead 第三方库版本 API 核验缺口）在 R21 一次性固化至三个层面：

| 固化项 | 反推层 | 落地位置 | 验证结果 |
|---|---|---|---|
| S-23 Tech Lead §10 预判第三方库版本 API 差异 | Spec 模板层 | spec-first-workflow.md §2.3 Tech Lead 提示词追加"§10 组合副作用预判须含'第三方库版本 API 差异'项——Tech Lead 须预判本轮可能触发的第三方库版本 API 差异（如 vitest 1.6.1 vs 2.x test.projects 不支持须改 workspace 文件模式 / react-window 不同版本 API 签名差异），在 §10 显式标注'已核验 package.json 固定版本 + 该版本 API 可用'或'版本差异须 impl-writer 注意（含替代方案）'" | ✅ 落地 |
| S-23 Tech Lead 第三方库版本 API 核验约束 | 提示词层 | spec-first-workflow.md §2.3 Tech Lead 提示词追加"第三方库版本 API 核验——Tech-Spec 写涉及第三方库 API 字段（如 vitest test.projects、playwright webServer、react-window FixedSizeList）时，须先核验 package.json 固定版本 + 该版本 API 文档（不可凭高版本文档假设 API 可用）。impl 阶段发现 spec 写了不存在 API 字段（被静默忽略）属 Tech Lead 版本核验缺口，须按 §10.6 'impl-writer 须修复（非静默跳过）'落地并反向同步 Spec" | ✅ 落地 |

**结论**：S-23 两层固化形成完整闭环——Tech Lead 在 spec 写涉及第三方库 API 字段前须核验 package.json 固定版本 + 该版本 API 文档（避免写出 vitest 1.6.1 不支持的 test.projects 字段）+ §10 预判本轮可能触发的版本差异并提示 impl-writer 替代方案。R20 S-23 的"spec 写 test.projects 但 vitest 1.6.1 静默忽略 → impl 阶段才发现并改 workspace"场景在 R21 固化后下轮业务轮（R22 前端性能加固涉及 react-window 等）将被 Tech Lead 在 spec 阶段预先核验版本 + §10 预判替代方案，避免 impl 阶段才发现。

### 1.2 S-23 衍生固化（提示词层 BA 凭据/seed 值核验延伸）

R20 retro §2 耗时根因分析中 BA 凭据笔误（Admin@123 vs admin123）属既有 S-2（PRD 核验不足）的延伸，但凭据/seed 值核验是 BA 提示词层独立约束，单独立 S-23 衍生项固化：

| 固化项 | 反推层 | 落地位置 | 验证结果 |
|---|---|---|---|
| S-23 衍生 BA 凭据/seed 值核验 | 提示词层 | spec-first-workflow.md §2.2 BA 提示词追加"凭据/seed 值核验——PRD 写凭据/seed 值（如登录凭据、初始 admin 密码、seed 数据）前，须 grep server.ts seedDemoData 确认实际 seed 值，不可凭主观假设（如 R20 BA 写 Admin@123 但 server.ts 实际 seed 是 admin123，编排者修正 PRD + Tech-Spec 声明 advisory）" | ✅ 落地 |

**结论**：S-23 衍生固化后 BA 在 PRD 写凭据/seed 值前须 grep server.ts seedDemoData 确认实际值。R20 的"BA 写 Admin@123 但实际 admin123"场景在 R21 固化后下轮业务轮涉及凭据/seed 值时将被 BA 预先核验。

### 1.3 R17 G6.5 范式可复用性验证（第三次落地）

R21 是 R17/R19 之后的第四个元改进轮，验证 R17 首次落地的 G6.5 元改进轮 Review checklist 范式第三次可复用：

| 维度 | R13（首个） | R17（第二个） | R19（第三个） | R21（第四个） |
|---|---|---|---|---|
| 流程 | 规划→实施→验证→复盘（无五角色） | 同 R13 | 同 R13 | 同 R13 |
| 改动范围 | 元资产（规则 + 提示词 + 扫描器） | 元资产（提示词 + 规则 + 门禁） | 元资产（仅提示词 + Spec 模板） | 元资产（仅提示词 + Spec 模板） |
| 固化教训数 | 4 项（S-1~S-4） | 6 项（S-6/S-7/S-17~S-20） | 2 项（S-21/S-22） | 1 项（S-23）+ 1 衍生（BA 凭据核验） |
| 门禁 | 无 G6.5（S-7 未固化，复盘替代） | 首次应用 G6.5（5 项全过） | 第二次应用 G6.5（5 项全过） | 第三次应用 G6.5（5 项全过） |
| 探针验证 | S-4 walkWeb 提升 + allTs 扩展（手动） | S-6 探针 lint:rules 实跑（机器） | S-21/S-22 提示词文本已落（下轮触发） | S-23 提示词已落（下轮 R22 react-window 等可触发） |
| 新发现 S-x | S-5/S-6/S-7（3 项遗留） | 0 项（纯固化轮） | 0 项（纯固化轮） | 0 项（纯固化轮） |

**结论**：R21 验证 R17 G6.5 范式第三次可复用——R17 首次落地 G6.5 后 R19/R21 连续两次落地 5 项 checklist 全过，证明 G6.5 范式稳定可复用。R21 是迄今最轻量元改进轮：仅 1 项教训（S-23）+ 1 衍生（BA 凭据核验），改动 1 文件 3 处编辑。证明元改进轮范式成熟，未来元改进轮均须走 G6.5，且可轻量化（单教训固化也走 G6.5）。

## 2 · 本轮新发现的问题（S 级，不阻断）

### S-23 第三方库版本 API 核验缺口（R20 来源 / R21 固化）

> S-23 来源 R20 retro 耗时根因分析（用户问"为什么 76 分钟"后的根因分析），R20 retro §2 当时基于"5 项 Suggestion 均被既有规则覆盖"判断不立新 S 级，但耗时根因 #1（vitest 版本核验缺口）是 R20 慢的最大可优化根因，值得单独立 S 级。R21 元改进轮正式固化至提示词层（Tech Lead + BA）+ Spec 模板层（§10 增项）。

**问题**：Tech Lead 在 spec §3.5 写 `test.projects` 数组，但 vitest 1.6.1（仓库固定版本 devDependencies `vitest: ^1.6.0`）不支持 `test.projects` 字段（vitest 2.x 才引入），vitest 1.6.1 静默忽略该字段 → 所有测试用顶层默认（environment=node, 无 setupFiles）→ 140 web 测试 `Invalid Chai property: toBeInTheDocument`。impl-writer 阶段才发现并改用 `vitest.workspace.ts` + `defineWorkspace()` 机制 + 反向同步 spec §3.5+D4，额外多花 ~15-20 分钟。

**根因**：Tech Lead 写 spec 涉及第三方库 API 字段时，未核验 package.json 固定版本 + 该版本 API 文档，凭高版本（vitest 2.x）文档假设 API 可用。

**R21 固化**（提示词层 + Spec 模板层，见 §1.1 + §5.3）：
- Spec 模板层（§2.3 Tech Lead）：§10 增项"第三方库版本 API 差异"——Tech Lead 须预判本轮可能触发的第三方库版本 API 差异，在 §10 显式标注"已核验 package.json 固定版本 + 该版本 API 可用"或"版本差异须 impl-writer 注意（含替代方案）"。
- 提示词层（§2.3 Tech Lead）：追加"第三方库版本 API 核验——Tech-Spec 写涉及第三方库 API 字段时，须先核验 package.json 固定版本 + 该版本 API 文档（不可凭高版本文档假设 API 可用）。impl 阶段发现 spec 写了不存在 API 字段属 Tech Lead 版本核验缺口，须按 §10.6 'impl-writer 须修复（非静默跳过）'落地并反向同步 Spec"。
- 提示词层（§2.2 BA 衍生）：追加"凭据/seed 值核验——PRD 写凭据/seed 值前须 grep server.ts seedDemoData 确认实际 seed 值"（R20 BA 写 Admin@123 但实际 admin123 笔误的延伸约束）。

**下轮触发验证**：R22 前端性能加固涉及第三方库（react-window 虚拟列表 / React.lazy 代码分割等），Tech Lead 须在 spec 阶段预先核验 react-window 版本 API + §10 预判替代方案。

## 3 · 量化对比（二十一轮演进表）

| 指标 | R15 | R16 | R17 | R18 | R19 | R20 | R21 |
|---|---|---|---|---|---|---|---|
| 用例数（vitest） | 1089 | 1196 | 1196（无源码改动） | 1256（+60） | 1256（无源码改动） | 1256（无回归）+ E2E 14（新增） | 1256（无源码改动） |
| 累计用例 | 1089 | 1196 | 1196 | 1256 | 1256 | 1256 vitest + 14 E2E | 1256 vitest + 14 E2E |
| blocker | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| suggestion | 8 | 7 | N/A（元改进轮） | 1（已闭合） | N/A（元改进轮） | 5（非阻断，建议下轮闭合） | N/A（元改进轮） |
| Reviewer verdict | pass | pass | N/A（G6.5） | pass | N/A（G6.5） | pass | N/A（G6.5） |
| AC 对齐 | 54/54 | 46/46 | N/A | 24/24 | N/A | 19/19 | N/A |
| 影响层 | 前端全域收尾层 | 后端能力前端化闭合层 | 元资产层 | 跨后端+前端+contracts 三层联动层 | 元资产层 | 测试基础设施层 | **元资产层**（仅 spec-first-workflow.md） |
| 新架构模式 | 前端全域覆盖 | 后端能力前端化闭合 | 元改进轮 #2 | 历史 advisory 偏离消除 | 元改进轮 #3 | E2E 三真实联调 + vitest workspace | **元改进轮 #4**（固化 R20 S-23） |
| 轮次类型 | 业务 | 业务 | 元改进 | 业务 | 元改进 | 业务 | **元改进**（第四个） |
| 提示词骨架条数 | 5角色+17条 | 5角色+17条 | 5角色+23条 | 5角色+23条 | 5角色+25条 | 5角色+25条（持续生效） | **5角色+27条**（R20 S-23 Tech Lead §10 增项 + 版本核验约束 + BA 凭据核验延伸共 3 条新增） |
| 规则机器化覆盖 | 持续覆盖 | 持续覆盖 | AI-005 扩展含 apps/web/test | 持续覆盖 | 持续覆盖 | 持续覆盖 | 持续覆盖（lint:rules exit 0） |
| 元改进轮 Review | 沿用 R13 | 沿用 R13 | G6.5 落地 | 沿用 R17 G6.5 | G6.5 第二次落地 | 沿用 G6（业务轮） | **G6.5 第三次落地**（5 项全过） |
| 固化教训数（本轮） | 4（S-13~S-16） | 0（持续验证） | 6（S-6/S-7/S-17~S-20） | 0（新发现 S-21/S-22） | 2（S-21/S-22） | 0（无新发现 S 级） | **1**（S-23）+ 1 衍生（BA 凭据核验） |

> R21 用例数 1256 = R20 1256（无源码改动，仅元资产改动，无回归风险）。lint:rules exit 0 + META-003/META-004 双向绑定持续闭合。

## 4 · 二十一轮演进脉络

- **第十五轮**：前端全域覆盖收尾（通知管理页 + 报表页，新增 notification + report 两域，完成七域全覆盖），验证前端全域覆盖适应性
- **第十六轮**：后端能力前端化闭合（调岗 transfer + 角色继承管理，闭合"前端覆盖全部后端写/读端点"最后一公里），验证后端能力前端化闭合适应性 + errorMapping 全码映射收尾 + impl-writer 自报准确性违规发现（S-17~S-20 4 项待固化）
- **第十七轮**：元改进轮 #2（固化 R16 S-17~S-20 + R13 遗留 S-6/S-7 共 6 项教训），验证 R13 元改进轮精简流程范式可复用 + G6.5 元改进轮 Review checklist 首次落地（S-7 自身递归闭合）
- **第十八轮**：业务轮 #13（消除 R12 D10 wire 字段名适配 + R12 D19 GET /v1/users/:id 端点缺失 + D9 重分类 [约束]），跨后端 + 前端 + contracts 三层联动，验证 R17 固化提示词在业务轮首次大规模触发 + 新发现 S-21（[约束] 偏离反向同步滞后）+ S-22（确定性 token setup 时序污染）
- **第十九轮**：元改进轮 #3（固化 R18 S-21/S-22 共 2 项教训），无业务代码改动，仅提示词层 + Spec 模板层。S-21 三层固化（Tech Lead §10 预判 + impl-writer 反向同步同标准 + Reviewer git diff 核实 + 加性安全降级但强制本轮闭合）。验证 R17 G6.5 范式第二次落地可复用。
- **第二十轮**：业务轮 #14（引入 Playwright E2E 测试 + 闭合 R12 遗留 S-5）。E2E 三真实联调覆盖核心流全链路（login → users → roles → transfer → 登出，14 AC）。S-5 经 9 轮（R12→R20）最终闭合（vitest workspace 模式分离 api node / web jsdom）。R18 S-21 首次大规模触发验证生效（4 项 advisory 偏离全部实际编辑 Spec 闭合）。§10.6 关键风险预判第二次大规模触发并精准命中（jest-dom → jest-dom/vitest 修复）。**retro 耗时根因分析新发现 S-23**（Tech Lead 第三方库版本 API 核验缺口）+ BA 凭据笔误（Admin@123 vs admin123）。
- **第二十一轮**：**元改进轮 #4**（固化 R20 S-23 共 1 项教训 + BA 凭据核验衍生），无业务代码改动，仅提示词层 + Spec 模板层。S-23 两层固化（Tech Lead §10 增项第三方库版本 API 差异 + 版本核验约束 + BA 凭据/seed 值核验延伸）。验证 R17 G6.5 范式第三次落地可复用。R21 是迄今最轻量元改进轮（1 项教训 + 1 衍生，1 文件 3 处编辑），证明元改进轮范式成熟可轻量化。

## 5 · 反推优化三个层面执行情况

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R21 状态 | 证据 |
|---|---|---|
| META-003 声明即实现 | ✅ 持续闭合 | 本轮无规则脚本改动，lint:rules exit 0 |
| META-004 实现即声明 | ✅ 持续闭合 | 本轮无新增 enforcement ID |
| ARCH-001/002/003 | ✅ 保持 | 本轮无 ARCH 改动，元资产改动不引入 apps/api/src 依赖 |
| AI-005 扫描器（R13 S-6 固化） | ✅ 持续覆盖 | lint:rules exit 0，6 条 AI-005 建议为 R16 既有 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R21 状态 | 证据 |
|---|---|---|
| R16 S-18 全集定义明确 | ✅ 持续生效 | 本轮无改动，下轮业务轮继续生效 |
| R16 S-19 简单常量复用边界 | ✅ 持续生效 | 本轮无改动 |
| R16 S-20 测试工具 workaround | ✅ 持续生效 | 本轮无改动 |
| R18 S-21 [约束] 偏离反向同步闭环性 | ✅ 持续生效（R20 已验证） | 本轮无改动，R20 已大规模触发验证生效 |
| **R20 S-23 第三方库版本 API 差异** | ✅ **R21 固化** | spec-first-workflow.md §2.3 Tech Lead 提示词追加"§10 组合副作用预判须含'第三方库版本 API 差异'项" |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.2~2.6）

#### R20 固化的 S-23 在 R21 全部固化

| 固化项 | 角色 | 落地位置 | 固化状态 |
|---|---|---|---|
| S-23 Tech Lead §10 预判第三方库版本 API 差异 | Tech Lead | spec-first-workflow.md §2.3 提示词追加"§10 组合副作用预判须含'第三方库版本 API 差异'项" | ✅ R21 固化 |
| S-23 Tech Lead 第三方库版本 API 核验约束 | Tech Lead | spec-first-workflow.md §2.3 提示词追加"第三方库版本 API 核验——Tech-Spec 写涉及第三方库 API 字段时须先核验 package.json 固定版本 + 该版本 API 文档" | ✅ R21 固化 |
| S-23 衍生 BA 凭据/seed 值核验 | BA | spec-first-workflow.md §2.2 提示词追加"凭据/seed 值核验——PRD 写凭据/seed 值前须 grep server.ts seedDemoData 确认实际 seed 值" | ✅ R21 固化 |

**合计**：R20 反推的 S-23（Tech Lead 两层：§10 增项 + 版本核验约束 + BA 凭据核验衍生）共 3 条提示词在 R21 全部固化。R13 固化的 8 条 + R14 固化的 5 条 + R15 固化的 4 条 + R16 持续验证的 17 条 + R17 固化的 6 条 + R18 持续验证的 23 条 + R19 固化的 4 条 + R20 持续验证的 25 条 + R21 新固化的 3 条 = **R21 后提示词骨架共 5 角色 + 27 条固化项持续生效**。

## 6 · 结论 + 剩余改进项

第二十一轮是"元改进轮 #4 · 固化 R20 S-23"的标志——R17/R19 之后的第四个元改进轮，承接 R20 retro §2 耗时根因分析新发现的 S-23（Tech Lead 第三方库版本 API 核验缺口）+ S-23 衍生（BA 凭据/seed 值核验延伸）共 1 项教训 + 1 衍生。本轮一次性固化至提示词层（Tech Lead + BA）+ Spec 模板层（§10 增项），同时第三次落地 G6.5 元改进轮 Review checklist（验证 R17 范式第三次可复用）。

关键证据：
1. **R20 S-23 两层固化**：Tech Lead §10 预判第三方库版本 API 差异（如 vitest 1.6.1 vs 2.x test.projects / react-window 版本差异）+ Tech Lead 版本核验约束（spec 写 API 字段前须核验 package.json 固定版本 + 该版本 API 文档，不可凭高版本文档假设 API 可用）。R20 S-23 的"spec 写 test.projects 但 vitest 1.6.1 静默忽略 → impl 阶段才发现并改 workspace"场景在 R21 固化后下轮业务轮将被 Tech Lead 在 spec 阶段预先核验版本 + §10 预判替代方案。
2. **S-23 衍生 BA 凭据核验**：BA 在 PRD 写凭据/seed 值前须 grep server.ts seedDemoData 确认实际值。R20 的"BA 写 Admin@123 但实际 admin123"场景在 R21 固化后下轮业务轮涉及凭据/seed 值时将被 BA 预先核验。
3. **R17 G6.5 范式第三次落地可复用性验证**：R21 第三次应用 G6.5 五项 checklist 全过，证明 G6.5 范式稳定可复用。R21 是迄今最轻量元改进轮（1 项教训 + 1 衍生，1 文件 3 处编辑），证明元改进轮范式成熟可轻量化（单教训固化也走 G6.5）。

剩余改进项（S 级，不阻断）：
- **本轮无新立 S 级**：S-23 已在 R21 固化，lessons-learned.md 经 `npm run gen:retro-index` 重生后将迁入"已固化规则表"。
- **R20 Reviewer 5 项 Suggestion 待闭合**：R20 Review 报告 5 项 Suggestion（AC-E7 父子关系断言强化 / playwright.config retries=0 spec 偏离 / Tech-Spec §2.3 devDeps 描述 / Tech-Spec §7.2 stale Admin@123 / task 文件数误差）建议下轮（R22 前端性能加固）启动时顺带闭合。

> 本轮固化的 1 项教训（S-23）反推证据见 §1 + §5，不再列为"仍在生效"——下轮业务轮（R22）生效，lessons-learned.md 经 `npm run gen:retro-index` 重生后将迁入"已固化规则表"。

> **下一轮候选**（按 R17 §6 + R18 §6 + R19 §6 + R20 §6 + R21 §6 状态排序）：
> 1. **R22 前端性能加固**（React.memo/useMemo/useCallback 评估 + 虚拟列表 react-window + 代码分割 React.lazy）—— 前端单层变更，顺带闭合 R20 5 项 Suggestion。R21 固化的 S-23 将在 R22 首次触发验证（react-window 等第三方库版本 API 核验）。
> 2. **R23 可访问性深化**（screen reader 端到端测试 + 键盘导航 + 色彩对比 WCAG AA）—— 前端单层变更，可与 R22 合并。
> 3. **R24 跨浏览器 E2E**（firefox/webkit，R20 chromium 基础设施已就绪）—— E2E 扩展。
