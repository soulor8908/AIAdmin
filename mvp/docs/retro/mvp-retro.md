---
doc_type: Retrospective
id: RETRO-MVP-001
scope: 用户管理 MVP 端到端演练
date: 2026-07-01
participants: [编排者, BA-subagent, TechLead-subagent, Dev-subagent, Reviewer-subagent]
verdict: 跑通（G1–G7 全绿），暴露 5 类系统性问题
---

# MVP 演练复盘 · 用户管理

## 0 · 演练结果速览

| 阶段 | 角色 | 产物 | 门禁 | 结果 |
|---|---|---|---|---|
| 1 需求 | BA subagent | docs/prd/user.md | G1 字段+验收非空 | ✅ |
| 2 设计 | （跳过，MVP 无 UI） | — | — | ⏭️ |
| 3 Spec | Tech Lead subagent | Tech-Spec + Zod + OpenAPI | G3 编译+1:1+边界 | ✅ |
| 4 测试 | Dev subagent | test/user.test.ts（35 用例） | G4 用例红 | ✅ |
| 5 实现 | Dev subagent | domain/repo/service/router | G5 全绿 | ✅ |
| 6 Review | Reviewer subagent | review/user-review.md | G6 零阻塞 | ❌→✅ |
| 7 合入 | 编排者 | G7 三件套全绿 | G7 | ✅ |

**最终状态**：tsc pass · 规则校验 pass · 35/35 用例 pass · 1 blocker 已修复。

---

## 1 · 暴露的问题（按严重度）

### P0 · 规则可校验性缺口（最严重的系统性问题）

**现象**：Reviewer 发现的 blocker 是 CODE-004 命名违反（schema 未带 `Schema` 后缀），但 `check-rules.mjs` 没有校验 CODE-004，门禁 G5 漏过了它，直到 G6 人工 Review 才拦下。

**根因**：规范白皮书里"规则可机器校验"是核心原则，但落地时 4 类规则里只有 ARCH-001/002、CODE-001/002/003 有机器校验，CODE-004 与全部 SEC-* 完全靠人工。这违背了"每条规则必须能被 lint/typecheck/AI review 之一自动校验，否则不立"的设计原则。

**影响**：门禁是"安全员"，但安全员有盲区——AI 生成的命名错误能一路绿灯到 Review，若 Reviewer 也漏看就会合入。这正是"显式优于隐式"原则的反面教材：规则没机器化 = 规则没真正立住。

**反推优化**：
- **规范层**：把"规则可校验"从原则升级为硬性准入条件——新规则 PR 必须同时提交校验脚本改动，否则规则不生效。
- **工具层**：补强 `check-rules.mjs`：CODE-004 用正则对 `export const xxx = z.object(` 的 xxx 做后缀检查；CODE-002 增强检测"仅 console 的 catch"；CODE-003 补 `Function(` 无 new 形式；ARCH-001 扩展到 service/repo/router 间反向依赖。
- **架构层**：SEC-001 引入声明式 `auth` 元数据（`Procedure` 加 `auth: 'admin' | 'public'` 字段），让"默认受保护"可机器校验。

### P1 · Spec 与代码的命名漂移

**现象**：Tech-Spec §DB 变更写的是 `interface UserRow`，但 Dev 实现时为避免手写副本（符合 ARCH-002 精神）改用 `UserEntity = User` 别名。Reviewer 判为 suggestion（方向对但与 Spec 文字不一致）。

**根因**：Spec 是 SSOT，但 Spec 里的"实现提示"（如建议用 interface）与"契约约束"（字段集）混在一起，Dev 合理地偏离了实现提示却被判为偏差。

**反推优化**：
- **Spec 规范**：Tech-Spec 模板要区分"约束"（必须遵守，如字段集/错误码/状态机）与"建议"（可偏离，如具体命名/数据结构形式）。建议项明确标注 `// advisory`，Reviewer 对 advisory 偏离不记为偏差。
- **流程层**：Dev 若偏离 Spec 的 advisory 项，应在 PR 描述里注明"反向同步 Spec"，让 Spec 跟代码一起演进，消除单向漂移。

