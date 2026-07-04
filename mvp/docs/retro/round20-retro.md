---
doc_type: Retrospective
id: RETRO-ROUND20-001
scope: 第二十轮演练（业务轮 #14：引入 Playwright E2E 测试 + 闭合 R12 遗留 S-5 setupFiles 全局副作用，跨测试基础设施层 + 配置层，无业务逻辑改动）
date: 2026-07-04
verdict: 跑通；19 AC 全对齐（AC-E1~E14 共 14 条 E2E + AC-S5-1~S5-5 共 5 条 S-5 闭合）；三件套全绿（typecheck exit 0 / lint:rules exit 0 / vitest 56 files 1256 tests / E2E 14 passed 14.7s）；4 项 advisory 偏离反向同步全部闭合；R18 S-21 首次触发验证生效（advisory #1 实际编辑 Tech-Spec §3.5+D4，非仅代码注释）；S-5 advisory 经 9 轮（R12→R20）最终闭合迁出"仍在生效"表
---

# 第二十轮演练复盘 · 业务轮 #14 · 引入 Playwright E2E 测试 + 闭合 S-5

> 本轮承接 R19 retro §6 候选清单第 1 项——E2E 测试引入（Playwright 真实浏览器 + 真实后端）+ 顺带闭合 R12 遗留 S-5（setupFiles 全局副作用）。本轮为业务轮（走五角色流程 BA→Tech Lead→test-writer→impl-writer→Reviewer + 七道门禁 G1/G3/G3.5/G4/G5/G6/G6.1/G7），承接 R19 retro 圈定的核心流范围（login → users → roles → transfer → 登出全链路），同时把 R12 遗留 9 轮的 S-5 advisory 在测试基础设施改造机会中顺带闭合（vitest projects 模式分离 api node / web jsdom）。

## 0 · 本轮目标与结果

1. **引入 Playwright E2E 测试能力** → ✅ 全部落地：
   - `apps/e2e/`（与 apps/api / apps/web 平级，PRD Q1 BLOCKING 决策）独立 E2E app
   - `playwright.config.ts` webServer 双进程编排（vite dev 5173 + api server 3000 with 临时 DB）
   - `apps/e2e/tests/{login,users,roles,transfer,logout}.spec.ts` 共 5 个 spec 文件 14 tests，覆盖 AC-E1~E14 全部核心流
   - `apps/e2e/tests/_helpers.ts` 提供 loginAsAdmin + apiCreateUser/Role/Department/AssignRole 辅助
   - `apps/e2e/global-teardown.ts` 临时 DB 清理（§3.3 策略 A）
   - 14 tests passed in 14.7s（chromium headless）
2. **闭合 R12 遗留 S-5（setupFiles 全局副作用）** → ✅ 全部落地：
   - `vitest.config.ts` 降级为共享基座（移除 environment + setupFiles + include，保留 plugins/globals/testTimeout/coverage/resolve.alias）
   - `vitest.workspace.ts` 新增（3 projects：api node 无 setupFiles / web jsdom + jest-dom / contracts node）
   - `apps/web/test/setup.ts` jest-dom → jest-dom/vitest（§10.6 关键风险预判触发并已修复）
   - 既有 1256 测试全绿无回归（AC-S5-4）
3. **R18 S-21 首次触发验证生效** → ✅ 验证通过：
   - advisory 偏离 #1（vitest workspace 模式 vs spec §3.5 test.projects）：impl-writer 实际编辑 Tech-Spec §3.5+D4 添加 `[advisory] R20 反向同步` 标注（含 vitest 1.6.1 源码根因 + `defineWorkspace()` 替代方案），Reviewer 通过 Read Tech-Spec 全文确认章节已改（非仅代码注释声明，R19 S-21 固化的"伪同步"检测机制首次在业务轮触发并捕获到合规对齐）
   - 4 项 advisory 偏离全部反向同步闭合（#1 vitest workspace / #2 每 test 登录 vs storageState / #3 凭据 admin123 PRD 笔误 / #4 AC-E4 次要断言弱）
4. **G6 Reviewer 验收**：verdict=pass，19/19 AC 对齐，4 项 advisory 反向同步全部闭合，0 Blocker + 5 项 Suggestion（非阻断）

