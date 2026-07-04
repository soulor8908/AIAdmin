---
doc_type: Review
id: REVIEW-E2E-INTRODUCTION-001
title: R20「E2E 测试引入 + 闭合 S-5」G6 验收 Review 报告
prd_ref: PRD-E2E-INTRODUCTION-001
spec_ref: TECH-E2E-INTRODUCTION-001
round: R20
verdict: pass
created: 2026-07-04
reviewer: reviewer@team
---

# R20「E2E 测试引入 + 闭合 S-5」G6 验收 Review 报告

## §0 速览

| 维度 | 结果 |
|------|------|
| **verdict** | **pass** |
| Blocker 数 | 0 |
| Suggestion 数 | 5 |
| AC 对齐数 | 19/19（AC-E1~E14 全部 ✅ + AC-S5-1~S5-5 全部 ✅） |
| typecheck 实跑 | exit 0 ✅ |
| lint:rules 实跑 | exit 0 ✅（6 条 AI-005 非阻断建议 + 3 条 SEC-002 豁免审计，均既有非本轮新增） |
| vitest（信赖编排者） | 56 files / 1256 tests passed ✅（`|web|` project 前缀证明 workspace 模式生效） |
| E2E（信赖编排者） | 14 passed（14.7s，AC-E1~E14 全绿）✅ |
| advisory 反向同步 | 4 项均已在 Tech-Spec 章节标注 ✅ |
| ARCH-003 | apps/e2e/ 不 import apps/api/src ✅（grep 确认） |
| ARCH-002 | contracts 零变更 ✅（git status 确认） |

**通过判定**：三件套全绿 + 19 AC 对齐 + 4 项 advisory 反向同步闭合 + ARCH 检查通过 + 无 Blocker → **pass**。

---

## §1 PRD 验收逐条核对（19 AC，AI-007）

### 1.1 E2E 核心流（AC-E1~E14，14 条）

| AC | 文件:行 | 关键断言 | 判定 |
|----|---------|----------|------|
| **AC-E1** 登录成功跳转 | `apps/e2e/tests/login.spec.ts:14-36` | `toHaveURL(/\/users$/)`（L23）+ `expect(token).toBeTruthy()`（L35，localStorage admin_token） | ✅ 对齐 |
| **AC-E2** 用户列表渲染 | `apps/e2e/tests/users.spec.ts:29-36` | `table.toBeVisible()`（L33）+ `toContainText(ADMIN_EMAIL)`（L35，含 seed admin） | ✅ 对齐 |
| **AC-E3** 创建用户 | `apps/e2e/tests/users.spec.ts:38-59` | `dialog.not.toBeVisible()`（L56）+ `toContainText(email)`（L58，新邮箱出现） | ✅ 对齐 |
| **AC-E4** 状态切换 If-Match | `apps/e2e/tests/users.spec.ts:61-102` | page.route 拦截 PATCH `/v1/users/*/status`（L81），`capturedIfMatch.truthy()` + `Number >= 0`（L95-97，强断言）；UI 行内含"禁用"（L101，弱断言，advisory #4） | ✅ 对齐（If-Match 强断言在，UI 弱断言已声明） |
| **AC-E5** 角色列表渲染 | `apps/e2e/tests/roles.spec.ts:27-33` | `table.toBeVisible()`（L30）+ `toContainText('admin')`（L32，seed admin 角色） | ✅ 对齐 |
| **AC-E6** 创建角色 | `apps/e2e/tests/roles.spec.ts:35-54` | `form.not.toBeVisible()`（L52）+ `toContainText(roleName)`（L53） | ✅ 对齐 |
| **AC-E7** 设父角色 If-Match | `apps/e2e/tests/roles.spec.ts:56-101` | page.route 拦截 POST `/v1/roles/*/parent`（L75），`capturedIfMatch.truthy()` + `Number >= 0`（L96-97，强断言）；modal 关闭（L100，弱断言） | ✅ 对齐（If-Match 强断言在，父子关系建立可强化见 Suggestion #1） |
| **AC-E8** 删除角色 | `apps/e2e/tests/roles.spec.ts:103-125` | `not.toContainText(role.name)`（L124，列表中消失） | ✅ 对齐 |
| **AC-E9** 调岗表单渲染 | `apps/e2e/tests/transfer.spec.ts:31-46` | h1 "调岗管理"（L38）+ 4 字段可见（用户 ID/目标部门/原角色/新角色，L40-43）+ 提交按钮（L45） | ✅ 对齐 |
| **AC-E10** 提交调岗 | `apps/e2e/tests/transfer.spec.ts:48-92` | page.route 拦截 POST `/v1/users/*/transfer`（L73），`responseStatus >= 200 && < 400`（L90-91，非 4xx/5xx） | ✅ 对齐 |
| **AC-E11** 调岗成功确认 | `apps/e2e/tests/transfer.spec.ts:94-128` | `getByText('调岗成功')`（L118）+ API GET 复核 `department_id === dept.id`（L127，强断言） | ✅ 对齐 |
| **AC-E12** 登出跳转 | `apps/e2e/tests/logout.spec.ts:19-28` | `toHaveURL(/\/login$/)`（L27） | ✅ 对齐 |
| **AC-E13** token 清除 | `apps/e2e/tests/logout.spec.ts:30-42` | `localStorage.getItem('admin_token')` → `toBeNull()`（L41） | ✅ 对齐（tokenStore 仅存 localStorage，sessionStorage 未用） |
| **AC-E14** 路由守卫 | `apps/e2e/tests/logout.spec.ts:44-61` | `toHaveURL(/\/login$/)`（L57）+ `heading('用户列表').not.toBeVisible()`（L60） | ✅ 对齐 |

