---
doc_type: Retrospective
id: RETRO-ROUND13-001
scope: 第十三轮演练（工作流改进固化轮：落地 R12 复盘 S-1~S-5 反推优化，纯元改进轮）
date: 2026-07-03
verdict: S-1~S-4 固化 + S-5 记录未来方向；元改进轮不走标准 PRD→Spec 流程；三件套绿，0 回归
---

# 第十三轮演练复盘 · 工作流改进固化轮（落地 R12 retro S-1~S-5 反推优化）

> 本轮是 admin-system-mvp 项目首个**纯工作流元资产改进轮**——不涉及业务功能，固化 R12 复盘反推的 S-1~S-5 优化，使工作流逐轮收敛。

## 0 · 本轮目标与结果

1. **S-1 固化**（Spec 模板层 + 提示词层）——区分"自由文本表单"（须 safeParse）vs"类型派生操作"（TS 类型保证，schema 校验冗余）→ ✅ Tech Lead 提示词 +1 条（§3.2 表单校验复用清单须区分两类）+ impl-writer 提示词 +1 条（类型派生操作不调 safeParse 须显式标注 [约束] 偏离）+ Reviewer 提示词 +1 条（AC-ARCH-4 partial 判定依据须区分两类表单）
2. **S-2 固化**（Spec 模板层 + 提示词层）——§10 advisory 同步边界明确（行为/数据/schema 偏离须同步 §10；纯 UI 文案偏离不须同步但须 Review 报告记录）→ ✅ Tech Lead 提示词 +1 条（§10 advisory 偏离预判须明确同步边界）+ impl-writer 提示词 +1 条（advisory 偏离反向同步边界）
3. **S-3 固化**（提示词层）——test-writer AC 覆盖矩阵自检 + 组合场景测试须单独测 → ✅ test-writer 提示词 +2 条（AC 覆盖矩阵自检 + 组合场景测试）
4. **S-4 固化**（规则层）——CODE 扫描器覆盖前端 → ✅ check-rules.mjs walkWeb 提升为顶层函数 + allTs 扩展含 apps/web/src + apps/web/test，CODE-001/002/003/004 通用扫描器覆盖前端 .ts/.tsx，探针验证 CODE-001 真报错
5. **S-5 记录未来方向**（advisory 不强制）——setupFiles 全局副作用 → ✅ 记录为未来改进方向（未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 node/jsdom 配置），本期不改 vitest 配置

**结果速览**：typecheck ✅ / lint:rules ✅（enforcement 14 项，ARCH-003 含）/ vitest ✅ 883/883（api 833 + web 50，无回归）/ 改动文件仅 2 个——`scripts/check-rules.mjs`（S-4）+ `docs/workflow/spec-first-workflow.md`（S-1/S-2/S-3 提示词骨架 §2.3~2.6）/ 不改业务代码（apps/api + packages/contracts + apps/web/src + apps/web/test 全冻结）/ 不改测试断言 / 不走标准 PRD→Spec 五角色流程（元改进轮直接"规划→实施→验证→复盘"精简流程）。

## 1 · 本轮核心验证结论

### 1.1 S-4 规则层固化——CODE 扫描器覆盖前端（R12 S-4 根因机器化修复）

R12 S-4 发现 CODE-001~004 扫描器的 `allTs`（check-rules.mjs L23-27）仅收集 packages/contracts/src + apps/api/src + apps/api/test，**不含 apps/web/src 与 apps/web/test**。故 CODE-001（禁 any）/CODE-002（禁空 catch）/CODE-003（禁 eval）/CODE-004（Zod schema 命名）扫描器均未覆盖前端（仅 ARCH-003 专属分支经 walkWeb 覆盖 apps/web/src）。本轮机器化修复此根因：