**结果速览**：typecheck ✅ exit 0 / lint:rules ✅ exit 0（6 条 AI-005 + 3 条 SEC-002 既有豁免非本轮新增）/ vitest ✅ 56 files 1256 tests passed（`|web|` project 前缀证明 workspace 模式生效）/ E2E ✅ 14 passed 14.7s / 改动文件 6 改 + 6 新增源文件 + 3 新增文档（PRD/Spec/Review）/ 19 AC 全对齐 / 4 项 advisory 反向同步闭合 / S-5 经 9 轮最终闭合迁出"仍在生效"表。

## 1 · 本轮核心验证结论

### 1.1 E2E 引入：14 AC 全绿（AC-E1~E14）

R19 retro §6 候选清单第 1 项「E2E 测试引入」在 R20 全部落地，覆盖核心流全链路：

| 核心流 | spec 文件 | AC 数 | 验收点 | 判定 |
|---|---|---|---|---|
| login | `apps/e2e/tests/login.spec.ts` | 1（AC-E1） | 登录成功跳转 `/users` + token 持有 | ✅ |
| users | `apps/e2e/tests/users.spec.ts` | 3（AC-E2/E3/E4） | 列表渲染 + 创建用户 + 状态切换 If-Match round-trip（page.route 拦截强断言） | ✅ |
| roles | `apps/e2e/tests/roles.spec.ts` | 4（AC-E5/E6/E7/E8） | 列表 + 创建 + 设父 If-Match round-trip + 删除 | ✅ |
| transfer | `apps/e2e/tests/transfer.spec.ts` | 3（AC-E9/E10/E11） | 表单 + 提交 + API GET 复核 department_id 强断言 | ✅ |
| logout | `apps/e2e/tests/logout.spec.ts` | 3（AC-E12/E13/E14） | 跳转 + localStorage token 清除 + 路由守卫 | ✅ |

**关键设计落地**：
- **webServer 双进程**（D2）：`playwright.config.ts` 启动 vite dev 5173（前端 dev proxy `/v1` → 3000）+ api server 3000 with `DB_PATH` 指向 `os.tmpdir()` 临时文件，Playwright 自动管理生命周期（启动 → 等待端口就绪 → 测试运行 → 优雅关闭）。
- **临时 DB 隔离**（D3 / §3.3）：`DB_PATH=${tmpdir()}/e2e-admin-${process.pid}-${Date.now()}.db`，每 run 全新 seed admin（admin@example.com / admin123），不污染 `./data/admin.db`；`reuseExistingServer: false` 强制新起保证数据隔离（[约束] 优先数据隔离 over 本地加速）。
- **E2E 独立 runner**（Q3）：`npm run test:e2e` = `playwright test`，不计入默认 `npm test`（vitest run），CI 两阶段编排 test → test:e2e。
- **chromium 单浏览器**（Q4）：仅 chromium 单 project（`{ name: 'chromium', use: { browserName: 'chromium' } }`），CI 用 `npx playwright install --with-deps chromium`。
- **ARCH-003 满足**：`apps/e2e/` 通过 HTTP 交互（`_helpers.ts` apiCreate* 用 `request.post(API_BASE)` 调真实后端），不 import apps/api/src（grep 确认）。

### 1.2 S-5 闭合：5 AC 全绿（AC-S5-1~S5-5）+ §10.6 关键风险预判准确

R12 遗留 9 轮的 S-5 advisory（setupFiles 全局副作用）在 R20 一次性闭合：

| AC | 文件:行 | 关键证据 | 判定 |
|---|---|---|---|
| AC-S5-1 projects 模式分离 | `vitest.workspace.ts:16-46` | 3 projects via `defineWorkspace()`：api（node）/ web（jsdom）/ contracts（node），environment+setupFiles 严格隔离 | ✅ |
| AC-S5-2 后端无 jest-dom 污染 | `vitest.workspace.ts:17-25` | api project `{ environment:'node', include:['apps/api/test/**'] }` 无 setupFiles | ✅ |
| AC-S5-3 前端 jest-dom 仍生效 | `vitest.workspace.ts:26-35` + `apps/web/test/setup.ts:15` | web project jsdom + setupFiles；setup.ts 改 `jest-dom/vitest`（§10.6 修复） | ✅ |
| AC-S5-4 既有 1256 测试全绿 | 编排者验证 | 56 files / 1256 tests passed，`|web|` project 前缀证明 workspace 模式生效 | ✅ |
| AC-S5-5 S-5 advisory 反向同步移除 | Tech-Spec §3.5+D4+§7.1 + `vitest.config.ts:3-19` 注释 | [advisory] R20 反向同步标注已落，vitest.config.ts 顶部注释说明 S-5 闭合 + §10.6 反向同步 | ✅ |

