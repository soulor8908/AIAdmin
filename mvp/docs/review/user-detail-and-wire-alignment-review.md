---
doc_type: Review-Report
id: REVIEW-USER-DETAIL-WIRE-001
title: 用户详情端点补齐 + 错误响应 wire 字段名对齐 G6 验收 Review 报告
prd_ref: PRD-USER-DETAIL-WIRE-001
spec_ref: TECH-USER-DETAIL-WIRE-001
status: pass
reviewer: reviewer@team
created: 2026-07-03
round: R18
---

# REVIEW-USER-DETAIL-WIRE-001 · G6 验收 Review 报告

> Reviewer 角色对 R18 业务轮（PRD-USER-DETAIL-WIRE-001 / TECH-USER-DETAIL-WIRE-001）执行 G6 验收。
> 范围：24 条 PRD AC（AC-W1~W11 + AC-G1~G13）逐条核对 + 三件套实跑 + AI-002 测试断言未改检查 + S-17 自报准确性核对 + advisory 反向同步核实 + ARCH/SEC + §10 组合副作用预判 + S-18/S-19。
> impl-writer 交付：5 impl 文件（apps/api/src/router/user.ts + apps/api/src/service/user.ts + apps/api/src/server.ts + apps/web/src/api/client.ts + docs/spec/web-auth-user.tech.md）+ 1 测试 setup 修正（apps/api/test/user-detail-embedding.test.ts setTimeout 跨秒 + segmentCounts 复合键）。

## 1 · Verdict

**verdict = pass**

- 24 条 PRD AC 全部对齐（24 对齐 / 0 偏离 / 0 未实现）。
- 三件套全绿：typecheck exit 0 / lint:rules exit 0 / test 1256 passed exit 0。
- AI-002 测试断言未改：git diff 抽样确认 ②类改动仅 `body.error→body.code` / mock `{error:}→{code:}` / 测试名+注释更新，matcher `.toBe`/`.not.toBe`/`.toBeUndefined` 不变。
- S-17 自报准确性：git diff --stat 实跑结果与 impl-writer 自报一致（10 ②类 + 2 ③类新增）。
- advisory 反向同步：D10/D19 已实际移除标注（web-auth-user.tech.md §1.2/§4.6/D10/D19 改"R18 已消除"历史记录），D9 重分类 [约束]，D21 保留 [advisory]（Q7 out of scope）。
- ARCH-001/003 + SEC-002/003a + S-18(errorMapping 零变更) + S-19(2 使用点 [advisory] 沿用) 均闭合。
- §10 五条组合副作用预判全部如预判处理。
- **0 blocker / 1 suggestion（已反向同步闭合）**（userDetailProcedureInputSchema `.strict()` 偏离 §4.4 [约束] 描述，R18 收尾已补反向同步，详见 §10 Suggestion 清单）。

G6 通过，R18 可合入（G7）。

## 2 · PRD 验收逐条核对（24 AC）

> 对照 PRD-USER-DETAIL-WIRE-001 §5 验收标准（AC-W1~W11 + AC-G1~G13）。每条标 ✅对齐 / ⚠️偏离 / ❌未实现 + 证据。

### 改动点 1：wire 字段名对齐（AC-W1~W11）