| 维度 | R12（allTs 未含 apps/web） | R13（allTs 扩展含 apps/web） |
|---|---|---|
| walkWeb 定义位置 | ARCH-003 分支局部函数 | **顶层函数**（allTs 与 ARCH-003 共用） |
| allTs 收集范围 | contracts/src + apps/api/src + apps/api/test | + **apps/web/src + apps/web/test**（经 walkWeb 收集 .ts/.tsx） |
| CODE-001（禁 any）前端覆盖 | ❌ 盲区（Reviewer 手动 grep） | ✅ 机器化扫描 |
| CODE-002（禁空 catch）前端覆盖 | ❌ 盲区 | ✅ 机器化扫描 |
| CODE-003（禁 eval/Function）前端覆盖 | ❌ 盲区 | ✅ 机器化扫描 |
| CODE-004（Zod schema 命名）前端覆盖 | ❌ 盲区 | ✅ 机器化扫描 |
| 探针验证 | N/A | 投放 `: any` 探针 → CODE-001 真报错 exit≠0；删除探针 → 基线 exit 0 |

**结论**：CODE 扫描器前端盲区闭合——walkWeb 提升为顶层函数（从 ARCH-003 分支局部函数提取为 allTs 与 ARCH-003 共用的顶层函数），allTs 扩展含 apps/web/src + apps/web/test，CODE-001/002/003/004 四个通用扫描器现覆盖前端 .ts/.tsx。探针验证投放 `: any` 触发 CODE-001 真报错（exit≠0），删除探针后基线 exit 0。这是 R12 S-4 根因的机器化修复——前端不再是 CODE 扫描盲区，未来前端代码若引入 any / 空 catch / eval / Zod schema 命名违规，lint:rules 会自动拦截。

### 1.2 S-1/S-2/S-3 提示词层固化——四角色提示词各 +2 条全部落地

R12 retro §5.3 反推的 8 条提示词改进（Tech Lead 2 + test-writer 2 + impl-writer 2 + Reviewer 2）全部落地到 `docs/workflow/spec-first-workflow.md` §2.3~2.6 四角色提示词骨架，每条均标注 `（R12 S-x）` 溯源标记：

| 角色 | 提示词新增条数 | 内容摘要 | 溯源 |
|---|---|---|---|
| Tech Lead（§2.3） | +2 | ① §3.2 表单校验复用清单须区分"自由文本表单"（须 safeParse）与"类型派生操作"（TS 类型保证，schema 校验冗余），AC 措辞须精确限定为"自由文本输入表单"；② §10 advisory 偏离预判须明确同步边界——行为/数据/schema 偏离须同步 §10，纯 UI 文案偏离不须同步但须 Review 报告记录 | S-1 / S-2 |
| test-writer（§2.4） | +2 | ① AC 覆盖矩阵自检——每条 AC 须有至少 1 个测试用例直接覆盖，未覆盖的显式列出 reason，交付报告附 AC↔测试用例覆盖矩阵表；② 组合场景测试——当 AC 涉及多操作组合（如筛选+分页、启停双向、登出 action），须单独测组合场景，不可仅分别测单一操作后假设组合正确 | S-3 / S-3 |
| impl-writer（§2.5） | +2 | ① advisory 偏离反向同步边界——行为/数据/schema 偏离须反向同步 Spec §10，纯 UI 文案偏离不须同步但须在交付报告列出；② 对类型派生操作（如 toggle）不调 schema.safeParse 时，须显式标注 [约束] 偏离 + 反向同步 Spec §3.2（注明"类型派生操作，schema 校验冗余"），不可静默偏离 | S-2 / S-1 |
| Reviewer（§2.6） | +2 | ① AC-ARCH-4（表单校验复用 Zod schema）partial 判定依据——须区分"自由文本表单"（须 safeParse，未调判 partial）与"类型派生操作"（TS 类型保证，safeParse 冗余，未调可判合理偏离须补同步），partial 判定须注明根因；② CODE 扫描器前端覆盖核对——当 apps/web 存在时，确认 allTs 已含 apps/web/src + apps/web/test（R13 S-4 固化后已覆盖），若扫描器未覆盖须手动 grep | S-1 / S-4 |

**结论**：8 条提示词改进全部落地 spec-first-workflow.md，下次这些角色 subagent 自动继承改进。核心是三方面收敛：① **S-1 区分自由文本表单 vs 类型派生操作**（Tech Lead 写 Spec 时区分 + impl-writer 不调 safeParse 时显式标注 + Reviewer partial 判定依据区分），消除 R12 AC-ARCH-4 partial 的根因（措辞未区分两类表单）；② **S-2 advisory 文案同步边界明确**（Tech Lead 预判时明确 + impl-writer 同步时遵循边界），消除 R12 三项 UI 文案未同步 Spec 的根因（边界未明确）；③ **S-3 AC 覆盖矩阵自检 + 组合场景测试**（test-writer 自检覆盖完整性 + 组合场景单独测），消除 R12 四项 AC 边界未单测的根因（未做覆盖矩阵自检）。Reviewer 第二条提示词已更新为"R13 S-4 固化后已覆盖"，反映扫描器盲区已机器化修复。