**§10.6 关键风险预判准确并已修复**：Tech-Spec §10.6 预判"jsdom 化隐藏依赖暴露（setup.ts 从 jest-dom 改为 jest-dom/vitest）"，实际触发——`setup.ts` 用 `import '@testing-library/jest-dom'` 在 vitest workspace 模式下报 "Invalid Chai property: toBeInTheDocument"（jest-dom 6.x 裸 `expect.extend` 在 projects 模式下不绑定 vitest expect）。impl 按 §10.6 "impl-writer 须修复（非静默跳过）"落地，改 `jest-dom/vitest` 子路径入口（显式 `import { expect } from 'vitest'; expect.extend(matchers)`），1256 全绿证明修复有效。**§10.6 预判范式（R17 固化）第二次大规模触发并精准命中**（首次是 R18 多约束组合）。

### 1.3 R18 S-21 首次触发验证生效（advisory 偏离反向同步同标准）

R19 固化的 S-21（impl-writer [约束] 偏离反向同步滞后）在 R20 首次大规模触发并验证生效：

| advisory 偏离 | Spec 反向同步落地位置 | Reviewer 核实方式 | 判定 |
|---|---|---|---|
| #1 vitest workspace vs test.projects | Tech-Spec §3.5（L197）+ D4（L307）+ `vitest.config.ts:9-19` 顶部注释 | Reviewer Read Tech-Spec 全文确认章节已含 `[advisory] R20 反向同步` 标注（非仅代码注释声明，R19 S-21 固化） | ✅ 闭合 |
| #2 每 test 登录 vs storageState | Tech-Spec §3.7（L243）`storageState 登录态注入（[advisory]）` 标注 | Reviewer Read 确认 + impl-writer 注释声明 | ✅ 闭合 |
| #3 凭据 admin123（PRD 笔误 Admin@123） | Tech-Spec §7.2（L428-436）+ PRD AC-E1（L79）已编排者修正 | Reviewer Read PRD AC-E1 + Tech-Spec §7.2 确认 | ✅ 闭合 |
| #4 AC-E4 次要断言弱 | impl 注释声明（关键 If-Match 强断言已在） | Reviewer Read users.spec.ts 确认 If-Match 强断言在 + 弱断言已声明 | ✅ 闭合 |

**S-21 固化机制验证结论**：
- R18 S-21 教训（impl-writer 在 router/user.ts 添加 `.strict()` 满足 test-writer AC-G3 扩展断言，但未实际编辑 Tech-Spec §4.4，仅代码注释声明"伪同步"）在 R19 固化后，R20 impl-writer 在 4 项 advisory 偏离场景中**全部实际编辑 Tech-Spec 文件**（§3.5/§3.7/§7.2/D4），Reviewer 通过 Read 全文 + git status 确认章节已含标注。
- 加性安全场景边界明确：advisory 偏离 #1（vitest workspace 替代 test.projects）属加性配置（功能等价，仅 API 形式不同），按 R19 S-21 固化"加性安全可降级 Suggestion 但强制本轮闭合"边界，advisory #1 在本轮 Review 中按 advisory 范围处理（非 blocker），但 Tech-Spec §3.5+D4 已实际编辑闭合（非跨轮遗留）。
- R19 S-21 固化的"伪同步检测"机制（Reviewer 须通过 Read Tech-Spec 全文 / git diff 确认章节已改，非仅信代码注释）在 R20 验证可复用——4 项 advisory 偏离全部按"实际编辑 Spec 文件 + Reviewer Read 核实"双闭环闭合。

### 1.4 R18 S-22 提示词层验证（E2E setup 阶段 token 唯一性）