| AC ID | 描述 | 对齐结论 | 证据 |
|-------|------|----------|------|
| AC-W1 | AppError 错误响应字段名 `code` | ✅对齐 | server.ts L609 `{ code: e.code, message: e.message }` + L610 `if (e.meta) Object.assign(respBody, e.meta)`（meta 合并不变，VERSION_CONFLICT current_version 仍填充）；auth-embedding.test.ts 11 处 `body.code` 断言转绿 |
| AC-W2 | VALIDATION_ERROR safeParse 失败 `code`+issues | ✅对齐 | server.ts L577-580 `{ code: 'VALIDATION_ERROR', message, issues }`（issues 保留 D21，Q7 不消除）；user-detail-embedding.test.ts AC-W2 断言 `body.code==='VALIDATION_ERROR'` + `issues.length>0` |
| AC-W3 | VERSION_REQUIRED 字段名 `code` | ✅对齐 | server.ts L563 `{ code: 'VERSION_REQUIRED', message }`；optimistic-locking-embedding.test.ts `res.body.code==='VERSION_REQUIRED'` 转绿 |
| AC-W4 | If-Match 格式非法 `code` | ✅对齐 | server.ts L566 `{ code: 'VALIDATION_ERROR', message }`；optimistic-locking-embedding.test.ts `res.body.code==='VALIDATION_ERROR'` 转绿 |
| AC-W5 | 通用 404 无路由 `code:NOT_FOUND` | ✅对齐 | server.ts L542 `{ code: 'NOT_FOUND', message }`（非 contracts 码，client fallback，D7）；user-detail-embedding.test.ts AC-W5 断言 `body.code==='USER_NOT_FOUND'`（detail 路由命中）`!== 'NOT_FOUND'` |
| AC-W6 | 500 INTERNAL_ERROR `code` | ✅对齐 | server.ts L619 `{ code: 'INTERNAL_ERROR', message }`（500 unhandled）+ L629 `{ code: 'INTERNAL_ERROR', message: 'fatal' }`（500 fatal）；auth-embedding.test.ts INTERNAL_ERROR 断言转绿 |
| AC-W7 | client 删除 wire 适配读 raw.code | ✅对齐 | client.ts L79 `const wireCode = raw.code;`（原 raw.error 已删）+ L80 `errorCodeSchema.safeParse(wireCode)` + L81 fallback `INTERNAL_ERROR`；7 web mock 测试 `{code:}` 转绿；user-detail.test.ts AC-W7 契约测断言 `errorResponseSchema` 接受 `{code,...}` 拒绝 `{error,...}` |
| AC-W8 | 非 contracts 码 fallback 不变 | ✅对齐 | client.ts L81 `codeParse.success ? codeParse.data : 'INTERNAL_ERROR'`；INTERNAL_ERROR round-trip 正确（server 发→client 收一致），NOT_FOUND 降级 INTERNAL_ERROR（行为不变）；user-detail.test.ts AC-W7 契约测断言 `errorResponseSchema.safeParse({code:'NOT_FOUND'}).success===false` + `{code:'INTERNAL_ERROR'}.success===false`（非枚举） |
| AC-W9 | 409 VERSION_CONFLICT 重试链不破坏 | ✅对齐 | client.ts L214 `err.code === 'VERSION_CONFLICT' && err.current_version !== undefined && !isRetry` → L217 重试；server.ts L610 meta 合并 current_version 不变；optimistic-locking-embedding.test.ts `res.body.code==='VERSION_CONFLICT'` 7 处转绿；api-client.test.ts 409 重试 mock `{code:'VERSION_CONFLICT', current_version:5}` 转绿 |
| AC-W10 | 401 拦截链不破坏 | ✅对齐 | client.ts L195-208：401 分支先于 409；L198 `INVALID_CREDENTIALS` 原样抛；L203 `INTERNAL_ERROR \|\| AUTH_401_CODES.has(code)` → clearToken+redirect；api-client.test.ts 4 鉴权码 + INVALID_CREDENTIALS mock `{code:}` 转绿 |
| AC-W11 | D10 advisory 反向同步移除 | ✅对齐 | web-auth-user.tech.md D10（L475-476）改"[advisory]（R18 已消除，历史记录）"+ §4.6（L214-238）改"wire 字段名对齐 code（D10 已消除 R18）"；client.ts 注释 L6/L12-14/L33/L62/L70-75 移除"wire 适配 error→code（D10 [advisory]）"措辞，改"D10 已消除" |

### 改动点 2：补 GET /v1/users/:id（AC-G1~G13）