### 1.3 元改进轮不走标准 PRD→Spec 流程——工作流对"自身改进"的适应性验证

R13 是首个"纯工作流元资产改进"轮次，不涉及业务功能，故不走标准五角色流程（BA→Tech Lead→test-writer→impl-writer→Reviewer），而是直接"规划→实施→验证→复盘"精简流程：

| 维度 | 标准业务轮（R1-R12） | 元改进轮（R13） |
|---|---|---|
| 流程 | PRD(BA)→Tech-Spec+契约(TechLead)→测试先行(test-writer)→实现(impl-writer)→Review(Reviewer)→门禁G7→复盘 | **规划→实施→验证→复盘**（精简四步） |
| 产物 | PRD + Tech-Spec + contracts 改动 + 测试 + 实现代码 + Review 报告 + retro | **改进清单 + 改动文件 + 三件套验证 + retro**（无 PRD/Tech-Spec/Review 报告） |
| AC 来源 | PRD 验收标准（Given/When/Then） | **R12 retro §5 反推优化清单**（S-1~S-5） |
| 质量门禁 | G1+G3+G4+G5+G6+G7（7 道门禁） | **三件套**（typecheck + lint:rules + vitest）+ 复盘替代 Review |
| 改动范围 | 业务代码 + 测试 + 契约 + 规则脚本 | **仅元资产**（规则脚本 + 工作流模板） |

**结论**：元改进轮精简流程验证成功——不涉及业务功能时，工作流可降级为"规划→实施→验证→复盘"四步，无需 PRD/Tech-Spec/五角色调度。这证明 spec-first 工作流对"自身改进"具有适应性：标准流程服务于业务功能交付，元资产改进可经精简流程闭环。复盘替代 Review 报告作为质量门禁（核对 S-x 是否全部固化 + 三件套绿），见 §2 S-7。

### 1.4 ARCH-002 误报风险消除——既有扫描器目录隔离设计在扩展时安全

扩展 allTs 含 apps/web 时，须核查既有扫描器是否会因 apps/web 文件误入而误报。逐分支核查结果：

| 扫描器 | 目录过滤逻辑 | apps/web 文件处理 | 误报风险 |
|---|---|---|---|
| ARCH-001（四层反向依赖） | `layerOf(f)` 正则匹配 `apps/api/src/(domain\|repository\|service\|router)`，不匹配返回 null → `if (!layer) continue` | apps/web 文件 layerOf 返回 null → **跳过** | ❌ 无误报 |
| ARCH-002（contracts 纯净） | `if (!rel(f).startsWith('packages/contracts/')) continue` | apps/web 文件不以 packages/contracts/ 开头 → **跳过** | ❌ 无误报 |
| CODE-001/002/003/004 | 无目录过滤（通用扫描） | apps/web 文件 **纳入扫描**（本轮目标，覆盖前端） | ✅ 预期覆盖 |
| SEC-001（procedure auth 元数据） | `if (!rel(f).startsWith('apps/api/src/router/')) continue` | apps/web 文件不以 apps/api/src/router/ 开头 → **跳过** | ❌ 无误报 |
| SEC-002（service 方法鉴权） | `if (!rel(f).startsWith('apps/api/src/service/')) continue` | apps/web 文件不以 apps/api/src/service/ 开头 → **跳过** | ❌ 无误报 |
| SEC-003a（输出 schema .strict()） | `if (!rel(f).startsWith('packages/contracts/')) continue` | apps/web 文件不以 packages/contracts/ 开头 → **跳过** | ❌ 无误报 |
| ARCH-003（前端禁连后端） | 独立 `walkWeb(apps/web/src)`，不依赖 allTs | apps/web/src **纳入扫描**（既有行为不变） | ✅ 预期覆盖 |
| AI-005（硬编码跨域可变集合） | `if (!rel(f).startsWith('apps/api/test/')) continue` | apps/web/test 文件不以 apps/api/test/ 开头 → **跳过**（见 §2 S-6） | ❌ 无误报（但有盲区） |

