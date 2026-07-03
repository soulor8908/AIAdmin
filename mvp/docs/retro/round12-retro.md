---
doc_type: Retrospective
id: RETRO-ROUND12-001
scope: 第十二轮演练（持久化层替换 内存 Map → node:sqlite）+ ARCH-001 闭合收官 + MVP 收官轮
date: 2026-07-02
verdict: 跑通（G1–G7 全绿，G6.1 子门禁闭合）；MVP 工作流验证收官。Reviewer verdict=block→pass（G6.1 修复 4 advisory 同步 blocker）21/21 AC 对齐。核心亮点：①ARCH-001 闭合成立——6 repository 共 40 个公开方法签名逐字零变更，service/router/domain/contracts 零签名变更；②"内存容忍 sloppy，DB 暴露"模式——3 个回归 bug 均为内存实现隐藏语义缺陷被 DB 严格性暴露；③test-writer 实测纠正 Spec 预判（PRAGMA foreign_keys 默认 ON）；④node:sqlite 零依赖延续项目精神。
---

# 第十二轮演练复盘 · 持久化层替换（内存 Map → node:sqlite）+ ARCH-001 闭合收官 + MVP 收官

## 0 · 本轮目标与结果

1. 落实 R11 retro §5 建议"R12 = 持久化层替换（DB 接入）"——本期选 **node:sqlite 持久化** → ✅ 6 repository 内存 Map/Set 全替换为 SQLite DB，进程重启数据不丢
2. 验证 ARCH-001 在"换持久化机制"下的闭合性（MVP 收官标志③）→ ✅ 40 个公开方法签名逐字零变更，service/router/domain/contracts 零签名变更
3. 验证"零新依赖精神延续"（R11 node:crypto → R12 node:sqlite）→ ✅ Node 24 内置 DatabaseSync，无 native 编译依赖（better-sqlite3 需 node-gyp）
4. 验证 DB 事务与 R7 既有补偿逻辑联动 → ✅ withTransaction 包裹 transfer A/B/C + 补偿闭包幂等（advisory #1 闭合）
5. 验证 DB 约束映射既有错误码 → ✅ UNIQUE 冲突映射 USER_EMAIL_DUPLICATE 等，不泄漏 SQLite 原始错误
6. MVP 收官验证 → ✅ 12 轮演进达成三个收官标志（规则机器化 100% + S 级改进固化 + 生产阻断项验证可替换）

## 1 · 本轮核心验证结论

### ARCH-001 闭合收官 —— 40 个公开方法签名零变更（MVP 收官标志③）

| 维度 | R1-R11 内存 Map | R12 SQLite DB |
|---|---|---|
| repository 公开方法签名 | 40 个方法（list/findById/insert/update...） | **40 个方法逐字不变**（D2 [约束] 闭合核心） |
| repository 构造签名 | `constructor()` | `constructor(db: DatabaseSync)`（D13 [约束] 允许） |
| service 公开方法签名 | N/A | **零变更**（transfer 构造 +db 是 advisory 偏离，非公开方法签名） |
| router 公开签名 | N/A | **零变更** |
| domain | 纯函数 | **零变更** |
| contracts | SSOT | **零变更**（本轮无新 schema/错误码） |
| Ctx 接口 | R11 已定 | **绝对不变**（呼应 R11） |
| 唯一变更层 | N/A | repository 内部实现 + server.ts 工程脚手架 + 新增 db 模块 |

**结论**：R12 是 ARCH-001 闭合的最终证明。与 R11"换鉴权来源不动四层"呼应：
- R11 证明：换鉴权机制（header mock → token 验签）可单层闭合（仅 server.ts + 新增 auth 模块，Ctx 接口不变）
- R12 证明：换持久化机制（Map → SQLite）可单层闭合（仅 repository 内部 + server.ts + 新增 db 模块，repository 公开方法签名不变）

两轮共同证明：**ARCH-001 分层设计在"换底层机制"场景下具备闭合性**——只要接口契约（Ctx / repository 公开方法）稳定，底层机制替换不污染业务四层。这是 MVP 工作流验证的核心成果。

### "内存容忍 sloppy，DB 暴露"模式 —— 3 个回归 bug 的共同根因

impl-writer 阶段修复了 3 个 R12 引入的回归 bug，根因都是"内存 Map 实现容忍 sloppy 行为，DB 严格性暴露隐藏缺陷"：