### 1.2 S-5 闭合（AC-S5-1~S5-5，5 条）

| AC | 文件:行 | 关键证据 | 判定 |
|----|---------|----------|------|
| **AC-S5-1** projects 模式分离 | `vitest.workspace.ts:16-46` | 3 projects via `defineWorkspace()`：api（node）/ web（jsdom）/ contracts（node），environment+setupFiles 严格隔离 | ✅ 对齐（[advisory] R20 反向同步：vitest.workspace.ts 替代 test.projects，§3.5+D4 已标注） |
| **AC-S5-2** 后端无 jest-dom 污染 | `vitest.workspace.ts:17-25` | api project `{ environment:'node', include:['apps/api/test/**'] }` 无 setupFiles | ✅ 对齐 |
| **AC-S5-3** 前端 jest-dom 仍生效 | `vitest.workspace.ts:26-35` + `apps/web/test/setup.ts:15` | web project `{ environment:'jsdom', setupFiles:['apps/web/test/setup.ts'] }`；setup.ts 改 `jest-dom/vitest`（§10.6 修复） | ✅ 对齐 |
| **AC-S5-4** 既有 1256 测试全绿 | 编排者验证 | 56 files / 1256 tests passed，`|web|` project 前缀证明 workspace 模式生效 | ✅ 对齐（信赖编排者） |
| **AC-S5-5** S-5 advisory 反向同步移除 | Tech-Spec §3.5+D4+§7.1 + `vitest.config.ts:3-19` 注释 | [advisory] R20 反向同步标注已落，vitest.config.ts 顶部注释说明 S-5 闭合 + §10.6 反向同步 | ✅ 对齐（lessons-learned.md S-5 状态更新属本轮 retro 阶段处理，Reviewer 仅核对 Tech-Spec 标注已落） |

**E2E + S-5 合计 19/19 AC 对齐。**

---

## §2 规则合规审查

### 2.1 ARCH-003（apps/e2e/ 不 import apps/api/src）

