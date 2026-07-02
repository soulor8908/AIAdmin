---
doc_type: Review-Report
id: REVIEW-ETAG-CACHING-001
tech_spec_ref: TECH-ETAG-CACHING-001
prd_ref: PRD-ETAG-CACHING-001
verdict: pass
created: 2026-07-02
---
# ETag 协商缓存 · Code Review 报告（第十轮演练）

评审范围：第十轮"ETag 协商缓存"PR 全部代码——F1 ETag 生成（detail 基于 version / list 基于 total-maxVersion）+ F2 If-None-Match 协商缓存（304 Not Modified）+ F3 list 端点 ETag + F4 缓存失效语义，以及 AI-006 三类标注 / AI-007 端到端验收 / ARCH-001 src/etag.ts 归属 / SEC-003a If-None-Match 宽容解析 / 与 R9 If-Match 对照五项验证。对照 `docs/prd/etag-caching.md`（17 个 AC：F1 4 + F2 4 + F3 5 + F4 3）、`docs/spec/etag-caching.tech.md`（D1~D13 决策 + §10 与 R9 对照表）与 `.trae/rules` 全部规则逐条核查。

本轮第十轮演练核心验证：①读条件协议扩展（HTTP 协商缓存，RFC 7232 Section 2.3/2.4，与 R9 写条件 If-Match 互补）②ETag 生成策略 SSOT（detail 复用 R9 version / list 用 total-maxVersion 组合键，Q1/Q2/Q5 决策①）③If-None-Match 宽容解析（缺失/非法→忽略返回 200，Q7 决策①，与 R9 严格解析形成对比）④304 协商缓存语义（匹配→304 空体+ETag header，Q3/Q6 决策①）⑤单层变更闭合（仅 server.ts 修改 + src/etag.ts 新增，contracts/domain/repo/service/router 全部零变更，验证 ARCH-001/ARCH-002 在 HTTP 读条件协议扩展下的稳定性）。

## 汇总

- blocker 数：**0**
- suggestion 数：**0**
- verdict：**pass**（三件套全绿 697/697；AI-007 PRD F1/F2/F3/F4 验收 17 条逐条对齐；AI-006 三类标注准确（①类 contracts 零变更 + git status 验证 / ②类既有测试零修改 + git status 验证 / ③类 32+12 新增测试覆盖 17 AC + 端到端全链路）；2 项 advisory 偏离均已评估并已反向同步 Tech-Spec）
- 三件套门禁复核（Reviewer 实跑）：
  - typecheck：`pnpm typecheck` exit 0，0 错误 ✅
  - lint:rules：`pnpm lint:rules` exit 0，13 项 enforcement + META-003/004 双向绑定 + 2 条 SEC-002 豁免审计 info + 6 条 AI-005 建议（R6 既有遗留，非本期新增） ✅
  - test：`pnpm test` exit 0，16 文件 697/697（audit 104 / audit-embedding 14 / dept 92 / etag-caching 32 / etag-caching-embedding 12 / notification 88 / notification-embedding 14 / optimistic-locking 22 / optimistic-locking-embedding 8 / report 86 / role 73 / role-inheritance 65 / role-inheritance-embedding 26 / transfer 25 / transfer-embedding 6 / user 35），5.30s ✅
- HTTP 运行时烟测：`etag-caching-embedding.test.ts` spawn 真实 server（port 4000）+ fetch 12 用例全链路通过（detail ETag 2 [notification+role] + list ETag 1 [user] + If-None-Match 协商 4 [匹配/不匹配/缺失/非法] + list 协商 2 [匹配/create后变化] + 缓存失效 2 [update/delete] + AC-F4-3 全链路 1），覆盖 PRD F1/F2/F3/F4 HTTP-level + 端到端全链路 ✅
- 规则机器化覆盖率：13/19 = 68%（与第八/九轮持平，本期不新增规则文件、不新增 markEnforcement 分支）

## 总体结论

三件套全绿，ETag 协商缓存三件套（F1 ETag 生成 + F2 If-None-Match 协商 + F3 list ETag + F4 缓存失效）实现质量高。AI-007 端到端测试（etag-caching-embedding.test.ts 12 用例）spawn 真实 HTTP server（port 4000）+ fetch 覆盖 PRD F1/F2/F3/F4 共 9 条 HTTP-level 断言（含 AC-F4-3 五步全链路协商缓存：GET(无INM)→200+ETag1 → GET(INM)→304 → update→v1 → GET(旧INM)→200+ETag2 → GET(新INM)→304），AI-007 关键——HTTP 读条件协议模式（If-None-Match 解析 → ETag 比对 → 304/200 决策）端到端可观测。

**本轮核心验证目标全部达成**：①读条件协议扩展在 server.ts 工程脚手架下闭合（Route.cacheable + buildEtag 标记 + parseIfNoneMatch 宽容解析 + handle() 304/200 决策 + sendJsonWithEtag）；②ETag 生成 SSOT 在 ARCH-002 下闭合（detail 复用 R9 version / list 用 total-maxVersion 组合键，无需 contracts 变更）；③单层变更在 ARCH-001 下闭合（仅 server.ts + src/etag.ts，contracts/domain/repo/service/router 全部零变更，git status 验证）；④AI-007 端到端 + Reviewer PRD 17 条逐条核对双轨闭合；⑤AI-006 三类标注完整（①类 contracts 零变更 / ②类既有测试零修改 / ③类 32+12 新增测试覆盖 17 AC + 端到端全链路）。2 项 advisory 偏离（§1 覆盖范围修正 user 无 detail 端点 + D2 src/etag.ts 归属偏离原 D2 工程脚手架描述）均已反向同步 Tech-Spec。

## AI-007 PRD 验收逐条核对（本轮核心硬要求）

对照 PRD `docs/prd/etag-caching.md` §验收标准（F1 ETag 生成 4 条 + F2 If-None-Match 协商 4 条 + F3 list ETag 5 条 + F4 缓存失效 3 条 = 17 条 Given/When/Then），逐条核对实现行为是否对齐。

### F1：ETag 生成（4 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F1-1 | §75 detail 响应含 ETag：GIVEN 任意实体存在 / WHEN GET detail / THEN 响应 header 含 `ETag: "version"`（引号包裹 version 数字） | `apps/api/src/etag.ts:21-25` detailEtag 返回 `"${r.version}"`（含引号，Q2 决策①）；`apps/api/src/server.ts:217-221` GET /v1/roles/:id cacheable=true buildEtag=detailEtag + `:300-304` GET /v1/notifications/:id cacheable=true buildEtag=detailEtag（D11，2 detail 路由标记）；`server.ts:498` sendJsonWithEtag(res, 200, result, etag) 在 200 响应追加 ETag header（D10） | `apps/api/test/etag-caching.test.ts:349-373` AC-F1-1（role detail + notification detail 通过 callProc 获取实体，detailEtag 格式 '"0"'）+ `apps/api/test/etag-caching-embedding.test.ts:177-198` HTTP-level（GET /v1/notifications/:id + GET /v1/roles/:id → 200 + ETag header，格式 /^"\d+"$/） | ✅ 对齐 |
| F1-2 | §76 ETag 随 version 递增：GIVEN User version=0 ETag="0" / WHEN updateStatus 成功 version→1 / THEN GET detail 响应 ETag="1" | `apps/api/src/etag.ts:23-24` detailEtag 提取 `r.version` 字段生成 ETag（version 变化则 ETag 变化）；service updateStatus +1（R9 落地，service/user.ts updateStatus 内 repo.updateStatus +1）→ version 变化后 detailEtag 自动跟随 | `apps/api/test/etag-caching.test.ts:375-387` AC-F1-2（User v0 → detailEtag='"0"' → updateStatus(0) → v1 → detailEtag='"1"'）+ `apps/api/test/etag-caching-embedding.test.ts:237-257` AC-F2-2 HTTP-level（notification v0 → update(If-Match=0) → v1 → ETag '"0"'→'"1"'） | ✅ 对齐 |
| F1-3 | §77 ETag 格式合规：GIVEN 任意 GET detail 响应 / WHEN 检查 ETag header / THEN 格式为 `"数字"`（双引号包裹纯数字，RFC 7232 强 ETag） | `apps/api/src/etag.ts:23-24` detailEtag 返回 `` `"${r.version}"` ``（双引号包裹，version 是 number 类型）；缺失 version 回退 `'"0"'`（D7 防御性）；format 永远匹配 `/^"\d+"$/` | `apps/api/test/etag-caching.test.ts:389-396` AC-F1-3（detailEtag 返回值 match /^"\d+"$/，4 个 version 值 + 缺失回退均合规）+ `apps/api/test/etag-caching-embedding.test.ts:185,194` HTTP-level（res.etag match /^"\d+"$/） | ✅ 对齐 |
| F1-4 | §78 内置 admin ETag 恒 "0"：GIVEN 内置 admin 角色 version=0 / WHEN GET detail / THEN ETag="0"（内置角色不可更新，ETag 恒定） | `apps/api/src/repository/role.ts` seedBuiltinAdmin 填 version=0（R9 落地）；内置 admin 不可达更新路径（service/role.ts delete B6 ROLE_BUILTIN_FORBIDDEN + setParent/unsetParent B6 ROLE_BUILTIN_FORBIDDEN）；detailEtag(admin) → `'"0"'` 恒定 | `apps/api/test/etag-caching.test.ts:398-413` AC-F1-4（admin role is_builtin=true, version=0, detailEtag='"0"'）+ `apps/api/test/etag-caching-embedding.test.ts:189-197` HTTP-level（GET /v1/roles/{adminRoleId} → ETag='"0"'） | ✅ 对齐 |