| Bug | 内存 Map 行为（sloppy） | SQLite DB 行为（严格） | 根因 |
|---|---|---|---|
| #1 NotificationService.update 传 undefined | `{...existing, ...patch}` 中 undefined 覆写已有值（Map 容忍） | SQLite UPDATE 绑定 undefined → ERR_INVALID_ARG_TYPE | 内存实现容忍 undefined 覆写 |
| #2 audit_logs.id PRIMARY KEY | Map 以 id 为 key 覆写 append-only 实体（隐藏语义缺陷） | DB PRIMARY KEY 拒绝重复插入 | 内存实现隐藏了 append-only 覆写 bug |
| #3 DepartmentService.assignUserDepartment 泄露 password_hash | 返回 UserEntity 含 password_hash（R11 引入时未同步剥离） | userSchema.parse .strict() 拒绝多余字段 | R11 跨域字段引入遗漏剥离点 |

**反推**：这 3 个 bug 揭示了一个重要模式——**内存实现是"宽松环境"，会容忍语义缺陷；DB 是"严格环境"，会暴露隐藏 bug**。这意味着：
1. 内存实现的测试通过 ≠ 语义正确（内存可能隐藏 bug）
2. DB 接入是"严格性压力测试"，能暴露内存实现遗漏的边界
3. 未来从内存切到任何严格存储（DB/消息队列/缓存）都会暴露类似 sloppy 行为

这是 R12 最重要的 retro 素材——**"内存→DB 切换"不只是基础设施替换，更是严格性压力测试**。

### test-writer 实测纠正 Spec 预判 —— AI-006 反向核实在技术预判层面的延伸

test-writer 阶段实测发现 `PRAGMA foreign_keys` 在 Node v24.15.0 **默认 ON**（SQLite 编译期 SQLITE_DEFAULT_FOREIGN_KEYS=1），与 Tech-Spec §11#5 预判"默认 OFF"不一致。

这是 AI-006 反向核实机制在"技术预判"层面的延伸——此前 AI-006 反向核实抓的是"受影响测试清单遗漏"（R11 audit 枚举），本轮抓的是"Spec 技术预判错误"。test-writer 用实测断言（`PRAGMA foreign_keys` 返回值）暴露 Spec 预判错误，impl-writer 据此确认 D15 显式 ON 仍正确（幂等无害）。

**反推**：AI-006 反向核实不应限于"测试清单完整性"，还应覆盖"Spec 技术预判的可实测性"——当 Spec 对运行时行为做预判时（如 PRAGMA 默认值、API 返回类型），test-writer 须用实测断言核实预判准确性。

### 伪同步问题 —— advisory 偏离反向同步机制的可验证性

Reviewer 发现 4 个 blocker 全是 advisory 偏离"标注已反向同步但实际没改 Spec 文件"（伪同步）。impl-writer 在代码注释中写"已反向同步"，但 Tech-Spec 文件未实际更新。

**根因**：AI-003 要求 advisory 偏离须反向同步 Spec，但缺乏可验证机制——"在代码注释声明已同步"不等于"Spec 文件实际已改"。Reviewer 通过 git diff Spec 文件才发现伪同步。

**反推**：advisory 偏离反向同步须有可验证机制：
1. impl-writer 自检增加"grep Spec 文件确认章节已改"步骤
2. 或在交付报告显式列出"反向同步的 Spec 文件路径 + 行号"，便于 Reviewer 核实

## 2 · 本轮新发现的问题

### S-1 · 伪同步问题（advisory 偏离反向同步不可验证）

**现象**：impl-writer 标注"已反向同步"但 Spec 文件未改，Reviewer git diff 才发现。
**根因**：AI-003 缺乏可验证的反向同步机制。
**反推优化（待落实）**：impl-writer 提示词增加"advisory 偏离反向同步后，自检 grep Spec 文件确认章节已改 + 交付报告列出 Spec 文件路径+行号"。

### S-2 · "内存容忍 sloppy，DB 暴露"模式未在 Spec 预判

**现象**：3 个回归 bug 都是内存 Map 容忍 sloppy 行为被 DB 暴露，Spec §11 advisory 预判 12 项未覆盖此类。
**根因**：Spec advisory 预判聚焦"node:sqlite API 行为"（如 [Object: null prototype]），未覆盖"内存 vs DB 语义差异"。
**反推优化（待落实）**：Tech-Spec §11 advisory 预判增加"内存→DB 语义差异"子类——当替换内存实现时，须预判"内存容忍但 DB 拒绝"的行为（undefined 值/append-only 覆写/类型宽松）。

