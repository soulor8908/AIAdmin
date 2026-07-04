---
doc_type: Retrospective
id: RETRO-ROUND18-001
scope: 第十八轮演练（业务轮 #13：消除 R12 D10 wire 字段名适配 + R12 D19 GET /v1/users/:id 端点缺失 + D9 重分类 [约束]，跨后端 + 前端 + contracts 三层联动）
date: 2026-07-03
verdict: 跑通；D10/D19 两项历史 advisory 偏离消除 + D9 重分类 [约束] 闭合；24 AC 全对齐 / 0 blocker / 1 suggestion（R18 收尾已反向同步闭合）；标准五角色流程（BA→Tech Lead→test-writer→impl-writer→Reviewer）完整闭合
---

# 第十八轮演练复盘 · 业务轮 #13 · 消除 D10 wire 适配 + D19 GET detail 端点

> 本轮承接 R16 §6 + R17 §6 剩余改进项之首"后端 wire 字段名对齐 + 补 GET /v1/users/:id"。走标准五角色流程（BA → Tech Lead → test-writer → impl-writer → Reviewer），跨后端（server.ts 7 处 error→code + router+service+server 三层补 detail 端点）+ 前端（client.ts 删 wire 适配 + 10 ②类既有测试字段名对齐）+ Spec（web-auth-user.tech.md D10/D19 移除标注 + D9 重分类）三层联动。验证 R17 固化的 S-17~S-20 提示词在业务轮下首次大规模触发。

## 0 · 本轮目标与结果

1. **消除 R12 D10 wire 字段名适配**（server.ts `error`→`code` + client.ts 删适配）→ ✅ 落地：
   - server.ts 7 处错误响应 `{ error: <code> }` → `{ code: <ErrorCode> }`（L542/563/566/577/609/619/629）
   - client.ts parseErrorResponse 读 `raw.code`（原 raw.error）+ 移除"D10 wire 适配"注释措辞 + 保留 safeParse+INTERNAL_ERROR fallback（D7，非 D10 残留）
   - web-auth-user.tech.md D10 标注移除改"[advisory]（R18 已消除，历史记录）" + §4.6 改标题"wire 字段名对齐 code（D10 已消除 R18）"
2. **消除 R12 D19 GET /v1/users/:id 端点缺失**（router+service+server 三层 + ETag + 404）→ ✅ 落地：
   - router/user.ts：导出 `userDetailProcedureInputSchema` + UserRouter 类型追加 `detail` + createUserRouter 追加 detail procedure（auth='admin'）
   - service/user.ts：UserService 追加 `getById(id, ctx)`（requireAdmin → findById → USER_NOT_FOUND 守卫 → toUserOutput 剥离 password_hash）
   - server.ts：routes 追加 `defineRoute('GET', '/v1/users/:id', ..., cacheable=true, detailEtag)`（位置：GET /v1/users 后、PATCH status 前）
   - web-auth-user.tech.md §1.2 + D19 标注移除改"R18 已消除（TECH-USER-DETAIL-WIRE-001 D2）"
3. **D9 重分类 [约束]**（Q6 决策①：client 选择 409-retry 而非 GET-retry）→ ✅ 落地：web-auth-user.tech.md D9 改"[约束]（R18 重分类，原 [advisory]-adjacent）"
4. **D21 保留 [advisory]**（Q7 out of scope：issues 仍存在）→ ✅ 落地：D21 保留 [advisory] + 正文说明
5. **三件套全绿 + 24 AC 全对齐** → ✅：typecheck exit 0 / lint:rules exit 0 / vitest 56 files 1256 tests exit 0 / Reviewer verdict=pass / 0 blocker / 1 suggestion（R18 收尾已反向同步闭合）

**结果速览**：三件套全绿（typecheck 0 / lint:rules 0 / vitest 1256 passed）/ Reviewer verdict=pass / 24 AC 全对齐（W1-W11 + G1-G13）/ 0 blocker / 1 suggestion（已闭合）/ 改动文件 12 个（5 impl + 2 ③类新增测试 + 10 ②类既有测试改动 + 1 Spec 反向同步收尾）/ 新增测试 60（37 user-detail + 23 user-detail-embedding）/ 固化 R17 提示词大规模触发验证（S-17 双向 + S-18 零变更 + S-19 沿用 + S-20 N/A 本轮无 user-event）。

## 1 · 本轮核心验证结论

### 1.1 D10 wire 字段名对齐消除（跨后端 + 前端 + Spec 三层）