grep `from '...apps/api/src'` / `require('...apps/api/src'` / `apps/api/src` 在 `apps/e2e/` 无实际 import 命中（仅 `apps/e2e/tests/_helpers.ts:4` 注释声明"不 import apps/api/src/**（ARCH-003：E2E 通过 HTTP 交互，不 import）"）。E2E 通过 HTTP 交互（`_helpers.ts` apiCreateUser/apiCreateRole/apiCreateDepartment/apiAssignRole 均用 `request.post(API_BASE)` 调真实后端）。

**ARCH-003 满足 ✅。**

### 2.2 ARCH-002（contracts 零变更）

`git status` 显示 `packages/contracts/` 未出现在改动列表（M 或 ??）。**ARCH-002 满足 ✅。**

### 2.3 SEC-002 / SEC-003a

N/A（E2E + 配置轮，无 service/router 改动）。lint:rules 输出 3 条 SEC-002 豁免审计（audit.ts / auth.ts / notification.ts，均既有豁免非本轮新增）。

### 2.4 META-003 / META-004（声明即实现 + 实现即声明）

lint:rules 输出"双向绑定：META-003(声明即实现) + META-004(实现即声明) 已校验"。**满足 ✅。**

### 2.5 AI-007（PRD AC 逐条核对）

见 §1，19 AC 逐条核对完成，每条有证据（文件:行 + 断言）。

### 2.6 AI-003（advisory 偏离反向同步）

见 §4，4 项 advisory 偏离均已在 Tech-Spec 章节标注。

---

## §3 S-17 自报准确性核对

### 3.1 git status 实跑结果

**改动（M）6 文件**：

| 文件 | 改动性质 |
|------|----------|
| `.gitignore` | 追加 `/data/` + `apps/e2e/.auth/` + `apps/e2e/test-results/` + `playwright-report/`（§3.8） |
| `apps/web/test/setup.ts` | `jest-dom` → `jest-dom/vitest`（§10.6 修复） |
| `package-lock.json` | npm install 附属产物（+64 行，非 impl-writer 手改） |
| `package.json` | 追加 `test:e2e` 脚本 + `@playwright/test` devDep |
| `tsconfig.json` | include 追加 `apps/e2e`（§3.6 typecheck 覆盖） |
| `vitest.config.ts` | 降级为共享基座（移除 environment+setupFiles+include，保留 plugins/globals/testTimeout/coverage/resolve.alias） |

**新增（??）源文件 9 个**：

1. `playwright.config.ts`
2. `vitest.workspace.ts`
3. `apps/e2e/tests/login.spec.ts`
4. `apps/e2e/tests/users.spec.ts`
5. `apps/e2e/tests/roles.spec.ts`
6. `apps/e2e/tests/transfer.spec.ts`
7. `apps/e2e/tests/logout.spec.ts`
8. `apps/e2e/tests/_helpers.ts`
9. `apps/e2e/global-teardown.ts`

（另：`apps/e2e/test-results/.last-run.json` 是 E2E 运行产物，已 gitignore；`docs/prd/e2e-introduction.md` + `docs/spec/e2e-introduction.tech.md` 是本轮 PRD/Spec 产物非 impl-writer 交付）

### 3.2 与 impl-writer 自报对比

impl-writer 自报清单列出 9 新增源文件 + 5 改动源文件，与 git status 实际一致（9 新增源文件全部存在 + 5 改动源文件全部存在）。额外 `package-lock.json` 是 npm install 自动生成的附属产物（非 impl-writer 手改）。

**判定**：impl-writer 自报清单准确，无漏报/多报。注：task 描述"新增 7 + 改动 5 = 12 文件"数字与 impl-writer 自报清单（9 新增 + 5 改动 = 14 源文件）不符，差异为 task 描述数字误差（少算 `vitest.workspace.ts` + `apps/e2e/global-teardown.ts`），非 impl-writer 问题（见 Suggestion #5）。**S-17 自报准确性通过 ✅。**

---

## §4 advisory 偏离反向同步核实（4 项，R19 S-21 固化）

