---
doc_type: TECH-Spec
id: TECH-ETAG-CACHING-001
title: ETag 协商缓存 Tech-Spec
prd_ref: PRD-ETAG-CACHING-001
status: decided
created: 2026-07-02
---

# TECH-ETAG-CACHING-001 · ETag 协商缓存 Tech-Spec

## 1. 概述
在既有 user/role/notification 三域的 GET 读端点上追加 ETag 生成 + If-None-Match 条件读 + 304 Not Modified 协商缓存。GET detail（role/notification）+ GET list（user/role/notification）响应追加 `ETag` header（detail 基于 `version`，list 基于 `total-maxVersion`）；客户端携带 `If-None-Match` header，匹配则 304 空体 + ETag header，不匹配则 200 + 最新内容 + ETag header。

**[advisory] 覆盖范围修正（PRD 起草假设 vs 实际路由表）**：PRD §功能点清单假设 user 有 detail 端点（GET /v1/users/:id），但实际 server.ts 路由表 user 域仅有 list/create/updateStatus/transfer，**无 detail 端点**（UserService 无 detail 方法，UserRouter 无 detail procedure）。本期覆盖范围修正为：
- detail 端点（2 个）：GET /v1/roles/:id + GET /v1/notifications/:id
- list 端点（3 个）：GET /v1/users + GET /v1/roles + GET /v1/notifications
- user detail 端点补齐为 out of scope（避免 AI-001 越界——补齐 detail 端点属新增业务功能非本期 ETag 协议扩展）

**核心特点：变更集中在 server.ts（HTTP 层），contracts/domain/service/repository/router 零变更**。这验证 ARCH-001/ARCH-002 在 HTTP 读条件协议扩展下的稳定性——ETag 是 HTTP 层 header 语义，非实体字段/领域逻辑，不污染领域层。R9 的 version 字段（已在实体 schema + service 返回值中）直接被 server.ts 用于生成 ETag，无需领域层感知 ETag。

## 2. 契约层变更（contracts）

### D1 · 零变更（ETag 是 HTTP header 非 contracts 字段）
- **无新增 schema / 无新增错误码 / 无 errorResponseSchema 扩展**。
- ETag 是 HTTP 响应 header（`ETag: "0"`），非实体字段（实体已有 `version` 字段，R9 落地）。
- If-None-Match 是 HTTP 请求 header，非 procedure input 字段（与 R9 If-Match 注入 expected_version 不同——If-None-Match 是读优化，不进入 service 层，server.ts 直接比对 ETag）。
- 304 是成功响应码（非错误），不进 errorCodeSchema。
- **理由**：ETag/If-None-Match/304 是 HTTP 协议层语义，contracts 层（Zod schema SSOT）仅管实体/输入契约，不管 HTTP header。这验证 ARCH-002（contracts SSOT 边界）在 HTTP 协议扩展下闭合——协议扩展不污染契约层。

## 3. domain 层变更

### D2 · 零变更（ETag 生成是 HTTP 层非领域逻辑）
- **无新增 domain 纯函数**。
- ETag 生成逻辑（detail: `"${version}"` / list: `"${total}-${maxVersion}"`）是 HTTP 层 header 格式化，非领域规则（无业务语义，纯格式）。
- **归属**：ETag helper（detailEtag/listEtag/parseIfNoneMatch）放 `src/etag.ts`（HTTP 层工具模块，与 server.ts 同层——src/ 根目录，layerOf 返回 null，不受 ARCH-001 四层反向依赖约束）。server.ts import 这些 helper。**不放 domain**（domain 持领域规则不感知 HTTP）+ **不放 server.ts 内部**（server.ts 是入口文件有 listen 副作用，测试不可直接 import，提取到独立模块便于单测）。
- **理由**：domain 层持领域规则（状态机/环检测/版本校验等），ETag 格式化是 HTTP 层职责。若未来 ETag 策略变化（如改内容 hash），仅改 src/etag.ts，不动 domain。这验证 ARCH-001（domain 不感知 HTTP）在协议扩展下闭合。

## 4. repository 层变更

### D3 · 零变更
- repository 已提供 list（返回 items + total）和 findById（返回实体含 version），server.ts 直接从 service 返回值提取 version 生成 ETag，无需 repository 新增方法。

## 5. service 层变更