R12 自引入 wire 适配（server `error` / contracts `code`）以来遗留 6 轮，R18 一次性消除：

| 层 | 改动 | 验证 |
|---|---|---|
| 后端 server.ts | 7 处 `{ error: <code> }` → `{ code: <ErrorCode> }`（L542/563/566/577/609/619/629） | ✅ wire 对齐 contracts errorResponseSchema.code |
| 前端 client.ts | parseErrorResponse 读 `raw.code`（原 raw.error）+ 移除"D10 wire 适配"注释 | ✅ AC-W1~W6 契约测断言全转绿 |
| Spec web-auth-user.tech.md | D10 标注移除改"R18 已消除历史记录" + §4.6 改标题 | ✅ AI-003 反向同步实际改（非伪同步） |
| ②类既有测试（10 文件） | 字段名 `body.error`→`body.code` / mock `{error:}`→`{code:}` / 测试名+注释更新 | ✅ AI-002 matcher 不变（git diff 抽样确认） |

**结论**：D10 消除后 server↔contracts↔client 三层 wire 字段名统一为 `code`，消除历史适配层。10 ②类既有测试改动均仅字段名（matcher `.toBe`/`.not.toBe`/`.toBeUndefined` 不变），符合 AI-002 测试断言未改约束。

### 1.2 D19 GET /v1/users/:id 端点补齐（router+service+server 三层 + ETag + 404）

R12 用 409 current_version 重试绕过 D19（无 GET detail 端点），R18 补齐端点：

| AC | 验证点 | 验证 |
|---|---|---|
| AC-G1 | 查询成功 200+User（不含 password_hash） | ✅ service getById + toUserOutput 剥离 password_hash + 端到端 `body.password_hash===undefined` |
| AC-G2 | 用户不存在 404 USER_NOT_FOUND | ✅ service USER_NOT_FOUND 守卫 + 端到端 `body.code==='USER_NOT_FOUND'` |
| AC-G3 | id 非法 uuid 400 VALIDATION_ERROR+issues | ✅ router `.strict()` + safeParse 失败→400 + 端到端 issues |
| AC-G4/G5 | 鉴权守卫 401（无 token / 无效 / 过期 / 吊销） | ✅ buildCtx Bearer 验签先于 safeParse + 端到端四码分别断言 |
| AC-G6 | 越权 403 FORBIDDEN | ✅ service requireAdmin（SEC-002）+ 守卫顺序（requireAdmin 先于 findById） |
| AC-G7~G10 | ETag 协商缓存（304/200 + If-None-Match） | ✅ detailEtag 基于 version 强 ETag + parseIfNoneMatch 宽容解析 |
| AC-G11 | 路由表注册位置正确 | ✅ GET /v1/users/:id 注册于 GET /v1/users 后、PATCH status 前 |
| AC-G12 | D19 advisory 反向同步移除 + D9 重分类 [约束] | ✅ §1.2 + D19 改"R18 已消除" + D9 改"[约束]" |
| AC-G13 | 前端消费 future-ready | ✅ 端到端 fetch 成功 |

**结论**：D19 端点补齐对齐 GET /v1/roles/:id 模式（detailEtag + 404 + 鉴权守卫），消除 R12 D19 绕过。ETag 基于 version 强 ETag，与 role detail 一致。

### 1.3 R17 固化提示词在业务轮首次大规模触发验证

R17 固化的 S-17~S-20 提示词在 R18 业务轮首次大规模触发：

| 固化项 | R18 触发场景 | 验证结果 |
|---|---|---|
| S-17 impl-writer 自报准确性 | impl-writer 交付 5 impl + 1 setup 修正 | ✅ git diff --stat 实跑与自报一致（10 ②类 + 2 ③类新增），Reviewer 闸门核验通过 |
| S-17 Reviewer 闸门核验 | Reviewer §5 S-17 自检章节 | ✅ git diff 抽样确认 ②类改动仅字段名，matcher 不变 |
| S-18 全码映射"全集"定义 | errorMapping.ts 本轮零变更 | ✅ S-18 闭合（errorCodeSchema 零扩展声明，无新域码） |
| S-19 简单常量复用边界 | userDetailProcedureInputSchema 2 使用点 | ✅ ≤3 阈值 [advisory] 沿用重复定义（与 roleDetailProcedureInputSchema 对称） |
| S-20 user-event disabled workaround | 本轮无前端 user-event 场景 | N/A 本轮无触发（下轮前端轮可触发） |