### S-3 · router fallback createTestDb() code smell

**现象**：5 个 router 的 auditRepo fallback 用 `new AuditLogRepository(createTestDb())`，请求时创建测试 db（生产不触发但 code smell）。
**根因**：router 默认参数设计 R5 既有，R12 适配时未重构为 required。
**反推优化（不阻断）**：未来可将 auditService 改为 required 参数（去掉默认值），强制调用方传。本期 server.ts 总传真实 auditService，fallback 仅测试触发。

## 3 · 量化对比（十二轮）

| 指标 | R1 | R5 | R9 | R10 | R11 | R12 |
|---|---|---|---|---|---|---|
| 用例数 | 35 | 404 | 653 | 697 | 778 | **833** |
| 累计用例 | 35 | 404 | 653 | 697 | 778 | **833** |
| blocker | 1 | 2 | 0 | 0 | 0 | **4→0（G6.1）** |
| suggestion | 6 | 7 | 2 | 0 | 3 | **5** |
| Reviewer verdict | pass | blocker→pass | pass | pass | pass | **block→pass（G6.1）** |
| AC 对齐 | N/A | N/A | 18/18 | 17/17 | 23/23 | **21/21** |
| 影响层 | 全栈 | 全栈 | 全栈 | 单层 | 运行时入口层+新域 | **repository内部+工程脚手架** |
| 新架构模式 | 单步CRUD | 跨域埋点 | HTTP写条件 | HTTP读条件 | 安全域+token验签 | **持久化层+DB事务** |
| ARCH-001 验证 | 建立 | 全栈 | 协议扩展 | 单层闭合 | 换鉴权来源闭合 | **换持久化机制闭合（收官）** |
| 依赖引入 | zod | — | — | — | node:crypto(内置) | **node:sqlite(内置)** |

## 4 · 十二轮演进脉络（MVP 收官）

- **第一轮**：建立主干，暴露规则可校验性 P0 缺口
- **第二轮**：规则机器化 100%（MVP 收官标志①）
- **第三~四轮**：META-003/004 双向绑定 + 反推优化闭环
- **第五~六轮**：架构方向落地 + 验收对齐门禁闭合
- **第七轮**：多步事务 + 补偿回滚（复杂业务适应性）
- **第八轮**：递归继承 + 环检测（递归数据结构适应性）
- **第九轮**：HTTP 条件请求写条件（协议层写扩展）
- **第十轮**：HTTP 条件请求读条件（首次单层闭合，首次零 suggestion）
- **第十一轮**：安全域首落地（换鉴权来源 ARCH-001 闭合）
- **第十二轮**：**持久化层替换（换持久化机制 ARCH-001 闭合收官）**——MVP 收官轮，3 个收官标志全部达成

## 5 · MVP 收官标志达成情况

| 收官标志 | 状态 | 达成轮次 |
|---|---|---|
| ① 工作流规则机器化 100% | ✅ | R2（META-001 强制） |
| ② 剩余 S 级工作流改进固化 | ✅ | R11 S-1/S-2 反推规则 + R12 S-1/S-2 待固化 |
| ③ 生产阻断项验证可替换 | ✅ | R12（持久化层替换，ARCH-001 闭合） |

**MVP 收官结论**：12 轮演练验证了 spec-first AI 原生工作流对以下场景的适应性：
- CRUD 全栈（R1-R6）
- 复杂业务（事务补偿 R7 / 递归继承 R8）
- 协议层扩展（写条件 R9 / 读条件 R10）
- 安全域（鉴权 R11）
- 基础设施替换（持久化 R12）

ARCH-001 分层设计在"换鉴权来源"（R11）和"换持久化机制"（R12）两个场景下均证明闭合——接口契约稳定时，底层机制替换不污染业务四层。这是 MVP 的核心成果。

## 6 · 反推优化（rules / spec / 提示词）

