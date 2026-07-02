---
doc_type: PRD-Spec
id: PRD-ETAG-CACHING-001
title: ETag 协商缓存（ETag 生成 + If-None-Match 条件读 + 304 Not Modified）
status: decided
# Q&A 决策结果：Q1=①version / Q2=①引号 / Q3=①304 / Q4=①detail+list / Q5=①total-max / Q6=①空体+ETag / Q7=①宽容 / Q8=①保持不同
owner: ba@team
created: 2026-07-02
extends: PRD-OPTIMISTIC-LOCKING-001
prd_ref: RETRO-ROUND9-001
---

# ETag 协商缓存（ETag 生成 + If-None-Match 条件读 + 304 Not Modified）

## 背景
前九轮演练已覆盖 CRUD / 审计埋点 / 报表聚合 / 事务补偿 / 递归继承 / 乐观锁并发控制。第九轮落地了 **If-Match 条件写**（写操作携带版本号，service 层比对 version 防止 lost update），但**读操作无缓存机制**——客户端每次 GET 请求都返回完整响应体，即使客户端已持有最新版本的数据，造成不必要的带宽与序列化开销。

本期引入 **ETag 协商缓存**（RFC 7232 Section 2.3/2.4）验证以下未覆盖的工作流边界：

1. **ETag 生成**：服务端为 GET 响应生成 ETag（实体版本标识），客户端在后续请求中携带 If-None-Match header，服务端比对 ETag，匹配则返回 304 Not Modified（空体），客户端复用缓存。这是新协议交互模式，现有 server.ts 仅处理 If-Match（R9 写条件），未处理 If-None-Match（读条件）。
2. **ETag 与 version 的关系**：R9 已有 `version` 字段（User/Role/Notification 三实体，每次 update +1）。ETag 可复用 version（简单）或基于内容 hash（精确），须明确生成策略与格式（RFC 引号 vs R9 纯数字）。
3. **list 端点的 ETag**：list 响应是集合（多个实体），ETag 须基于结果集整体生成（非单个实体 version），须验证集合 ETag 生成策略与缓存失效语义。
4. **304 响应语义**：If-None-Match 匹配时返回 304 Not Modified（空体 + ETag header），vs 200 返回最新内容。须验证 304 响应体规范（空体 / ETag header / 是否含 Last-Modified）。
5. **AI-007 端到端验收**：协商缓存是跨层行为（HTTP header 解析 → ETag 比对 → 304 响应），须端到端验收（客户端首次 GET 获取 ETag → 二次 GET 携带 If-None-Match → 304 → update 后再 GET → 200 新 ETag）。

本期在既有 user/role/notification 三域的 GET 端点上**扩展协商缓存能力**（非新增领域），作为上述五方向的验证载体。ETag + If-None-Match + 304 = "HTTP 协议读条件扩展 + 缓存语义"，与 R9 的 If-Match（写条件）互补，共同验证 RFC 7232 条件请求的完整语义。

## 业务目标
- **目标1（ETag 生成）**：GET detail 端点（GET /v1/users/:id / GET /v1/roles/:id / GET /v1/notifications/:id）响应追加 `ETag` header，基于实体 version 生成；update 后 ETag 自动变化（version 递增）。
- **目标2（If-None-Match 协商缓存）**：GET detail 端点解析 `If-None-Match` header，与当前实体 ETag 比对，匹配则返回 304 Not Modified（空体 + ETag header），不匹配则返回 200 + 最新实体 + 新 ETag。
- **目标3（list 端点 ETag）**：GET list 端点（GET /v1/users / GET /v1/roles / GET /v1/notifications）响应追加 ETag，基于结果集生成；结果集变化（create/update/delete）后 ETag 变化。
- **目标4（缓存失效语义）**：实体 update（version +1）后 ETag 变化；create/delete 后 list ETag 变化；客户端持旧 ETag 再 GET → 200 新 ETag。
- **目标5（验证工作流适应性）**：验证 ARCH-002（ETag 生成策略 SSOT）、AI-006（受影响测试三类标注：①schema 变更 ②既有测试加 ETag 断言 ③新增协商缓存测试）、AI-007（端到端验收 304 协商缓存全链路）、SEC-003a（If-None-Match header schema 校验）在 HTTP 读条件请求新领域下是否闭合。