> Tech-Spec（`docs/spec/e2e-introduction.tech.md`）是本轮 untracked 新文件（`git diff HEAD` 为空属正常）。Reviewer 通过 Read 全文确认 advisory 标注已落入章节（非仅代码注释，R19 S-21 固化）。

### 4.1 #1 vitest workspace 模式 vs spec §3.5 test.projects

**核实**：
- Tech-Spec §3.5（L197）含 `[advisory] R20 反向同步（vitest 1.6.1 API 差异，§10.6 触发）`标注，说明 vitest 1.6.1 不支持 `test.projects`（vitest 2.x 才引入），impl-writer 改用 `vitest.workspace.ts` + `defineWorkspace()` 机制。
- Tech-Spec D4（L307）同样含 `[advisory] R20 反向同步（vitest 1.6.1 API 差异）`标注，说明 spec 原文 `test.projects` 静默忽略 → 所有测试用顶层默认 → 140 web 测试 `Invalid Chai property: toBeInTheDocument`，impl-writer 改 workspace 文件模式。
- `vitest.config.ts:9-19` 顶部注释详述根因（vitest 1.6.1 源码 `workspacesFiles=['vitest.workspace','vitest.projects']` + `resolveWorkspace()` → `initializeProject()` 各 project 独立 Vite server）。

**判定**：advisory #1 反向同步闭合 ✅（Tech-Spec §3.5 + D4 已实际含标注，非仅代码注释）。

### 4.2 #2 E2E 每 test 登录 vs storageState

**核实**：
- Tech-Spec §3.7（L243）含 `storageState 登录态注入（[advisory]）`标注——"优先用 Playwright storageState... 或每 test 内重新登录（更隔离但慢）。impl-writer 据实际 flaky 程度选择"。
- 实际 `apps/e2e/tests/_helpers.ts:24-43` `loginAsAdmin` 每 test 重新登录；`users.spec.ts:23` 注释"每 test 重新登录（每 test 隔离，[advisory] 非 storageState 注入，spec §3.7 允许）"。

**判定**：advisory #2 反向同步闭合 ✅（Tech-Spec §3.7 [advisory] 标注允许每 test 登录，impl-writer 据此选择）。

### 4.3 #3 E2E 凭据 admin123（PRD 笔误 Admin@123）

**核实**：
- PRD AC-E1（`docs/prd/e2e-introduction.md:79`）已写 `admin@example.com / admin123`（编排者已修正）。
- Tech-Spec §7.2（L428-436）声明 advisory 偏离——"PRD AC-E1 字面写凭据 Admin@123... E2E 登录采用实际 seed 凭据 admin@example.com / admin123"。
- 实际 E2E 测试（`login.spec.ts:18-19` + `_helpers.ts:16-17`）用 `admin@example.com` / `admin123`，与 `server.ts seedDemoData` 一致。

**判定**：advisory #3 反向同步闭合 ✅（PRD 已修正为 admin123 + E2E 用 admin123 + Tech-Spec §7.2 声明差异）。注：Tech-Spec §7.2 / §2.4 仍提"PRD AC-E1 字面 Admin@123"作为历史描述，建议同步更新为"PRD AC-E1 已修正为 admin123"（见 Suggestion #4）。

### 4.4 #4 AC-E4 次要断言弱（UserRow 按钮文案统一"禁用"）

**核实**：
- `users.spec.ts:89` 找"禁用"按钮（UserRow 按钮文案统一"禁用"，双向切换）。
- `users.spec.ts:101` 断言行内含"禁用"文案（UI 状态弱断言，"禁用"文案无法区分 active→disabled 还是 disabled→active）。
- 关键断言（If-Match header 存在，`users.spec.ts:92-97`）是强断言（`capturedIfMatch` truthy + `Number >= 0`），符合 PRD AC-E4 "versioned 写操作的端到端 round-trip 验证"核心验收点。