**F1 小结：4/4 对齐**。detailEtag 纯函数（src/etag.ts:21-25）从实体提取 version 生成强 ETag（Q2 决策①，引号包裹，RFC 7232）；2 detail 路由（role/notifications）标记 cacheable=true buildEtag=detailEtag（D11，server.ts:221/304）；200 响应经 sendJsonWithEtag 追加 ETag header（D10，server.ts:498）；version 缺失回退 '"0"'（D7 防御性）。内置 admin ETag 恒 '"0"'（不可达更新路径 + version=0 SSOT）。

### F2：If-None-Match 协商缓存（detail，4 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F2-1 | §81 ETag 匹配 → 304：GIVEN User version=0 ETag="0" / WHEN GET detail 携带 `If-None-Match: "0"` / THEN 返回 304 Not Modified + 空体 + ETag="0" header | `apps/api/src/server.ts:490-497` handle() cacheable 分支：`if (ifNoneMatch !== null && ifNoneMatch === etag)` → `res.writeHead(304, { 'ETag': etag, 'Content-Length': 0 }); res.end();`（D9，Q3/Q6 决策①空体+ETag header）；`apps/api/src/etag.ts:56-62` parseIfNoneMatch('"0"') → '"0"'（合法引号格式返回 ETag 字符串） | `apps/api/test/etag-caching.test.ts:420-434` AC-F2-1 单层模拟（negotiate(etag,'"0"')===304）+ `apps/api/test/etag-caching-embedding.test.ts:222-235` HTTP-level（GET detail If-None-Match=etag → 304 + 空 body） | ✅ 对齐 |
| F2-2 | §82 ETag 不匹配 → 200：GIVEN User version=1 ETag="1" / WHEN GET detail 携带 `If-None-Match: "0"`（过期）/ THEN 返回 200 + 最新实体 + ETag="1" | `apps/api/src/server.ts:498` handle() cacheable 分支不匹配时 → `sendJsonWithEtag(res, 200, result, etag);`（D9，200+body+新 ETag header） | `apps/api/test/etag-caching.test.ts:436-458` AC-F2-2 单层模拟（update v0→v1, negotiate(etag='"1"','"0"')===200）+ `apps/api/test/etag-caching-embedding.test.ts:237-257` HTTP-level（update→v1, GET If-None-Match='"0"' → 200 + ETag='"1"'） | ✅ 对齐 |
| F2-3 | §83 缺失 If-None-Match → 200：GIVEN 任意实体 / WHEN GET detail 不携带 If-None-Match / THEN 返回 200 + 实体 + ETag（无条件 GET） | `apps/api/src/etag.ts:57-58` parseIfNoneMatch(undefined) → null（缺失）；`apps/api/src/server.ts:492-497` ifNoneMatch===null → 不进 304 分支 → fall through 到 sendJsonWithEtag 200（D9） | `apps/api/test/etag-caching.test.ts:460-474` AC-F2-3 单层模拟（negotiate(etag,undefined)===200）+ `apps/api/test/etag-caching-embedding.test.ts:259-266` HTTP-level（不携带 If-None-Match → 200 + ETag='"0"'） | ✅ 对齐 |
| F2-4 | §84 If-None-Match 格式非法 → 忽略 200：GIVEN 任意实体 / WHEN GET detail 携带 `If-None-Match: abc`（非引号格式）/ THEN 返回 200 + 实体 + ETag（宽容解析，忽略非法 header） | `apps/api/src/etag.ts:60-61` parseIfNoneMatch('abc') → null（非引号格式，Q7 决策①宽容）；`apps/api/src/server.ts:492-497` ifNoneMatch===null → 200 + ETag（D9，忽略非法不报错） | `apps/api/test/etag-caching.test.ts:476-490` AC-F2-4 单层模拟（negotiate(etag,'abc')===200）+ `apps/api/test/etag-caching-embedding.test.ts:268-277` HTTP-level（If-None-Match='abc' → 200 + ETag='"0"'） | ✅ 对齐 |

**F2 小结：4/4 对齐**。parseIfNoneMatch 宽容解析（src/etag.ts:56-62）三分支：undefined/空 → null（缺失）；非引号格式 → null（非法，Q7 决策①宽容）；合法引号格式 → ETag 字符串。handle() cacheable 分支（server.ts:490-500）：ifNoneMatch !== null && === etag → 304 空体+ETag header；否则 200 + body + ETag header（D9）。304 响应不含 Last-Modified（Q6 决策①）。2 detail 路由均标记 cacheable=true（D11）。