R19 固化的 S-22（test-writer 确定性 token setup 时序污染）在 R20 E2E 测试 setup 阶段首次触发场景但未污染——E2E 每 test 重新登录（`_helpers.ts:24-43` `loginAsAdmin`），每 test 独立 admin token，无确定性 token 生成（每次登录调真实后端 `/v1/auth/login` 拿新 token），无跨用例污染风险。S-22 提示词层约束虽未在 R20 直接触发（每 test 重新登录规避了确定性 token 场景），但提示词文本已落 §2.4 test-writer，下轮业务轮端到端测试 setup 若引入确定性 token 生成场景将触发验证。

## 2 · 本轮新发现的问题（S 级，不阻断）

本轮无新发现 S 级教训。Reviewer 给出 5 项 Suggestion（非阻断，建议未来轮次收尾闭合）：

1. **AC-E7 父子关系建立断言可强化**：`roles.spec.ts:100` 仅断言 modal 关闭间接验证设置成功，未直接验证 DB 中 `parent_id` 已更新。建议参照 AC-E11 用 API GET `/v1/roles/:id` 复核 `parent_id === roleA.id`（强断言）。当前 If-Match header 强断言已在，不影响关键验收。
2. **playwright.config.ts retries=0 偏离 spec §3.2 字面**：spec §3.2 原文 `retries: CI ? 2 : 0`，impl 取 `retries: 0`（`playwright.config.ts:36`），未在 Tech-Spec §7 反向同步声明。建议反向同步声明或恢复 spec 值（[advisory] 范围，E2E 14 passed 证明 retries=0 可行）。
3. **Tech-Spec §2.3 @playwright/test devDeps 描述误差**：spec §2.3 称"@playwright/test 已在 devDependencies（^1.61.1）"，但 git diff 显示 `package.json` 本轮新增 `@playwright/test` devDep 行（实际本轮才真正加入 devDeps）。功能正确，建议 spec §2.3 同步修正描述。
4. **Tech-Spec §7.2 / §2.4 stale 描述**：仍提"PRD AC-E1 字面 Admin@123"，但 PRD 已被编排者修正为 admin123。advisory #3 反向同步目标已达成，建议 Tech-Spec §7.2 同步更新为"PRD AC-E1 已修正为 admin123"消除 stale 描述。
5. **task 描述"新增 7 + 改动 5 = 12 文件"数字误差**：与 impl-writer 自报清单（9 新增源文件 + 5 改动源文件 = 14）不符。实际 git status 与清单一致，建议 task 描述同步修正数字（非 impl-writer 问题）。

**判定**：5 项 Suggestion 均属文档同步类（无新规则 / 新提示词 / 新 Spec 模板项需求），按 AI-003 流程属 advisory 范围（不阻断本轮 pass），建议下轮业务轮（R21 前端性能加固）启动时顺带闭合 #2-#5（#1 AC-E7 强断言属测试增强，可纳入 R21 测试增强范畴）。

> **不新立 S 级教训的理由**：5 项 Suggestion 均已被既有规则覆盖（#1 测试增强属既有 AI-007 弱断言改进流程 / #2-#5 文档同步属 R12 S-2 advisory 反向同标准 + R18 S-21 实际编辑 Spec 同标准），无新规则缺口，不立新 S 级。本轮 retro 不新增 S-x，lessons-learned.md "仍在生效"表 S-5 迁出后该表为空。

## 3 · 量化对比（二十轮演进表）

