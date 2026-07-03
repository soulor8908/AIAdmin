---
doc_type: Retrospective
id: RETRO-ROUND12-001
scope: 第十二轮演练（前端首轮：登录页 + 用户列表页列表/创建/启停 + 前端基础设施 + ARCH-003 校验落地）
date: 2026-07-03
verdict: 跑通；ARCH-003 闭合；wire 适配 advisory 范例；多约束组合副作用预判首次大规模验证
---

# 第十二轮演练复盘 · 前端首轮（登录页 + 用户列表页）+ ARCH-003 跨层只经契约机器化闭合

## 0 · 本轮目标与结果

1. 落实 R11 retro §6 第⑤项"前端引入（验证 ARCH-003 跨层只经契约）"——本期首次引入 **apps/web** 前端 → ✅ 登录页（F1）+ 用户列表页（F2 列表/F3 创建/F4 启停）+ 前端基础设施（F5 API client + F6 路由守卫 + F7 错误处理）落地
2. 验证 ARCH-003「跨层只经契约」从 `[预留]` 落地为机器化 enforcement（R1-R11 唯一未机器化规则）→ ✅ check-rules.mjs 新增 ARCH-003 分支（walkWeb 扩展 .tsx + 三条禁止规则 + 探针验证）+ layering.md 校验方式更新，META-003/META-004 双向绑定闭合
3. 验证跨层契约消费（z.infer 派生 + Zod schema 复用 SSOT）→ ✅ apps/web 全部类型经 z.infer 从 @admin/contracts 派生，登录/创建表单复用 loginInputSchema/createUserInputSchema 的 safeParse
4. 验证真实鉴权链路端到端在浏览器侧闭合（AI-007）→ ✅ 登录→存 token→Bearer 注入→路由守卫→401 拦截跳登录全链路
5. 验证零新依赖精神延伸到前端 → ✅ 原生 fetch（无 axios）+ react-router-dom（必要第三方）+ React Context（无 Redux）+ CSS Modules（无 UI 框架）+ Vitest/Testing Library（与后端同栈）

**结果速览**：typecheck ✅ / lint:rules ✅（ARCH-003 enforcement 生效，META-003/META-004 闭合）/ vitest ✅ 883/883（web 50 + api 833 无回归）/ AC 对齐 47/48（功能 44/44 + ARCH-003 专项 3/4，AC-ARCH-4 partial）/ blocker 0 / suggestion 7 / 新增源码 apps/web/src 14 文件 + check-rules.mjs ARCH-003 分支 + layering.md 更新 / 不改后端（apps/api + packages/contracts 冻结）/ 不改测试断言（impl-writer 报告 git diff test/ 为空）。

## 1 · 本轮核心验证结论

### 1.1 ARCH-003 从 `[预留]` 到机器化 enforcement 闭合（R12 最大验证点）

ARCH-003「跨层只经契约」自立项起即声明"前端只能通过 router 调用，类型来自 @admin/contracts；禁止直连 repository"，但校验方式长期标注 `[预留]`——因为 apps/web 不存在，无法落地专属 enforcement。**这是分层依赖规则体系 R1-R11 唯一未机器化的规则**：ARCH-001/002 自 R2 起已机器化（check-rules.mjs 扫描 apps/api 与 contracts），唯独 ARCH-003 仅靠人工 Review。本轮首次引入前端，闭合此最大未验证缺口。

| 维度 | R1-R11（apps/web 不存在） | R12（前端首引入） |
|---|---|---|
| ARCH-003 校验方式 | `[预留]`（无 apps/web，无专属 enforcement） | **check-rules.mjs ARCH-003 分支**（walkWeb 扩展 .tsx + 三条禁止规则） |
| 扫描范围 | N/A | apps/web/src/**/*.{ts,tsx} 的 import 语句 |
| 禁止规则 | N/A | ① `^@admin/api\b` ② `api/src/` 子串 ③ `^apps/api\b` |
| META-003（声明即实现） | 不触发（校验方式标 [预留]） | **闭合**（layering.md 含 `check-rules.mjs ARCH-003 分支` 措辞 ↔ 脚本 markEnforcement('ARCH-003')） |
| META-004（实现即声明） | 不触发 | **闭合**（脚本 markEnforcement ↔ layering.md ## ARCH-003 块） |
| 合规验证 | 人工 Review | **逐文件核对 0 违规 + 探针验证真报错 + 基线 exit 0** |

