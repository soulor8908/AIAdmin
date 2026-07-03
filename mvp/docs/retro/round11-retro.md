---
doc_type: Retrospective
id: RETRO-ROUND11-001
scope: 第十一轮演练（鉴权域 auth/login）+ 安全域首落地 + 运行时入口层 Ctx 来源切换 + 敏感字段管理 + SEC-001/002/003 首次端到端验证
date: 2026-07-02
verdict: 跑通；R10 落地 ETag 读条件（单层变更），本期落地鉴权域（新业务域 + 运行时入口层替换），首次验证 spec-first 工作流对"安全域"的适应性。Reviewer verdict=pass 0 blocker 3 suggestion（均已 impl 阶段闭合）23/23 AC 对齐。核心亮点：①Ctx 接口不变仅换 server.ts 来源（ARCH-001 闭合关键，service/repo/domain/router 零变更）；②SEC-001 首个 public 路由落地；③token 确定性碰撞 bug 由测试驱动暴露并修复（iat-bump 规避）；④AI-006 反向核实抓出 audit 枚举二次遗漏。
---

# 第十一轮演练复盘 · 鉴权域（auth/login）+ 安全域首落地 + 运行时入口层 Ctx 来源切换

## 0 · 本轮目标与结果

1. 落实 R10 retro §5 建议"R11 = 鉴权域（auth/login）"——本期选 **鉴权域** 方向 → ✅ 登录签发 token + token 校验中间件替换 header mock + 登出吊销三件套落地
2. 验证 spec-first 工作流对"安全域"的适应性（R5 以来首个全新业务域，前六轮 CRUD 域扩展，R7-R10 既有域协议/事务扩展）→ ✅ 新业务域 PRD→Spec→契约→测试→实现→Review→门禁全链路闭合
3. 验证 SEC-001/002/003 三条安全规则首次端到端落地（前 10 轮鉴权是 mock，规则未真实验证）→ ✅ SEC-001 首个 public 路由、SEC-002 真实 token 驱动 requireAdmin + login 豁免标记、SEC-003a password_hash 不输出
4. 验证 ARCH-001 在"换鉴权来源不动四层"下的闭合性 → ✅ Ctx 接口不变，service/repo/domain/router 零变更，仅 server.ts 层换来源
5. AI-007 端到端验收 401 全链路 → ✅ 18 用例覆盖无 token / 伪造 / 过期 / 吊销 / 有效五态

## 1 · 本轮核心验证结论

### 安全域首落地 + ARCH-001 闭合（核心亮点）—— Ctx 接口不变仅换来源

| 维度 | R1-R10 mock 鉴权 | R11 真实鉴权 |
|---|---|---|
| Ctx 构造来源 | `X-User-Id`/`X-User-Role` header（可伪造） | `Authorization: Bearer <token>` 验签 |
| Ctx 接口 | `{ user: { id, role } }` | **`{ user: { id, role } }`（不变）** |
| service 层改动 | N/A | **零变更**（requireAdmin 逻辑不变，Ctx 来源透明） |
| repo 层改动 | N/A | **零变更**（UserRepository 加 password_hash 存取，非签名变更） |
| domain 层改动 | N/A | **新增 domain/auth.ts**（纯函数，不反向依赖） |
| router 层改动 | N/A | **新增 router/auth.ts**（不反向依赖既有 router） |
| server.ts 改动 | header mock | **buildCtx 来源切换 + login/logout 路由 + seed + AUTH_SECRET** |
| SEC-001 验证 | 所有路由 auth:'admin'，public 未用过 | **首个 auth:'public' 路由落地（login）** |
| SEC-002 验证 | requireAdmin 在 mock 之上 | **真实 token 驱动 requireAdmin + login SEC-002-exempt 豁免标记** |
| SEC-003a 验证 | 无敏感字段 | **password_hash 首个敏感字段，userEntitySchema 拆分 + .strict() 不输出** |

**结论**：R11 安全域首落地的最大亮点是 **Ctx 接口不变仅换来源**。鉴权来源是运行时入口层（server.ts）职责，与四层业务架构正交分离。Ctx 作为"已认证身份"的抽象边界，service/repo/domain/router 只消费 Ctx 不关心来源——这是 ARCH-001 分层设计在"换鉴权机制"场景下的闭合证明。与 R10 单层变更闭合（ETag 仅 HTTP 层）形成呼应：R10 证明协议扩展可单层闭合，R11 证明安全机制替换也可单层闭合（仅 server.ts + 新增 auth 模块）。