## 用户故事
- 作为管理员，我希望查询用户详情时，若我持有的 ETag 与服务端一致则返回 304 节省带宽，避免重复传输已持有的数据。
- 作为管理员，我希望查询用户列表时，列表 ETag 反映结果集整体版本，结果集未变化则返回 304。
- 作为管理员，我希望更新用户后，该用户的 detail ETag 与 list ETag 都自动变化，确保下次 GET 返回 200 新数据而非 304 旧缓存。
- 作为系统负责人，我希望 ETag 复用 R9 的 version 字段（而非引入内容 hash），保持版本标识的单一 SSOT，避免 version 与 ETag 不一致。
- 作为系统负责人，我希望 ETag 格式遵循 RFC 7232 标准（引号包裹），与 R9 If-Match 的纯数字格式明确区分（If-Match 写条件用纯数字 version，If-None-Match 读条件用 ETag 引号格式），两者语义清晰不混淆。

## 功能点清单
- [ ] F1：ETag 生成（detail 端点响应追加 ETag header，基于实体 version 生成）
- [ ] F2：If-None-Match 协商缓存（detail 端点解析 If-None-Match，匹配 → 304 Not Modified 空体 + ETag header）
- [ ] F3：list 端点 ETag（list 端点响应追加 ETag，基于结果集生成；If-None-Match 匹配 → 304）
- [ ] F4：缓存失效语义（update/create/delete 后 ETag 变化，持旧 ETag 再 GET → 200 新 ETag）

## 数据实体草图
- **ETag 生成策略（detail）**：基于实体 `version` 字段生成。
  - 格式：`ETag: "version"`（引号包裹，RFC 7232 强 ETag 格式，如 `ETag: "0"` / `ETag: "1"`）。
  - 生成时机：GET detail 成功（200）响应追加 ETag header；304 响应也含 ETag header（与匹配的 If-None-Match 一致）。
  - 不引入内容 hash（复用 R9 version SSOT，避免双源不一致）。
- **ETag 生成策略（list）**：基于结果集生成。
  - 格式：`ETag: "total-maxVersion"`（如 `ETag: "3-5"`，total=3 条 / maxVersion=5），组合键减少误判（仅 max 可能因删除+新增同数量误判，total+max 组合更精确）。
  - 生成时机：GET list 成功（200）响应追加 ETag header；304 响应也含 ETag header。
- **If-None-Match header 契约**：
  - 格式：`If-None-Match: "version"`（引号包裹，与 ETag 格式一致，RFC 7232 标准）。
  - 解析：server.ts 提取 header → 比对当前实体 ETag → 匹配返回 304 / 不匹配返回 200。
  - 缺失：正常返回 200（If-None-Match 可选，缺失则无条件 GET）。
  - 格式非法（非引号包裹）：忽略 header，正常返回 200（宽容解析，非 400 错误；与 If-Match 严格解析不同，因 If-None-Match 是读优化非强一致性要求）。
- **304 Not Modified 响应**：
  - 状态码：304
  - 响应体：空（无 body）
  - 响应 header：`ETag: "version"`（与匹配的 If-None-Match 一致）
  - 不含 Last-Modified（MVP 简化，仅 ETag，不引入时间戳缓存验证）
- **与 R9 If-Match 的关系**：
  - R9 If-Match：写条件，纯数字 version（`If-Match: 0`），严格解析（缺失→VERSION_REQUIRED 400 / 非法→VALIDATION_ERROR 400）。
  - R10 If-None-Match：读条件，引号 ETag（`If-None-Match: "0"`），宽容解析（缺失/非法→忽略，返回 200）。
  - 两者格式不同（纯数字 vs 引号）、语义不同（写条件 vs 读条件）、解析策略不同（严格 vs 宽容），明确区分不混淆。
- **新增错误码**：无（304 是成功响应非错误；If-None-Match 格式非法不报错而是忽略）。

## 验收标准（Given/When/Then）—— AI-007 端到端验收依据

### F1 ETag 生成
- **AC-F1-1 detail 响应含 ETag**：GIVEN 任意实体存在 / WHEN GET detail / THEN 响应 header 含 `ETag: "version"`（引号包裹 version 数字）。
- **AC-F1-2 ETag 随 version 递增**：GIVEN User version=0 ETag="0" / WHEN updateStatus 成功 version→1 / THEN GET detail 响应 ETag="1"（ETag 随 version 变化）。
- **AC-F1-3 ETag 格式合规**：GIVEN 任意 GET detail 响应 / WHEN 检查 ETag header / THEN 格式为 `"数字"`（双引号包裹纯数字，RFC 7232 强 ETag）。
- **AC-F1-4 内置 admin ETag 恒 "0"**：GIVEN 内置 admin 角色 version=0 / WHEN GET detail / THEN ETag="0"（内置角色不可更新，ETag 恒定）。