### F3：list 端点 ETag（5 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F3-1 | §87 list 响应含 ETag：GIVEN 任意 list 查询 / WHEN GET list / THEN 响应 header 含 `ETag: "total-maxVersion"` | `apps/api/src/etag.ts:34-46` listEtag 从 `{items, total}` 提取 total + max(version) 返回 `"${total}-${maxVersion}"`（Q5 决策②组合键）；`apps/api/src/server.ts:191` GET /v1/users cacheable=true buildEtag=listEtag + `:215` GET /v1/roles + `:298` GET /v1/notifications（D11，3 list 路由标记）；server.ts:498 sendJsonWithEtag 200 追加 ETag header | `apps/api/test/etag-caching.test.ts:497-509` AC-F3-1 单层（user list listEtag match /^"\d+-\d+"$/，2 seed users v0 → '"2-0"'）+ `apps/api/test/etag-caching-embedding.test.ts:204-216` HTTP-level（GET /v1/users → ETag match /^"\d+-\d+"$/，从 body 计算 total+maxVersion 验证 ETag 值） | ✅ 对齐 |
| F3-2 | §88 list ETag 匹配 → 304：GIVEN list ETag="3-5" / WHEN GET list 携带 `If-None-Match: "3-5"` / THEN 返回 304 + 空体 + ETag="3-5" | `apps/api/src/server.ts:490-497` handle() cacheable 分支同 detail（listEtag 生成的 ETag 与 parseIfNoneMatch 比对，匹配→304空体+ETag header）；listEtag 输出含引号，parseIfNoneMatch 接受引号格式 → 匹配 304 | `apps/api/test/etag-caching.test.ts:511-521` AC-F3-2 单层（negotiate(etag,etag)===304）+ `apps/api/test/etag-caching-embedding.test.ts:284-296` HTTP-level（GET /v1/users 拿 ETag → 二次 GET If-None-Match=etag → 304 + 空 body） | ✅ 对齐 |
| F3-3 | §89 create 后 list ETag 变化：GIVEN list ETag="3-5"（3 条 maxVersion=5）/ WHEN create 新用户（version=0）/ THEN GET list ETag="4-5"（total=4，maxVersion 仍 5 因新用户 version=0 < 5） | `apps/api/src/etag.ts:38-45` listEtag 计算 total + max(items.version)；create 触发 total+1（service/user.ts create 调 repo.insert），新用户 version=0 < maxVersion=5 → max 不变 → ETag "3-5"→"4-5"（Q5 决策②组合键精确捕获 total 变化） | `apps/api/test/etag-caching.test.ts:523-546` AC-F3-3 单层（setupUserWithVersions 3 用户 v=[0,5,2] → listEtag '"3-5"' → create 新用户 → listEtag '"4-5"' → negotiate(afterEtag,'"3-5"')===200）+ `apps/api/test/etag-caching-embedding.test.ts:298-314` HTTP-level（GET list → create user → GET list 旧 If-None-Match → 200 + 新 ETag !== 旧 ETag） | ✅ 对齐 |
| F3-4 | §90 update 后 list ETag 变化：GIVEN list ETag="3-5" / WHEN update 某用户 version 5→6 / THEN GET list ETag="3-6"（total 不变，maxVersion 5→6） | `apps/api/src/etag.ts:40-44` listEtag max(items.version) 计算；update 触发 maxVersion 变化（service updateStatus +1，5→6）→ ETag "3-5"→"3-6"（Q5 决策②组合键精确捕获 max 变化） | `apps/api/test/etag-caching.test.ts:548-568` AC-F3-4 单层（setupUserWithVersions 3 用户 v=[0,5,2] → listEtag '"3-5"' → updateStatus(TARGET,disabled,5) → v=[0,6,2] → listEtag '"3-6"' → negotiate(afterEtag,'"3-5"')===200） | ✅ 对齐 |
| F3-5 | §91 list If-None-Match 缺失 → 200：GIVEN 任意 list / WHEN GET list 不携带 If-None-Match / THEN 返回 200 + 结果集 + ETag | `apps/api/src/etag.ts:57-58` parseIfNoneMatch(undefined) → null；`apps/api/src/server.ts:492-497` ifNoneMatch===null → 200 + ETag（D9，list 与 detail 同流程） | `apps/api/test/etag-caching.test.ts:570-580` AC-F3-5 单层（negotiate(etag,undefined)===200）+ `apps/api/test/etag-caching-embedding.test.ts:204-216` HTTP-level（GET /v1/users 不携带 If-None-Match → 200 + ETag） | ✅ 对齐 |

**F3 小结：5/5 对齐**。listEtag 纯函数（src/etag.ts:34-46）从 `{items, total}` 提取 total + max(version) 生成 `"${total}-${maxVersion}"`（Q5 决策②组合键，create 触发 total 变化 / update 触发 maxVersion 变化 / delete 触发 total 变化）；3 list 路由（user/role/notifications）标记 cacheable=true buildEtag=listEtag（D11，server.ts:191/215/298）。AC-F3-3 单层断言 "3-5"→"4-5"（精确值）+ HTTP-level 断言 ETag 变化（not.toBe 旧 ETag），AC-F3-4 单层断言 "3-5"→"3-6"（精确值），覆盖 PRD §89/§90 的 ETag 变化语义。

### F4：缓存失效语义（3 条）

| # | PRD 验收点（Given/When/Then，行号） | 实现行为 | 测试覆盖 | 对齐结论 |
|---|---|---|---|---|
| F4-1 | §94 update 后 detail 304→200：GIVEN 客户端持 User ETag="0" + 服务端 version=0 / WHEN update version→1 + GET detail 携带 If-None-Match: "0" / THEN 返回 200 + 新实体 + ETag="1"（缓存失效，返回最新） | `apps/api/src/etag.ts:23-24` detailEtag 跟随 version（v1→'"1"'）；`apps/api/src/server.ts:490-498` handle() cacheable 分支：旧 If-None-Match='"0"' 与新 ETag='"1"' 不匹配 → sendJsonWithEtag 200（D9） | `apps/api/test/etag-caching.test.ts:587-619` AC-F4-1 单层（notification create→v0 ETag='"0"', negotiate('"0"','"0"')===304 → update(v0)→v1 ETag='"1"', negotiate('"1"','"0"')===200）+ `apps/api/test/etag-caching-embedding.test.ts:320-344` HTTP-level（GET → 200 ETag='"0"' → GET If-None-Match='"0"' → 304 → update → GET If-None-Match='"0"' → 200 ETag='"1"'） | ✅ 对齐 |
| F4-2 | §95 delete 后 list 304→200：GIVEN 客户端持 list ETag="3-5" / WHEN delete 某用户 / THEN GET list 携带 If-None-Match: "3-5" → 返回 200 + 新结果集 + 新 ETag（total 3→2） | `apps/api/src/etag.ts:38-45` listEtag total 跟随结果集（delete 触发 total-1）；`apps/api/src/server.ts:490-498` 旧 If-None-Match='"3-5"' 与新 ETag（total-1 后变化）不匹配 → 200 + 新 ETag | `apps/api/test/etag-caching.test.ts:621-645` AC-F4-2 单层（notification 3 条 v=[0,5,2] ETag='"3-5"', negotiate===304 → delete 第一条 → 2 条 v=[5,2] ETag='"2-5"', negotiate('"2-5"','"3-5"')===200）+ `apps/api/test/etag-caching-embedding.test.ts:346-372` HTTP-level（GET list → ETag1 → GET If-None-Match=ETag1 → 304 → delete → GET list If-None-Match=ETag1 → 200 + 新 ETag !== ETag1） | ✅ 对齐 |
| F4-3 | §96 端到端协商缓存全链路：GIVEN 首次 GET detail（无 If-None-Match）→ 200 + ETag="0" / WHEN 二次 GET 携带 If-None-Match: "0" → 304 / THEN update version→1 + 三次 GET 携带 If-None-Match: "0" → 200 + ETag="1" + 四次 GET 携带 If-None-Match: "1" → 304（全链路协商缓存正确） | `apps/api/src/server.ts:490-500` handle() cacheable 分支完整覆盖四步：① 无 If-None-Match → 200+ETag ② 匹配 → 304 ③ update 后旧 If-None-Match 不匹配 → 200+新ETag ④ 新 If-None-Match 匹配 → 304；`apps/api/src/etag.ts:21-25` detailEtag 跟随 version（v0→'"0"' / v1→'"1"'） | `apps/api/test/etag-caching-embedding.test.ts:378-419` AC-F4-3 HTTP-level 五步全链路（step1 GET→200+ETag1='"0"' / step2 GET If-None-Match=etag1→304+空body / step3 update(If-Match='0')→200 v1 / step4 GET If-None-Match=etag1→200+ETag2='"1"' / step5 GET If-None-Match=etag2→304+空body） | ✅ 对齐 |

**F4 小结：3/3 对齐**。缓存失效语义在 detail + list 双场景闭合：update 触发 version+1 → detail ETag 变化（detailEtag 跟随 version）+ list ETag 变化（listEtag max 跟随 version）；delete 触发 total-1 → list ETag 变化（listEtag total 跟随结果集）。AC-F4-3 五步全链路 HTTP 端到端验证协商缓存正确性（200→304→update→200+新ETag→304），是本轮 AI-007 端到端验收的核心硬要求。

### AI-007 PRD 逐条核对总结

- **F1 ETag 生成**：4/4 对齐（detailEtag 纯函数 + 2 detail 路由 cacheable + 200 ETag header + 内置 admin 恒 '"0"'）
- **F2 If-None-Match 协商**：4/4 对齐（parseIfNoneMatch 宽容解析 + handle() 304/200 决策 + 304 空体+ETag header + 缺失/非法忽略 200）
- **F3 list ETag**：5/5 对齐（listEtag total-maxVersion 组合键 + 3 list 路由 cacheable + create/update/delete 触发 ETag 变化精确捕获）
- **F4 缓存失效**：3/3 对齐（update→detail 304→200 + delete→list 304→200 + AC-F4-3 五步全链路 HTTP 端到端）
- **合计**：17/17 对齐，0 偏离