| AC ID | 描述 | 对齐结论 | 证据 |
|-------|------|----------|------|
| AC-G1 | 查询成功 200+User（不含 password_hash） | ✅对齐 | service/user.ts L61-70 getById：requireAdmin→findById→toUserOutput（剥离 password_hash）；server.ts L245-249 路由注册；user-detail.test.ts AC-G1 断言 userSchema.parse 通过 + version/department_id 字段；user-detail-embedding.test.ts AC-G1 端到端 200+body+ETag + `not.toHaveProperty('password_hash')` |
| AC-G2 | 用户不存在 404 USER_NOT_FOUND | ✅对齐 | service/user.ts L65-67 `if (!target) throw new AppError('USER_NOT_FOUND', ...)`；user-detail.test.ts AC-G2 `expectAppError(..., 'USER_NOT_FOUND')`；user-detail-embedding.test.ts AC-G2 端到端 404 + `body.code==='USER_NOT_FOUND'` |
| AC-G3 | id 非法 uuid 400 VALIDATION_ERROR+issues | ✅对齐 | router/user.ts L51-53 `userDetailProcedureInputSchema = z.object({ id: z.string().uuid() }).strict()`；server.ts L572-580 safeParse 失败→400 VALIDATION_ERROR+issues；user-detail.test.ts AC-G3 `safeParse({id:'not-uuid'}).success===false` + `safeParse({id,...extra}).success===false`；user-detail-embedding.test.ts AC-G3 端到端 400 + `body.code==='VALIDATION_ERROR'` + issues |
| AC-G4 | 鉴权守卫-无 token 401 UNAUTHORIZED | ✅对齐 | server.ts buildCtx L431-432 `if (authHeader===undefined) throw new AppError('UNAUTHORIZED', ...)`；user-detail-embedding.test.ts AC-G4 端到端无 Authorization → 401 + `body.code==='UNAUTHORIZED'` |
| AC-G5 | 鉴权守卫-token 无效/过期/吊销 401 | ✅对齐 | server.ts buildCtx L437/L447/L451/L455 抛 TOKEN_INVALID/TOKEN_EXPIRED/TOKEN_REVOKED；user-detail-embedding.test.ts AC-G5 端到端三码分别断言（含 signExpiredToken + logout 入黑名单） |
| AC-G6 | 越权校验 403 FORBIDDEN | ✅对齐 | service/user.ts L62 `this.requireAdmin(ctx)`（SEC-002，role≠admin→FORBIDDEN）；user-detail.test.ts AC-G6 `expectAppError(service.getById(ADMIN_ID, userCtx), 'FORBIDDEN')` + 守卫顺序（requireAdmin 先于 findById） |
| AC-G7 | ETag 生成 `"<version>"` | ✅对齐 | server.ts L245-249 `cacheable=true, detailEtag`；etag.ts detailEtag 基于 version；user-detail.test.ts AC-G7 契约测 `detailEtag(user v=0)==='"0"'`；user-detail-embedding.test.ts AC-G7 端到端 `etag==='"0"'` + `/^"\d+"$/` |
| AC-G8 | If-None-Match 匹配 304 空体 | ✅对齐 | server.ts L592-598 `if (ifNoneMatch !== null && ifNoneMatch === etag) → 304 + ETag header + Content-Length:0`；user-detail-embedding.test.ts AC-G8 端到端 二次 GET If-None-Match='"0"' → 304 + `text===''` |
| AC-G9 | If-None-Match 不匹配 200+新 ETag | ✅对齐 | server.ts L600 `sendJsonWithEtag(res, 200, result, etag)`；parseIfNoneMatch 宽容解析（非法→null→忽略）；user-detail-embedding.test.ts AC-G9 端到端 不匹配/缺失/非法格式 三场景 → 200 + `etag==='"0"'` |
| AC-G10 | 路由不与列表/状态/调岗冲突 | ✅对齐 | server.ts matchPattern L397 `if (pp.length !== ap.length) return null`（段数判定）+ L404 字面段判定；GET /v1/users/:id（3 段）与 GET /v1/users（2 段）/ PATCH .../status（4 段）/ POST .../transfer（4 段）/ GET .../roles（4 段）/ GET .../effective-permissions（4 段）段数+method 均不同；user-detail-embedding.test.ts AC-G10 端到端验证 3 段命中 detail ≠ 2/4 段 + segmentCounts 复合键去重无冲突 |
| AC-G11 | 路由表新增条目（注册位置正确） | ✅对齐 | server.ts L245-249 `defineRoute('GET', '/v1/users/:id', ..., false, true, detailEtag)` 注册于 L240 GET /v1/users 之后、L250 PATCH /v1/users/:id/status 之前（user 域读端点聚拢）；user-detail-embedding.test.ts AC-G11 端到端 GET / 返回 endpoints 含 `"GET    /v1/users/:id"` + 3 段 GET 命中（非 404 NOT_FOUND 通用路由） |
| AC-G12 | D19 advisory 反向同步移除 + D9 重分类 [约束] | ✅对齐 | web-auth-user.tech.md §1.2（L37-43）改"R18 已消除（TECH-USER-DETAIL-WIRE-001 D2）"+ D19（L505-506）改"[advisory]（R18 已消除，历史记录）"；D9（L472-473）改"[约束]（R18 重分类，原 [advisory]-adjacent）" |
| AC-G13 | 前端消费 future-ready（端点可被 fetch 调用） | ✅对齐 | user-detail-embedding.test.ts 全程 fetch GET /v1/users/:id 成功（端到端可调用）；前端 api/users.ts getUser(id) 列为 future（不在本轮强制） |

**24 AC 对齐结论：24 对齐 / 0 偏离 / 0 未实现。**

## 3 · 三件套复核结果（AI-004）

