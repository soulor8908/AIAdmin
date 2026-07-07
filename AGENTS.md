# AGENTS.md

> 本文件给在 AIAdmin 仓库内工作的 AI agent（含 Trae IDE 助手与 spec-first 工作流五角色 subagent）提供工作指引。
> 人类开发者也可读，但首要受众是 AI agent。

## 项目定位（先读这一段）

本仓库**已结束 spec-first 工作流实验阶段**（24 轮迭代完成，tag `v0.1.0-experimental` 归档），**正在进入生产化阶段**。

两层产物：

1. **工作流层（实验产物，已归档为方法论资产）**：五角色编排 + 7 道门禁 + 规则机器化校验 + 复盘反推机制，经 24 轮迭代验证。完整定义见 [mvp/docs/workflow/spec-first-workflow.md](mvp/docs/workflow/spec-first-workflow.md)。
2. **代码层（实验载体，正在生产化改造）**：admin 管理系统。原为流程运行时证据，现需按生产化路线图（见 [mvp/docs/workflow/production-transition.md](mvp/docs/workflow/production-transition.md)）演进为生产级产品。

**关键认知**（实验阶段保留）：当工作流与代码冲突时，工作流优先；当 Spec 与代码冲突时，Spec 优先（AI-001）；当规则与 Spec 冲突时，规则优先（META-001/003/004）。

**生产化阶段新认知**：实验期为证明可行性而设的人为约束（零新依赖 / 角色严格禁读 / 每轮 retro 反推规则 / 手动编排门禁）已不再适用，应按 [生产化路线图](mvp/docs/workflow/production-transition.md) 演进。方法论内核（spec-first / SSOT / 类型派生 / 断言级红 / 机器化校验）保留并嵌入真实工程基座。

## 接到任务时的第一动作

### 任何代码生成/修改任务

1. **先读 Spec**（AI-001）：定位 `mvp/docs/spec/<domain>.tech.md` + `mvp/packages/contracts/src/schemas/<domain>.ts`。找不到对应 Spec → 停下，回复"缺 Spec"，禁止凭对话记忆写码。
2. **再读规则**：`mvp/.trae/rules/` 下相关规则文件。规则速查表见 `mvp/docs/context-snapshot.md`。
3. **再读教训索引**：`mvp/docs/retro/lessons-learned.md`（替代全量 retro），避免重蹈覆辙。
4. **增量上下文**：若任务属于某轮迭代，先读 `mvp/docs/round-<N>-delta.md`（< 3KB，A1 机制），按需再读全量 `context-snapshot.md`。

### 不要做的事

- 不读 PRD 写实现（PRD 是 BA 产物，impl-writer 须基于 Tech-Spec，AI-003）
- 不读测试写实现（测试是 test-writer 产物，但 impl-writer 须使其转绿，禁改断言，AI-002）
- 不读实现写测试（test-writer 须基于 Spec + 契约写测试，AI-002）
- 不读历史 retro 明细（已由 lessons-learned.md 索引替代，仅在该索引指向特定 round 时按需读）
- 不在 `packages/contracts/` 加业务逻辑（ARCH-002）
- 不让前端直连 `apps/api/src/**`（ARCH-003，仅可 `@admin/contracts`）
- 不硬编码跨域可变集合（枚举断言用 `[...schema.options]`，AI-005）
- 不使用 `any` / 不空 catch / 不用 `eval` / Zod schema 命名带 `Schema` 后缀（CODE-001~004）

## 五角色 subagent 速查

完整提示词骨架见 [mvp/docs/workflow/spec-first-workflow.md](mvp/docs/workflow/spec-first-workflow.md) §2。下表是各角色的输入/产出/禁读速查：

| 角色 | 输入 | 产出 | 禁读 |
|---|---|---|---|
| **BA** | 背景需求 + 既有规则 + 路由表 | `docs/prd/<domain>.md`（AC + Q&A BLOCKING） | 实现代码 / 测试 / Spec / contracts schemas |
| **Tech Lead** | PRD（decided）+ 既有 contracts | `docs/spec/<domain>.tech.md` + contracts schemas + errors.ts 改动 | 测试 / 实现 / Review |
| **test-writer** | PRD + Tech-Spec §9 + contracts | `apps/<api|web>/test/<domain>*.test.ts`（断言级红） | 实现 / PRD 非本域 / Review |
| **impl-writer** | Tech-Spec + contracts + 测试 | `domain→repository→service→router→server.ts` 改动 | PRD / Review / 前端测试（后端轮） |
| **Reviewer** | PRD + Tech-Spec + 实现 + 测试 + 规则 | `docs/review/<domain>-review.md`（verdict + AC 逐条核对） | 未改动文件 / 历史 retro 明细 |