### D4 · 零变更
- service 返回值已含 version（R9 落地）：
  - detail：RoleService.detail / NotificationService.detail 返回实体含 version
  - list：UserService.list / RoleService.list / NotificationService.list 返回 `{items: [...], total, ...}`，items 各项含 version
- server.ts 从 service 返回值提取 version 生成 ETag，service 不感知 ETag。

## 6. router 层变更

### D5 · 零变更
- router procedure 的 input/handler/auth 不变。ETag 是 server.ts 在 handler 成功后追加的 header，不进入 procedure 执行链。
- **读 procedure 无 versioned 标记**（versioned 是 R9 写路由标记，读路由 versioned=false）。R10 新增 cacheable 标记仅在 server.ts Route 类型，不在 router procedure。

## 7. server.ts 变更（核心，全部变更集中于此）

### D6 · Route 类型追加 cacheable + buildEtag 字段
```ts
type Route = {
  method: string;
  pattern: string;
  buildInput: (m: MatchCtx) => unknown;
  inputSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  handler: (input: unknown, ctx: Ctx) => Promise<unknown>;
  auth: 'admin' | 'public';
  versioned: boolean;
  /** 是否支持 ETag 协商缓存（TECH-ETAG-CACHING-001 D6）。cacheable=true 时，handle() 在 handler 成功后生成 ETag + 比对 If-None-Match。 */
  cacheable: boolean;
  /** ETag 生成函数（cacheable=true 时必填）。输入为 handler 返回值，输出为 ETag 字符串（含引号，如 "0" / "3-5"）。 */
  buildEtag?: (result: unknown) => string;
};
```
- `cacheable: boolean` 缺省 false（与 versioned 同模式）。
- `buildEtag?: (result: unknown) => string` 仅 cacheable=true 时有意义。
- defineRoute 追加 `cacheable = false` + `buildEtag?` 参数。

### D7 · ETag 生成函数（src/etag.ts 导出，server.ts import）
```ts
/** detail ETag：基于实体 version（引号包裹，RFC 7232 强 ETag）。 */
function detailEtag(result: unknown): string {
  const r = result as { version?: number };
  if (typeof r?.version !== 'number') return '"0"';
  return `"${r.version}"`;
}

/** list ETag：基于 total-maxVersion 组合键（引号包裹）。 */
function listEtag(result: unknown): string {
  const r = result as { total?: number; items?: { version?: number }[] };
  const total = typeof r?.total === 'number' ? r.total : 0;
  const items = Array.isArray(r?.items) ? r.items : [];
  const maxVersion = items.reduce((m, x) => {
    const v = typeof x?.version === 'number' ? x.version : 0;
    return Math.max(m, v);
  }, 0);
  return `"${total}-${maxVersion}"`;
}
```
- 归属 `src/etag.ts`（HTTP 层工具模块，导出供 server.ts import + 测试 import——见 D2）。
- detailEtag：从实体提取 version，格式 `"${version}"`。
- listEtag：从 `{items, total}` 提取 total + max(version)，格式 `"${total}-${maxVersion}"`（Q5 决策②）。
- 防御性：version/total/items 缺失时回退 `"0"` / `"0-0"`（不抛错，保证 ETag 生成不阻断请求）。

### D8 · parseIfNoneMatch 宽容解析（与 parseIfMatch 严格解析对比）
```ts
/**
 * 解析 If-None-Match header 为 ETag（TECH-ETAG-CACHING-001 D8）。
 * 接受 RFC 7232 强 ETag 引号格式（如 "0" / "3-5"）。
 * [约束] Q7 决策①宽容解析：缺失/格式非法 → 返回 null（忽略 header，返回 200），非错误。
 *   与 R9 parseIfMatch 严格解析形成对比——写条件严格（缺失→VERSION_REQUIRED 400）/ 读条件宽容（缺失/非法→忽略 200）。
 * @returns ETag 字符串（含引号）或 null（缺失/格式非法，忽略）。
 */
function parseIfNoneMatch(headerValue: string | undefined): string | null {
  if (headerValue === undefined || headerValue.trim() === '') return null;
  const trimmed = headerValue.trim();
  // RFC 7232 强 ETag：双引号包裹（允许内部含除引号外字符）
  if (!/^"[^"]*"$/.test(trimmed)) return null;
  return trimmed;
}
```
- 缺失 → null（正常 200，无条件 GET）。
- 非引号格式（如 `abc` / `0` 纯数字）→ null（忽略，返回 200，Q7 决策①宽容）。
- 合法引号格式（如 `"0"` / `"3-5"`）→ 返回 ETag 字符串（含引号）。
- **与 R9 parseIfMatch 对比**：parseIfMatch 严格（缺失→VERSION_REQUIRED / 非法→VALIDATION_ERROR），parseIfNoneMatch 宽容（缺失/非法→null 忽略）。语义匹配：写条件严格 / 读条件宽容。