**结论**：R17 固化的 5 条提示词（S-17 双向）在 R18 业务轮全部触发验证生效，S-17 双向闭环（impl-writer 自报 + Reviewer git diff 核验）形成完整闸门。S-18/S-19 在后端轮（无 errorMapping 扩展）下零变更闭合，S-20 在无 user-event 场景下不触发。

### 1.4 端到端验收测试 + Reviewer PRD 逐条核对（AI-007）

R18 落地 AI-007 端到端验收：test-writer 产出 user-detail-embedding.test.ts（23 tests，spawn 真实 server 端口 4890），覆盖 AC-G1~G11 + AC-W1/W2/W5 全链路。Reviewer 按 PRD 24 AC 逐条核对，24 对齐 / 0 偏离。

**关键端到端断言**：AC-G1 端到端 `body.password_hash===undefined`（SEC-003a 永不出响应）+ AC-G5 三码分别断言（含 signExpiredToken + logout 入黑名单）+ AC-G9 ETag 三场景（不匹配/缺失/非法格式）+ AC-G11 路由表 endpoints 含 `"GET    /v1/users/:id"`。

## 2 · 本轮新发现的问题（S 级，不阻断）

### S-21 · impl-writer [约束] 偏离反向同步滞后到收尾（非交付阶段闭合）

- **现象**：impl-writer 在 router/user.ts L51-53 添加 `.strict()` 满足 test-writer AC-G3 扩展断言（user-detail.test.ts L219-221 `safeParse({ id, extra }).success === false`），偏离 Tech-Spec §4.4 [约束] 描述（不带 .strict()）。impl-writer 在代码注释（L47-48）显式标注"[约束] AC-G3：.strict() 拒绝多余字段...AI-002 不改断言"，**但未实际编辑 Spec §4.4**（与 R12 S-1 advisory 伪同步同形——代码注释声明但 Spec 未改）。
- **Reviewer 捕获**：Reviewer §10 Suggestion 清单捕获为非阻断 Suggestion（因加性安全 + 根因为 test-writer + 三件套全绿 + 24 AC 全对齐），AI-003 流程核对 "Spec 反向同步：❌"，建议"后续补反向同步 §4.4"。
- **滞后闭合**：R18 收尾阶段（G6 验收后）由编排者补反向同步 §4.4（添加 .strict() + [约束] 演进标注）+ 更新 Review 报告 Suggestion 状态为"已反向同步闭合"。即反向同步未在 impl-writer 交付阶段完成，滞后到收尾。
- **根因**：AI-003 [约束] 偏离处理流程虽规定 impl-writer "须反向同步 Tech-Spec"，但 impl-writer 实际停留在"代码注释声明"层面（与 R12 S-1 advisory 伪同步同形）。R12 S-1 已反推 advisory 偏离的"伪同步"检测（impl-writer 须 grep Spec 文件 + 交付报告列行号 + Reviewer git diff 核实），但该反推未显式覆盖 [约束] 项偏离场景，且 impl-writer 对"[约束] 偏离须反向同步 Spec 文件"的认知弱于 advisory（误以为代码注释声明即合规）。
- **影响评估**：加性安全（更严格非更弱）+ 无功能回归 + 三件套全绿 + 24 AC 全对齐，无验收偏离。仅造成 [约束] 偏离反向同步滞后一轮内闭合（未跨轮遗留，R18 收尾已补）。属流程改进项，非本轮 blocker。
- **修复建议**（反推固化方向）：
  1. **提示词层**：impl-writer 提示词追加"[约束] 项偏离反向同步与 advisory 同标准——须实际编辑 Spec 文件（grep 确认章节已改）+ 交付报告列出'反向同步的 Spec 文件路径 + 修改行号'，代码注释声明 ≠ Spec 已同步（伪同步）"。
  2. **提示词层**：Reviewer 提示词追加"[约束] 项偏离须 git diff Spec 文件核实章节已改（与 advisory 反向同步同标准，R12 S-1 反推），加性安全场景可降级为 Suggestion 但须强制本轮收尾闭合（不允许跨轮遗留）"。
  3. **Spec 模板层**：§10 组合副作用预判增项"[约束] 项偏离反向同步闭环性"——Tech Lead 须预判本轮可能触发的 [约束] 偏离并提示 impl-writer 交付阶段同步 Spec。
- **责任归属**：impl-writer（未实际编辑 §4.4）+ Reviewer（Suggestion 未强制本轮闭合）。属流程改进项。