**结论**：既有扫描器的目录隔离设计在 allTs 扩展时安全——ARCH-001（layerOf 返回 null 跳过）、ARCH-002（packages/contracts/ 前缀过滤）、SEC-001/002/003a（apps/api/src/ 前缀过滤）均有目录过滤，apps/web 文件被跳过，无误报。CODE-001/002/003/004 无目录过滤（通用扫描），apps/web 文件纳入扫描是本轮目标（覆盖前端）。AI-005 有硬编码目录过滤 `apps/api/test/`，apps/web/test 被跳过——这是 S-6 新发现（见 §2），非误报但属盲区。**证明既有扫描器的目录隔离设计在扩展时安全**，扩展 allTs 仅影响无目录过滤的通用扫描器（CODE-*），有目录过滤的专属扫描器（ARCH/SEC）自动跳过 apps/web。

## 2 · 本轮新发现的问题（S 级，不阻断）

### S-6 · AI-005 前端测试盲区（apps/web/test 未覆盖）

**现象**：AI-005 分支（check-rules.mjs L243）有硬编码目录过滤 `if (!rel(f).startsWith('apps/api/test/')) continue`，扩展 allTs 含 apps/web/test 后，AI-005 仍只扫后端测试（apps/api/test/），**未覆盖 apps/web/test**。前端测试若硬编码跨域可变集合（如 `[...errorCodeSchema.options]` 之外的字面量枚举，或硬编码权限码全集），无机器校验。

**根因**：AI-005 分支设计时 apps/web 不存在，硬编码 `apps/api/test/` 前缀过滤。R13 S-4 扩展 allTs 时仅解决 CODE 扫描器（无目录过滤的通用扫描器），未触及 AI-005 的硬编码目录过滤。AI-005 的 continue 条件未扩展含 apps/web/test。

**反推优化**（未来改进方向，非本轮目标）：AI-005 continue 条件扩展为 `if (!rel(f).startsWith('apps/api/test/') && !rel(f).startsWith('apps/web/test/')) continue`，使 AI-005 覆盖前端测试。须注意前端测试的跨域枚举模式可能与后端不同（如前端测试可能硬 errorCode 字面量用于断言错误提示文案），须核查 PERMISSION_CODE_LIT / ERROR_CODE_LIT 正则对前端测试的适用性。本期不阻断（前端测试本轮 50 用例，Reviewer 已手动核对 SSOT 派生）。

### S-7 · 元改进轮 Review 缺失（复盘替代 Review 作为质量门禁）

**现象**：R13 是首个元改进轮，无标准 Review 报告（无 PRD AC 可逐条核对，无五角色流程）。复盘替代 Review 作为质量门禁——核对 S-1~S-5 是否全部固化 + 三件套绿。

**根因**：标准 Review 报告依赖 PRD AC（§1 PRD 验收逐条核对）+ 实现代码 + 测试，元改进轮无 PRD/Tech-Spec/测试改动，标准 Review 报告无锚点。复盘虽含"目标与结果"+ "核心验证结论"，但缺少独立的第三方核对环节（复盘由编排者自撰，Review 由 Reviewer subagent 独立核对）。

**反推优化**（未来改进方向，非本轮目标）：未来元改进轮可考虑轻量 Review checklist——① S-x 是否全部固化（逐条核对 R(n-1) retro §5 反推清单）；② 三件套是否全绿（typecheck + lint:rules + vitest）；③ 改动范围是否合规（仅元资产，未触及业务代码）；④ 探针验证是否执行（扫描器扩展类改动须探针验证真报错）。本期不阻断（复盘已覆盖①②③④，且元改进轮改动面小、可审计性高）。

## 3 · 量化对比（十三轮演进表）