### D9 · handle() 304 协商缓存流程
handle() 在 handler 成功后（result !== undefined 分支）追加 ETag 协商缓存逻辑：
```ts
const result = await route.handler(parsed.data, ctx);
if (result === undefined) {
  res.writeHead(204, { 'Content-Length': 0 });
  res.end();
  return;
}
// [约束] TECH-ETAG-CACHING-001 D9：cacheable 路由在 handler 成功后生成 ETag + 比对 If-None-Match。
if (route.cacheable && route.buildEtag) {
  const etag = route.buildEtag(result);
  const ifNoneMatch = parseIfNoneMatch(req.headers['if-none-match'] as string | undefined);
  if (ifNoneMatch !== null && ifNoneMatch === etag) {
    // ETag 匹配 → 304 Not Modified（空体 + ETag header，Q3/Q6 决策①）
    res.writeHead(304, { 'ETag': etag, 'Content-Length': 0 });
    res.end();
    return;
  }
  // ETag 不匹配或 If-None-Match 缺失/非法 → 200 + body + ETag header
  sendJsonWithEtag(res, 200, result, etag);
  return;
}
sendJson(res, 200, result);
```
- **304 响应**：空体 + `ETag` header + `Content-Length: 0`（Q6 决策①，不含 Last-Modified）。
- **200 响应（cacheable）**：body + `ETag` header（sendJsonWithEtag）。
- **200 响应（非 cacheable）**：原 sendJson（无 ETag）。

### D10 · sendJsonWithEtag helper
```ts
/** 发送 JSON 响应 + ETag header（TECH-ETAG-CACHING-001 D10）。 */
function sendJsonWithEtag(res: ServerResponse, status: number, body: unknown, etag: string): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'ETag': etag,
  });
  res.end(payload);
}
```
- 与 sendJson 同模式，追加 ETag header。

### D11 · 5 个读路由标记 cacheable + buildEtag
```ts
// detail 端点（2 个）—— buildEtag: detailEtag
defineRoute('GET', '/v1/roles/:id', ..., roleRouter.detail, false, true, detailEtag),
defineRoute('GET', '/v1/notifications/:id', ..., notificationRouter.detail, false, true, detailEtag),
// list 端点（3 个）—— buildEtag: listEtag
defineRoute('GET', '/v1/users', ..., userRouter.list, false, true, listEtag),
defineRoute('GET', '/v1/roles', ..., roleRouter.list, false, true, listEtag),
defineRoute('GET', '/v1/notifications', ..., notificationRouter.list, false, true, listEtag),
```
- defineRoute 签名扩展：`defineRoute(method, pattern, buildInput, procedure, versioned=false, cacheable=false, buildEtag?)`。
- 5 个读路由标记 cacheable=true + 对应 buildEtag。
- 其余读路由（tree/effective-permissions/inheritance-chain/audit-logs/reports/roles-of-user）cacheable=false（out of scope，Q4 决策②）。

## 8. 测试策略

### D12 · AI-006 受影响测试清单三类标注

**①类 · contracts 联动（无变更）**：
- 本期 contracts 零变更（D1），无新增 schema/错误码/errorResponse 字段。
- ①类无影响（ETag 是 HTTP header 非 contracts 字段）。

**②类 · 既有测试加 ETag 断言**：
- 既有 embedding 测试（端到端 HTTP 测试）若断言 GET 响应，需追加 ETag header 断言。
- 但既有 embedding 测试主要断言响应体（body），不断言 header。经核查，既有 embedding 测试的 GET 断言聚焦 body 内容（如 `expect(res.body.items).toHaveLength(...)`），不断言 header。
- **②类影响：既有测试无需修改**（ETag 是新增 header，不破坏既有 body 断言；304 是新行为，既有测试不携带 If-None-Match 故仍 200）。