### F2 If-None-Match 协商缓存（detail）
- **AC-F2-1 ETag 匹配 → 304**：GIVEN User version=0 ETag="0" / WHEN GET detail 携带 `If-None-Match: "0"` / THEN 返回 304 Not Modified + 空体 + ETag="0" header。
- **AC-F2-2 ETag 不匹配 → 200**：GIVEN User version=1 ETag="1" / WHEN GET detail 携带 `If-None-Match: "0"`（过期）/ THEN 返回 200 + 最新实体 + ETag="1"。
- **AC-F2-3 缺失 If-None-Match → 200**：GIVEN 任意实体 / WHEN GET detail 不携带 If-None-Match / THEN 返回 200 + 实体 + ETag（无条件 GET）。
- **AC-F2-4 If-None-Match 格式非法 → 忽略 200**：GIVEN 任意实体 / WHEN GET detail 携带 `If-None-Match: abc`（非引号格式）/ THEN 返回 200 + 实体 + ETag（宽容解析，忽略非法 header）。

### F3 list 端点 ETag
- **AC-F3-1 list 响应含 ETag**：GIVEN 任意 list 查询 / WHEN GET list / THEN 响应 header 含 `ETag: "total-maxVersion"`。
- **AC-F3-2 list ETag 匹配 → 304**：GIVEN list ETag="3-5" / WHEN GET list 携带 `If-None-Match: "3-5"` / THEN 返回 304 + 空体 + ETag="3-5"。
- **AC-F3-3 create 后 list ETag 变化**：GIVEN list ETag="3-5"（3 条 maxVersion=5）/ WHEN create 新用户（version=0）/ THEN GET list ETag="4-5"（total=4，maxVersion 仍 5 因新用户 version=0 < 5）。
- **AC-F3-4 update 后 list ETag 变化**：GIVEN list ETag="3-5" / WHEN update 某用户 version 5→6 / THEN GET list ETag="3-6"（total 不变，maxVersion 5→6）。
- **AC-F3-5 list If-None-Match 缺失 → 200**：GIVEN 任意 list / WHEN GET list 不携带 If-None-Match / THEN 返回 200 + 结果集 + ETag。

### F4 缓存失效语义
- **AC-F4-1 update 后 detail 304→200**：GIVEN 客户端持 User ETag="0" + 服务端 version=0 / WHEN update version→1 + GET detail 携带 If-None-Match: "0" / THEN 返回 200 + 新实体 + ETag="1"（缓存失效，返回最新）。
- **AC-F4-2 delete 后 list 304→200**：GIVEN 客户端持 list ETag="3-5" / WHEN delete 某用户 / THEN GET list 携带 If-None-Match: "3-5" → 返回 200 + 新结果集 + 新 ETag（total 3→2）。
- **AC-F4-3 端到端协商缓存全链路**：GIVEN 客户端首次 GET detail（无 If-None-Match）→ 200 + ETag="0" / WHEN 二次 GET 携带 If-None-Match: "0" → 304 / THEN update version→1 + 三次 GET 携带 If-None-Match: "0" → 200 + ETag="1" + 四次 GET 携带 If-None-Match: "1" → 304（全链路协商缓存正确）。

## Q&A 决策（全 BLOCKING，未回答不进入 Spec）

**Q1 · ETag 生成策略？**
BLOCKING。方案①基于 version 字段（`ETag: "version"`，复用 R9 version SSOT，简单一致）；方案②基于内容 hash（SHA-256 of JSON，内容变化才变，精确但成本高）。本期选哪个？推荐①（复用 R9 version 单一 SSOT，避免 version 与 ETag 双源不一致；内存实现性能足够；update 已递增 version，ETag 自动跟随）。是否认可？

**Q2 · ETag 格式？**
BLOCKING。方案①强 ETag 引号格式（`ETag: "0"`，RFC 7232 标准）；方案②纯数字（`ETag: 0`，与 R9 If-Match 一致但非 RFC 标准）。本期选哪个？推荐①（RFC 7232 标准强 ETag 格式；与 R9 If-Match 纯数字明确区分——If-Match 写条件用纯数字 version，If-None-Match 读条件用引号 ETag，语义清晰不混淆）。是否认可？这要求 server.ts 同时支持两种 header 格式（If-Match 纯数字 + If-None-Match 引号），须验证解析逻辑的独立性。