### S-22 · test-writer 确定性 token setup 时序污染（logout 黑名单全局副作用）

- **现象**：user-detail-embedding.test.ts beforeAll login 后，后续 AC-G5 logout 测试将 token 入黑名单。因 signToken 确定性生成（同 sub + 同 iat 秒级 → 同 token），logout 黑名单污染同 test suite 后续用 401。
- **修复**（impl-writer 阶段，AI-002 允许 setup 修正）：beforeAll login 后追加 `setTimeout(1100)` 跨秒边界，使后续 token iat 不同 → token 不同 → 黑名单不污染。
- **根因**：test-writer 在使用确定性 token 生成时未确保 token 唯一性（sub+iat 复合键），导致全局黑名单副作用跨用例污染。属测试隔离缺陷，与 R15 S-13（impl-writer 测试 setup 改动增多）同形但根因不同（S-13 是 setup 改动频率，S-22 是 setup 时序唯一性）。
- **影响评估**：本轮已修复（setTimeout 跨秒），无遗留。属 testability 改进项。
- **修复建议**（反推固化方向）：
  1. **提示词层**：test-writer 提示词追加"确定性 token 生成时须确保 token 唯一性（sub+iat+nonce 或跨秒边界），避免全局黑名单/缓存副作用污染同 test suite 后续用例；test-writer 须在 setup 阶段预判全局副作用（logout/缓存写入/状态机变更）的跨用例污染风险"。
- **责任归属**：test-writer（setup 时序唯一性预判不足）。属流程改进项。

## 3 · 量化对比（十八轮演进表）

| 指标 | R14 | R15 | R16 | R17 | R18 |
|---|---|---|---|---|---|
| 用例数 | 991 | 1089 | 1196 | 1196（无源码改动） | 1256（+60） |
| 累计用例 | 991 | 1089 | 1196 | 1196 | 1256 |
| blocker | 0 | 0 | 0 | 0 | 0 |
| suggestion | 8 | 8 | 7 | N/A（元改进轮） | 1（已闭合） |
| Reviewer verdict | pass | pass | pass | N/A（G6.5） | pass |
| AC 对齐 | 68/68 | 54/54 | 46/46 | N/A | 24/24 |
| 影响层 | 前端扩展层 | 前端全域收尾层 | 后端能力前端化闭合层 | 元资产层 | **跨后端+前端+contracts 三层联动层**（D10 wire 消除 + D19 GET detail） |
| 新架构模式 | 前端多域扩展 | 前端全域覆盖 | 后端能力前端化闭合 | 元改进轮 #2 | **历史 advisory 偏离消除**（D10/D19 两项 + D9 重分类） |
| 轮次类型 | 业务 | 业务 | 业务 | 元改进 | **业务** |
| 提示词骨架条数 | 5角色+13条 | 5角色+17条 | 5角色+17条（S-17~S-20 待固化） | 5角色+23条（S-17~S-20 固化） | **5角色+23条持续生效**（R17 固化项首次业务轮大规模触发验证） |
| 规则机器化覆盖 | 持续覆盖 | 持续覆盖 | 持续覆盖 | AI-005 扩展含 apps/web/test | 持续覆盖（lint:rules exit 0，6 条 AI-005 建议为 R16 既有） |
| 固化教训数（本轮） | 5（S-8~S-12） | 4（S-13~S-16） | 0（持续验证） | 6（S-6/S-7/S-17~S-20） | **0**（本轮新发现 S-21/S-22 待 R19 固化） |

> R18 用例数 1256 = R17 1196 + 60（37 user-detail + 23 user-detail-embedding）。lint:rules exit 0 + 三件套全绿 + 24 AC 全对齐 + 0 blocker / 1 suggestion（R18 收尾已反向同步闭合）。

## 4 · 十八轮演进脉络