| 指标 | R1 | R5 | R7 | R9 | R10 | R11 | R12 | R13 |
|---|---|---|---|---|---|---|---|---|
| 用例数 | 35 | 404 | 537 | 653 | 697 | 778 | 883（api 833 + web 50） | **883**（无新增，无回归） |
| 累计用例 | 35 | 404 | 537 | 653 | 697 | 778 | 883 | **883** |
| blocker | 1 | 2(修复0) | 0 | 0 | 0 | 0 | 0 | **0** |
| suggestion | 6 | 7 | 2 | 2(impl闭合) | 0 | 3(impl闭合) | 7 | **N/A**（无 Review 报告） |
| Reviewer verdict | pass | blocker→pass | pass | pass | pass | pass | pass | **N/A**（复盘替代 Review） |
| AC 对齐 | N/A | N/A | 16/16 | 18/18 | 17/17 | 23/23 | 47/48（AC-ARCH-4 partial） | **N/A**（元改进轮无 PRD AC） |
| 受影响清单 | 无 | ①类遗漏 | ①②类 | ①②③类 | ①②零+③类 | ①②③（①类二次遗漏） | ①②零影响+③类6文件 | **2 文件**（check-rules.mjs + spec-first-workflow.md） |
| 影响层 | 全栈 | 全栈 | 全栈 | 全栈 | 单层 | 运行时入口层+新域 | 前端新增层+规则脚本 | **元资产层**（规则脚本+工作流模板） |
| 新架构模式 | 单步CRUD | 跨域埋点 | 多步事务 | HTTP写条件 | HTTP读条件 | 安全域+token验签 | 前端+ARCH-003机器化+wire适配 | **工作流元改进**（提示词+扫描器扩展） |
| 轮次类型 | 业务 | 业务 | 业务 | 业务 | 业务 | 业务 | 业务 | **元改进**（首个） |
| ARCH-003 状态 | [预留] | [预留] | [预留] | [预留] | [预留] | [预留] | 闭合（机器化 enforcement） | **闭合（保持）** |
| 前端 | 无 | 无 | 无 | 无 | 无 | 无 | 首引入（50用例） | **已存在**（扫描器覆盖扩展） |
| SEC 验证 | mock | mock | mock | mock | mock | 首次真实 | 前端延伸 | **不涉及**（无业务代码） |
| CODE 扫描器前端覆盖 | N/A | N/A | N/A | N/A | N/A | N/A | ❌ 盲区（手动 grep） | **✅ 机器化**（allTs 扩展含 apps/web） |
| 提示词骨架条数 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | 5角色基线 | **5角色+8条**（S-1/S-2/S-3 固化） |

> R13 用例数 883 = api 833 + web 50（与 R12 持平，无新增测试、无回归）。元改进轮不改业务代码与测试，三件套全绿仅验证"未破坏既有"。

## 4 · 十三轮演进脉络

- **第一轮**：建立主干，暴露规则可校验性 P0 缺口
- **第二轮**：规则机器化 100%，暴露声明漂移
- **第三轮**：META-003/004 双向绑定消除漂移
- **第四轮**：三个反推优化点闭环生效
- **第五轮**：三个架构方向落地，首次暴露"测试通过 ≠ 验收对齐"
- **第六轮**："验收对齐"门禁首次闭合——端到端 + Reviewer PRD 双轨
- **第七轮**：多步事务 + 补偿回滚，验证"复杂业务适应性"
- **第八轮**：递归继承 + 环检测，验证"递归数据结构适应性"
- **第九轮**：HTTP 条件请求写条件（If-Match），验证"协议层写扩展适应性"，首次③类测试
- **第十轮**：HTTP 条件请求读条件（ETag + 304），验证"协议层读扩展适应性"，首次单层变更闭合，首次零 suggestion
- **第十一轮**：安全域首落地（登录签发 + token 校验中间件 + 登出吊销），验证"安全域适应性 + 运行时入口层替换"，Ctx 接口不变仅换来源（ARCH-001 闭合），SEC-001/002/003 首次端到端验证
- **第十二轮**：前端首轮（登录页 + 用户列表页 + 前端基础设施），验证 ARCH-003 跨层只经契约从 [预留] 到机器化 enforcement 闭合（R1-R11 唯一未机器化规则闭合），wire 适配 advisory 范例（D10），409 current_version 重试纠正 PRD（D19，R10 S-2 教训再次生效），多约束组合副作用预判首次大规模验证（4 条全部正确实现），零新依赖精神延伸到前端
- **第十三轮**：**首个元改进轮**（S-1~S-4 固化 R12 反推优化 + S-5 记录未来方向），验证**工作流对"自身改进"的适应性**——不走标准 PRD→Spec 五角色流程，直接"规划→实施→验证→复盘"精简流程；规则层 S-4 walkWeb 提升顶层 + allTs 扩展含 apps/web，CODE 扫描器覆盖前端（机器化修复 R12 S-4 根因）；提示词层 S-1/S-2/S-3 四角色各 +2 条落地 spec-first-workflow.md（共 8 条）；ARCH-002 误报风险消除（既有扫描器目录隔离设计在扩展时安全）；S-6 AI-005 前端测试盲区 + S-7 元改进轮 Review 缺失记录为未来方向