## 7 道门禁

| 门禁 | 阶段 | 检查项 | 执行者 |
|---|---|---|---|
| G1 | PRD | 字段+验收非空 + BLOCKING 已拍板 | 编排者 |
| G3 | Spec | tsc 编译 + Spec↔契约 1:1 + 边界覆盖 + 受影响清单 | 编排者 |
| G4 | 测试 | vitest 断言级红（非导入级红）+ tsc 自检 0 缺陷 | 编排者实跑 |
| G5 | 实现 | typecheck + lint:rules + test 全绿 | 编排者实跑 |
| G6 | Review | PRD 逐条核对 + 规则合规 + 0 blocker | Reviewer |
| G6.1 | 修复复验 | blocker 修复后重跑 G5+G6 | 编排者 |
| G7 | 合入 | G1+G3+G4+G5+G6 全绿 | 编排者 |

## 每次改动必跑三件套（AI-004）

```bash
cd mvp
npm run typecheck   # tsc --noEmit
npm run lint:rules  # 13 项规则机器校验
npm test            # vitest run（1272 用例）
```

任一失败禁止提交。E2E 改动时追加 `npm run test:e2e:local`（仅 chromium 快速反馈）。

## 关键约束速查

### 架构（ARCH-001~003）

- 后端四层单向依赖：`router → service → repository → domain`，禁止反向 import
- `packages/contracts/` 纯净层，只导出 Zod schema + `z.infer` 类型，禁含业务逻辑
- 前端仅可 `import @admin/contracts`，禁连 `apps/api/src/**` 与 `@admin/api`

### 安全（SEC-001/002/003）

- 路由默认受保护，public 路由须带注释（声明式 `auth: 'public'`）
- 越权校验在 service 层（`requireAdmin(ctx)` 入口校验）
- 输出 schema 全 `.strict()`，存储态 schema（含 `password_hash`）与输出态 schema 拆分
- 错误消息不回显他人 PII；审计日志查询返回 `redactedAuditLogSchema`

### 跨域 SSOT（AI-005）

- 跨域枚举断言用 `[...schema.options].toContain(x)`，禁硬编码全集
- 错误码 `errorCodeSchema` 全局 SSOT，新增码须四处同步：contracts / errors.ts / OpenAPI / 前端 errorMapping

### advisory / [约束] 偏离（AI-003）

- `[约束]` 项：默认禁止偏离。impl-writer 实现期发现设计不足须偏离时，按 R7 S-2 / R18 S-21 流程：显式标注 + 反向同步 Spec（实际编辑文件，非仅代码注释）+ Reviewer 确认
- `[advisory]` 项：允许偏离，但必须 PR 描述含"反向同步 Spec：{{项}}"，并实际编辑 Tech-Spec 对应章节
- **伪同步检测**（R18 S-21）：仅在代码注释声明"已反向同步"但 Spec 文件未实际编辑 = 违规

### @ai-spec/skill 消费（Phase 2 新增，P0/P1 review 修复后）