**AI-007 是否生效**：✅ **生效**。etag-caching.test.ts 32 用例（单测 + service/HTTP-header 层行为测，覆盖 F1/F2/F3/F4 共 15 AC + 单测 9 + 契约测 2 + 辅助 6）+ etag-caching-embedding.test.ts 12 用例（HTTP 端到端，覆盖 F1/F2/F3/F4 共 9 AC HTTP-level + AC-F4-3 五步全链路）对照 PRD 17 条 Given/When/Then 产出断言。端到端测试 spawn 真实 HTTP server（npx tsx apps/api/src/server.ts，port 4000）+ fetch 发起 HTTP 请求，覆盖 server.ts 的 ETag 生成（D7）、If-None-Match 解析（D8）、304 协商决策（D9）、sendJsonWithEtag（D10）、5 路由 cacheable 标记（D11）等 HTTP 层行为。Reviewer 按 PRD 17 条验收逐条核对无 [约束] 偏离。

## AI-006 受影响测试清单校验（本轮核心）

### 清单章节存在性 + 三类标注完整性
- **章节存在**：Tech-Spec §8 D12 受影响测试清单存在，三类标注齐全 ✅
- **三类标注**：
  - ①类·contracts 联动（本期零变更）：D1 contracts 零变更（无新增 schema/错误码/errorResponse 字段），①类无影响
  - ②类·既有测试加 ETag 断言：D12 声明"既有测试无需修改"（ETag 是新增 header 不破坏 body 断言，304 是新行为既有测试不携带 If-None-Match 故仍 200）
  - ③类·新增协商缓存测试：etag-caching.test.ts 32 tests + etag-caching-embedding.test.ts 12 tests
- **三类均覆盖，缺一无** ✅ 满足 AI-006 增强硬要求

### ①类 contracts 联动校验（本期零变更）

- **D1 零变更声明**：Tech-Spec §2 D1 显式声明"无新增 schema / 无新增错误码 / 无 errorResponseSchema 扩展"，理由"ETag/If-None-Match/304 是 HTTP 协议层语义，contracts 层（Zod schema SSOT）仅管实体/输入契约，不管 HTTP header"。
- **git status 验证**：`git status packages/contracts/ apps/api/src/domain/ apps/api/src/repository/ apps/api/src/service/ apps/api/src/router/` 输出 "nothing to commit, working tree clean"——contracts/domain/repository/service/router 五层全部零变更 ✅
- **新增 src 文件**：仅 `apps/api/src/etag.ts`（HTTP 层工具模块，layerOf 返回 null，不属四层反向依赖范围）+ `apps/api/src/server.ts` 修改（工程脚手架，advisory 已声明）
- **ETag 生成不进 contracts 是否合理**：✅ 合理。ETag 是 HTTP 响应 header（`ETag: "0"`），非实体字段（实体已有 R9 version 字段）；If-None-Match 是 HTTP 请求 header，非 procedure input 字段（与 R9 If-Match 注入 expected_version 不同——If-None-Match 是读优化不进入 service 层，server.ts 直接比对 ETag）；304 是成功响应码非错误，不进 errorCodeSchema。验证 ARCH-002（contracts SSOT 边界）在 HTTP 协议扩展下闭合。

**①类结论**：✅ contracts 零变更经 git status 验证，①类无影响声明准确。

### ②类 既有测试加 ETag 断言校验（本期零修改）

- **D12 ②类声明**：Tech-Spec §8 D12 声明"既有 embedding 测试主要断言响应体（body），不断言 header。经核查，既有 embedding 测试的 GET 断言聚焦 body 内容（如 `expect(res.body.items).toHaveLength(...)`），不断言 header。②类影响：既有测试无需修改（ETag 是新增 header，不破坏既有 body 断言；304 是新行为，既有测试不携带 If-None-Match 故仍 200）"。
- **git status 验证**：`git status apps/api/test/` 输出仅 2 个 untracked 新增文件（etag-caching-embedding.test.ts + etag-caching.test.ts），既有测试文件零修改 ✅
- **grep 验证**：grep "ETag|etag" 既有 embedding 测试文件（notification-embedding/role-inheritance-embedding/optimistic-locking-embedding/audit-embedding/transfer-embedding）→ 0 匹配，既有测试不引用 ETag ✅
- **304 不影响既有测试断言**：既有测试 GET 请求不携带 If-None-Match → parseIfNoneMatch 返回 null → 走 sendJsonWithEtag 200 分支（D9），既有 200 + body 断言仍成立 ✅
- **ETag header 不破坏既有 body 断言**：ETag 是新增响应 header，不改变响应体（sendJsonWithEtag 与 sendJson 仅 header 差异，body 同样 JSON.stringify）✅

**②类结论**：✅ 既有测试零修改经 git status + grep 双重验证，D12 ②类声明准确。

### ③类 新增协商缓存测试校验

Tech-Spec §8 D13 要求：etag-caching.test.ts 32 tests（单测 + 14 AC 行为测）+ etag-caching-embedding.test.ts 12 tests（端到端 HTTP + AC-F4-3 全链路）。Reviewer 核实：

**etag-caching.test.ts（32 tests，单测 + service/HTTP-header 行为测）**：
- 单测 detailEtag：4 tests（`apps/api/test/etag-caching.test.ts:271-291`，version=0/5/缺失/格式合规）
- 单测 listEtag：4 tests（`:294-313`，total+maxVersion 计算 / 缺失回退 / max 计算）
- 单测 parseIfNoneMatch：7 tests（`:316-343`，合法引号/含连字符/undefined/空串/无引号/纯数字/缺右引号）
- F1 ETag 生成：4 tests（AC-F1-1~F1-4，`:349-413`）
- F2 If-None-Match 协商：4 tests（AC-F2-1~F2-4，`:420-490`，negotiate 模拟 server.ts D9 决策）
- F3 list ETag：5 tests（AC-F3-1~F3-5，`:497-580`）
- F4 缓存失效：2 tests（AC-F4-1~F4-2，`:587-645`）
- ①类契约测：2 tests（`:651-667`，实体 schema 含 version + list schema 含 items/total SSOT 依赖断言）
- 合计 32 tests ✅

**etag-caching-embedding.test.ts（12 tests，端到端 HTTP）**：
- F1 detail ETag：2 tests（`:177-198`，notification + role 内置 admin HTTP-level）
- F1 list ETag：1 test（`:204-216`，user list ETag "total-maxVersion" 格式 + 从 body 计算验证）
- F2 If-None-Match 协商：4 tests（`:222-277`，匹配→304 / 不匹配→200 / 缺失→200 / 非法→200）
- F3 list 协商：2 tests（`:284-314`，匹配→304 / create 后变化→200）
- F4 缓存失效：2 tests（`:320-372`，update→detail 304→200 / delete→list 304→200）
- AC-F4-3 全链路：1 test（`:378-419`，五步端到端协商缓存）
- 合计 12 tests ✅

**17 AC 覆盖分布**：
- F1-1~F1-4（4）：etag-caching.test.ts 单层（callProc + detailEtag）+ F1-1/F1-4 额外在 etag-caching-embedding.test.ts HTTP-level 覆盖 ✅
- F2-1~F2-4（4）：etag-caching.test.ts 单层（negotiate 模拟）+ 全部 4 AC 在 etag-caching-embedding.test.ts HTTP-level 覆盖 ✅
- F3-1~F3-5（5）：etag-caching.test.ts 单层 + F3-1/F3-2/F3-3 额外在 etag-caching-embedding.test.ts HTTP-level 覆盖 ✅
- F4-1~F4-2（2）：etag-caching.test.ts 单层 + 全部 2 AC 在 etag-caching-embedding.test.ts HTTP-level 覆盖 ✅
- F4-3 全链路（1）：etag-caching-embedding.test.ts:378-419 HTTP 端到端五步 ✅