## 5 · 反推优化三个层面执行情况

> R12 retro §5 反推的三个层面优化（规则层 + Spec 模板层 + 提示词层），本轮逐条核对固化情况。

### 5.1 规则层固化（反推到 .trae/rules/ + scripts/check-rules.mjs）

| R12 反推项 | 本轮固化状态 | 证据 |
|---|---|---|
| **S-4 根因修复**：CODE 扫描器扩展到 apps/web（allTs 含 apps/web/src + apps/web/test） | ✅ **已固化** | check-rules.mjs L21-31 walkWeb 提升为顶层函数 + L34-41 allTs 扩展含 `...walkWeb(apps/web/src)` + `...walkWeb(apps/web/test)`；CODE-001/002/003/004 现扫描前端 .ts/.tsx；探针验证 CODE-001 真报错 |
| ARCH-003 校验方式闭合（R12 已落地） | ✅ 保持 | check-rules.mjs ARCH-003 分支（L211-234）不变，layering.md 校验方式描述不变 |
| META 规则双向绑定闭合（R12 已落地） | ✅ 保持 | META-003/META-004 对 ARCH-003 闭合不变，lint:rules 输出"双向绑定已校验" |

### 5.2 Spec 模板层固化（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| R12 反推项 | 本轮固化状态 | 证据 |
|---|---|---|
| **S-1 根因修复**：§3.2/§6 区分"自由文本表单"（须 safeParse）与"类型派生操作"（TS 类型保证，schema 校验冗余） | ✅ **已固化**（经 Tech Lead 提示词） | spec-first-workflow.md §2.3 Tech Lead 提示词 +1 条："Tech-Spec §3.2 表单校验复用清单须区分'自由文本表单'（须 safeParse）与'类型派生操作'（TS 类型保证，schema 校验冗余），AC 措辞须精确限定为'自由文本输入表单'。（R12 S-1）" |
| **S-2 根因修复**：§10 advisory 同步边界明确（行为/数据/schema 偏离须同步；纯 UI 文案偏离不须同步但须 Review 报告记录） | ✅ **已固化**（经 Tech Lead 提示词） | spec-first-workflow.md §2.3 Tech Lead 提示词 +1 条："Tech-Spec §10 advisory 偏离预判须明确同步边界——行为/数据/schema 偏离须反向同步 §10；纯 UI 文案偏离不须同步 §10 但须在 Review 报告记录。（R12 S-2）" |
| S-3 根因修复（§9 AC↔测试用例覆盖矩阵表） | ⚠️ **未固化**（选择提示词层路径替代） | R12 retro §5.2 建议 Tech-Spec §9 增加"AC↔测试用例覆盖矩阵"表；本轮选择经 test-writer 提示词（§2.4 +2 条）实现 AC 覆盖矩阵自检，未在 Spec 模板层增加 §9 矩阵表。理由：test-writer 提示词约束"交付报告附 AC↔测试用例覆盖矩阵表"已实现覆盖矩阵自检目标，且比 Spec 模板 §9 矩阵表更轻量（无需 Tech Lead 维护矩阵）。未来若发现 test-writer 自检矩阵质量不足，可补 §9 矩阵表 |

### 5.3 提示词层固化（反推到五角色提示词骨架 spec-first-workflow.md §2.3~2.6）