| 件 | 命令 | exit code | 结果 |
|----|------|-----------|------|
| typecheck | `npm run typecheck`（tsc -p tsconfig.json --noEmit） | 0 | 无类型错误 |
| lint:rules | `npm run lint:rules`（node scripts/check-rules.mjs） | 0 | ✅ 规则校验通过；enforcement 覆盖 AI-005/ARCH-001/002/003/CODE-001~004/META-001/003/004/SEC-001/002/003a；3 条 SEC-002 豁免审计清单（audit/auth/notification 既有，非本轮新增）；6 条 AI-005 建议（role-inheritance 测试既有，非本轮新增，不阻断） |
| test | `npm test`（vitest run） | 0 | Test Files 56 passed / Tests 1256 passed / Duration 74.10s |

三件套全绿，与 impl-writer 自报"1256 tests 全绿"一致。

## 4 · AI-002 测试断言未改检查（git diff 证据）

**核对范围**：`git diff HEAD -- apps/api/test/ apps/web/test/`，重点检查 `expect(` 行未被弱化（matcher 不变，仅字段名 error→code）。

**git diff --stat 实跑结果**（10 文件，87 insertions + 87 deletions，行数对称符合"仅改字段名"特征）：

```
 apps/api/test/auth-embedding.test.ts           | 24 +++++++-------
 apps/api/test/optimistic-locking-embedding.test.ts | 16 ++++-----
 apps/api/test/persist-embedding.test.ts        |  4 +--
 apps/web/test/api-client.test.ts               | 18 +++++-----
 apps/web/test/api-departments.test.ts          |  2 +-
 apps/web/test/api-notifications.test.ts        | 26 +++++++--------
 apps/web/test/api-reports.test.ts              | 12 +++----
 apps/web/test/api-role-inheritance.test.ts     | 20 ++++++------
 apps/web/test/api-roles.test.ts                | 14 ++++----
 apps/web/test/api-transfer.test.ts             | 38 +++++++++++-----------
 10 files changed, 87 insertions(+), 87 deletions(-)
```

与 Tech-Spec §7.2 ②类清单完全一致（3 api + 7 web = 10 文件）。

**抽样 diff 核对（matcher 不变，仅字段名 error→code）**：

- **auth-embedding.test.ts**：`-expect(body.error).toBe('INVALID_CREDENTIALS')` → `+expect(body.code).toBe('INVALID_CREDENTIALS')`；`-expect(body.error).not.toBe('UNAUTHORIZED')` → `+expect(body.code).not.toBe('UNAUTHORIZED')`；`-expect(body.error).toBeUndefined()` → `+expect(body.code).toBeUndefined()`。matcher（`.toBe`/`.not.toBe`/`.toBeUndefined`）不变，仅 `body.error→body.code`。✅
- **optimistic-locking-embedding.test.ts**：`-expect(res.body.error).toBe('VERSION_REQUIRED')` → `+expect(res.body.code).toBe('VERSION_REQUIRED')`；VERSION_CONFLICT/VALIDATION_ERROR 同模式。matcher `.toBe` 不变。✅
- **api-client.test.ts**：mock `{ error: code }` → `{ code: code }`；mock `{ error: 'INVALID_CREDENTIALS' }` → `{ code: 'INVALID_CREDENTIALS' }`；测试名 `"wire 适配：响应 {error:...}"` → `"wire 字段对齐：响应 {code:...}（D10 已消除）"`；注释 `字段名 error，非 contracts 的 code` → `字段名 code，对齐 contracts errorResponseSchema.code，D10 已消除`。matcher 不变。✅

**结论**：②类改动均为 wire 字段名 error→code 驱动（行为变更），matcher 不变（`.toBe`/`.not.toBe`/`.toBeUndefined`），属合法 ②类签名驱动更新（非静默弱化断言）。AI-002 闭合。

**impl-writer 自报 setup 修正核实**（user-detail-embedding.test.ts，③类新增文件，untracked）：

- L103-108 `await new Promise((r) => setTimeout(r, 1100))`：跨秒等待保证 beforeAll login token 与 AC-G5 logout token 的 iat 不同（避免同秒同 token 串→logout 误黑名单全局 authToken）。注释标注"[setup 修正，AI-002 允许] 仅改 setup 时序，不改任何断言"。✅ 合理 setup 调整。
- L247-262 segmentCounts 复合键（`段数 | 字面段位置:值`）：原 `pattern.split('/').length` 仅按段数去重，不反映 matchPattern 真实逻辑（段数+字面段位置）。改用复合键反映 server.ts L404 `else if (seg !== actual) return null` 真实匹配逻辑。注释标注"[setup 修正，AI-002 允许] 仅改 setup 计算，不改 expect 断言"。✅ 合理 setup 调整（修正 test-writer 阶段对 matchRoute 逻辑的过简化）。