**③类 · 新增协商缓存测试（新建 `etag-caching.test.ts` + `etag-caching-embedding.test.ts`）**：
- `etag-caching.test.ts`：单层/契约测（ETag 生成纯函数单测 + parseIfNoneMatch 单测 + 14 个 AC 行为测）。
- `etag-caching-embedding.test.ts`：端到端 HTTP 测（spawn server + fetch，覆盖 AC-F4-3 全链路协商缓存）。

### D13 · 测试矩阵（覆盖 PRD 17 个 AC，F1 4 + F2 4 + F3 5 + F4 3；user 无 detail 故 F1 仅 2 实体）

**etag-caching.test.ts（service/HTTP-header 单测 + 行为测）**：
- 单测 detailEtag / listEtag / parseIfNoneMatch（格式正确/缺失/非法引号/纯数字）
- F1 ETag 生成（AC-F1-1~F1-4）：detail 响应含 ETag / ETag 随 version 递增 / ETag 格式合规 / 内置 admin ETag 恒 "0"
- F2 If-None-Match 协商（AC-F2-1~F2-4）：匹配→304 / 不匹配→200 / 缺失→200 / 格式非法→忽略 200
- F3 list ETag（AC-F3-1~F3-5）：list 含 ETag / 匹配→304 / create 后 ETag 变 / update 后 ETag 变 / 缺失→200
- F4 缓存失效（AC-F4-1~F4-2）：update 后 detail 304→200 / delete 后 list 304→200

**etag-caching-embedding.test.ts（端到端 HTTP）**：
- AC-F4-3 端到端协商缓存全链路：首次 GET(无 If-None-Match)→200+ETag → 二次 GET(If-None-Match:旧)→304 → update → 三次 GET(If-None-Match:旧)→200+新ETag → 四次 GET(If-None-Match:新)→304
- 端到端 lost cache 防护（与 R9 lost update 防护对照）

## 9. 实现顺序

1. **contracts 层**：零变更（D1，仅文档说明）
2. **domain 层**：零变更（D2，仅文档说明）
3. **repository/service/router 层**：零变更（D3/D4/D5）
4. **server.ts**（核心）：
   - Route 类型追加 cacheable + buildEtag（D6）
   - detailEtag / listEtag helper（D7）
   - parseIfNoneMatch helper（D8）
   - sendJsonWithEtag helper（D10）
   - handle() 304 流程（D9）
   - 5 个读路由标记 cacheable + buildEtag（D11）
5. **既有测试**：②类无影响（D12），不修改
6. **新增测试**：③类 etag-caching.test.ts + etag-caching-embedding.test.ts（D13）
7. **三件套验证 + HTTP 烟测**：tsc 0 err / test 全绿 / lint:rules ✅ + 端到端 304 协商缓存

## 10. 与 R9 的对照（验证协议扩展工作流适应性）

| 维度 | R9 If-Match（写条件） | R10 If-None-Match（读条件） |
|---|---|---|
| header 格式 | 纯数字 version（`If-Match: 0`） | 引号 ETag（`If-None-Match: "0"`，Q2 决策①） |
| 解析策略 | 严格（缺失→VERSION_REQUIRED 400 / 非法→VALIDATION_ERROR 400） | 宽容（缺失/非法→忽略，返回 200，Q7 决策①） |
| 语义 | 写条件（防 lost update） | 读条件（协商缓存，省带宽） |
| 匹配失败 | VERSION_CONFLICT 409（含 current_version） | 200 + 最新内容 + 新 ETag |
| 匹配成功 | 更新成功 200 | 304 Not Modified 空体 + ETag |
| 响应扩展 | errorResponseSchema 追加 current_version（D3） | 304 空体 + ETag header（无 body） |
| Route 标记 | versioned: boolean（8 写路由） | cacheable: boolean（5 读路由） |
| 影响层 | contracts + domain + repo + service + router + server（全栈） | **仅 server.ts**（contracts/domain/repo/service/router 零变更） |
| 新增错误码 | VERSION_REQUIRED / VERSION_CONFLICT | 无（304 非错误） |

**核心验证点**：R10 影响层仅 server.ts，验证 ARCH-001/ARCH-002 在 HTTP 读条件协议扩展下的稳定性——读条件协商缓存是纯 HTTP 层语义，不污染领域层。与 R9（写条件影响全栈）形成对比，证明 spec-first 工作流对不同协议扩展的适应性（写条件全栈变更 / 读条件单层变更）。