| R12 反推项 | 角色 | 本轮固化状态 | 证据 |
|---|---|---|---|
| S-1（区分两类表单） | Tech Lead | ✅ +1 条 | §2.3："Tech-Spec §3.2 表单校验复用清单须区分'自由文本表单'与'类型派生操作'...（R12 S-1）" |
| S-2（advisory 同步边界） | Tech Lead | ✅ +1 条 | §2.3："Tech-Spec §10 advisory 偏离预判须明确同步边界...（R12 S-2）" |
| S-3（AC 覆盖矩阵自检） | test-writer | ✅ +1 条 | §2.4："AC 覆盖矩阵自检——每条 AC 须有至少 1 个测试用例直接覆盖...交付报告附 AC↔测试用例覆盖矩阵表。（R12 S-3）" |
| S-3（组合场景测试） | test-writer | ✅ +1 条 | §2.4："组合场景测试——当 AC 涉及多操作组合...须单独测组合场景...（R12 S-3）" |
| S-2（advisory 同步边界） | impl-writer | ✅ +1 条 | §2.5："advisory 偏离反向同步边界——行为/数据/schema 偏离须反向同步 Spec §10；纯 UI 文案偏离不须同步但须在交付报告列出。（R12 S-2）" |
| S-1（类型派生操作标注） | impl-writer | ✅ +1 条 | §2.5："对类型派生操作不调 schema.safeParse 时，须显式标注 [约束] 偏离 + 反向同步 Spec §3.2...不可静默偏离。（R12 S-1）" |
| S-1（AC-ARCH-4 partial 判定依据） | Reviewer | ✅ +1 条 | §2.6："AC-ARCH-4 partial 判定依据——须区分'自由文本表单'与'类型派生操作'...partial 判定须注明根因...（R12 S-1）" |
| S-4（CODE 扫描器前端覆盖核对） | Reviewer | ✅ +1 条（已更新） | §2.6："CODE 扫描器前端覆盖核对——当 apps/web 存在时，确认 allTs 已含 apps/web/src + apps/web/test（R13 S-4 固化后已覆盖）；若扫描器未覆盖，须手动 grep...（R12 S-4）" |

**合计**：8 条提示词改进全部落地，四角色（Tech Lead 2 + test-writer 2 + impl-writer 2 + Reviewer 2）各 +2 条。Reviewer 第二条已更新为"R13 S-4 固化后已覆盖"，反映扫描器盲区已机器化修复。

### 5.4 S-5 未固化记录（advisory 不强制）

| R12 反推项 | 本轮固化状态 | 说明 |
|---|---|---|
| **S-5**：setupFiles 全局副作用（vitest setupFiles 全局，未来若后端受 jest-dom 污染改 vitest projects 模式） | ⚠️ **未固化**（advisory，记录未来方向） | 本期不改 vitest 配置（当前安全，仅追加 matcher，无破坏性副作用）。未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 node/jsdom 配置（独立 vitest.config.web.ts）。S-5 是 advisory 级（不强制固化），记录为未来改进方向 |

## 6 · 结论 + 剩余改进项

第十三轮是"工作流对自身改进适应性 + R12 反推优化固化"验证的标志——前 12 轮所有验证均围绕业务功能交付（CRUD/跨域/事务/HTTP 条件/安全/前端），本轮首次验证工作流对"自身元资产改进"的适应性。R12 复盘反推的 S-1~S-5 优化，本轮 S-1~S-4 全部固化（规则层 + Spec 模板层 + 提示词层三层面），S-5 记录为未来方向（advisory 不强制）。