### token 确定性碰撞 bug —— 测试驱动暴露设计缺陷的范例

**现象**：impl 阶段初期，F5 seed 后 login 测试全挂（GET /v1/users → 401 TOKEN_REVOKED）。根因排查发现 D1 token 格式 `base64url(payload).base64url(hmac)` 是**确定性函数**，同 payload（同 sub + iat 秒级）产生相同 token 字符串。F4 logout 把 token 加入黑名单后，F5 同秒内 re-login 产生**完全相同**的 token → buildCtx G5 误判 TOKEN_REVOKED。

**根因**：D1 [约束] token 格式设计为确定性（无随机 nonce），iat 精度是秒级。这是合理的简化（无状态验签，无需服务端存 token），但与 D4 黑名单（有状态）组合时产生副作用——黑名单按 token 字符串去重，确定性 token 导致"同秒 re-login 产生已被吊销的 token"。

**修复**（iat-bump 规避）：login B4 签发后检查黑名单，命中则 `iat += 1` 重签直至不碰撞。token 格式/payload schema/往返 toEqual 不变；iat 语义微调为"签发秒或 +N 秒碰撞规避"。

**反推**：这是 spec-first 工作流"测试驱动暴露设计缺陷"的范例——D1 [约束] 在 Spec 阶段看似无懈可击，但与 D4 黑名单组合的副作用只有端到端测试（F4 logout → F5 re-login 组合场景）才能暴露。证明 AI-007 端到端验收的不可替代性：单层 service 断言无法覆盖"logout 后同秒 re-login"的跨操作时序组合。

### AI-006 反向核实抓出 audit 枚举二次遗漏 —— 反向核实机制的范例

**现象**：test-writer 阶段，AI-006 反向核实发现 Tech-Spec §5/§9 受影响测试清单遗漏了 contracts/audit.ts 的枚举联动：
- `auditLogEntityTypeSchema` 须追加 `'auth'`（PRD AC-F1-6/F4-3 要求 entityType='auth'）
- `auditLogActionSchema` 须追加 `'login'`/`'login_failed'`/`'logout'`

test-writer 用 SSOT 派生断言 `[...schema.options].toContain('auth')` 显式表达需求，以断言级红暴露清单遗漏。

**但二次遗漏**：test-writer 发现了枚举要扩，却没发现 audit-embedding.test.ts 有 `toEqual(['create','update','delete'])` **全集断言**会因枚举扩展而失效。impl-writer 阶段才发现并改为 `toContain` 子集断言。

**根因**：AI-006 清单的"①类 grep 命中"只 grep 了直接引用被改符号的文件，没 grep "全集断言依赖枚举值"的隐式影响点。`toEqual([...])` 全集断言在枚举扩展时必然失效，但这类影响是语义层面的（断言期望值与枚举值耦合），非符号引用层面的。

**反推优化（待落实）**：AI-006 增强须区分两类影响：
- ①类显式影响（grep 命中）：直接引用被改符号的文件——已覆盖
- ①类隐式影响（语义耦合）：全集断言 `toEqual([...enum])` 依赖枚举值，枚举扩展时失效——**须新增**

### SEC-001 首个 public 路由 + SEC-002 扫描器盲区

**现象**：login 路由是 SEC-001 规则定义以来首个 `auth:'public'` 路由。impl 阶段初期 login 方法未标 `// SEC-002-exempt:`，但 check-rules.mjs 未报违规——因为 logout 方法 body 含 `this.requireAdmin(ctx)` 字样，扫描器在同 class 内 40 行 body 范围匹配命中，误以为 login 也"受保护"。

**根因**：SEC-002 扫描器按 class 文件扫描"方法 body 含 requireAdmin"，但未精确定位到方法声明边界——同 class 内一个方法调 requireAdmin 会让扫描器误判同文件其他方法也合规。