**③类结论**：✅ 32+12 新增测试覆盖 17 AC + 端到端 AC-F4-3 全链路。端到端测试 spawn 真实 HTTP server（npx tsx apps/api/src/server.ts port 4000）+ fetch，覆盖 server.ts ETag 生成（D7）+ If-None-Match 解析（D8）+ 304 协商决策（D9）+ sendJsonWithEtag（D10）+ 5 路由 cacheable 标记（D11）。

### AI-006 本轮是否生效
✅ **生效**。三类标注完整：
- ①类 contracts 零变更经 git status 验证（packages/contracts/ + 四层全部 clean）
- ②类 既有测试零修改经 git status + grep 双重验证（既有测试文件零修改 + 不引用 ETag）
- ③类 32+12 新增测试覆盖 17 AC + 端到端 AC-F4-3 全链路（spawn 真实 server + fetch）

## AI-001 越界检查

R10 新增导出符号均可溯源至 Tech-Spec §2~§7 决策：

| 新增符号 | 溯源 Tech-Spec 决策 | 文件:行号 |
|---|---|---|
| `detailEtag` 函数 | D7 ETag 生成函数（detail） | `apps/api/src/etag.ts:21` |
| `listEtag` 函数 | D7 ETag 生成函数（list） | `apps/api/src/etag.ts:34` |
| `parseIfNoneMatch` 函数 | D8 parseIfNoneMatch 宽容解析 | `apps/api/src/etag.ts:56` |
| `Route.cacheable` 字段 | D6 Route 类型追加 cacheable | `apps/api/src/server.ts:144` |
| `Route.buildEtag` 字段 | D6 Route 类型追加 buildEtag | `apps/api/src/server.ts:148` |
| `defineRoute` 参数 `cacheable = false` | D6 defineRoute 追加 cacheable 参数 | `apps/api/src/server.ts:163` |
| `defineRoute` 参数 `buildEtag?` | D6 defineRoute 追加 buildEtag 参数 | `apps/api/src/server.ts:164` |
| `sendJsonWithEtag` 函数 | D10 sendJsonWithEtag helper | `apps/api/src/server.ts:396` |
| handle() 304 协商缓存流程 | D9 handle() 304 流程 | `apps/api/src/server.ts:488-500` |
| 5 路由标记 cacheable=true + buildEtag | D11 5 个读路由标记 | `apps/api/src/server.ts:191/215/221/298/304` |
| `negotiate` 辅助函数（测试专用） | D13 测试矩阵（行为测模拟 server.ts D9 决策） | `apps/api/test/etag-caching.test.ts:75` |

- **结论**：✅ 所有新增导出符号均可溯源至 Tech-Spec §2~§7 决策，无越界。
- **未在 Spec 中的新增导出**：无。`negotiate` 是测试文件内部辅助函数（非 src 导出），用于模拟 server.ts D9 的 304/200 决策（D13 测试矩阵明确"行为测通过 callProc + ETag 比对模拟 server.ts D9 决策"），不属越界。
- **5 路由而非 6 路由**：advisory 偏离（user 无 detail 端点，Tech-Spec §1 已修正覆盖范围为 5 路由），实现 server.ts 标记 5 路由 cacheable=true（GET /v1/users / GET /v1/roles / GET /v1/roles/:id / GET /v1/notifications / GET /v1/notifications/:id），与 Tech-Spec §1 [advisory] 修正后的覆盖范围对齐（详见下文 advisory 偏离评估）。

## advisory 偏离评估（AI-003）

### 偏离 1：§1 [advisory] 覆盖范围修正（user 无 detail 端点，5 路由而非 6 路由）

**偏离内容**：PRD §功能点清单假设 user 有 detail 端点（GET /v1/users/:id），但实际 server.ts 路由表 user 域仅有 list/create/updateStatus/transfer，**无 detail 端点**（UserService 无 detail 方法，UserRouter 无 detail procedure）。Tech-Spec §1 [advisory] 显式声明覆盖范围修正为 5 路由（2 detail + 3 list），user detail 端点补齐为 out of scope（避免 AI-001 越界——补齐 detail 端点属新增业务功能非本期 ETag 协议扩展）。

**理由评估**：
- ✅ **理由成立**。补齐 user detail 端点属新增业务功能（UserService.detail + UserRouter.detail + server.ts GET /v1/users/:id 路由），非本期 ETag 协议扩展范围。AI-001 越界原则要求"对 Spec 未提及项：一律禁止"，user detail 端点未在 PRD/Spec 范围内，补齐将构成越界。
- ✅ **覆盖范围修正合理**。5 路由（2 detail + 3 list）已覆盖 PRD F1（detail ETag）+ F3（list ETag）两类 ETag 生成策略；F2（detail 协商）通过 role/notification detail 验证；F4（缓存失效）通过 notification detail + user/notification list 验证。覆盖范围足以验证 PRD 17 AC（user 无 detail 故 F1 仅 2 实体，Tech-Spec D13 已声明）。
- ✅ **Tech-Spec §1 已反向同步**。`docs/spec/etag-caching.tech.md` §1 含 [advisory] 标注 "PRD §功能点清单假设 user 有 detail 端点（GET /v1/users/:id），但实际 server.ts 路由表 user 域仅有 list/create/updateStatus/transfer，**无 detail 端点**"，并明确修正后覆盖范围（2 detail + 3 list）+ out of scope 声明。

**反向同步评估**：
- ✅ **Tech-Spec §1 [advisory] 已同步**。Reviewer 核实 `docs/spec/etag-caching.tech.md:15-18` 含完整 [advisory] 标注（覆盖范围修正理由 + 修正后覆盖范围 + out of scope 声明），消除单向漂移。

**处置**：✅ **合规，不记 blocker/suggestion**。advisory 偏离理由成立 + Tech-Spec 已反向同步 + 验收对齐（PRD 17/17 AC）+ 5 路由覆盖足以验证 F1/F2/F3/F4 全部 AC。

### 偏离 2：D2 src/etag.ts 归属偏离（原 D2 说 server.ts 工程脚手架，后修正为 src/etag.ts 独立模块）

**偏离内容**：R10 早期 D2 描述 ETag helper 归属 server.ts 工程脚手架；后修正为 src/etag.ts 独立模块（HTTP 层工具模块，与 server.ts 同层——src/ 根目录，layerOf 返回 null，不受 ARCH-001 四层反向依赖约束），server.ts import 这些 helper。

**理由评估**：
- ✅ **理由成立**。server.ts 是入口文件有 listen 副作用，测试不可直接 import；提取到独立模块 src/etag.ts 便于单测（etag-caching.test.ts:34 直接 `import { detailEtag, listEtag, parseIfNoneMatch } from '../src/etag.js'`）。这与 domain/version.ts validateVersion 纯函数下沉（R9 D5）同模式——纯函数提取到独立模块便于单测 + 避免入口文件副作用。
- ✅ **ARCH-001 合规**。src/etag.ts 文件位于 src/ 根目录（非 src/domain/service/repository/router 四层），layerOf 返回 null，不受 ARCH-001 四层反向依赖约束。grep 验证 `apps/api/src/etag.ts` 无任何 import（纯函数模块），不依赖任何上层。
- ✅ **ARCH-002 合规**。ETag 生成不进 contracts（HTTP header 格式化非实体字段），不污染契约 SSOT。
- ✅ **Tech-Spec §3 D2 已反向同步**。`docs/spec/etag-caching.tech.md:36` D2 明确 "归属：ETag helper（detailEtag/listEtag/parseIfNoneMatch）放 `src/etag.ts`（HTTP 层工具模块，与 server.ts 同层——src/ 根目录，layerOf 返回 null，不受 ARCH-001 四层反向依赖约束）。server.ts import 这些 helper。**不放 domain**（domain 持领域规则不感知 HTTP）+ **不放 server.ts 内部**（server.ts 是入口文件有 listen 副作用，测试不可直接 import，提取到独立模块便于单测）。"