关键证据：
1. **S-4 规则层固化——CODE 扫描器覆盖前端**（R13 最大验证点）：check-rules.mjs walkWeb 提升为顶层函数 + allTs 扩展含 apps/web/src + apps/web/test，CODE-001（禁 any）/CODE-002（禁空 catch）/CODE-003（禁 eval）/CODE-004（Zod schema 命名）四个通用扫描器现覆盖前端 .ts/.tsx。探针验证投放 `: any` 触发 CODE-001 真报错（exit≠0），删除探针后基线 exit 0。这是 R12 S-4 根因的机器化修复——前端不再是 CODE 扫描盲区。
2. **S-1/S-2/S-3 提示词层固化——四角色提示词各 +2 条**：R12 retro §5.3 反推的 8 条提示词改进（Tech Lead 2 + test-writer 2 + impl-writer 2 + Reviewer 2）全部落地 spec-first-workflow.md §2.3~2.6，每条标注 `（R12 S-x）` 溯源标记。核心是"区分自由文本表单 vs 类型派生操作"（S-1）+ "advisory 文案同步边界明确"（S-2）+ "AC 覆盖矩阵自检 + 组合场景测试"（S-3），下次这些角色 subagent 自动继承改进。
3. **元改进轮不走标准 PRD→Spec 流程**：R13 是首个"纯工作流元资产改进"轮次，直接"规划→实施→验证→复盘"精简流程，无 PRD/Tech-Spec/五角色调度。复盘替代 Review 作为质量门禁。这验证了工作流对"自身改进"的适应性——标准流程服务于业务功能交付，元资产改进可经精简流程闭环。
4. **ARCH-002 误报风险消除**：扩展 allTs 时逐分支核查既有扫描器目录隔离设计——ARCH-001（layerOf 返回 null 跳过）、ARCH-002（packages/contracts/ 前缀过滤）、SEC-001/002/003a（apps/api/src/ 前缀过滤）均有目录过滤，apps/web 文件被跳过，无误报。证明既有扫描器的目录隔离设计在扩展时安全，扩展 allTs 仅影响无目录过滤的通用扫描器（CODE-*）。
5. **三件套全绿 + 0 回归**：typecheck ✅ / lint:rules ✅（enforcement 14 项，ARCH-003 含）/ vitest ✅ 883/883（api 833 + web 50，无回归）。元改进轮不改业务代码与测试，三件套全绿仅验证"未破坏既有"。
6. **改动面极小**：仅 2 个文件——`scripts/check-rules.mjs`（S-4 walkWeb 提升 + allTs 扩展）+ `docs/workflow/spec-first-workflow.md`（S-1/S-2/S-3 提示词骨架 §2.3~2.6 四角色各 +2 条）。无业务代码改动、无测试断言改动、无契约改动。

这证明：**AI 原生工作流在"前端域适应性 + ARCH-003 机器化闭合"验证（R12）后，进入"工作流自身元改进固化"验证阶段（R13）**——R12 复盘反推的 S-1~S-5 优化，本轮 S-1~S-4 全部固化（三层面：规则层 S-4 + Spec 模板层 S-1/S-2 + 提示词层 S-1/S-2/S-3），S-5 记录为未来方向。元改进轮精简流程验证成功，工作流对"自身改进"具有适应性。R12 S-4 根因（CODE 扫描器前端盲区）机器化修复，前端不再是 CODE 扫描盲区。

剩余改进项（S 级，不阻断）：
- **S-5**（R12 遗留，advisory 不强制）：setupFiles 全局副作用——未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 node/jsdom 配置（独立 vitest.config.web.ts）。本期不阻断（当前安全，仅追加 matcher）。
- **S-6**（R13 新发现）：AI-005 前端测试盲区——AI-005 分支硬编码目录过滤 `apps/api/test/`，扩展 allTs 后仍只扫后端测试，未覆盖 apps/web/test。前端测试若硬编码跨域可变集合无机器校验。未来改进方向：AI-005 continue 条件扩展含 apps/web/test（须核查正则对前端测试的适用性）。
- **S-7**（R13 新发现）：元改进轮 Review 缺失——R13 是首个元改进轮，无标准 Review 报告（无 PRD AC 可逐条核对），复盘替代 Review 作为质量门禁。未来元改进轮可考虑轻量 Review checklist（核对 S-x 是否全部固化 + 三件套绿 + 改动范围合规 + 探针验证执行）。

> 十三轮演进脉络：R9/R10 验证"协议层扩展适应性"（写条件 + 读条件），R11 验证"安全域适应性"（鉴权），R12 验证"前端域适应性 + ARCH-003 机器化闭合"，**R13 验证"工作流自身元改进固化"**（S-1~S-4 固化 + S-5 记录）。R10 证明协议扩展可单层闭合，R11 证明安全机制替换可单层闭合，R12 证明前端引入可跨层契约机器化闭合，**R13 证明工作流元资产改进可经精简流程闭环**（不走标准五角色流程）。下一轮可考虑：①前端扩展角色/部门/审计页（更多管理域前端）；②后端对齐 wire 字段名消除 D10 适配（server.ts `error`→`code`）；③补 GET /v1/users/:id 端点（R12 §1.3 发现的 gap，消除 D19 不 GET 偏离）；④E2E 测试引入（Playwright 跑真实浏览器+真实后端）；⑤S-6/S-7 固化（AI-005 前端测试覆盖 + 元改进轮 Review checklist）。