两处 setup 修正均不改 `expect(` 断言行，符合 AI-002 "只可改 setup/import 路径，须注明理由"。

## 5 · S-17 自报准确性核对（git diff --stat 实跑 vs impl-writer 自报）

**impl-writer 自报**：5 impl 文件 + 1 测试 setup 修正。

**git diff HEAD --stat -- apps/api/test/ apps/web/test/ 实跑**：10 ②类测试文件改动（3 api + 7 web）+ 2 ③类新增测试文件（untracked，user-detail.test.ts + user-detail-embedding.test.ts）。

**核对结论**：

- 10 ②类文件改动属 test-writer 阶段产出（wire 字段名 error→code 驱动），非 impl-writer 改动。impl-writer 自报"1 测试 setup 修正"指 user-detail-embedding.test.ts 的两处 setup 调整（setTimeout + segmentCounts），位于 ③类新增文件内（untracked，不在 git diff --stat 内但文件存在）。✅ 自报准确。
- impl 5 文件核对：`git status` 确认 `M apps/api/src/router/user.ts` + `M apps/api/src/service/user.ts` + `M apps/api/src/server.ts` + `M apps/web/src/api/client.ts` + `M docs/spec/web-auth-user.tech.md`，与自报 5 impl 文件一致。✅ 自报准确。

**额外发现（非 R18 impl-writer 范围）**：`git status` 另有 `M .trae/rules/ai-behavior/spec-first.md` + `M docs/retro/lessons-learned.md` + `M docs/workflow/spec-first-workflow.md` + `M scripts/check-rules.mjs` + `M scripts/gen-retro-index.mjs` + `?? docs/retro/round17-retro.md`。这些是 **R17 元改进轮** 残留改动（规则/工作流/脚本/retro 索引），非 R18 业务轮 impl-writer 范围。S-17 闸门核验聚焦 R18 业务代码（apps/api/src + apps/web/src + docs/spec/web-auth-user.tech.md），R17 元资产改动不构成 R18 自报准确性违规（属另一轮次未提交产物）。

**S-17 结论**：impl-writer 自报改动范围与 git diff 实跑一致，无自报准确性违规。

## 6 · advisory 反向同步核实（AI-003，D10/D19/D9/D21）

> AI-003 advisory 偏离反向同步可验证性（RETRO-ROUND12 S-1）：impl-writer 须 `git diff` Spec 文件核实章节已改（非仅信代码注释声明）。

**核实方式**：直接读 `docs/spec/web-auth-user.tech.md` 改后内容（已在 §2 读取核对）。

| 偏离 | 反向同步目标 | 核实结论 | 证据（web-auth-user.tech.md 行号） |
|------|-------------|----------|------|
| D10 [advisory] 移除 | §4.6 + D10 标注移除/改历史 | ✅ 已实际改 | §4.6（L214-238）改标题"wire 字段名对齐 code（D10 已消除 R18）"+ 代码示例 `raw.code`（原 raw.error）+ 保留 safeParse+fallback 说明（D7，非 D10 残留）；D10（L475-476）改"[advisory]（R18 已消除，历史记录）" |
| D19 [advisory] 移除 | §1.2 + D19 标注移除 | ✅ 已实际改 | §1.2（L37-43）改标题"GET /v1/users/:id 端点（R18 已补齐，D19 已消除）"+ 正文说明端点已补齐；D19（L505-506）改"[advisory]（R18 已消除，历史记录）" |
| D9 重分类 [约束]（Q6 决策①） | D9 标注重分类 | ✅ 已实际改 | D9（L472-473）改"[约束]（R18 重分类，原 [advisory]-adjacent）"+ 正文说明 client 选择 409-retry 而非 GET-retry（Q6 决策①）；§4.5（L200-212）D9 重分类说明 |
| D21 [advisory] 保留（Q7 out of scope） | D21 标注保留 | ✅ 已实际改 | D21（L511-512）保留 [advisory]，正文说明"R18 已对齐 wire 字段名（D10 已消除），但 issues 仍存在（Q7 不本轮消除）"；§4.6（L238）说明保留手动读字段不直校 |

**client.ts 注释反向同步**（AC-W11）：