**反向同步评估**：
- ✅ **Tech-Spec §3 D2 已同步**。Reviewer 核实 `docs/spec/etag-caching.tech.md:36` 含完整 D2 归属说明（src/etag.ts 独立模块 + 理由 + 不放 domain/server.ts 内部的权衡），消除单向漂移。

**处置**：✅ **合规，不记 blocker/suggestion**。advisory 偏离理由成立（便于单测 + 避免入口副作用）+ Tech-Spec 已反向同步 + ARCH-001/ARCH-002 合规 + src/etag.ts 纯函数模块无 import。

### 其他偏离检查

Reviewer 全面扫描 diff，未发现其他偏离：
- ARCH-001：`apps/api/src/etag.ts` 0 import（grep 验证）；server.ts import etag 合规（server.ts 是入口脚手架，import HTTP 层工具模块同层）；service/domain/repository/router 零变更（git status 验证） ✅
- ARCH-002：contracts 零变更（git status 验证）；ETag 生成放 src/etag.ts 不进 contracts ✅
- SEC-001：5 cacheable 路由不改变 auth（route.auth 从 procedure.auth 派生，无 override） ✅
- SEC-002：service 零变更（git status 验证），无 requireAdmin 改动 ✅
- SEC-003a：If-None-Match 不进 schema safeParse（server.ts:492 在 safeParse 之后、handler 成功之后的 cacheable 分支解析），Q7 决策①宽容解析 ✅
- CODE-001：无 `: any` / `as any`（grep `apps/api/src/etag.ts` + `apps/api/test/etag-caching*.test.ts` + `apps/api/src/server.ts` 0 匹配） ✅
- CODE-002：无空 catch / 仅 console catch（src/etag.ts 无 catch；server.ts:502-515 catch 含 console.error + sendJson 500 既有模式） ✅
- CODE-003：无 eval/new Function（grep 0 匹配） ✅
- 无其他 [advisory] 偏离或 [约束] 项偏离。

## 规则合规（META-001/003/004 + ARCH + CODE + SEC）

| 规则 | 校验 | 结论 |
|---|---|---|
| META-001 | 本期不新增规则文件、不新增 markEnforcement 分支；既有 13 项规则均含"校验方式"段且含机器校验关键词 | ✅ pass |
| META-003 | 本期不新增 markEnforcement 项（复用既有 13 项验证 HTTP 读条件协议新领域）；check-rules 输出 13 项 enforcement 与规则文档双向绑定，无声明漂移 | ✅ pass |
| META-004 | 脚本 13 项 enforcement 均有规则文档块；本期不新增规则故无新增块 | ✅ pass |
| ARCH-001 | `apps/api/src/etag.ts` 0 import（grep 验证 `import` 0 匹配，纯函数模块）；server.ts import etag 合规（同层 HTTP 工具）；service/domain/repository/router 零变更（git status 验证 "nothing to commit, working tree clean"）；src/etag.ts 位于 src/ 根目录 layerOf 返回 null 不受四层反向依赖约束 | ✅ pass |
| ARCH-002 | contracts/ 零变更（git status 验证）；ETag 生成（detailEtag/listEtag/parseIfNoneMatch）放 src/etag.ts 不进 contracts（HTTP header 格式化非实体字段，与 R9 validateSetParent/transitionStatus/version.validateVersion 同先例：domain/HTTP 层纯函数不污染 contracts SSOT） | ✅ pass |
| CODE-001 | 无 `: any` / `as any`（grep `apps/api/src/etag.ts` + `apps/api/test/etag-caching.test.ts` + `apps/api/test/etag-caching-embedding.test.ts` + `apps/api/src/server.ts` 0 匹配）；etag.ts 用 `result as { version?: unknown }` + `typeof` 类型守卫；测试文件用 unknown + 类型守卫 + 具体接口（EntityLike/ResponseBody/HttpResponse/NotificationEntity/UserEntity） | ✅ pass |
| CODE-002 | 无空 catch / 仅 console catch：`apps/api/src/etag.ts` 无 catch（纯函数无 IO）；`apps/api/src/server.ts:502-515` catch 含 console.error + sendJson 500（既有模式，与 R9 同）；测试文件无 catch | ✅ pass |
| CODE-003 | 无 eval/new Function（grep 4 文件 0 匹配） | ✅ pass |
| CODE-004 | 新增函数命名一致：`detailEtag` / `listEtag` / `parseIfNoneMatch` / `sendJsonWithEtag`（动词+名词+Etag/IfNoneMatch 后缀，与 R9 `parseIfMatch` / `validateVersion` 同模式）；新增 Route 字段 `cacheable` / `buildEtag`（与 R9 `versioned` 同模式，布尔标记 + 可选 builder） | ✅ pass |
| SEC-001 | 5 cacheable 路由不改变 auth：`server.ts:191` GET /v1/users auth 从 userRouter.list.auth 派生；`:215` GET /v1/roles auth 从 roleRouter.list.auth 派生；`:217-221` GET /v1/roles/:id auth 从 roleRouter.detail.auth 派生；`:298` GET /v1/notifications auth 从 notificationRouter.list.auth 派生；`:300-304` GET /v1/notifications/:id auth 从 notificationRouter.detail.auth 派生（defineRoute 内 `auth: procedure.auth`，cacheable 标记不覆盖 auth） | ✅ pass |
| SEC-002 | 读操作无 requireAdmin 变更：service 零变更（git status 验证 "nothing to commit, working tree clean"）；cacheable 是 server.ts Route 标记，不进入 service 层；读 procedure auth='admin' 由 router 既有声明（无改动） | ✅ pass |
| SEC-003a | If-None-Match 宽容解析不进 schema safeParse（Q7 决策①）：`server.ts:492` parseIfNoneMatch 在 `route.handler(parsed.data, ctx)` 之后调用（safeParse 之后、handler 成功之后的 cacheable 分支），不进入 procedure input schema；parseIfNoneMatch 宽容解析（缺失/非引号→null 忽略，非 400 错误）；与 R9 parseIfMatch 严格解析（safeParse 之前拦截，缺失→VERSION_REQUIRED 400 / 非法→VALIDATION_ERROR 400）形成对比；SEC-003a check-rules 仅扫 contracts 输出 schema（输出 schema 均 .strict()），If-None-Match 不在扫描范围 | ✅ pass |

## 与 R9 对照验证（Tech-Spec §10）

Reviewer 核实 Tech-Spec §10 R10 与 R9 对照表准确性：

| 维度 | R9 If-Match（写条件） | R10 If-None-Match（读条件） | Reviewer 核实 |
|---|---|---|---|
| header 格式 | 纯数字 version（`If-Match: 0`） | 引号 ETag（`If-None-Match: "0"`，Q2 决策①） | ✅ server.ts:418 parseIfMatch `/^\d+$/`（纯数字）；etag.ts:60 parseIfNoneMatch `/^"[^"]*"$/`（引号格式） |
| 解析策略 | 严格（缺失→VERSION_REQUIRED 400 / 非法→VALIDATION_ERROR 400） | 宽容（缺失/非法→忽略，返回 200，Q7 决策①） | ✅ server.ts:414-421 parseIfMatch 三分支（缺失→VERSION_REQUIRED / 非法→VALIDATION_ERROR / 合法→ok）；etag.ts:56-62 parseIfNoneMatch 两分支（缺失/非法→null / 合法→ETag 字符串） |
| 语义 | 写条件（防 lost update） | 读条件（协商缓存，省带宽） | ✅ R9 versioned 写路由 8 个；R10 cacheable 读路由 5 个 |
| 匹配失败 | VERSION_CONFLICT 409（含 current_version） | 200 + 最新内容 + 新 ETag | ✅ R9 service 抛 AppError('VERSION_CONFLICT', ..., {current_version}) → server.ts:506-508 合并 meta；R10 server.ts:498 sendJsonWithEtag 200+新ETag |
| 匹配成功 | 更新成功 200 | 304 Not Modified 空体 + ETag | ✅ R9 service update 成功 → 200；R10 server.ts:493-496 304 + ETag + Content-Length:0 |
| 响应扩展 | errorResponseSchema 追加 current_version（D3） | 304 空体 + ETag header（无 body） | ✅ R9 contracts/schemas/user.ts errorResponseSchema current_version；R10 server.ts:494 writeHead 304 仅 ETag+Content-Length |
| Route 标记 | versioned: boolean（8 写路由） | cacheable: boolean（5 读路由） | ✅ server.ts 8 versioned 路由（R9 落地）+ 5 cacheable 路由（R10 D11） |
| 影响层 | contracts + domain + repo + service + router + server（全栈） | **仅 server.ts**（contracts/domain/repo/service/router 零变更） | ✅ R9 全栈变更（D1 version 字段 + D5 validateVersion + D7 repo +1 + D9 守卫顺序 + D15 procedure input + D17 server.ts versioned）；R10 git status 验证仅 server.ts 修改 + src/etag.ts 新增 |
| 新增错误码 | VERSION_REQUIRED / VERSION_CONFLICT | 无（304 非错误） | ✅ R9 errorCodeSchema 追加 2 码；R10 contracts 零变更无新错误码 |