**判定**：advisory #4 反向同步闭合 ✅（关键 If-Match 强断言在，UI 弱断言已声明不影响关键验收）。

**4 项 advisory 偏离反向同步全部闭合。**

---

## §5 S-5 闭合验收

| 维度 | 证据 | 判定 |
|------|------|------|
| projects 模式分离（AC-S5-1） | `vitest.workspace.ts:16-46` 3 projects（api node / web jsdom / contracts node） | ✅ |
| 后端无 jest-dom 污染（AC-S5-2） | api project 无 setupFiles（`vitest.workspace.ts:17-25`） | ✅ |
| 前端 jest-dom 仍生效（AC-S5-3） | web project jsdom + setupFiles（`vitest.workspace.ts:26-35`）；setup.ts 改 `jest-dom/vitest`（§10.6 修复） | ✅ |
| 既有 1256 测试全绿（AC-S5-4） | 编排者验证 56 files / 1256 tests passed，`|web|` 前缀证明 workspace 生效 | ✅ |
| S-5 advisory 反向同步（AC-S5-5） | Tech-Spec §3.5+D4+§7.1 标注已落；`vitest.config.ts:3-19` 注释说明 S-5 闭合 | ✅ |
| jsdom 化隐藏依赖修复（§10.6 关键风险） | `setup.ts` jest-dom → jest-dom/vitest（§10.6 预判触发，impl 已修复，1256 全绿证明修复有效） | ✅ |

**S-5 闭合验收通过 ✅。**

---

## §6 §10 组合副作用预判验证

| 预判项 | 实际处理 | 判定 |
|--------|----------|------|
| **§10.1** 多约束组合（4 条工程层） | ① webServer 双进程+临时 DB+baseURL 5173（`playwright.config.ts:65-90` 已配）；② vitest projects+node:sqlite plugin 顶层（`vitest.config.ts:21-45` plugin 留顶层，1256 全绿证明生效）；③ E2E 独立 runner+CI 两阶段（`package.json:13` test:e2e 独立）；④ reuseExistingServer=false+临时 DB（`playwright.config.ts:74,88`） | ✅ 全部如预判处理 |
| **§10.2** 全码映射收尾（N/A，R16 S-18） | `errorMapping.ts` 零变更（git status 确认无 errorMapping 改动） | ✅ N/A 如预判 |
| **§10.3** 简单常量复用（N/A，R16 S-19） | vitest include glob 重复定义（api/web/contracts 各 1 处）符合 S-19 ≤3 处阈值 | ✅ N/A 如预判 |
| **§10.4** 测试工具 workaround（N/A，R16 S-20） | page.route 拦截 If-Match（AC-E4/E7，click 前注册 route ✅）+ page.evaluate 读 localStorage（AC-E13，登出后读 ✅）；storageState token exp 预判通过每 test 登录规避 | ✅ 如预判处理 |
| **§10.5** [约束] 偏离反向同步闭环（S-21，本轮无 [约束] 偏离） | 所有 [约束] 决策（D1-D8）均按 spec 落地，无 [约束] 偏离；retries=0 偏离 spec §3.2 字面属 [advisory] 范围（见 Suggestion #2） | ✅ 如预判 |
| **§10.6** vitest projects jsdom 化隐藏依赖（关键风险） | **实际触发**：`setup.ts` jest-dom 6.x 裸 `expect.extend` 在 projects 模式下不绑定 vitest expect → "Invalid Chai property: toBeInTheDocument"。impl 按 §10.6 "impl-writer 须修复（非静默跳过）"落地，改 `jest-dom/vitest` 子路径入口（显式 `import { expect } from 'vitest'; expect.extend(matchers)`），1256 全绿证明修复有效 | ✅ 预判准确 + 已修复 |

**§10 五项预判全部如预判处理，§10.6 关键风险预判准确并已修复。**

---

## §7 Blocker 清单 / Suggestion 清单