- L6：`错误体读 raw.code（D10 已消除）`（原"wire 适配 error→code"）
- L12-15：`[约束] D10 已消除（R18，TECH-USER-DETAIL-WIRE-001 D1）：wire 字段名已对齐 contracts errorResponseSchema.code，parseErrorResponse 直接读 raw.code，不再读 raw.error 适配`
- L62/L70-75：parseErrorResponse 注释改"D10 已消除 R18"+"保留 safeParse+fallback（D7，非 contracts 码 fallback，与 D10 wire 适配独立）"

**advisory 反向同步结论**：D10/D19 已实际移除标注（非伪同步），D9 重分类 [约束]，D21 保留 [advisory]。AI-003 闭合。

## 7 · ARCH / SEC 检查

### 7.1 ARCH-001 四层单向依赖（router→service→repository→domain）

- **router/user.ts** imports：`@admin/contracts` + `../service/user.js`（service 类型）+ `../repository/audit.js`（AuditLogRepository）+ `../db/connection.js` + `../context.js` + `./audit.js`。router→service/repository，方向正确。✅
- **service/user.ts** imports：`@admin/contracts` + `../repository/user.js` + `../service/audit.js` + `../context.js` + `../domain/user.js` + `../domain/version.js` + `../domain/audit.js` + `../domain/auth.js` + `../errors.js`。service→repository/domain，方向正确。✅
- 无反向 import（domain 不依赖 router/service）。lint:rules ARCH-001 enforcement 通过。✅

### 7.2 ARCH-002 contracts 纯净层

本轮 contracts 零变更（`git diff HEAD --stat -- packages/contracts/` 空）。errorResponseSchema/userSchema/errorCodeSchema 均不变。✅

### 7.3 ARCH-003 跨层只经契约（client.ts 仅 import @admin/contracts）

- **client.ts** imports（L16-17）：`import { errorCodeSchema, type ErrorCode } from '@admin/contracts';` + `import { getToken, clearToken } from '../auth/tokenStore.js';`。无 `apps/api/src/**` 越界。✅
- lint:rules ARCH-003 enforcement 通过（check-rules.mjs ARCH-003 分支扫描 apps/web/src/**/*.{ts,tsx}）。✅

### 7.4 SEC-002 service.getById 入口 requireAdmin

- service/user.ts L62 `this.requireAdmin(ctx);`（getById 入口第一行，先于 findById）。✅
- requireAdmin（L35-38）：`if (ctx.user.role !== 'admin') throw new AppError('FORBIDDEN', '需要管理员权限')`。✅
- 与既有 list/create/updateStatus + roleService.getById 同模式（D4）。✅
- 守卫顺序：buildCtx（401 系列）→ safeParse（400）→ handler requireAdmin（403 FORBIDDEN）→ findById（404 USER_NOT_FOUND），先到先返不叠加。✅
- user-detail.test.ts AC-G6 单测 + "requireAdmin 先于 findById"（非 admin+不存在→FORBIDDEN）验证。✅

### 7.5 SEC-003a password_hash 永不出响应

- service/user.ts L69 `return toUserOutput(target);`（getById 经 toUserOutput 剥离 password_hash）。✅
- toUserOutput（domain/user.ts 既有）剥离 password_hash，输出对齐 userSchema（.strict()）。✅
- user-detail.test.ts AC-G12 `.strict() 拒绝 password_hash` + `not.toHaveProperty('password_hash')`。✅
- user-detail-embedding.test.ts AC-G1 端到端 `body.password_hash===undefined`。✅

## 8 · §10 组合副作用预判验证（5 条）

对照 Tech-Spec §8.1 五条多 [约束] 组合副作用预判，核实 impl 是否如预判处理：