**核心验证点**：✅ R10 影响层仅 server.ts + src/etag.ts，验证 ARCH-001/ARCH-002 在 HTTP 读条件协议扩展下的稳定性——读条件协商缓存是纯 HTTP 层语义，不污染领域层。与 R9（写条件影响全栈）形成对比，证明 spec-first 工作流对不同协议扩展的适应性（写条件全栈变更 / 读条件单层变更）。

## 测试覆盖与三件套

- **三件套真绿**：✅ Reviewer 实跑 typecheck exit 0（0 错误）/ lint:rules exit 0（13 enforcement + 2 SEC-002 豁免 info + 6 AI-005 建议[R6 既有遗留，非本期新增]）/ test exit 0（16 文件 697/697，5.30s）
- **AI-007 端到端覆盖**：✅ etag-caching-embedding.test.ts 12 用例 spawn 真实 HTTP server（port 4000）+ fetch 覆盖 PRD F1 3 条 + F2 4 条 + F3 3 条 + F4 3 条 HTTP-level（含 AC-F4-3 五步全链路）
- **service/HTTP-header 单层覆盖**：✅ etag-caching.test.ts 32 用例覆盖 detailEtag/listEtag/parseIfNoneMatch 纯函数单测（15）+ F1/F2/F3/F4 共 15 AC 行为测（negotiate 模拟 server.ts D9 决策）+ ①类契约测（2）
- **②类既有测试零修改**：✅ git status 验证既有测试文件零修改 + grep 验证既有测试不引用 ETag
- **HTTP 运行时烟测**：✅ etag-caching-embedding.test.ts 12 用例 spawn 真实 server（npx tsx apps/api/src/server.ts port 4000）+ fetch，全链路通过（detail ETag 2 + list ETag 1 + If-None-Match 协商 4 + list 协商 2 + 缓存失效 2 + AC-F4-3 全链路 1），HTTP 200/304 全链路通过
- **stderr 输出**：本轮 etag-caching 测试无 stderr 噪声；audit-embedding 的 best-effort 吞异常 console.warn 是既有预期输出（withAudit D1 模式），非缺陷 ✅

## 本轮亮点

1. **读条件协议扩展单层变更闭合**：R10 仅修改 server.ts（51 insertions / 6 deletions）+ 新增 src/etag.ts（62 行纯函数模块），contracts/domain/repo/service/router 全部零变更（git status 验证 "nothing to commit, working tree clean"）。这是与前九轮（特别是 R9 全栈变更）显著不同的工作流模式——读条件协商缓存是纯 HTTP 层语义，不污染领域层。验证 ARCH-001/ARCH-002 在 HTTP 读条件协议扩展下的稳定性，与 R9（写条件影响全栈）形成对比，证明 spec-first 工作流对不同协议扩展的适应性（写条件全栈变更 / 读条件单层变更）。
2. **ETag 生成 SSOT 复用 R9 version**：detailEtag 复用 R9 已落地的 version 字段（`"${version}"`，Q1 决策①），不引入内容 hash 双源；listEtag 用 total-maxVersion 组合键（Q5 决策②，create 触发 total 变化 / update 触发 maxVersion 变化 / delete 触发 total 变化，覆盖主要变更场景）；ETag 生成不进 contracts（HTTP header 格式化非实体字段），保持 contracts SSOT 边界。AC-F3-3 单层断言 "3-5"→"4-5"（create 触发 total+1，maxVersion 不变）+ AC-F3-4 单层断言 "3-5"→"3-6"（update 触发 maxVersion+1，total 不变），精确验证组合键的捕获能力。
3. **If-None-Match 宽容解析与 R9 严格解析形成对比**：parseIfNoneMatch（src/etag.ts:56-62）两分支——缺失/空→null / 非引号格式→null（Q7 决策①宽容，忽略不报错）；与 R9 parseIfMatch（server.ts:411-422）三分支——缺失→VERSION_REQUIRED 400 / 非法→VALIDATION_ERROR 400 / 合法→ok——形成鲜明对比。语义匹配：写条件严格（防 lost update 强一致性）/ 读条件宽容（缓存优化非强一致性，避免缓存优化导致请求失败）。AC-F2-3（缺失→200）+ AC-F2-4（非法→忽略 200）HTTP-level 验证宽容解析行为可观测。
4. **304 协商缓存语义标准实现**：handle() cacheable 分支（server.ts:490-500）完整实现 RFC 7232 协商缓存——匹配→304 空体+ETag header+Content-Length:0（Q3/Q6 决策①，不含 Last-Modified）/ 不匹配/缺失/非法→200+body+ETag header（sendJsonWithEtag）。sendJsonWithEtag（server.ts:396-404）与 sendJson 同模式追加 ETag header，不破坏既有 body 序列化。AC-F4-3 五步全链路 HTTP 端到端验证（200→304→update→200+新ETag→304），是 RFC 7232 协商缓存语义的完整端到端验收。
5. **AI-007 端到端 + Reviewer PRD 17 条逐条核对双轨闭合**：etag-caching-embedding.test.ts 12 用例 spawn 真实 HTTP server（port 4000）+ fetch 覆盖 PRD F1 3 条 + F2 4 条 + F3 3 条 + F4 3 条 HTTP-level，关键 AC-F4-3 五步全链路协商缓存（GET(无INM)→200+ETag1 → GET(INM)→304 → update→v1 → GET(旧INM)→200+ETag2 → GET(新INM)→304）端到端断言。Reviewer 按 PRD 17 条验收逐条核对 0 偏离。
6. **AI-006 三类标注完整闭合**：①类 contracts 零变更经 git status 验证（packages/contracts/ + 四层全部 clean）；②类 既有测试零修改经 git status + grep 双重验证（既有测试文件零修改 + 不引用 ETag）；③类 32+12 新增测试覆盖 17 AC + 端到端 AC-F4-3 全链路。三类标注完整闭合，且 ①类/②类"零变更/零修改"声明经 git 客观验证（非主观判断）。
7. **src/etag.ts 独立模块便于单测**：ETag helper（detailEtag/listEtag/parseIfNoneMatch）提取到 src/etag.ts 独立模块（D2），与 R9 domain/version.ts validateVersion 纯函数下沉同模式——纯函数提取便于单测（etag-caching.test.ts:34 直接 import）+ 避免入口文件副作用（server.ts 有 listen 副作用测试不可直接 import）。src/etag.ts 0 import（纯函数模块，grep 验证），ARCH-001 合规。
8. **2 项 advisory 偏离均已反向同步 Tech-Spec**：①§1 [advisory] 覆盖范围修正（user 无 detail 端点，5 路由而非 6 路由）—— Tech-Spec §1 已含完整 [advisory] 标注（理由 + 修正后覆盖范围 + out of scope 声明）；②D2 src/etag.ts 归属偏离（原 D2 说 server.ts 工程脚手架，后修正为 src/etag.ts 独立模块）—— Tech-Spec §3 D2 已含完整归属说明（src/etag.ts 独立模块 + 理由 + 不放 domain/server.ts 内部的权衡）。两项偏离均按 AI-003 advisory 偏离处理流程反向同步，消除单向漂移。