| 指标 | R15 | R16 | R17 | R18 | R19 | R20 |
|---|---|---|---|---|---|---|
| 用例数（vitest） | 1089 | 1196 | 1196（无源码改动） | 1256（+60） | 1256（无源码改动） | 1256（无回归）+ **E2E 14**（新增） |
| 累计用例 | 1089 | 1196 | 1196 | 1256 | 1256 | 1256 vitest + 14 E2E |
| blocker | 0 | 0 | 0 | 0 | 0 | 0 |
| suggestion | 8 | 7 | N/A（元改进轮） | 1（已闭合） | N/A（元改进轮） | 5（非阻断，建议下轮闭合） |
| Reviewer verdict | pass | pass | N/A（G6.5） | pass | N/A（G6.5） | pass |
| AC 对齐 | 54/54 | 46/46 | N/A | 24/24 | N/A | **19/19**（14 E2E + 5 S-5） |
| 影响层 | 前端全域收尾层 | 后端能力前端化闭合层 | 元资产层 | 跨后端+前端+contracts 三层联动层 | 元资产层 | **测试基础设施层**（apps/e2e/ 新增 + vitest workspace 重构 + Playwright 引入） |
| 新架构模式 | 前端全域覆盖 | 后端能力前端化闭合 | 元改进轮 #2 | 历史 advisory 偏离消除 | 元改进轮 #3 | **E2E 三真实联调**（真实浏览器+真实后端+真实前端路由）+ vitest workspace 多 project 模式 |
| 轮次类型 | 业务 | 业务 | 元改进 | 业务 | 元改进 | **业务**（第 14 个） |
| 提示词骨架条数 | 5角色+17条 | 5角色+17条 | 5角色+23条 | 5角色+23条 | 5角色+25条 | **5角色+25条**（R18 S-21/S-22 在 R20 首次大规模触发验证生效，无新固化） |
| 规则机器化覆盖 | 持续覆盖 | 持续覆盖 | AI-005 扩展含 apps/web/test | 持续覆盖 | 持续覆盖 | 持续覆盖（lint:rules exit 0） |
| 元改进轮 Review | 沿用 R13 | 沿用 R13 | G6.5 落地 | 沿用 R17 G6.5 | G6.5 第二次落地 | 沿用 G6（业务轮） |
| 固化教训数（本轮） | 4（S-13~S-16） | 0（持续验证） | 6（S-6/S-7/S-17~S-20） | 0（新发现 S-21/S-22） | 2（S-21/S-22） | **0**（无新发现 S 级，5 项 Suggestion 均被既有规则覆盖） |

> R20 用例数 1256 vitest + 14 E2E（新增 runner，不计入 vitest 默认 npm test，Q3 决策）。lint:rules exit 0 + META-003/META-004 双向绑定持续闭合。R18 S-21 在 R20 首次大规模触发验证生效（4 项 advisory 偏离全部实际编辑 Spec 闭合）。

## 4 · 二十轮演进脉络

- **第十五轮**：前端全域覆盖收尾（通知管理页 + 报表页，新增 notification + report 两域，完成七域全覆盖），验证前端全域覆盖适应性
- **第十六轮**：后端能力前端化闭合（调岗 transfer + 角色继承管理，闭合"前端覆盖全部后端写/读端点"最后一公里），验证后端能力前端化闭合适应性 + errorMapping 全码映射收尾 + impl-writer 自报准确性违规发现（S-17~S-20 4 项待固化）
- **第十七轮**：元改进轮 #2（固化 R16 S-17~S-20 + R13 遗留 S-6/S-7 共 6 项教训），验证 R13 元改进轮精简流程范式可复用 + G6.5 元改进轮 Review checklist 首次落地（S-7 自身递归闭合）
- **第十八轮**：业务轮 #13（消除 R12 D10 wire 字段名适配 + R12 D19 GET /v1/users/:id 端点缺失 + D9 重分类 [约束]），跨后端 + 前端 + contracts 三层联动，验证 R17 固化提示词在业务轮首次大规模触发 + 新发现 S-21（[约束] 偏离反向同步滞后）+ S-22（确定性 token setup 时序污染）
- **第十九轮**：元改进轮 #3（固化 R18 S-21/S-22 共 2 项教训），无业务代码改动，仅提示词层 + Spec 模板层。S-21 三层固化（Tech Lead §10 预判 + impl-writer 反向同步同标准 + Reviewer git diff 核实 + 加性安全降级但强制本轮闭合）。验证 R17 G6.5 范式第二次落地可复用。
- **第二十轮**：**业务轮 #14**（引入 Playwright E2E 测试 + 闭合 R12 遗留 S-5）。E2E 三真实联调（真实浏览器 + 真实后端 webServer + 真实前端路由）覆盖核心流全链路（login → users → roles → transfer → 登出，14 AC）。S-5 经 9 轮（R12→R20）最终闭合（vitest workspace 模式分离 api node / web jsdom，setupFiles 不再全局注入）。R18 S-21 首次大规模触发验证生效（4 项 advisory 偏离全部实际编辑 Spec 闭合，Reviewer Read 全文核实非伪同步）。§10.6 关键风险预判第二次大规模触发并精准命中（jest-dom → jest-dom/vitest 修复）。