**反推优化（待落实）**：SEC-002 扫描器须精确按方法边界判定（每个 public 方法独立检查 body），而非文件级/类级模糊匹配。本期通过补 `// SEC-002-exempt:` 标记规避（豁免清单从 2 条增至 3 条），但扫描器盲区根因未修。

### PRD 估算偏差与 Spec 精确核验 —— R10 S-2 教训的再次生效

**现象**：PRD Q7 估算"②类端到端测试 Bearer 改造影响 5 个 embedding 文件"，但 Tech-Spec §9 精确 grep 显示实际仅 2 个 spawn-based（optimistic-locking-embedding / etag-caching-embedding）+ 4 个 in-process（不经 server.ts，零影响）。

**根因**：PRD 起草时未区分两种 embedding 模式——spawn 真实 server + fetch（受 server.ts Ctx 来源切换影响）vs in-process 构造 Ctx 直接调 service（不受影响）。

**反推**：R10 S-2 教训（BA 起草 PRD 涉及既有端点须核验路由表）再次生效——本期 BA 估算影响面时未核验测试架构。Tech-Spec §9 精确分析纠正了估算，test-writer 按 Spec 精确清单执行（2 改 + 4 声明），未盲改 5 个。这验证了"Spec 是 SSOT，PRD 估算可被 Spec 纠正"的分层。

## 2 · 本轮新发现的问题

### S-1 · SEC-002 扫描器方法边界盲区（根因未修）

**现象**：login 方法未标豁免时扫描器未报违规（同 class logout body 含 requireAdmin 字样误判）。本期补标记规避，但根因（扫描器未按方法边界判定）未修。

**根因**：`scripts/check-rules.mjs` SEC-002 分支按文件扫描 requireAdmin 出现，未精确定位方法声明边界。

**反推优化（待落实）**：SEC-002 扫描器增强——按方法声明（`async methodName(` 或 `methodName(`）切分方法块，每个 public 方法独立检查 body 是否含 requireAdmin 或 SEC-002-exempt 标记。

### S-2 · AI-006 ①类隐式影响未覆盖（全集断言依赖枚举值）

**现象**：audit-embedding.test.ts 的 `toEqual(['create','update','delete'])` 全集断言在 auditLogActionSchema 扩展时失效。AI-006 清单 grep 了符号引用但没覆盖这类语义耦合。

**根因**：AI-006 ①类只 grep 显式引用，未识别"断言期望值与枚举值耦合"的隐式影响。

**反推优化（待落实）**：AI-006 增强——①类新增"隐式影响"子类：当 contracts 枚举扩展时，须 grep `toEqual([...])` / `toStrictEqual([...])` 中期望值含枚举字面量的断言，标记为受影响点。

### S-3 · PRD 影响面估算未核验测试架构

**现象**：PRD Q7 估算 5 个 embedding 文件受影响，实际 2 个。BA 起草时未区分 spawn-based vs in-process 两种 embedding 模式。

**根因**：BA 估算影响面时未核验测试架构（哪些测试 spawn 真实 server，哪些 in-process 构造 Ctx）。

**反推优化（待落实）**：BA 起草 PRD 涉及"测试影响面"时，须标注"估算待 Spec 精确核验"，Tech-Spec §9 以精确 grep 为准。或 BA 提示词增加"估算影响面时区分 spawn-based vs in-process 测试模式"。

## 3 · 量化对比（十一轮）

| 指标 | R1 | R5 | R7 | R9 | R10 | R11 |
|---|---|---|---|---|---|---|
| 用例数 | 35 | 404 | 537 | 653 | 697 | **778** |
| 累计用例 | 35 | 404 | 537 | 653 | 697 | **778** |
| blocker | 1 | 2(修复0) | 0 | 0 | 0 | **0** |
| suggestion | 6 | 7 | 2 | 2(impl闭合) | 0 | **3(impl阶段全闭合)** |
| Reviewer verdict | pass | blocker→pass | pass | pass | pass | **pass** |
| AC 对齐 | N/A | N/A | 16/16 | 18/18 | 17/17 | **23/23** |
| 端到端验收 | 无 | 缺失 | 有 | 有 | 有 | **有（第五轮，401 全链路）** |
| 受影响清单 | 无 | ①类遗漏 | ①②类 | ①②③类 | ①②零影响+③类 | **①②③类（①类二次遗漏被反向核实抓出）** |
| 影响层 | 全栈 | 全栈 | 全栈 | 全栈 | 单层 | **运行时入口层+新域模块（ARCH-001 闭合）** |
| 新架构模式 | 单步CRUD | 跨域埋点 | 多步事务 | HTTP写条件 | HTTP读条件 | **安全域+token验签+密码哈希+黑名单** |
| SEC 验证 | mock | mock | mock | mock | mock | **首次真实（SEC-001 public + SEC-002 真实 + SEC-003a 敏感字段）** |