- **第十四轮**：前端多域扩展（角色/部门/审计三域一次引入，5 域前端），验证前端多域扩展适应性 + R13 固化提示词首次大规模验证
- **第十五轮**：前端全域覆盖收尾（通知管理页 + 报表页，新增 notification + report 两域，完成七域全覆盖），验证前端全域覆盖适应性
- **第十六轮**：后端能力前端化闭合（调岗 transfer + 角色继承管理，闭合"前端覆盖全部后端写/读端点"最后一公里），验证后端能力前端化闭合适应性 + errorMapping 全码映射收尾 + impl-writer 自报准确性违规发现（S-17~S-20 4 项待固化）
- **第十七轮**：元改进轮 #2（固化 R16 S-17~S-20 + R13 遗留 S-6/S-7 共 6 项教训），验证 R13 元改进轮精简流程范式可复用 + G6.5 元改进轮 Review checklist 首次落地
- **第十八轮**：**业务轮 #13**（消除 R12 D10 wire 字段名适配 + R12 D19 GET /v1/users/:id 端点缺失 + D9 重分类 [约束]），跨后端 + 前端 + contracts 三层联动，验证 R17 固化提示词在业务轮首次大规模触发（S-17 双向 + S-18 零变更 + S-19 沿用）+ 新发现 S-21（[约束] 偏离反向同步滞后）+ S-22（确定性 token setup 时序污染）待 R19 固化

## 5 · 反推优化三个层面执行情况

### 5.1 规则层执行情况（反推到 .trae/rules/ + scripts/check-rules.mjs）

| 反推项 | R18 状态 | 证据 |
|---|---|---|
| META-003 声明即实现 | ✅ 持续闭合 | 本轮无规则脚本改动，lint:rules exit 0 |
| META-004 实现即声明 | ✅ 持续闭合 | 本轮无新增 enforcement ID |
| ARCH-001/002/003 | ✅ 保持 | 跨层只经 contracts，wire 字段名对齐后 ARCH-003 更纯净（client 直接读 raw.code） |
| AI-005 扫描器（R13 S-6 固化） | ✅ 持续覆盖 | lint:rules exit 0，6 条 AI-005 建议为 R16 既有 role-inheritance 测试 |

### 5.2 Spec 模板层执行情况（反推到 Tech-Spec 模板，经 Tech Lead 提示词约束）

| 反推项 | R18 状态 | 证据 |
|---|---|---|
| R16 S-18 全集定义明确 | ✅ 持续生效 | R18 errorMapping 零变更，errorCodeSchema 零扩展声明（S-18 闭合） |
| R16 S-19 简单常量复用边界 | ✅ 触发验证 | R18 userDetailProcedureInputSchema 2 使用点 ≤3 阈值 [advisory] 沿用（S-19 闭合） |
| R16 S-20 测试工具 workaround | N/A 本轮无触发 | 本轮无前端 user-event 场景 |
| **S-21 [约束] 偏离反向同步闭环性**（待 R19 固化） | ⏳ 待固化 | 本轮新发现，反推方向见 §2 S-21 修复建议 |

### 5.3 提示词层执行情况（反推到五角色提示词骨架 spec-first-workflow.md §2.3~2.6）

#### R17 固化的 S-17~S-20 在 R18 业务轮首次大规模触发验证

| 固化项 | 角色 | R18 触发场景 | 验证结果 |
|---|---|---|---|
| S-17 impl-writer 自报准确性 | impl-writer | 交付 5 impl + 1 setup 修正，git diff --stat 实跑核对 | ✅ 触发生效（自报与 git diff 一致） |
| S-17 Reviewer 闸门核验 | Reviewer | §5 S-17 自检章节，git diff 抽样确认 matcher 不变 | ✅ 触发生效（闸门核验通过） |
| S-18 全集定义明确 | impl-writer | errorMapping.ts 零变更 | ✅ 触发生效（零扩展声明） |
| S-19 简单常量复用边界 | impl-writer | userDetailProcedureInputSchema 2 使用点 | ✅ 触发生效（≤3 沿用） |
| S-20 user-event workaround | test-writer | 本轮无 user-event 场景 | N/A 未触发 |

**合计**：R17 固化的 5 条提示词（S-17 双向）在 R18 业务轮 4 条触发验证生效（S-20 未触发因无 user-event 场景）。R17 反推的"下轮业务轮 Tech Lead 须在 §10 预判时考虑全集定义/简单常量/测试工具三类组合副作用"在 R18 §10 五条组合副作用预判全部如预判处理，验证 R17 固化生效。

#### R18 新发现待固化的 S-21/S-22

| 待固化项 | 角色 | 反推方向 | 固化状态 |
|---|---|---|---|
| S-21 [约束] 偏离反向同步滞后 | impl-writer + Reviewer | impl-writer 提示词追加"[约束] 偏离反向同步与 advisory 同标准" + Reviewer 提示词追加"加性安全可降级 Suggestion 但强制本轮闭合" + Spec 模板层 §10 增项 | ⏳ 待 R19 固化 |
| S-22 确定性 token setup 时序污染 | test-writer | test-writer 提示词追加"确定性 token 生成须确保唯一性 + 预判全局副作用跨用例污染" | ⏳ 待 R19 固化 |