## 本轮问题

### Blocker（0）
无。本轮无 [约束] 偏离，PRD 17 条验收逐条对齐。

### Suggestion（0）
无。本轮实现质量高，advisory 偏离均已反向同步 Tech-Spec，规则合规全 pass，测试覆盖完整（17 AC + 端到端 AC-F4-3 五步全链路），无工作流改进建议。

## 门禁复核（Reviewer 实跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| typecheck | `pnpm typecheck` | exit 0，0 错误 |
| lint:rules | `pnpm lint:rules` | exit 0，13 项 enforcement（AI-005/ARCH-001/ARCH-002/CODE-001/CODE-002/CODE-003/CODE-004/META-001/META-003/META-004/SEC-001/SEC-002/SEC-003a）+ META-003/004 双向绑定 + 2 条 SEC-002 豁免审计 info（markRead + record，R9 既有遗留）+ 6 条 AI-005 建议（R6 既有遗留：role-inheritance/role-inheritance-embedding 硬编码枚举字面量，非本期新增） |
| test | `pnpm test` | exit 0，16 文件 697/697（audit 104 / audit-embedding 14 / dept 92 / etag-caching 32 / etag-caching-embedding 12 / notification 88 / notification-embedding 14 / optimistic-locking 22 / optimistic-locking-embedding 8 / report 86 / role 73 / role-inheritance 65 / role-inheritance-embedding 26 / transfer 25 / transfer-embedding 6 / user 35），5.30s |
| HTTP 烟测 | etag-caching-embedding.test.ts spawn server(port 4000) + fetch 12 用例 | 12/12 通过（detail ETag 2 [notification+role 内置 admin] + list ETag 1 [user] + If-None-Match 协商 4 [匹配/不匹配/缺失/非法] + list 协商 2 [匹配/create后变化] + 缓存失效 2 [update/delete] + AC-F4-3 全链路 1），HTTP 200/304 全链路通过 |

三件套全绿，且**本轮全绿 = 验收对齐**——AI-007 端到端测试 + Reviewer PRD 17 条逐条核对双轨验证，未发现 [约束] 偏离。HTTP 读条件协议扩展（ETag 生成 + If-None-Match 协商缓存 + 304 Not Modified）在前九轮的工作流下成功落地，且为单层变更（仅 server.ts + src/etag.ts），与 R9 全栈变更形成对比。

## 最终结论

**verdict: pass**。

- **0 项 blocker**：本轮无 [约束] 偏离，PRD F1/F2/F3/F4 共 17 条验收逐条对齐（F1 4/4 + F2 4/4 + F3 5/5 + F4 3/3）。
- **0 项 suggestion**：本轮实现质量高，2 项 advisory 偏离均已反向同步 Tech-Spec（§1 覆盖范围修正 + D2 src/etag.ts 归属），规则合规全 pass，测试覆盖完整（17 AC + 端到端 AC-F4-3 五步全链路），无工作流改进建议。
- **AI-007 PRD 逐条核对结论**：17/17 对齐，0 偏离。
  - F1 ETag 生成（4/4）：detailEtag 纯函数 + 2 detail 路由 cacheable + 200 ETag header + 内置 admin 恒 '"0"'
  - F2 If-None-Match 协商（4/4）：parseIfNoneMatch 宽容解析 + handle() 304/200 决策 + 304 空体+ETag header + 缺失/非法忽略 200
  - F3 list ETag（5/5）：listEtag total-maxVersion 组合键 + 3 list 路由 cacheable + create/update/delete 触发 ETag 变化精确捕获
  - F4 缓存失效（3/3）：update→detail 304→200 + delete→list 304→200 + AC-F4-3 五步全链路 HTTP 端到端
- **AI-006 三类标注校验结论**：✅ 生效。三类标注完整且经客观验证：
  - ①类 contracts 零变更：git status 验证 packages/contracts/ + domain/repo/service/router 五层 "nothing to commit, working tree clean"
  - ②类 既有测试零修改：git status 验证既有测试文件零修改 + grep 验证既有测试不引用 ETag
  - ③类 32+12 新增测试：覆盖 17 AC + 端到端 AC-F4-3 全链路（spawn 真实 server port 4000 + fetch）
- **advisory 偏离评估结论**：2 项 advisory 偏离均已反向同步 Tech-Spec，理由成立 + 验收对齐。
  - §1 [advisory] 覆盖范围修正（user 无 detail 端点，5 路由而非 6 路由）：理由成立（补齐 user detail 属新增业务功能非本期 ETag 协议扩展，AI-001 越界原则要求禁止）+ Tech-Spec §1 已同步 [advisory] 标注 → 合规。
  - D2 src/etag.ts 归属偏离（原 D2 说 server.ts 工程脚手架，后修正为 src/etag.ts 独立模块）：理由成立（server.ts 有 listen 副作用测试不可直接 import，提取独立模块便于单测）+ Tech-Spec §3 D2 已同步完整归属说明 → 合规。
- **本轮 AI-007/AI-006 是否生效**：✅ **均生效**。
  - AI-007：端到端测试（etag-caching-embedding.test.ts 12 用例 spawn 真实 server port 4000 + fetch 覆盖 F1 3 + F2 4 + F3 3 + F4 3 HTTP-level + AC-F4-3 五步全链路）+ Reviewer PRD 17 条逐条核对（17/17 对齐）双轨闭合，关键 AC-F4-3 五步全链路协商缓存端到端断言（GET(无INM)→200+ETag1 → GET(INM)→304 → update→v1 → GET(旧INM)→200+ETag2 → GET(新INM)→304）。
  - AI-006：三类标注完整且经客观验证（①类 git status contracts/ 零变更 / ②类 git status + grep 既有测试零修改 / ③类 32+12 新增测试覆盖 17 AC + 端到端全链路）。
- **本轮核心验证目标达成**：①读条件协议扩展在 server.ts 工程脚手架下闭合（Route.cacheable + buildEtag + parseIfNoneMatch + handle() 304/200 决策 + sendJsonWithEtag）；②ETag 生成 SSOT 在 ARCH-002 下闭合（detail 复用 R9 version / list 用 total-maxVersion 组合键，无需 contracts 变更）；③单层变更在 ARCH-001 下闭合（仅 server.ts + src/etag.ts，git status 验证 contracts/domain/repo/service/router 全部零变更）；④AI-007 端到端 + AI-006 三类标注双轨闭合；⑤与 R9 对照表准确性验证（写条件全栈变更 vs 读条件单层变更 / 严格 vs 宽容 / 纯数字 vs 引号 ETag）。
- **最值得关注的发现**：**HTTP 读条件协议扩展（ETag + If-None-Match + 304）在前九轮的工作流下成功落地，且为单层变更（仅 server.ts 51 insertions + src/etag.ts 62 行新增）**——验证了 spec-first 工作流对"读条件 HTTP 协议扩展"的适应性，与 R9（写条件全栈变更）形成对比。ETag 生成复用 R9 version SSOT（不引入内容 hash 双源）+ If-None-Match 宽容解析（与 R9 严格解析形成对比）+ 304 协商缓存标准语义（RFC 7232）三项设计决策在 ARCH-001/ARCH-002/SEC-003a 下闭合，且 2 项 advisory 偏离（§1 覆盖范围修正 + D2 src/etag.ts 归属）均已按 AI-003 流程反向同步 Tech-Spec。下一轮可考虑：（1）补齐 user detail 端点（PRD §out of scope 已声明，避免 AI-001 越界）；（2）扩展到计算型端点（effective-permissions/inheritance-chain/tree）的 ETag（PRD §out of scope Q4 决策②）；（3）OpenAPI yaml 同步（PRD §out of scope 已声明，沿用既有先例）。