## 4 · 十一轮演进脉络

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
- **第十一轮**：**安全域首落地**（登录签发 + token 校验中间件 + 登出吊销），验证"安全域适应性 + 运行时入口层替换"，**Ctx 接口不变仅换来源**（ARCH-001 闭合），**SEC-001/002/003 首次端到端验证**，**token 确定性碰撞 bug 测试驱动暴露**，**AI-006 反向核实抓出 audit 枚举二次遗漏**

## 5 · 反推优化（rules / spec / 提示词）

### 5.1 规则层优化（反推到 .trae/rules）

1. **SEC-002 扫描器方法边界增强**（S-1 根因修复）：`check-rules.mjs` SEC-002 分支须按方法声明切分方法块，每个 public 方法独立检查 body 含 requireAdmin 或 SEC-002-exempt 标记，而非文件级模糊匹配。
2. **AI-006 ①类隐式影响子类**（S-2 根因修复）：AI-006 规则增强——①类新增"隐式影响"：当 contracts 枚举扩展时，须 grep `toEqual([...])`/`toStrictEqual([...])` 期望值含枚举字面量的断言，标记为受影响点（全集断言在枚举扩展时必然失效）。
3. **SEC-004 新增·敏感字段不输出**（从 SEC-003a 拆出更精确的安全规则）：当实体含 password_hash / secret / token 等敏感字段时，输出 schema 必须 .strict() 且不含这些字段； contracts 须拆 entitySchema（存储含）+ outputSchema（输出不含）。本轮 userEntitySchema/userSchema 拆分是范例。

### 5.2 Spec 模板层优化

1. **Tech-Spec §9 受影响测试清单须含"语义耦合"子类**：①类显式影响（grep 符号引用）+ ①类隐式影响（全集断言依赖枚举值）+ ②类签名变更 + ③类新增。隐式影响须 grep `toEqual([...enum])` 模式。
2. **Tech-Spec §10 advisory 偏离预判须含"约束组合副作用"**：本轮 D1（确定性 token）+ D4（黑名单）组合产生碰撞副作用。单个 [约束] 看似无懈可击，但组合副作用只有端到端测试暴露。Spec 须预判"多 [约束] 组合的潜在副作用"。

### 5.3 提示词层优化

#### BA subagent 提示词
- 增加："估算测试影响面时，须区分 spawn-based（受 server.ts 改动影响）vs in-process（构造 Ctx 直接调 service，不受影响）两种 embedding 模式；估算须标注'待 Spec 精确核验'。"
- 增加："涉及安全域（密码/token/权限）时，须显式标注 PII/敏感字段清单，并明确哪些字段不可出现在响应输出。"

#### Tech Lead subagent 提示词
- 增加："Tech-Spec §9 受影响测试清单 ①类须分显式影响（grep 符号引用）+ 隐式影响（全集断言依赖枚举值）两个子类。枚举扩展时须 grep `toEqual([...])` 期望值含枚举字面量的断言。"
- 增加："Tech-Spec §10 advisory 偏离预判须含'多 [约束] 组合副作用'分析——当多个 [约束] 决策存在交互时（如确定性 + 有状态黑名单），须预判组合副作用。"

#### test-writer subagent 提示词
- 增加："AI-006 反向核实时，不仅核实清单完整性，还须核实'清单遗漏的二次影响'——如发现枚举扩展，须进一步 grep 既有测试中 `toEqual([...enum])` 全集断言是否受影响，显式列出。"
- 增加："测试断言涉及枚举时，优先用 `toContain` 子集断言（扩展友好）而非 `toEqual` 全集断言（扩展即失效），除非语义要求全集。"