## 6 · 结论 + 剩余改进项

第十八轮是"业务轮 #13 · 消除 R12 D10 wire 适配 + D19 GET detail 端点"的标志——承接 R16 §6 + R17 §6 剩余改进项之首"后端 wire 字段名对齐 + 补 GET /v1/users/:id"。走标准五角色流程（BA → Tech Lead → test-writer → impl-writer → Reviewer），跨后端 + 前端 + contracts 三层联动，24 AC 全对齐 / 0 blocker / 1 suggestion（R18 收尾已反向同步闭合）。

关键证据：
1. **D10 wire 字段名对齐消除**：server.ts 7 处 `error`→`code` + client.ts 删适配 + 10 ②类既有测试字段名对齐（matcher 不变）+ web-auth-user.tech.md D10 标注移除。三层 wire 统一为 `code`，消除历史适配层。
2. **D19 GET /v1/users/:id 端点补齐**：router+service+server 三层 + detailEtag + 404 + 鉴权守卫，对齐 GET /v1/roles/:id 模式。消除 R12 D19 绕过（409 current_version 重试）。
3. **D9 重分类 [约束]**（Q6 决策①）：client 选择 409-retry 而非 GET-retry，D9 从 [advisory]-adjacent 重分类为 [约束]。
4. **R17 固化提示词首次业务轮大规模触发验证**：S-17 双向（impl-writer 自报 + Reviewer 闸门核验）+ S-18 零变更 + S-19 沿用 + S-20 未触发（无 user-event）。R17 反推的"下轮业务轮 Tech Lead §10 预判"在 R18 §10 五条组合副作用预判全部如预判处理。
5. **AI-007 端到端验收 + Reviewer PRD 逐条核对**：user-detail-embedding.test.ts 23 tests 端到端（spawn 真实 server 端口 4890）覆盖 AC-G1~G11 + AC-W1/W2/W5，Reviewer 24 AC 逐条核对 24 对齐 / 0 偏离。

剩余改进项（S 级，不阻断）：
- **S-21**（R18 新发现，待 R19 固化）：impl-writer [约束] 偏离反向同步滞后到收尾（非交付阶段闭合）。反推方向见 §2 S-21 修复建议（提示词层 impl-writer + Reviewer 双向 + Spec 模板层 §10 增项）。
- **S-22**（R18 新发现，待 R19 固化）：test-writer 确定性 token setup 时序污染（logout 黑名单全局副作用）。反推方向见 §2 S-22 修复建议（提示词层 test-writer）。
- **S-5**（R12 遗留，advisory 不强制）：setupFiles 全局副作用——R13/R14/R15/R16/R17/R18 均未触发，持续 advisory。未来若后端测试受 jest-dom matcher 污染，改用 vitest projects 模式分离。

> 本轮新发现的 S-21/S-22 待 R19 元改进轮固化（反推至提示词层 + Spec 模板层）。R17 固化的 S-6/S-7/S-17~S-20 已在 R18 业务轮触发验证生效，不再列为"仍在生效"。

> **下一轮候选**（按 R17 §6 + R18 §6 状态排序）：
> 1. **元改进轮 #3**（固化 R18 S-21/S-22 共 2 项教训）—— R19，无标准 PRD→Spec 流程，直接"规划→实施→验证→复盘" + G6.5 元改进轮 Review checklist。反推 S-21（impl-writer [约束] 偏离反向同步与 advisory 同标准 + Reviewer 加性安全降级但强制本轮闭合 + §10 增项）+ S-22（test-writer 确定性 token 唯一性 + 全局副作用预判）。
> 2. **E2E 测试引入**（Playwright 真实浏览器+真实后端）—— R20，加 Playwright 依赖 + e2e/ 目录 + 真实后端启动 fixture，覆盖核心流（login → user 列表 → role 操作 → transfer → 登出），顺带闭合 S-5 setupFiles 全局副作用（vitest projects 模式分离 unit/e2e）。
> 3. **前端性能加固**（React.memo/useMemo/useCallback 评估 + 虚拟列表 + 代码分割）—— R21，前端单层变更。
> 4. **可访问性深化**（screen reader 端到端测试 + 键盘导航 + 色彩对比 WCAG AA）—— R22，前端单层变更，可与 R21 合并。