### P1 · BA 的"开放不确定项"阻塞了下游决策

**现象**：BA 产出 PRD 时 Q5（新建用户必填字段集合）是开放项，直接影响契约定义。工作流里 PRD 门禁 G1 只要求"不确定项已记录"，没要求"影响下游的开放项必须先拍板"，导致 Tech Lead 差点卡住，最终由编排者（我）替产品负责人拍板才继续。

**根因**：G1 门禁太弱——"记录了"不等于"解决了"。影响契约的开放项若不拍板，Tech-Spec 阶段要么猜（违反 AI-003）、要么停（流程中断）。

**反推优化**：
- **门禁层**：G1 增加"阻断性开放项"概念——凡是影响数据实体/验收标准/边界的开放项，必须在 PRD 锁定前由产品负责人拍板，否则 PRD status 不能升到 `reviewed/locked`。非阻断性开放项（如 Q4 搜索、Q6 会话失效）可保留为 out-of-scope。
- **提示词层**：BA subagent 提示词增加一步"识别哪些不确定项是阻断性的，显式标记 `[BLOCKING]`，并明确指出它阻塞哪个下游阶段"。

### P2 · "测试先行"在单 subagent 内难以真正验证

**现象**：Dev subagent 报告"先写测试→确认红→再写实现"，但红的表现是"模块导入失败（实现不存在）"而非"断言失败"。这是合理的红，但说明"测试先行"在单个 subagent 一次性产出里，"红"的语义偏弱——无法证明测试真的在测逻辑而非仅测"文件存在"。

**根因**：工作流设计里 G4 要求"用例能红（验证它确实在测未实现的逻辑）"，但 subagent 一次性产出 test+impl 时，"红"只能靠导入失败体现，无法独立验证断言级红。

**反推优化**：
- **流程层**：把阶段 4（测试先行）与阶段 5（实现）拆成两个独立 subagent 调用，中间编排者实跑一次 `vitest run` 确认断言级红（而非导入级红），再启动实现 subagent。这增加一次往返但真正落地"测试即契约"。
- **提示词层**：测试 subagent 提示词要求"测试必须包含至少 N 条会因逻辑未实现而失败的断言（非导入失败）"，并要求实现 subagent 不得修改测试断言。

### P2 · SEC-003 PII 脱敏的边界判定的灰色地带

**现象**：Reviewer 对 `USER_EMAIL_DUPLICATE` 错误消息回显原始 email 给了 suggestion（建议脱敏），但也承认"邮箱存在性本就由 409 设计性暴露"。这是规则与业务设计的真实张力，Reviewer 判定合理但暴露了规则本身不够精确。

**根因**：SEC-003 写的是"email/phone 在日志/审计 before-after 中脱敏；API 响应不返回非必要 PII"，但没定义"错误消息是否算 PII 渠道""回显用户自己提交的值算不算泄漏"。

**反推优化**：
- **规则层**：SEC-003 细化——明确"错误消息不得回显其他用户的 PII；回显调用者自己提交的值允许，但不得在日志中持久化完整值"。给 Reviewer 明确判定依据，避免每次靠主观。

---

## 2 · 工作流层面的优化（反推到模块 1）

| 现象 | 工作流优化 |
|---|---|
| BA 开放项阻塞下游 | G1 门禁增加"阻断性开放项须拍板"子检查 |
| Spec advisory 与约束混淆 | Tech-Spec 模板区分 `约束`/`advisory` 两类标记 |
| 测试先行红得太弱 | 阶段 4/5 拆为两次 subagent 调用，中间实跑断言级红 |
| 规则机器校验有盲区 | 新增 G3.5 门禁："规则 PR 必须含校验脚本改动" |
| Review→修复→复验无闭环 | 显式定义 G6.1 子门禁："blocker 修复后必须重跑 G5+G6" |