#### impl-writer subagent 提示词
- 增加："实现期发现 [约束] 决策的组合副作用 bug 时（如确定性 + 有状态导致碰撞），按 advisory 偏离处理（格式/schema 不变则非 [约束] 偏离），标注 `[advisory]` + 反向同步 Spec §10。"
- 增加："改既有测试 setup（非断言）时，须在交付报告显式列出每个改动文件 + 改动性质（setup/import 路径 vs 断言）+ 理由。涉及断言 matcher 改动（如 toEqual→toContain）须特别标注，由 Reviewer 判定是否违反 AI-002。"

#### Reviewer subagent 提示词
- 增加："对 SEC-002 扫描器盲区（同 class 多方法误判）须单独审查——逐个 public 方法核对是否调 requireAdmin 或标 SEC-002-exempt，不依赖扫描器结果。"
- 增加："对断言 matcher 改动（toEqual→toContain）须判定：若根因是 contracts 枚举扩展（①类隐式影响）且改动保留 SSOT 派生 + 语义不弱化，判 pass（合理调整）；若根因是测试期望值过期或语义弱化，判 suggestion/blocker。"

## 6 · 结论

第十一轮是"工作流对安全域适应性 + 运行时入口层替换"验证的标志——前 10 轮鉴权始终是 mock，本期首次落地真实鉴权（登录签发 + token 校验 + 登出吊销），验证 spec-first 工作流对"安全域"的适应性。

关键证据：
1. **Ctx 接口不变仅换来源（ARCH-001 闭合核心）**：鉴权来源是运行时入口层职责，service/repo/domain/router 零变更，仅 server.ts 层换来源 + 新增 auth 模块。与 R10 单层变更闭合形成呼应。
2. **SEC-001/002/003 首次端到端验证**：SEC-001 首个 public 路由（login）、SEC-002 真实 token 驱动 requireAdmin + login 豁免标记、SEC-003a password_hash 不输出（userEntitySchema 拆分）。
3. **token 确定性碰撞 bug 测试驱动暴露**：D1 [约束] 确定性 token + D4 黑名单组合产生副作用，F4→F5 组合场景端到端测试暴露，iat-bump 规避。证明 AI-007 端到端验收的不可替代性。
4. **AI-006 反向核实抓出二次遗漏**：test-writer 用 SSOT 派生断言暴露 audit 枚举遗漏（①次），impl-writer 发现全集断言失效（②次）。反推 AI-006 须增"隐式影响"子类。
5. **23/23 AC 对齐 + 0 blocker + 3 suggestion 全闭合**：Reviewer verdict=pass，3 suggestion（SEC-001 public 标记格式 / SEC-002 login 豁免标记格式 / Spec §10 iat-bump 同步）均 impl 阶段闭合。

这证明：**AI 原生工作流在"协议层扩展适应性"验证阶段（R9 写条件 + R10 读条件）后，进入"安全域适应性"验证阶段（R11 鉴权）**——安全域 + 运行时入口层替换在既有规则下成功落地，Ctx 接口不变是 ARCH-001 闭合的关键设计。Reviewer verdict=pass 0 blocker，证明 spec-first 工作流对"安全域"具有适应性。

剩余改进项（S 级，不阻断）：
- **S-1**：SEC-002 扫描器方法边界盲区（本期补标记规避，根因未修）。
- **S-2**：AI-006 ①类隐式影响未覆盖（全集断言依赖枚举值，本期 impl 阶段改 toContain 规避）。
- **S-3**：PRD 影响面估算未核验测试架构（本期 Spec 精确分析纠正）。

> 十轮演进脉络：R9/R10 验证"协议层扩展适应性"（写条件 + 读条件），R11 验证"安全域适应性"（鉴权）。R10 证明协议扩展可单层闭合（仅 HTTP 层），R11 证明安全机制替换也可单层闭合（仅 server.ts + 新增模块，Ctx 接口不变）。下一轮可考虑：①S-1/S-2/S-3 三项工作流改进固化；②持久化层替换（DB 接入，验证"换 DB 不动 service/router"的 ARCH-001 闭合）；③跨实体事务乐观锁（transfer + version，R9 Q8 out-of-scope）；④补齐 user detail 端点（R10 发现的 gap）；⑤前端引入（验证 ARCH-003 跨层只经契约）。