| # | 组合 | 预判要点 | 实现核实 | 结论 |
|---|------|----------|----------|------|
| 1 | wire 对齐(D1) + 409 重试(D3 既有 D9) | L594 `Object.assign(respBody, e.meta)` 不动，current_version 仍填充；client 读 raw.code + raw.current_version 重试 | server.ts L609-610 `{ code: e.code, message: e.message }` + `if (e.meta) Object.assign(respBody, e.meta)`（meta 合并逻辑零改动）；client.ts L214 `err.code === 'VERSION_CONFLICT' && err.current_version !== undefined` 读 raw.code+current_version | ✅ 如预判 |
| 2 | wire 对齐(D1) + 401 拦截(既有 D8) | 401 解析失败（非 JSON/缺 code）仍降级 UNAUTHORIZED 行为跳登录（不白屏）；parseErrorResponse fallback 路径不变 | client.ts L203 `if (err.code === 'INTERNAL_ERROR' \|\| AUTH_401_CODES.has(err.code as ErrorCode))` → INTERNAL_ERROR fallback 也触发 clearToken+redirect（不白屏）；L196 `safeReadJson` 解析失败返回 `{}` → parseErrorResponse → code=INTERNAL_ERROR | ✅ 如预判 |
| 3 | GET detail(D2) + ETag(D5) + 鉴权(D4) | 401/403/404/400 响应无 ETag header（仅 200+304 含 ETag）；cacheable 分支仅在 handler 成功后执行 | server.ts handle() L551 buildCtx→L572 safeParse→L583 handler→L592 cacheable 分支；错误抛出走 catch L604（不走 L592 ETag 分支）；401/403/404/400 响应无 ETag header（sendJson 不带 ETag）；user-detail-embedding.test.ts AC-G4/G5/G6 错误响应无 etag 断言（仅 AC-G7/G8/G9 成功响应断言 etag） | ✅ 如预判 |
| 4 | wire 对齐(D1) + 非 contracts 码 fallback(D7) | INTERNAL_ERROR round-trip 正确（server 发→client 收一致）；NOT_FOUND 降级 INTERNAL_ERROR | server.ts L619/L542 发 `{ code: 'INTERNAL_ERROR' }` / `{ code: 'NOT_FOUND' }`；client.ts L80-81 `errorCodeSchema.safeParse('INTERNAL_ERROR')` 失败→fallback `INTERNAL_ERROR`（round-trip 一致）；`safeParse('NOT_FOUND')` 失败→fallback `INTERNAL_ERROR`（降级） | ✅ 如预判 |
| 5 | GET detail(D2) + 路由匹配(D9) | matchRoute 按 method+段数匹配，/v1/users/abc（3 段）不误匹配 /v1/users/:userId/roles（4 段） | server.ts matchPattern L397 `if (pp.length !== ap.length) return null`（段数判定）+ L404 字面段判定；GET /v1/users/:id（3 段）与 4 段子资源路由段数不同；user-detail-embedding.test.ts AC-G10 端到端验证 3 段 GET 命中 detail ≠ 4 段 roles | ✅ 如预判 |

**§10 结论**：五条组合副作用预判全部如预判处理，无未预判副作用。

## 9 · S-18 / S-19 核实

### 9.1 S-18 errorMapping.ts 零变更

`git diff HEAD --stat -- apps/api/src/errorMapping.ts apps/api/src/errors.ts packages/contracts/` 实跑结果：**空输出（零变更）**。

- errorMapping.ts：USER_NOT_FOUND 已映射"用户不存在"（R16 已完成全码映射收尾），本轮无新码，零变更。✅ S-18 闭合。
- errors.ts：errorCodeToHttpStatus.USER_NOT_FOUND 已映射 404，零变更。✅
- packages/contracts/：errorResponseSchema/userSchema/errorCodeSchema 均不变（Q2 不扩 errorCodeSchema + Q8 复用 userSchema），零变更。✅

### 9.2 S-19 userDetailProcedureInputSchema 使用点数

`grep -rn "userDetailProcedureInputSchema" apps/api/src/` 实跑命中 5 行，其中实际使用点 = 2 处：

| 行 | 用途 | 类型 |
|----|------|------|
| router/user.ts:51 | `export const userDetailProcedureInputSchema = z.object({...}).strict()` | 定义 |
| router/user.ts:58 | `detail: Procedure<z.infer<typeof userDetailProcedureInputSchema>, User>` | 类型引用（z.infer） |
| router/user.ts:86 | `input: userDetailProcedureInputSchema` | **使用点 1**（procedure input 绑定） |
| server.ts:51 | `import { ..., userDetailProcedureInputSchema } from './router/user.js'` | import |
| server.ts:246 | `input: userDetailProcedureInputSchema` | **使用点 2**（route input 绑定） |

对照 S-19 阈值：使用场景 = 2 处（role detail roleDetailProcedureInputSchema + user detail userDetailProcedureInputSchema），≤3 处简单常量（单字段 `z.string().uuid()`），符合 [advisory] 沿用重复定义阈值，不强制提取共享 `idPathSchema`。✅ S-19 闭合。

## 10 · Blocker 清单 / Suggestion 清单

### Blocker 清单

**0 blocker。**

### Suggestion 清单

**1 suggestion（非阻断，已反向同步闭合）：**

**SUGGESTION-1 · userDetailProcedureInputSchema `.strict()` 偏离 Tech-Spec §4.4 [约束] 描述未反向同步**（✅ R18 收尾已反向同步闭合）