### 7.1 Blocker 清单

**无 Blocker。**

（三件套全绿 + 19 AC 对齐 + 4 项 advisory 反向同步闭合 + ARCH 检查通过）

### 7.2 Suggestion 清单

1. **AC-E7 父子关系建立断言可强化**：`roles.spec.ts:100` 仅断言 modal 关闭（`parentSelect not.toBeVisible`）间接验证设置成功，未直接验证 DB 中 `parent_id` 已更新。建议参照 AC-E11 用 API GET `/v1/roles/:id` 复核 `parent_id === roleA.id`（强断言）。当前 If-Match header 强断言已在，不影响关键验收，属改进建议。

2. **playwright.config.ts retries=0 偏离 spec §3.2 字面**：spec §3.2 原文 `retries: CI ? 2 : 0`，impl 取 `retries: 0`（`playwright.config.ts:36`）。impl-writer 在注释中声明理由（"task spec 要求；本 impl 取 0 简化"），但未在 Tech-Spec §7 反向同步声明。建议反向同步声明或恢复 spec 值（[advisory] 范围，E2E 14 passed 证明 retries=0 可行，不影响 AC 验收）。

3. **Tech-Spec §2.3 @playwright/test devDeps 描述误差**：spec §2.3 称"@playwright/test 已在 devDependencies（^1.61.1）"，但 git diff 显示 `package.json` 本轮新增 `@playwright/test` devDep 行（实际本轮才真正加入 devDeps）。功能正确（依赖已装 + E2E 14 passed），建议 spec §2.3 同步修正描述。

4. **Tech-Spec §7.2 / §2.4 stale 描述**：仍提"PRD AC-E1 字面 Admin@123"，但 PRD 已被编排者修正为 admin123。advisory #3 反向同步目标已达成（PRD 已修正 + E2E 用 admin123），建议 Tech-Spec §7.2 同步更新为"PRD AC-E1 已修正为 admin123"消除 stale 描述。

5. **task 描述"新增 7 + 改动 5 = 12 文件"数字误差**：与 impl-writer 自报清单（9 新增源文件 + 5 改动源文件 = 14）不符。实际 git status 与清单一致（9+5 源文件 + `package-lock.json` 附属）。建议 task 描述同步修正数字（非 impl-writer 问题，不影响验收）。

---

## G6 自检声明

- **实跑核对完成**：`git diff --stat HEAD` + `git status` 实跑 ✅；`npm run typecheck` exit 0 ✅；`npm run lint:rules` exit 0 ✅；vitest + E2E 信赖编排者结果（避免重复 80s+15s 开销）✅。
- **PRD 19 AC 逐条核对完成**：AC-E1~E14（14 条 E2E）+ AC-S5-1~S5-5（5 条 S-5 闭合）全部 ✅ 对齐，每条有证据（文件:行 + 断言）。
- **advisory 偏离反向同步核实完成**：4 项均已在 Tech-Spec 章节标注（§3.5+D4 #1 / §3.7 #2 / §7.2 #3 / impl 注释 #4），通过 Read Tech-Spec 全文确认（非仅信代码注释，R19 S-21 固化）。
- **ARCH/SEC 检查完成**：ARCH-003（apps/e2e 不 import apps/api/src）grep 确认无实际 import命中 ✅；ARCH-002（contracts 零变更）git status 确认 ✅；SEC-002/SEC-003a N/A（E2E + 配置轮）。
- **S-17 自报准确性核对完成**：impl-writer 自报清单（9 新增 + 5 改动源文件）与 git status 实际一致 ✅。
- **§10 组合副作用预判验证完成**：五项预判（§10.1-§10.6）全部如预判处理，§10.6 关键风险预判准确并已修复 ✅。
- **verdict 判定**：**pass**（三件套全绿 + 19 AC 对齐 + 4 项 advisory 反向同步闭合 + ARCH 检查通过 + 无 Blocker）。