**Q3 · If-None-Match 匹配语义？**
BLOCKING。方案①304 Not Modified（ETag 匹配则 304 空体 + ETag header，客户端用缓存）；方案②200 返回最新（总是 200，If-None-Match 仅 hint）。本期选哪个？推荐①（标准协商缓存语义，节省带宽；304 是 RFC 7232 标准响应码）。是否认可？

**Q4 · 覆盖范围？**
BLOCKING。方案①仅 detail 端点（GET /v1/users/:id 等，单实体 ETag）；方案②detail + list 端点（list 基于结果集 ETag）；方案③所有 GET 端点（含 tree/effective-permissions/inheritance-chain 等计算型端点）。本期选哪个？推荐②（detail + list 覆盖主要读场景；计算型端点如 effective-permissions 涉及递归聚合，ETag 生成复杂且缓存价值低，out of scope）。是否认可？

**Q5 · list ETag 生成策略？**
BLOCKING。方案①`max(version)`（简单，但删除+新增同数量时 max 不变误判）；方案②`total-max(version)`（组合键，total 变化或 max 变化都触发 ETag 变化，更精确）；方案③内容 hash（最精确但成本高）。本期选哪个？推荐②（total+max 组合键，MVP 简化且减少误判；create 触发 total 变化，update 触发 max 变化，delete 触发 total 变化，覆盖主要变更场景）。是否认可？

**Q6 · 304 响应体？**
BLOCKING。方案①空体 + ETag header（标准 304）；方案②空体 + ETag + Last-Modified header（含时间戳）。本期选哪个？推荐①（MVP 简化，仅 ETag 不引入 Last-Modified 时间戳；Last-Modified 需维护 updated_at 精度，且与 ETag 语义重叠）。是否认可？

**Q7 · If-None-Match 格式非法处理？**
BLOCKING。方案①宽容解析（非引号格式 → 忽略 header，返回 200，非错误）；方案②严格解析（非引号格式 → VALIDATION_ERROR 400，与 R9 If-Match 一致）。本期选哪个？推荐①（If-None-Match 是读优化非强一致性要求，宽容解析避免缓存优化导致请求失败；与 R9 If-Match 严格解析形成对比——写条件严格 / 读条件宽容，语义匹配）。是否认可？

**Q8 · ETag 与 R9 If-Match 格式统一的张力？**
BLOCKING。R9 If-Match 用纯数字 version（`If-Match: 0`），R10 ETag 用引号格式（`ETag: "0"`）。两者格式不同是否认可？方案①保持不同（If-Match 纯数字写条件 / If-None-Match 引号读条件，语义清晰但格式不统一）；方案②统一为引号格式（R9 If-Match 也改引号，但破坏 R9 向后兼容）；方案③统一为纯数字（R10 ETag 也纯数字，但非 RFC 标准）。本期选哪个？推荐①（保持不同，语义清晰——写条件严格纯数字 / 读条件 RFC 引号；R9 已闭环不破坏；server.ts 分别解析两种格式，逻辑独立）。是否认可？

## Out of scope
- Last-Modified / If-Modified-Since 条件请求 —— 本期仅 ETag + If-None-Match，时间戳缓存验证为未来工程化方向。
- Cache-Control / Expires 强缓存（客户端不验证直接用缓存） —— 本期仅协商缓存（客户端须验证），强缓存为未来工程化方向。
- Vary header（按 Accept-Encoding 等区分缓存） —— 本期响应体固定 JSON，无 Vary 需求。
- ETag 弱比较（W/"0"） —— 本期仅强 ETag，弱比较（语义等价即匹配）为未来方向。
- 计算型端点的 ETag（effective-permissions / inheritance-chain / tree / report） —— 这些端点涉及递归聚合，ETag 生成复杂且缓存价值低，out of scope（Q4 决策②）。
- 内容 hash ETag（SHA-256 of JSON） —— 本期复用 version，内容 hash 为未来精确缓存方向（Q1 决策①）。
- 分布式 ETag 一致性（多实例 ETag 同步） —— 本期单实例内存存储，分布式为未来方向。
- OpenAPI yaml 同步（etag-caching.openapi.yaml） —— 记为遗留同步项，沿用既有先例。