**结论**：ARCH-003 机器化 enforcement 首次落地成功——Reviewer 逐文件核对 apps/web/src 14 文件 import 全部仅来自 @admin/contracts + 第三方（react/react-dom/react-router-dom）+ apps/web 内部相对模块，0 处 apps/api/src/** 或 @admin/api 实际引用（4 处 grep 命中均为 [约束] ARCH-003 注释）；投放探针 `import ... from "../../../apps/api/src/repository/user.js"` 验证扫描器报 `ARCH-003 违规` exit≠0，删除探针后基线干净 exit 0。META-003/META-004 双向绑定闭合（lint:rules 输出"双向绑定：META-003(声明即实现) + META-004(实现即声明) 已校验"）。**R12 最大未验证缺口闭合**——前 11 轮 ARCH-001/002 已机器化，唯独 ARCH-003 因 apps/web 不存在而 [预留]，本轮闭合。

### 1.2 wire 格式适配作为 advisory 偏离的范例（D10）

**问题**：contracts `errorResponseSchema` 字段名 `code`，但后端 server.ts L594 实际 wire 响应体字段名为 `error`（`{ error: <code>, message, current_version? }`），二者不一致（后端历史遗留）。另 server.ts L562-566 VALIDATION_ERROR 响应额外带 `issues` 字段（contracts 未声明）。

**适配设计**（Q11 决策①，前端解析层隔离历史遗留）：
- API client `parseErrorResponse` 读 wire `error` 字段 → `errorCodeSchema.safeParse`（contracts SSOT 校验）→ 映射为 contracts `code` 字段，对外暴露 `ErrorResponse` 类型（contracts 派生）
- `message` 与 `current_version` 字段名 wire 与 contracts 一致，无需重命名；仅 `error→code` 一处适配
- `issues` 等额外字段被丢弃（不 strict-parse wire body，避免 .strict() 拒绝）
- **前端业务代码（pages/components）只接触 ApiError（contracts 派生类型），不感知 wire 字段名 `error`**（ARCH-003 类型来自 contracts）

**结论**：这是 [advisory] 偏离机制的正向案例——适配层隔离后端历史遗留，不改后端、不改 contracts，前端业务代码零感知 wire 差异。AI-003 advisory 偏离须反向同步 Spec，Tech-Spec §4.6 + D10 [advisory] 已明确记录此适配，并标注"未来后端对齐字段名（server.ts `error`→`code`）可消除此适配层，届时改 `errorResponseSchema.parse(body)` 直校"。**advisory 偏离机制的范例**：隔离历史遗留 + 标注消除路径 + 不阻塞当前交付。

### 1.3 GET /v1/users/:id 端点不存在 → 409 current_version 重试（D9+D19，R10 S-2 教训再次生效）

**现象**：PRD AC-F4-3 字面"API client 自动 GET 最新 user 取 version=N+1，用新 version 重试 PATCH 一次"。但 Tech-Spec §1.2 核验既有路由表（server.ts routes 数组 L221~L374）发现：用户域仅 `GET /v1/users`（列表）、`POST /v1/users`（创建）、`PATCH /v1/users/:id/status`（状态更新）、`POST /v1/users/:userId/transfer`（调岗），**无 `GET /v1/users/:id` 单条详情端点**。

**Spec 纠正**（D19 [advisory]）：PRD AC-F4-3 字面"GET 最新 user"无法落地。但 server.ts L594-595 错误响应合并 `e.meta`，VERSION_CONFLICT 的 409 响应体已含 `current_version`（对齐 TECH-OPTIMISTIC-LOCKING-001 D13 + contracts `errorResponseSchema.current_version`）。故 API client 直接从 409 响应体读 `current_version` 重试，无需 GET。语义不弱化（重试仍 1 次、仍用最新 version）。

**结论**：这是 Spec 阶段核验既有路由表（R10 S-2 教训）再次生效的范例——Spec 纠正 PRD 估算。R10 S-2 教训"BA 起草 PRD 涉及既有端点须核验路由表"在 R11 已生效（PRD 估算 5 个 embedding 受影响，Spec 精确 grep 纠正为 2 个），本轮再次生效：PRD AC-F4-3 假设 GET /v1/users/:id 存在，Spec §1.2 核验发现端点不存在，改用 409 body current_version 重试。**证明"Spec 是 SSOT，PRD 估算可被 Spec 纠正"的分层**。

### 1.4 多[约束]组合副作用预判 4 条全部正确实现（Spec 模板 §10 首次大规模验证）

Tech-Spec §10 预判的 4 条多[约束]组合副作用，impl-writer 全部正确规避：

| # | 组合 | Spec §10 预判 | 实现核查 | 结论 |
|---|---|---|---|---|
| 1 | 401 拦截（D8）+ 409 重试（D9） | 重试响应若 401 须先判 401 拦截终止重试链，不误当冲突；impl 须保证 status===401 分支先于 status===409 | client.ts 响应处理顺序：204 → 401（L179）→ 409（L195）→ 200（L207）。**401 分支先于 409** ✅。重试 doRequest(isRetry=true) 响应再走分支：401 仍拦截，409 不再重试（!isRetry=false） | ✅ 正确 |
| 2 | wire 适配（D10）+ 401 拦截（D8） | 401 响应体也用 wire `error`，须先 wire 适配取 code 再判拦截；401 解析失败（非 JSON/缺 error）须降级 UNAUTHORIZED 行为跳登录，不白屏 | 401 → safeReadJson（解析失败返回 {}）→ parseErrorResponse（解析失败 code='INTERNAL_ERROR'）→ 视为鉴权失败跳登录。**解析失败降级跳登录** ✅，不白屏 | ✅ 正确 |
| 3 | 乐观锁重试（D9）+ 列表刷新 | 重试成功后列表须刷新取最新 version，否则下次同用户操作又用旧 version 触发 409 | UserListPage updateUserStatus 成功（含 client 透明重试成功）→ refresh() 重新 listUsers 取最新 version ✅ | ✅ 正确 |
| 4 | tokenStore（D12）+ 并发 401 | 401 拦截清 token 后并发请求也可能 401 重复跳 /login；MVP 接受重复跳转（幂等）；impl 可加"已跳转"标志位防重复（advisory 不强制） | 每次 401 拦截均 clearToken + redirectToLogin（window.location.href='/login'）。无"已跳转"标志位。window.location.href 幂等（重复设置同值无害）✅。advisory 项未实现，可接受 | ✅ 正确（advisory 项可接受） |

**结论**：这是 Spec 模板 §10"多[约束]组合副作用预判"机制首次大规模验证生效。R11 token 确定性碰撞 bug 是组合副作用的反面案例（Spec 未预判，端到端测试才暴露），R12 4 条组合副作用全部预判 + 全部正确实现，证明 §10 组合副作用预判机制从"被动暴露"升级为"主动预判"。组合 #1（401 先于 409）+ #2（401 解析失败降级）是关键正确性保证，实现均满足。

### 1.5 零新依赖精神延伸到前端

对齐后端"零新 HTTP 框架"精神（R1-R11 后端用 Node 内置 http + 原生 fetch），前端本轮零新依赖精神延伸：

| 维度 | 后端（R1-R11） | 前端（R12） |
|---|---|---|
| HTTP | 原生 Node http | **原生 fetch + URLSearchParams**（无 axios/ky） |
| 路由 | 自建 router | **react-router-dom**（必要第三方） |
| 状态 | 无（无状态 service） | **React Context + 本地 useState**（无 Redux/Zustand） |
| 测试 | Vitest | **Vitest + Testing Library**（与后端同栈） |
| 样式 | N/A | **CSS Modules / 内联样式**（无 antd/MUI 等 UI 框架） |
| 校验 | Zod（contracts SSOT） | **Zod 复用 contracts**（无重复校验库） |

**结论**：零新依赖精神从前端延伸落地。package.json dependencies 仅 @admin/contracts + react + react-dom + react-router-dom；devDependencies 仅 testing-library + jsdom + vite + vitest。无 axios/ky/Redux/Zustand/UI 框架。react-router-dom 是必要第三方（路由库无法用原生替代），符合"零新依赖精神"而非"零依赖绝对化"。

## 2 · 本轮新发现的问题（S 级，不阻断）

### S-1 · AC-ARCH-4 partial（F4 toggle 未调 schema.safeParse）

**现象**：AC-ARCH-4 要求"前端表单校验复用 contracts Zod schema"，但 UserListPage 的启停按钮 toggle 状态更新未调 `updateUserStatusInputSchema.safeParse`。Reviewer 判 partial——因 newStatus 经类型派生（`user.status==='active'?'disabled':'active'`，UserStatus 字面量联合）无自由文本输入，schema 运行时校验逻辑冗余（safeParse 在 type-safe 值上为 no-op）。loginInputSchema.safeParse（LoginPage）+ createUserInputSchema.safeParse（CreateUserModal）已正确复用。

**根因**：AC-ARCH-4 措辞"全部表单"未区分"自由文本表单"与"类型派生 toggle"。后者经 TS 类型系统保证（newStatus 类型为 UserStatus，编译期保证 ∈ {active,disabled}），schema 运行时校验冗余。Spec §3.2 列 F4 用 updateUserStatusInputSchema.safeParse 但实现未调，impl-writer 也未显式标注此 [约束] 偏离。

**反推优化**：Spec 模板须区分"自由文本表单（须 safeParse，因有自由输入）"与"类型派生操作（TS 类型保证，schema 校验冗余但可保留 defensive）"。AC 措辞须精确——"表单校验复用"应限定为"自由文本输入表单"。impl-writer 若对类型派生操作不调 safeParse，须显式标注 [约束] 偏离 + 反向同步 Spec §3.2。

### S-2 · advisory 偏离反向同步未闭环（3 项 UI 文案未同步 Spec）

**现象**：impl-writer 自报 5 项 advisory 偏离，其中 wire 适配（D10）、409 不 GET（D19）在 Spec 已记录；但 3 项 UI 文案调整未反向同步 Spec §10：
- UserRow 按钮文案统一"禁用"（spec §6.2 字面"启用/禁用按钮"，实现单按钮文案"禁用"，父组件双向切换；原因：测试 matcher 单匹配约束）
- CreateUserModal name 错误文案"姓名不能为空"（AC-F3-4 字面"姓名必填"；原因：测试 findByText(/必填|请输入/i) 须单匹配，email "邮箱必填"已匹配）
- UserListPage select option "已激活"/"已停用"（value 为 contracts UserStatus，文案中文化）

**根因**：AI-003 advisory 偏离须反向同步 Spec，但"文案调整"这类纯 UI 文案偏离是否须同步 Spec §10 未明确——Spec §6 是 [advisory] 实现提示，文案不在 [约束] 范围。impl-writer 未判断"文案偏离是否须同步"，导致 3 项遗漏。

**反推优化**：Spec 模板须明确"UI 文案偏离属 advisory 实现提示，不须反向同步 Spec §10（因 §6 本就是 advisory）"；但若文案涉及 AC 验收（如测试断言文案、AC 字面文案），须在 Review 报告记录。impl-writer 提示词须增加"advisory 偏离反向同步边界：行为/数据/schema 偏离须同步 Spec §10；纯 UI 文案偏离不须同步但须在交付报告列出"。

### S-3 · 测试覆盖缺口（4 项 AC 边界未单测）

**现象**：Reviewer 发现 4 项测试覆盖缺口（实现正确但缺直接测试断言）：
- AC-F2-4（筛选+分页复合）：实现 useEffect 保留 statusFilter 翻页正确，但测试仅分别测筛选（F2-3）与分页（F2-2），未组合断言 `listUsers({page:2,pageSize:20,status:'disabled'})`
- AC-F3-3（CreateUserModal 邮箱格式非法）：仅测空提交（invalid_type），未测非法格式（如 "abc"→"邮箱格式不正确"）
- AC-F4-2（启用成功 disabled→active）：仅测 active→disabled，未测反向
- AC-F6-2（登出跳转）：未点击登出按钮断言 logout action（route-guard 测登出后态 F6-3，未测 logout action 本身）

**根因**：test-writer 按 §9 清单写 6 文件 50 用例，但部分 AC 边界未单独覆盖。test-writer 未做"AC 覆盖矩阵自检"——每条 AC 是否有至少 1 个测试用例直接覆盖。

**反推优化**：test-writer 提示词增加"AC 覆盖矩阵自检——每条 AC 须有至少 1 个测试用例覆盖，未覆盖的显式列出 reason（如'实现正确但缺直接测试'）"。或在 Tech-Spec §9 增加"AC↔测试用例覆盖矩阵"表，显式标注每条 AC 的测试文件+用例号。

### S-4 · CODE 扫描器前端覆盖盲区

**现象**：Reviewer 发现 CODE-001~004 扫描器（check-rules.mjs）的 `allTs`（L23-27）仅收集 packages/contracts/src + apps/api/src + apps/api/test，**不含 apps/web/src 与 apps/web/test**。故 CODE-001（禁 any）/CODE-002（禁空 catch）/CODE-003（禁 eval）/AI-005（SSOT 派生）/SEC-003a/ARCH-001/002 扫描器均未覆盖前端（仅 ARCH-003 专属分支经 walkWeb 覆盖 apps/web/src）。本轮 Reviewer 已手动 grep 核对前端合规（0 any / 0 eval / catch 有语义 / SSOT 派生）。

**根因**：既有 CODE 扫描器按 apps/api 目录扫描（前 11 轮 apps/web 不存在），本轮新增 apps/web 但仅扩展了 ARCH-003 专属分支（walkWeb），未将 apps/web 纳入 allTs 通用扫描范围。前端命名/禁用模式违规无机器校验。

**反推优化**：CODE 扫描器扩展到 apps/web——walkWeb 已有（ARCH-003 分支已实现），复用即可：将 allTs 扩展为含 apps/web/src + apps/web/test，使 CODE-001/002/003/AI-005 等通用扫描器覆盖前端。或新增 CODE-005"前端命名规则"。非 blocker（ARCH-003 已覆盖跨层核心 + 手动核对合规）。

### S-5 · setupFiles 全局副作用（test-writer advisory）

**现象**：vitest.config.ts setupFiles 加 apps/web/test/setup.ts（import @testing-library/jest-dom），对全部测试文件（含后端 node 环境）生效。当前安全（仅追加 matcher，无破坏性副作用），但若后续后端测试环境变更需注意。

**根因**：vitest setupFiles 是全局的，无法按 project/environment 隔离（除非用 vitest projects 模式分离 node/jsdom 配置）。

**反推优化**：advisory——未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离 node/jsdom 配置（独立 vitest.config.web.ts）。本期不阻断（当前安全，仅追加 matcher）。

## 3 · 量化对比（十二轮演进表）

| 指标 | R1 | R5 | R7 | R9 | R10 | R11 | R12 |
|---|---|---|---|---|---|---|---|
| 用例数 | 35 | 404 | 537 | 653 | 697 | 778 | **883**（api 833 + web 50） |
| 累计用例 | 35 | 404 | 537 | 653 | 697 | 778 | **883** |
| blocker | 1 | 2(修复0) | 0 | 0 | 0 | 0 | **0** |
| suggestion | 6 | 7 | 2 | 2(impl闭合) | 0 | 3(impl闭合) | **7** |
| Reviewer verdict | pass | blocker→pass | pass | pass | pass | pass | **pass** |
| AC 对齐 | N/A | N/A | 16/16 | 18/18 | 17/17 | 23/23 | **47/48**（AC-ARCH-4 partial） |
| 受影响清单 | 无 | ①类遗漏 | ①②类 | ①②③类 | ①②零+③类 | ①②③（①类二次遗漏） | **①②零影响+③类6文件**（契约冻结+apps/web全新） |
| 影响层 | 全栈 | 全栈 | 全栈 | 全栈 | 单层 | 运行时入口层+新域 | **前端新增层+规则脚本**（后端冻结） |
| 新架构模式 | 单步CRUD | 跨域埋点 | 多步事务 | HTTP写条件 | HTTP读条件 | 安全域+token验签 | **前端+ARCH-003机器化+wire适配** |
| ARCH-003 状态 | [预留] | [预留] | [预留] | [预留] | [预留] | [预留] | **闭合（机器化 enforcement）** |
| 前端 | 无 | 无 | 无 | 无 | 无 | 无 | **首引入**（登录+列表+创建+启停，50用例） |
| SEC 验证 | mock | mock | mock | mock | mock | 首次真实 | 前端延伸（SEC-003b password/token 不入日志） |

> R12 用例数 883 = api 833（后端冻结，无回归）+ web 50（前端新增 6 文件）。后端 833 用例基线在本轮前端引入前已达稳态，R12 不改后端。

## 4 · 十二轮演进脉络

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
- **第十二轮**：**前端首轮**（登录页 + 用户列表页 + 前端基础设施），验证 **ARCH-003 跨层只经契约从 [预留] 到机器化 enforcement 闭合**（R1-R11 唯一未机器化规则闭合），wire 适配 advisory 范例（D10），409 current_version 重试纠正 PRD（D19，R10 S-2 教训再次生效），**多约束组合副作用预判首次大规模验证**（4 条全部正确实现），零新依赖精神延伸到前端

## 5 · 反推优化（rules / spec / 提示词）

### 5.1 规则层优化（反推到 .trae/rules/）

1. **CODE 扫描器扩展到 apps/web**（S-4 根因修复）：`check-rules.mjs` `allTs`（L23-27）当前仅收集 packages/contracts/src + apps/api/src + apps/api/test，须扩展含 apps/web/src + apps/web/test。walkWeb 已有（ARCH-003 分支已实现 .tsx 收集），复用即可：将 allTs 改为 `[...walk(contracts), ...walk(api/src), ...walk(api/test), ...walkWeb(web/src), ...walkWeb(web/test)]`，使 CODE-001/002/003/AI-005/SEC-003a 等通用扫描器覆盖前端。或新增 CODE-005"前端命名规则"。
2. **ARCH-003 校验方式已闭合**（本轮已落地，记录闭合状态）：layering.md ARCH-003 校验方式从 `[预留]` 更新为 `check-rules.mjs ARCH-003 分支扫描 apps/web/src/**/*.{ts,tsx}` 机器化描述。R1-R11 唯一未机器化规则本轮闭合，规则机器化覆盖率维持 100%（META-001 强制）。
3. **META 规则双向绑定已闭合**（META-003/META-004 对 ARCH-003 闭合）：layering.md ARCH-003 块含 `check-rules.mjs ARCH-003 分支` 措辞（命中 META-003 claimsExclusive 正则）↔ 脚本 markEnforcement('ARCH-003') 注册（命中 META-004）。lint:rules 输出"双向绑定已校验"。本轮无需新增 META 规则，既有 META-003/004 自动覆盖 ARCH-003。

### 5.2 Spec 模板层优化（反推到 Tech-Spec 模板）

1. **§6 区分"自由文本表单"与"类型派生操作"**（S-1 根因修复）：Tech-Spec §6/§3.2 表单校验复用 Zod schema 须区分两类——
   - **自由文本表单**（如登录 email/password、创建用户 email/name/password）：须 safeParse（因有自由输入，运行时校验必要）
   - **类型派生操作**（如 F4 toggle，newStatus 经 `user.status==='active'?'disabled':'active'` 派生，UserStatus 类型编译期保证）：schema 校验冗余（safeParse 为 no-op），可不调或保留 defensive safeParse
   AC 措辞须精确——"表单校验复用"应限定为"自由文本输入表单"。
2. **§10 advisory 文案同步边界明确**（S-2 根因修复）：Tech-Spec §10 advisory 偏离预判须明确同步边界——
   - **行为/数据/schema 偏离**（如 wire 适配 D10、409 不 GET D19）：须反向同步 Spec §10
   - **纯 UI 文案偏离**（如按钮文案、错误提示文案、select option 文案）：属 advisory 实现提示，不须同步 Spec §10（因 §6 本就是 advisory）；但若文案涉及 AC 验收（如测试断言文案、AC 字面文案），须在 Review 报告记录
3. **§9 测试 AC 覆盖矩阵自检**（S-3 根因修复）：Tech-Spec §9 受影响测试清单须含"AC↔测试用例覆盖矩阵"——每条 AC 显式标注覆盖它的测试文件+用例号，未覆盖的显式列出 reason（如"实现正确但缺直接测试"）。test-writer 据此自检覆盖完整性，Reviewer 据此核对缺口。

### 5.3 提示词层优化（反推到五角色提示词骨架）

#### test-writer subagent 提示词
- 增加："AC 覆盖矩阵自检——每条 AC 须有至少 1 个测试用例直接覆盖，未覆盖的显式列出 reason（如'实现正确但缺直接测试'/'组合场景未单独测'）。交付报告附 AC↔测试用例覆盖矩阵表。"
- 增加："组合场景测试——当 AC 涉及多操作组合（如筛选+分页、启停双向、登出 action），须单独测组合场景，不可仅分别测单一操作后假设组合正确。"

#### impl-writer subagent 提示词
- 增加："advisory 偏离反向同步边界——行为/数据/schema 偏离（如 wire 适配、重试策略变更）须反向同步 Spec §10；纯 UI 文案偏离（按钮文案、错误提示文案、select option 文案）不须同步 Spec §10 但须在交付报告列出。"
- 增加："对类型派生操作（如 toggle，值经 TS 类型派生非自由输入）不调 schema.safeParse 时，须显式标注 [约束] 偏离 + 反向同步 Spec §3.2（注明'类型派生操作，schema 校验冗余'），不可静默偏离。"

#### Reviewer subagent 提示词
- 增加："AC-ARCH-4（表单校验复用 Zod schema）partial 判定依据——须区分'自由文本表单'（须 safeParse，未调判 partial）与'类型派生操作'（TS 类型保证，safeParse 冗余，未调可判合理偏离须补同步）。partial 判定须注明根因（措辞未区分 vs 实际遗漏）。"
- 增加："CODE 扫描器前端覆盖盲区核对——当 apps/web 存在时，须单独核对 CODE-001/002/003/AI-005 在前端的合规性（手动 grep），不依赖扫描器 exit 0（allTs 未含 apps/web 时扫描器有盲区）。"

#### Tech Lead subagent 提示词
- 增加："Tech-Spec §3.2 表单校验复用清单须区分'自由文本表单'（须 safeParse）与'类型派生操作'（TS 类型保证，schema 校验冗余），AC 措辞须精确限定为'自由文本输入表单'。"
- 增加："Tech-Spec §10 advisory 偏离预判须明确同步边界——行为/数据/schema 偏离须同步 §10；纯 UI 文案偏离不须同步 §10 但须在 Review 报告记录。"

## 6 · 结论 + 剩余改进项

第十二轮是"工作流对前端域适应性 + ARCH-003 机器化闭合"验证的标志——前 11 轮所有验证均经 curl / 端到端 fetch 测试驱动，真实用户交互链路（浏览器 → 表单 → API client → router → service）从未端到端跑通；ARCH-003 自立项起标注 `[预留]`（apps/web 不存在）。本期首次引入前端，验证 spec-first 工作流对"前端域"的适应性，并闭合 R1-R11 唯一未机器化规则。

关键证据：
1. **ARCH-003 从 [预留] 到机器化 enforcement 闭合**（R12 最大验证点）：check-rules.mjs ARCH-003 分支（walkWeb 扩展 .tsx + 三条禁止规则）+ layering.md 校验方式更新，逐文件核对 0 违规 + 探针验证真报错 + META-003/META-004 双向绑定闭合。R1-R11 唯一未机器化规则闭合。
2. **wire 格式适配作为 advisory 偏离的范例**（D10）：contracts errorResponseSchema 字段名 code vs server.ts wire 字段名 error 不一致（后端历史遗留），前端 API client 解析层适配（error→code），不改后端、不改 contracts，前端业务代码零感知（ARCH-003 类型来自 contracts）。advisory 偏离机制正向案例——隔离历史遗留 + 标注消除路径。
3. **GET /v1/users/:id 端点不存在 → 409 current_version 重试**（D9+D19）：PRD AC-F4-3 字面"GET 最新 user"无法落地（端点不存在），Spec §1.2 核验既有路由表发现，改用 409 响应体 current_version 重试。R10 S-2 教训（Spec 须核验既有路由表）再次生效——Spec 纠正 PRD 估算。
4. **多[约束]组合副作用预判 4 条全部正确实现**：Tech-Spec §10 预判的 401拦截+409重试、wire适配+401拦截、重试+列表刷新、tokenStore+并发401 四条组合副作用，impl-writer 全部正确规避（401 分支先于 409、401 解析失败降级 UNAUTHORIZED、重试成功刷新列表、接受重复跳转）。Spec 模板 §10 组合副作用预判机制首次大规模验证生效——从 R11"被动暴露"升级为"主动预判"。
5. **零新依赖精神延伸到前端**：原生 fetch（无 axios）+ react-router-dom（必要第三方）+ React Context（无 Redux）+ CSS Modules（无 UI 框架）+ Vitest/Testing Library（与后端同栈）。对齐后端"零新 HTTP 框架"精神。
6. **47/48 AC 对齐 + 0 blocker + 7 suggestion**：Reviewer verdict=pass，功能 44/44 全对齐 + ARCH-003 专项 3/4（AC-ARCH-4 partial，F4 toggle 未调 safeParse，类型派生无自由输入判合理偏离）。7 suggestion 均为文案同步/测试覆盖/扫描范围类改进，不阻断合入。

这证明：**AI 原生工作流在"安全域适应性"验证（R11）后，进入"前端域适应性 + 跨层契约机器化"验证阶段（R12）**——前端首轮在既有规则下成功落地，ARCH-003 从 [预留] 升级为机器化 enforcement（R1-R11 唯一未机器化规则闭合），跨层契约消费（z.infer + Zod 复用 SSOT）端到端验证，wire 适配 advisory 范例示范历史遗留隔离。Reviewer verdict=pass 0 blocker，证明 spec-first 工作流对"前端域"具有适应性，且 ARCH-003 跨层只经契约具备机器化 enforcement 能力。

剩余改进项（S 级，不阻断）：
- **S-1**：AC-ARCH-4 partial（F4 toggle 未调 safeParse，类型派生无自由输入判合理偏离，须 Spec §3.2 区分两类表单 + impl-writer 补显式标注）。
- **S-2**：advisory 偏离反向同步未闭环（3 项 UI 文案未同步 Spec，须明确 UI 文案不须同步 §10 但须 Review 报告记录）。
- **S-3**：测试覆盖缺口（4 项 AC 边界未单测：F2-4 组合/F3-3 邮箱格式/F4-2 反向/F6-2 登出 action，须 test-writer AC 覆盖矩阵自检）。
- **S-4**：CODE 扫描器前端覆盖盲区（allTs 未含 apps/web，须扩展 walkWeb 复用使 CODE-* 覆盖前端）。
- **S-5**：setupFiles 全局副作用（vitest setupFiles 全局，未来若后端受 jest-dom 污染改 vitest projects 模式，本期不阻断）。

> 十二轮演进脉络：R9/R10 验证"协议层扩展适应性"（写条件 + 读条件），R11 验证"安全域适应性"（鉴权），R12 验证"前端域适应性 + ARCH-003 机器化闭合"。R10 证明协议扩展可单层闭合，R11 证明安全机制替换可单层闭合，R12 证明前端引入可跨层契约机器化闭合（ARCH-003 从 [预留] 到 enforcement）。下一轮可考虑：①S-1~S-5 工作流改进固化；②前端扩展角色/部门/审计页（更多管理域前端）；③后端对齐 wire 字段名消除 D10 适配（server.ts error→code）；④补 GET /v1/users/:id 端点（R12 §1.3 发现的 gap，消除 D19 不 GET 偏离）；⑤E2E 测试引入（Playwright 跑真实浏览器+真实后端，Q8 out-of-scope 的工程化方向）。