- **现象**：router/user.ts L51-53 `userDetailProcedureInputSchema = z.object({ id: z.string().uuid() }).strict()`，而 Tech-Spec §4.4（user-detail-and-wire-alignment.tech.md L246-248）描述为 `z.object({ id: z.string().uuid() })`（不带 `.strict()`）。参考模式 roleDetailProcedureInputSchema（router/role.ts L31-33）亦不带 `.strict()`。
- **根因**：test-writer 阶段在 user-detail.test.ts L219-221 新增 `safeParse({ id, extra }).success === false` 断言（超出 AC-G3 字面"id 非法 uuid"范围，属 test-writer 对输入校验的过简化扩展）。impl-writer 依据 AI-002（禁止改测试断言）添加 `.strict()` 以满足测试，并在代码注释（router/user.ts L47-48）显式标注"[约束] AC-G3：.strict() 拒绝多余字段（与 roleDetailProcedureInputSchema 非 strict 略有差异，AC-G3 测试明确要求 safeParse({ id, extra }) 失败；行为以测试为准，AI-002 不改断言）"。
- **AI-003 流程核对**：
  - 理由成立：✅（AI-002 优先测试断言，test-writer 已先于 impl-writer 落地 .strict() 断言）
  - Spec 反向同步：✅（R18 收尾已补：user-detail-and-wire-alignment.tech.md §4.4 L243-254 改为 `z.object({ id: z.string().uuid() }).strict()` + 追加 [约束] 演进标注，列明 test-writer AC-G3 扩展 + impl-writer AI-002 + 加性安全 + 验收对齐 + 三件套全绿）
  - 验收对齐：✅（1256 tests 全绿，AC-G3 端到端验证通过）
- **影响评估**：`.strict()` 是**加性安全**（拒绝多余字段，比 Spec 描述更严格），无功能回归、无安全风险、无验收偏离。仅造成 userDetailProcedureInputSchema 与 roleDetailProcedureInputSchema 的微小不一致（前者 strict，后者非 strict）。
- **判定**：非 blocker。因偏离属加性安全 + impl-writer 已在代码注释显式标注 + 根因为 test-writer 过简化扩展（非 impl-writer 越界）+ 三件套全绿 + 24 AC 全对齐。按 AI-003"理由成立 + 验收对齐 → 视为 Spec 已演进"精神，不阻断合入。
- **修复建议**（后续轮次或本轮补提交）：
  1. 反向同步 Tech-Spec §4.4：将 `z.object({ id: z.string().uuid() })` 改为 `z.object({ id: z.string().uuid() }).strict()`，并追加注释说明"`.strict()` 拒绝多余字段，AC-G3 测试要求，与 roleDetailProcedureInputSchema 非 strict 略有差异"。
  2. （可选）考虑 roleDetailProcedureInputSchema 是否也应加 `.strict()` 以保持 detail procedure input schema 一致性（future 轮次）。
- **责任归属**：test-writer（过简化扩展 AC-G3 范围）+ impl-writer（未反向同步 §4.4）。属流程改进项，非本轮 blocker。

## G6 自检声明

- **PRD AC 全覆盖**：24 条 AC（W1-W11 + G1-G13）逐条核对，24 对齐 / 0 偏离 / 0 未实现。
- **三件套全绿**：typecheck exit 0 / lint:rules exit 0 / test 1256 passed exit 0（实跑核对，非仅信自报）。
- **AI-002 测试断言未改**：git diff 抽样确认 ②类改动仅字段名 error→code，matcher 不变；setup 修正（setTimeout + segmentCounts）不改 expect 断言。
- **S-17 自报准确性**：git diff --stat 实跑与 impl-writer 自报一致（5 impl + 1 setup 修正）；R17 元改进轮残留改动非 R18 范围。
- **advisory 反向同步**：D10/D19 已实际移除标注（非伪同步），D9 重分类 [约束]，D21 保留 [advisory]。
- **ARCH-001/002/003 + SEC-002/003a**：四层单向依赖 + contracts 纯净层 + 跨层只经契约 + service requireAdmin + password_hash 永不出响应，全部闭合。
- **§10 组合副作用**：5 条预判全部如预判处理。
- **S-18/S-19**：errorMapping.ts 零变更；userDetailProcedureInputSchema 2 使用点 [advisory] 沿用。
- **0 blocker / 1 suggestion**（userDetailProcedureInputSchema .strict() 偏离 §4.4 未反向同步，加性安全，非阻断）。

**verdict = pass，G6 通过，R18 可合入（G7）。**