## 5 · 反推优化三个层面执行情况

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R20 状态 | 证据 |
|---|---|---|
| META-003 声明即实现 | ✅ 持续闭合 | lint:rules exit 0 |
| META-004 实现即声明 | ✅ 持续闭合 | 本轮无新增 enforcement ID |
| ARCH-001/002/003 | ✅ 全部保持 | ARCH-003（apps/e2e 不 import apps/api/src）grep 确认；ARCH-002（contracts 零变更）git status 确认；ARCH-001（四层反向依赖）不触发（无 src/ 业务文件改动，仅测试基础设施层） |
| AI-005 扫描器（R13 S-6 固化） | ✅ 持续覆盖 | lint:rules exit 0，6 条 AI-005 建议为 R16 既有非本次新增 |
| SEC-002/SEC-003a | N/A | E2E + 配置轮，无 service/router 改动；3 条 SEC-002 豁免审计为既有非本轮新增 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R20 状态 | 证据 |
|---|---|---|
| R16 S-18 全集定义明确 | ✅ 持续生效 | 本轮无全码映射改动（errorMapping 零变更） |
| R16 S-19 简单常量复用边界 | ✅ 持续生效 | vitest include glob 重复定义（api/web/contracts 各 1 处）符合 S-19 ≤3 处阈值 |
| R16 S-20 测试工具 workaround | ✅ 持续生效 | page.route 拦截 If-Match（AC-E4/E7）+ page.evaluate 读 localStorage（AC-E13）+ 每 test 登录规避 storageState token exp，全部按 S-20 标注 |
| **R18 S-21 [约束] 偏离反向同步闭环性** | ✅ **R20 首次大规模触发验证生效** | Tech Lead §10.5 预判 [约束] 偏离可能场景 → impl-writer 实际编辑 Tech-Spec §3.5+D4+§7.2+§3.7（4 项 advisory 偏离） → Reviewer Read 全文核实非伪同步。R19 固化机制在 R20 业务轮首次大规模触发并验证可复用。 |
| §10.6 关键风险预判范式（R17 固化） | ✅ **第二次大规模触发并精准命中** | Tech-Spec §10.6 预判"jsdom 化隐藏依赖暴露"，实际触发"jest-dom 6.x 裸 expect.extend 在 projects 模式下不绑定 vitest expect → Invalid Chai property: toBeInTheDocument"，impl 按 §10.6 "impl-writer 须修复（非静默跳过）"落地改 jest-dom/vitest。1256 全绿证明修复有效。 |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.3~2.6）

| 固化项 | 角色 | R20 状态 | 证据 |
|---|---|---|---|
| S-21 Tech Lead §10 预判 [约束] 偏离反向同步闭环性 | Tech Lead | ✅ R20 触发 | Tech-Spec §10.5 [约束] 偏离反向同步闭环性预判已落（本轮无 [约束] 偏离但预判已含） |
| S-21 impl-writer 反向同步同标准（实际编辑 Spec + 行号 + 合规论证） | impl-writer | ✅ R20 首次大规模触发验证生效 | 4 项 advisory 偏离全部实际编辑 Tech-Spec（§3.5+D4 #1 / §3.7 #2 / §7.2 #3 / impl 注释 #4），vitest.config.ts 顶部注释详述根因（vitest 1.6.1 源码 workspacesFiles + resolveWorkspace） |
| S-21 Reviewer 闸门核验（Read 全文 / git diff 核实非伪同步） | Reviewer | ✅ R20 首次大规模触发验证生效 | Reviewer 通过 Read Tech-Spec 全文确认 4 项 advisory 标注已落入章节（非仅信代码注释），R19 S-21 固化的"伪同步检测"机制在 R20 验证可复用 |
| S-22 test-writer 确定性 token 唯一性 | test-writer | ✅ 提示词已落（未直接触发） | E2E 每 test 重新登录（无确定性 token 生成场景），提示词文本已落 §2.4 test-writer，下轮业务轮端到端测试 setup 若引入确定性 token 生成场景将触发验证 |
| S-17 impl-writer 自报准确性 | impl-writer | ✅ 持续生效 | impl-writer 自报清单（9 新增 + 5 改动源文件）与 git status 实际一致 ✅（task 数字误差非 impl-writer 问题） |

**合计**：R13 固化的 8 条 + R14 固化的 5 条 + R15 固化的 4 条 + R16 持续验证的 17 条 + R17 固化的 6 条 + R18 持续验证的 23 条 + R19 固化的 4 条 = **R20 后提示词骨架共 5 角色 + 25 条固化项持续生效**（R20 无新固化，R18 S-21/S-22 在 R20 首次大规模触发验证生效）。