AIAdmin 通过 npm 依赖 `@ai-spec/skill`（独立仓库 [soulor8908/ai-spec-skill](https://github.com/soulor8908/ai-spec-skill)）消费 spec-first 工作流方法论资产。

**依赖关系**：
- `mvp/package.json`：`"@ai-spec/skill": "github:soulor8908/ai-spec-skill#main"`
- 包提供（主入口 `@ai-spec/skill`）：RuleEngine / loadRules / BuiltinRegexPlugin / InjectPipeline / 三个契约 renderer / scoreSpec / getBuiltinRulesDir
- 子路径按需导入（P0.3 新增）：`@ai-spec/skill/engine`、`@ai-spec/skill/inject`、`@ai-spec/skill/adapters`、`@ai-spec/skill/intelligence`
- 包内 `src/kernel/rules/*.yaml` 为 13 项 enforcement 的声明式 SSOT
- 包内 `src/adapters/` 含适配器 manifest + 模板（P1.11 修正：files 白名单已包含，路径经 `getPackageRoot()` 解析）

**dist/ 分发机制**（P0.1 修正）：
- `dist/` 不入 git（.gitignore 排除），通过 `prepare` 脚本在 `npm install` 时自动 `tsc` 构建
- npm 对 git 依赖会安装 devDeps 并执行 `prepare`，消费方无须手动 build
- 更新包后须 `npm cache clean --force` + 重装，否则 npm 可能用缓存的旧 tarball

**RuleEngine 构造签名**（P0.2 修正，README 已对齐）：
```ts
// 正确：构造需 rootDir + profile；BuiltinRegexPlugin 由 engine 自动注册
const engine = new RuleEngine({
  rootDir: process.cwd(),
  profile: { language: 'typescript', overall_confidence: 1.0, signals: [] },
});
const result = await engine.run();  // 无参，options 在构造时给定
```

**BuiltinRegexPlugin 用法**（P1.6 修正）：
- 无参构造：`new BuiltinRegexPlugin()` 内部 auto-load 包内 kernel/rules
- 仍接受显式 rules：`new BuiltinRegexPlugin(rules)`（测试场景用）

**InjectPipeline 用法**（P0.4/P1.5 修正）：
- 公共 API 仅暴露 `InjectPipeline` 类 + 类型，底层函数（detectProject/analyzeArchitecture 等）不再从公共导出
- CLI（`cli/inject-command.ts`）通过 `onStage` 回调接入交互日志，不再重复编排逻辑（DRY）

**check-rules.mjs 委托**（`mvp/scripts/check-rules.mjs`）：
- 规则**定义**委托 @ai-spec/skill：启动时 `loadRules(getBuiltinRulesDir())` 加载 22 条声明式规则
- 规则**执行**留在 AIAdmin：enforcement 逻辑（路径感知 / AST 级检查）仍由 check-rules.mjs 内联实现（项目特化）
- SKILL-PARITY 校验：脚本每个 `// === XXX-NNN ===` enforcement 分支须在 @ai-spec/skill kernel/rules 有对应规则定义（防漂移）

**parity 测试**（`mvp/apps/api/test/skill-parity.test.ts`）：
- 验证规则加载：22 条规则可加载，0 错误，13 项 enforcement ID 全覆盖
- 验证 BuiltinRegexPlugin 与 check-rules.mjs 的 regex 检查等价（CODE-001/002/003 检出 + 干净代码不误报）
- @ai-spec/skill 包内仅保留 schema 一致性精简测试，完整 parity 留 AIAdmin 消费侧

**更新 @ai-spec/skill 包**：
```bash
# 1. 在 ai-spec-skill 仓库改代码 → push main
# 2. AIAdmin 拉最新版（须清缓存，否则用旧 tarball）：
cd mvp && npm cache clean --force && npm install
# 3. 跑 parity 测试验证：
npx vitest run apps/api/test/skill-parity.test.ts
# 4. 跑 lint:rules 验证 SKILL-PARITY 对齐：
npm run lint:rules
```

**已知限制**：
- @ai-spec/skill 的 glob 实现不支持段内 brace expansion（`*.{ts,tsx}`），engine 的文件收集对含 `{}` 的 pattern 会返回空。parity 测试绕过此限制直接调用 `BuiltinRegexPlugin.check()`。
- 未来修复：ai-spec-skill 的 `src/engine/glob.ts` 需支持段内 brace expansion，或改用 `fast-glob`。

## 测试约定

- **断言级红**（AI-002）：test-writer 须产出"因逻辑未实现而失败的断言"，非"导入级红"（模块未实现）。交付前自跑 `npx tsc --noEmit`，区分预期导入红 vs 真实缺陷
- **impl-writer 禁改测试断言**：只可改 setup/import 路径，须注明理由；自报改动范围须通过 `git diff HEAD --stat -- apps/<api|web>/test/` 实跑核对（R16 S-17）
- **端到端验收**（AI-007）：PRD 每条 Given/When/Then 须有端到端断言覆盖（注入共享 AuditLogRepository 观测旁路副作用）
- **embedding 测试**：`*-embedding.test.ts` spawn 真实 server + fetch，与单测 `*.test.ts` 分离

## 复盘反推（核心机制）

每轮结束产出 `mvp/docs/retro/roundN-retro.md`，含：

1. 本轮目标与结果
2. 核心验证结论（量化对比表）
3. 新发现问题（S 级，不阻断）
4. **反推优化**（三个层面）：
   - 规则层：反推到 `.trae/rules/`
   - Spec 模板层：反推到 Tech-Spec 模板
   - 提示词层：反推到五角色提示词骨架
5. 量化对比（N 轮演进表）

**反推原则**：复盘不是总结，是"把这次踩的坑变成下次的规则/提示词"，使工作流逐轮收敛。

## 文件编辑注意事项

- `mvp/docs/context-snapshot.md` 自动生成，勿手改（由 `scripts/gen-context-snapshot.mjs` 生成）
- `mvp/docs/retro/lessons-learned.md` 自动生成，勿手改（由 `scripts/gen-retro-index.mjs` 生成）
- `mvp/docs/retro/roundN-retro.md` 写入后不改（历史快照）
- `mvp/.trae/rules/` 改动须同步改 `scripts/check-rules.mjs`（META-002 规则 PR 准入）
- 代码注释里的 `[约束] TECH-XXX-001 Dxx` 标签须与 Spec 章节 1:1 对应（META-003/004 双向绑定）

## 常见任务路由

| 任务 | 应读文件 | 应产文件 |
|---|---|---|
| 新增业务域 | `context-snapshot.md` + `lessons-learned.md` + `server.ts` 路由表 | `prd/<domain>.md` → `spec/<domain>.tech.md` → contracts schemas → test → impl → review |
| 修改既有契约 | `spec/<domain>.tech.md` + contracts schemas + `errors.ts` | Tech-Spec §9 受影响清单（grep 引用 + 全集断言隐式影响）→ 同步测试 → 同步实现 |
| 元改进轮（无 PRD AC） | 最新 retro §6 候选清单 | 仅元资产（规则 / Spec 模板 / 提示词），走 G6.5 不走 G1-G4 |
| 修 bug | 对应 `spec/<domain>.tech.md` + 实现文件 | 先复现测试（test-writer 角色）→ 修实现（impl-writer 角色）→ Reviewer 核对 Spec 是否需反向同步 |

## 不在本仓库范围内（实验阶段约束，生产化阶段已废止）

> ⚠️ 以下为实验阶段（v0.1.0-experimental）约束，**生产化阶段已废止**，按 [生产化路线图](mvp/docs/workflow/production-transition.md) 演进。

实验期保留的硬约束（已不再适用）：
- ~~生产部署（见 README "生产就绪性警告"）~~ → 生产化阶段的核心目标
- ~~替换 `node:sqlite` 为 PostgreSQL（属未来生产化项目）~~ → 生产化阶段优先项
- ~~引入 Express / Hapi / axios / Redux / UI 框架（违背零新依赖设计原则）~~ → 零新依赖原则已废止

仍不在范围内：
- 产品本身的 AI 能力（LLM 调用 / embedding / agent 行为）—— "AI Native" 指开发流程

## 生产化阶段工作指引（新增）

进入生产化阶段后，工作模式调整：

### 角色协作（实验期"严格禁读"已废止）

| 角色 | 实验期禁读 | 生产化阶段调整 |
|---|---|---|
| BA | 实现代码 / 测试 / Spec / contracts | 不变（BA 仍不读代码） |
| Tech Lead | 测试 / 实现 / Review | 可读既有实现（设计契约时需核验现状） |
| test-writer | 实现 / PRD 非本域 / Review | 可读实现（写测试时需了解接口现状） |
| impl-writer | PRD / Review / 前端测试（后端轮） | 可读 PRD（理解业务意图）+ 可读测试（理解断言） |
| Reviewer | 未改动文件 / 历史 retro 明细 | 不变 |

**理由**：实验期为证明 spec-first 可行性而设严格禁读；生产团队是"人 + AI 副驾"，人是 owner，AI 是助手，强制禁读变成流程税。

### Retro 反推（实验期"每轮反推规则"已废止）

- 实验期：每轮 retro 自动反推到 `.trae/rules/`（24 轮规则越堆越多，收敛期红利）
- 生产化：**事件驱动**反推——出 incident / postmortem / blocker 才反推规则；常规 retro 仅记录不反推

### 门禁（实验期"手动编排 7 道门禁"演进）

| 门禁 | 实验期 | 生产化阶段 |
|---|---|---|
| G1 PRD | 编排者人工 | PR 模板 checklist 自动 |
| G3 Spec | 编排者人工 tsc + 契约 1:1 | CI 自动（contract drift 检测） |
| G4 测试 | 编排者实跑断言级红 | CI 自动（vitest + coverage threshold） |
| G5 实现 | 编排者实跑三件套 | CI 自动（typecheck + lint + test + SAST） |
| G6 Review | Reviewer subagent | 人 + 自动化 linter/SAST/依赖扫描 |
| G6.1 修复 | 编排者重跑 | CI 重跑 |
| G7 合入 | 编排者 | branch protection + required reviews |

完整生产化路线图见 [mvp/docs/workflow/production-transition.md](mvp/docs/workflow/production-transition.md)。