---

## 3 · 规范层面的优化（反推到模块 4 Rules）

1. **新增 META-001 规则**：每条规则必须在 `校验方式` 段注明具体工具+命令，无校验方式的规则不得合入 `.trae/rules`。
2. **CODE-004 机器化**：`check-rules.mjs` 增加 schema 命名后缀检查（对 `z.object/z.enum/z.array` 赋值的 export const）。
3. **SEC-001 机器化**：`Procedure` 类型加 `auth` 字段，`check-rules.mjs` 校验每个 procedure 必须声明 auth，public 须带注释。
4. **SEC-003 精细化**：拆为 SEC-003a（响应不返回未声明 PII）与 SEC-003b（错误消息/日志的 PII 边界），各自给可判定标准。
5. **ARCH-001 扩面**：校验脚本覆盖全部四层反向依赖，不限于 domain。

---

## 4 · 提示词层面的优化（反推到模块 5 Skills）

### BA subagent 提示词
- 增加："识别不确定项时，对影响数据实体/验收标准/边界的项标记 `[BLOCKING]`，并说明它阻塞哪个下游阶段；PRD status 仅当无 BLOCKING 未决项时才可设为 reviewed。"
- 增加："自检增加一项：每个 BLOCKING 不确定项是否已有产品决策（若无，status 必须为 draft）。"

### Tech Lead subagent 提示词
- 增加："Tech-Spec 中所有实现性描述必须显式标注 `[约束]` 或 `[advisory]`；advisory 项 Dev 可偏离但须在 PR 注明。"
- 增加："若 PRD 存在未拍板的 BLOCKING 不确定项，立即停下回报，不得猜测。"

### Dev subagent 提示词
- 拆为两个：`test-writer`（只写测试，要求至少 N 条断言级红）与 `impl-writer`（只写实现，禁止改测试断言）。
- `impl-writer` 增加："实现完成后若某处偏离 Spec 的 advisory 项，在 PR 描述里写'反向同步 Spec：{{项}}'，并相应更新 Tech-Spec。"

### Reviewer subagent 提示词
- 增加："对 advisory 偏离不计为偏差，但须检查 Dev 是否做了反向同步 Spec。"
- 增加："对规则校验缺口（check-rules.mjs 未覆盖但规则存在项）必须单独列出，记为 suggestion 并标注'规则机器化缺口'。"
- 增加："verdict=block 时，必须给出精确修复路径（文件:行 + 修复动作 + 影响面），使修复可一键执行。"

---

## 5 · 量化指标（本次演练）

| 指标 | 值 |
|---|---|
| 端到端阶段数 | 7（跳过设计） |
| subagent 调用数 | 4（BA/Tech/Dev/Reviewer） |
| 产物文件数 | 13（PRD/Tech/OpenAPI/契约/8 实现+test/review/本复盘） |
| 用例数 | 35（全绿） |
| blocker 数 | 1（已修复） |
| suggestion 数 | 6 |
| 规则机器校验覆盖率 | 5/9 规则（56%，暴露 P0 缺口） |
| 三件套最终状态 | tsc ✅ / rules ✅ / test 35/35 ✅ |

---

## 6 · 结论

MVP 跑通证明了工作流主干是可行的：**PRD→Spec→契约→测试→实现→Review→门禁** 这条链路在 subagent 协作下能产出可合入的代码，且每个阶段产物可追溯。

但演练同时证明了一个核心论断：**规范的"可机器校验性"是整套体系的阿喀琉斯之踵**。本次唯一 blocker 恰是规则校验盲区漏过的命名问题——若没有 Reviewer 兜底，它会合入主干。这意味着：

> 工作流的安全网不是"门禁数量"，而是"每条规则是否真的有机器在查"。

下一轮迭代的第一优先级不是加新功能，而是**把规则校验覆盖率从 56% 拉到 100%**，并新增 META-001 强制"无校验不立规"。这是把"规范"真正变成"门禁"的唯一路径。