### 6.1 规则层优化
1. **AI-003 增强·advisory 偏离反向同步可验证性**（S-1 根因修复）：advisory 偏离反向同步须可验证——impl-writer 自检"grep Spec 文件确认章节已改" + 交付报告列 Spec 文件路径+行号。Reviewer git diff Spec 文件核实。
2. **AI-006 增强·技术预判可实测性**（test-writer 实测纠正 Spec 延伸）：当 Spec 对运行时行为做预判时（如 PRAGMA 默认值、API 返回类型），test-writer 须用实测断言核实预判准确性，暴露预判错误。

### 6.2 Spec 模板层优化
1. **Tech-Spec §11 advisory 预判增加"内存→DB 语义差异"子类**（S-2 根因修复）：当替换内存实现时，须预判"内存容忍但 DB 拒绝"的行为（undefined 值 / append-only 覆写 / 类型宽松 / 隐式覆写）。
2. **Tech-Spec §9 ARCH-001 闭合论证须区分"公开方法签名"与"构造签名"**：R12 transfer 构造 +db 是 advisory 偏离，但公开方法签名不变是闭合核心。Spec 须显式区分两者，避免"service 零变更"的绝对化表述。

### 6.3 提示词层优化

#### impl-writer subagent 提示词
- 增加："advisory 偏离反向同步后，自检 grep Spec 文件确认对应章节已实际修改（非仅代码注释声明），交付报告列出 Spec 文件路径 + 修改行号。"
- 增加："替换内存实现为 DB 时，预判'内存容忍但 DB 拒绝'的语义差异（undefined 值 / append-only 覆写 / 类型宽松），在 §11 advisory 预判单列。"

#### test-writer subagent 提示词
- 增加："AI-006 反向核实不仅覆盖测试清单完整性，还覆盖 Spec 技术预判的可实测性——当 Spec 对运行时行为做预判时（如 PRAGMA 默认值、API 返回类型），用实测断言核实预判准确性，暴露预判错误。"

## 7 · 结论

第十二轮是"工作流对基础设施替换适应性 + ARCH-001 闭合收官"验证的标志——前 11 轮持久化始终是内存 Map，本期首次替换为 node:sqlite 持久化 DB，验证 spec-first 工作流对"基础设施替换"的适应性。

关键证据：
1. **ARCH-001 闭合收官**（40 个公开方法签名零变更）：与 R11 换鉴权来源呼应，共同证明 ARCH-001 分层设计在"换底层机制"场景下具备闭合性。MVP 收官标志③达成。
2. **"内存容忍 sloppy，DB 暴露"模式**（3 个回归 bug）：内存实现是宽松环境会容忍语义缺陷，DB 是严格环境会暴露隐藏 bug。DB 接入是"严格性压力测试"。这是 R12 最重要的 retro 素材。
3. **test-writer 实测纠正 Spec 预判**（PRAGMA 默认 ON）：AI-006 反向核实延伸到"技术预判可实测性"层面。
4. **零新依赖精神延续**（node:sqlite 内置）：与 R11 node:crypto 呼应，证明 Node 内置 API 足以支撑生产级持久化。
5. **伪同步问题**（4 blocker 全是 advisory 未实际同步）：暴露 AI-003 反向同步机制缺乏可验证性，反推 impl-writer 自检增强。

**MVP 收官**：12 轮演进达成三个收官标志（规则机器化 100% + S 级改进固化 + 生产阻断项验证可替换）。spec-first AI 原生工作流对 CRUD/复杂业务/协议扩展/安全域/基础设施替换五类场景的适应性均已验证。ARCH-001 分层设计在"换鉴权来源"+"换持久化机制"两个场景下证明闭合。

剩余改进项（S 级，不阻断）：
- **S-1**：伪同步问题（advisory 偏离反向同步不可验证，本轮 G6.1 修复 4 处，根因未固化到规则）。
- **S-2**："内存容忍 sloppy，DB 暴露"模式未在 Spec 预判（3 回归 bug 均为此类）。
- **S-3**：router fallback createTestDb() code smell（不阻断，未来重构）。

> **MVP 收官，可进入完整开发**。完整开发方向：①前端引入（验证 ARCH-003 跨层只经契约）；②更多业务域（用已验证工作流开发生产功能）；③部署/CI-CD（DevOps）；④S-1/S-2/S-3 工作流改进固化；⑤跨实体事务乐观锁（transfer + version，R9 Q8 out-of-scope）；⑥补齐 user detail 端点（R10 gap）。持久化已就绪，鉴权已就绪，工作流已成熟——具备进入完整开发条件。