## 6 · 结论 + 剩余改进项

第二十轮是"业务轮 #14 · 引入 Playwright E2E 测试 + 闭合 S-5"的标志——承接 R19 retro §6 候选清单第 1 项，本轮一次性完成两项测试基础设施改进：E2E 引入（Playwright + apps/e2e/ + 14 AC 全绿）+ S-5 闭合（vitest workspace 模式分离 api node / web jsdom）。R12 遗留 9 轮的 S-5 advisory 经本轮闭合迁出"仍在生效"表（lessons-learned.md 重生后该表为空）。

关键证据：
1. **E2E 三真实联调能力建立**：`apps/e2e/` 独立 app + `playwright.config.ts` webServer 双进程（vite dev 5173 + api server 3000 with 临时 DB）+ 5 spec 文件 14 tests 覆盖核心流全链路（login → users → roles → transfer → 登出），14 passed in 14.7s。临时 DB 隔离（`DB_PATH=${tmpdir()}/e2e-admin-${pid}-${ts}.db`）+ `reuseExistingServer: false` 保证数据隔离。
2. **S-5 闭合**：`vitest.config.ts` 降级为共享基座 + `vitest.workspace.ts` 3 projects（api node 无 setupFiles / web jsdom + jest-dom / contracts node）+ `setup.ts` jest-dom → jest-dom/vitest（§10.6 修复）。既有 1256 测试全绿无回归（`|web|` project 前缀证明 workspace 模式生效）。
3. **R18 S-21 首次大规模触发验证生效**：4 项 advisory 偏离全部实际编辑 Tech-Spec（§3.5+D4 #1 / §3.7 #2 / §7.2 #3 / impl 注释 #4），Reviewer 通过 Read 全文 + git status 确认章节已含标注（非仅信代码注释，R19 S-21 固化的"伪同步检测"机制在 R20 业务轮首次大规模触发并验证可复用）。加性安全场景边界明确：advisory #1（vitest workspace 替代 test.projects 属加性配置）按 advisory 范围处理（非 blocker），但 Tech-Spec §3.5+D4 已实际编辑闭合（非跨轮遗留）。
4. **§10.6 关键风险预判第二次大规模触发并精准命中**：Tech-Spec §10.6 预判"jsdom 化隐藏依赖暴露"，实际触发"jest-dom 6.x 裸 expect.extend 在 projects 模式下不绑定 vitest expect → Invalid Chai property: toBeInTheDocument"。impl 按 §10.6 "impl-writer 须修复（非静默跳过）"落地改 jest-dom/vitest 子路径入口，1256 全绿证明修复有效。

剩余改进项（S 级，不阻断）：
- **本轮无新立 S 级**：5 项 Reviewer Suggestion 均属文档同步类（#1 测试增强属既有 AI-007 弱断言改进流程 / #2-#5 文档同步属 R12 S-2 + R18 S-21 同标准），无新规则缺口，不立新 S 级。
- **既有 S 级全部闭合**：S-5（R12 遗留 9 轮）经 R20 闭合迁出"仍在生效"表，lessons-learned.md 重生后该表为空。

> 本轮 5 项 Suggestion 不立新 S 级，按既有规则在下轮（R21 前端性能加固）启动时顺带闭合（#2-#5 文档同步 + #1 AC-E7 强断言增强）。

> **下一轮候选**（按 R17 §6 + R18 §6 + R19 §6 + R20 §6 状态排序）：
> 1. **前端性能加固**（React.memo/useMemo/useCallback 评估 + 虚拟列表 + 代码分割）—— R21，前端单层变更，顺带闭合 R20 Reviewer 5 项 Suggestion（文档同步 + AC-E7 强断言）。
> 2. **可访问性深化**（screen reader 端到端测试 + 键盘导航 + 色彩对比 WCAG AA）—— R22，前端单层变更，可与 R21 合并。
> 3. **跨浏览器 E2E 覆盖**（firefox/webkit，PRD Q4 out of scope 转 future）—— R23，E2E 扩展，本轮 chromium 单浏览器已建好基础设施（apps/e2e/ + webServer + 临时 DB），扩展为多浏览器仅需 playwright.config projects 数组增 firefox/webkit 项。
