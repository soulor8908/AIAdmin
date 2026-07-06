---
doc_type: Product-Roadmap
id: WF-SKILL-PRODUCT-001
title: AIAdmin Skill 化产品路线规划
status: draft
derived_from: v0.1.0-experimental 归档后的对外产品化评估
purpose: 把 spec-first 工作流方法论从 AIAdmin 仓库绑定中解耦，沉淀为可被任意技术栈复用的 Skill 产品（改造型 + 生成型），并作为可追踪的待办清单
---

# AIAdmin Skill 化产品路线规划

> 实验归档点：tag `v0.1.0-experimental`（24 轮迭代完成，方法论内核已验证）
> 本文档定义**对外产品化**路径：把工作流方法论从 Node.js/React/SQLite 实验载体中提取出来，做成两个 Skill 产品形态，供任意技术栈项目复用。
>
> **与 [production-transition.md](./production-transition.md) 的关系**：
> - `production-transition.md` 是**对内**路线（把 AIAdmin 这个 admin 系统本身从实验脚手架演进为生产级产品）
> - 本文档是**对外**路线（把方法论抽成可复用 Skill，赋能其他项目）
> - 两者**不互相阻塞**，但共享同一方法论内核（spec-first / SSOT / 类型派生 / 断言级红 / 机器化校验）
> - Phase 0 的资产提取会**反哺** production-transition：通用化的规则引擎可直接用于 admin 系统的 CI 门禁

---

## 0 · 产品定位

### 0.1 两个核心产品形态

| 形态 | 命令 | 起点 | 输出 |
|---|---|---|---|
| **形态 1：改造型 Skill** | `ai-spec inject` | 已有代码仓 | 注入 Spec-First 工作流基础设施（规则集 + 契约层 + 门禁 + 角色编排） |
| **形态 2：生成型 CLI 脚手架** | `npx create-ai-spec-app` | 空目录 + 技术栈选项 | 带完整 Spec-First 基础设施的项目骨架 |

### 0.2 共享内核 + 适配器层（统一抽象）

两个形态不是两套独立实现，而是 **共享内核 + 可插拔适配器** 的同一产品：

```
┌──────────────────────────────────────────────────────────┐
│                    产品形态层                            │
│   create-ai-spec-app (生成型)   ai-spec inject (改造型)  │
├──────────────────────────────────────────────────────────┤
│  适配器层（可插拔，按技术栈渲染）                        │
│  ┌──────────────┬──────────────┬────────────────────┐    │
│  │ backend      │ frontend     │ runtime            │    │
│  │ Fastify/     │ React/Vue3/  │ PostgreSQL/MySQL/  │    │
│  │ Express/     │ Angular      │ MongoDB/SQLite    │    │
│  │ Spring Boot/│              │                    │    │
│  │ FastAPI      │              │                    │    │
│  └──────────────┴──────────────┴────────────────────┘    │
│  ┌──────────────┬──────────────┬────────────────────┐    │
│  │ contract     │ auth         │ ci                 │    │
│  │ Zod/Pydantic/│ JWT/OIDC/    │ GH Actions/        │    │
│  │ JSON Schema/ │ Session/无   │ GitLab CI/手动     │    │
│  │ Protobuf     │              │                    │    │
│  └──────────────┴──────────────┴────────────────────┘    │
├──────────────────────────────────────────────────────────┤
│  共享内核（技术栈无关，方法论沉淀）                       │
│  • spec-first 规则集（声明式 YAML/JSON）                  │
│  • 五角色提示词骨架（参数化模板）                          │
│  • 7 道门禁定义（G1/G3/G4/G5/G6/G6.1/G7）                 │
│  • 规则引擎（可插拔，语言无关核心 + 语言特化 plugin）     │
│  • 增量上下文工具（gen-delta / gen-snapshot）             │
│  • Spec/PRD/Review 文档模板                              │
└──────────────────────────────────────────────────────────┘
```

**设计原则**：
- 内核只描述"做什么 + 为什么"，不绑定"用什么语言写"
- 适配器只描述"用 X 技术栈怎么落地"，可被替换
- 改造型与生成型共享内核与适配器，差异仅在**入口流程**（扫描 vs 模板渲染）

---

## 1 · Phase 0：资产提取与通用化（4-6 周）

### 1.1 目标

把 AIAdmin 实验资产从 Node.js/React/SQLite 绑定中解耦出来，形成技术栈无关的共享内核 + 可插拔适配器。

### 1.2 现状 → 目标状态映射

| 当前状态 | 目标状态 |
|---|---|
| `.trae/rules/`（Node.js 绑定） | `rules/`（通用规则 + 技术栈适配器） |
| `contracts/schemas/`（Zod） | `templates/contract/`（Zod / Pydantic / JSON Schema） |
| 四层架构（Node.js HTTP） | `templates/architecture/`（多框架） |
| `check-rules.mjs` | `rule-engine/`（可插拔） |
| `gen-*.mjs` | `tools/`（通用 CLI） |

### 1.3 关键任务清单

- [ ] **P0-1 规则集声明式化**：把 `.trae/rules/` 下 5 类规则（AI 行为 / 架构 / 编码 / 安全 / 元约束）提取为 YAML/JSON 声明式格式，与具体语言解耦
  - [ ] 定义规则 schema（`id` / `severity` / `applies_to` / `check_expr` / `fix_hint` / `rationale_ref`）
  - [ ] 把现有 13 项 enforcement 全部迁移为声明式
  - [ ] 保留规则 ID（AI-001~007 / ARCH-001~003 / SEC-001~003 / CODE-001~004 / META-001~004）作为稳定标识
- [ ] **P0-2 契约模板参数化**：把 `contracts/schemas/*.ts` 抽为 Handlebars/EJS 模板，按技术栈渲染（Zod / Pydantic / JSON Schema / Protobuf）
  - [ ] 提取契约元模型（字段名 / 类型 / 约束 / 语义标签如 PII/输出/存储态）
  - [ ] 每种目标语言一个 renderer
  - [ ] 验证 `.strict()` / `z.infer` 等语言特性在 Pydantic/JSON Schema 的等价表达
- [ ] **P0-3 架构模板多框架化**：把四层单向依赖（router→service→repository→domain）抽为多框架版本
  - [ ] Node.js: Fastify / Express（保留实验期 `node:http` 版本作为最小实现参考）
  - [ ] JVM: Spring Boot（Controller→Service→Repository→Entity）
  - [ ] Python: FastAPI（Router→Service→Repository→Model）
- [ ] **P0-4 规则引擎可插拔化**：把 `scripts/check-rules.mjs` 重构为可插拔规则引擎
  - [ ] 核心引擎语言无关（读规则声明 + 跑 AST/正则/语义检查）
  - [ ] 语言特化作为 plugin（如 TS 的 `no-any` 检查 / Java 的 `catch swallow` 检查 / Python 的 `eval` 检查）
  - [ ] 输出格式标准化（JSON + 人类可读 markdown 报告）
- [ ] **P0-5 五角色提示词参数化**：把五角色提示词骨架（[spec-first-workflow.md §2](./spec-first-workflow.md)）参数化，技术栈变量注入
  - [ ] 抽取变量：`{{backend_framework}}` / `{{orm}}` / `{{contract_lib}}` / `{{test_runner}}` / `{{frontend_framework}}`
  - [ ] 每角色一份模板 + 一份"最小上下文包"清单（参数化路径）
- [ ] **P0-6 文档模板抽取**：Spec / PRD / Review / Retro 模板参数化
  - [ ] PRD 模板（含 BLOCKING Q&A 段）
  - [ ] Tech-Spec 模板（含 §9 受影响清单）
  - [ ] Review 模板（含 verdict + AC 逐条核对表）
- [ ] **P0-7 增量上下文工具通用化**：`gen-delta.mjs` / `gen-snapshot.mjs` 抽为通用 CLI，按项目配置（路径映射）生成
- [ ] **P0-8 适配器 SPI 定义**：定义适配器须实现的接口（`detectProject()` / `renderContract()` / `renderArchitecture()` / `runRuleChecks()` / `generateCiConfig()`）

### 1.4 退出准则（DoD）

- [ ] 共享内核规则集通过"无 Node.js 关键字"测试（grep 不到 `require` / `node:` / `.mjs`）
- [ ] 至少 2 种技术栈适配器（Node.js + 1 非 Node.js，如 Spring Boot 或 FastAPI）能渲染出可编译的最小契约
- [ ] 规则引擎在不修改核心的前提下，能加载一个外部 plugin
- [ ] 实验期 13 项 enforcement 在新引擎下产出等价 verdict

### 1.5 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 规则声明式化后表达能力下降（如 AST 级检查难声明） | 高 | 保留"声明 + 命令式 plugin"双轨；声明式描述意图，plugin 实现 |
| 契约元模型覆盖不全（如 Pydantic 的 `Field(default_factory=...)`） | 中 | 元模型预留 `language_hints` 字段，承载语言特有标注 |
| 五角色提示词参数化后过长（变量膨胀） | 中 | 每角色拆"内核骨架 + 上下文包"两段，变量只在上下文包出现 |

---

## 2 · Phase 1：CLI 脚手架 MVP（6-8 周）

### 2.1 目标

`npx create-ai-spec-app` 可用，生成的项目能跑通"BA → Tech-Spec → 契约 → 测试 → 实现 → Review"最小闭环。

### 2.2 交互流程

```bash
$ npx create-ai-spec-app my-project

? 选择后端技术栈:
  ❯ Fastify + TypeScript
    Express + TypeScript
    Spring Boot + Java
    FastAPI + Python

? 选择数据库:
  ❯ PostgreSQL
    MySQL
    MongoDB
    SQLite (开发用)

? 选择前端技术栈:
  ❯ React + Vite
    Vue3 + Vite
    Angular
    无前端

? 选择认证方案:
  ❯ JWT (自签发)
    OAuth2/OIDC
    Session
    无认证 (开发用)

? 选择 CI 平台:
  ❯ GitHub Actions
    GitLab CI
    无 (手动)

✔ 生成项目骨架...
✔ 安装依赖...
✔ 初始化规则集...
✔ 生成契约层模板...
✔ 配置门禁脚本...
✔ 初始化增量上下文工具...

✅ 项目 my-project 已创建!
  cd my-project
  npm run spec:init    # 初始化第一个业务域
  npm run spec:check   # 运行规则校验
  npm run spec:gate    # 运行门禁检查
```

### 2.3 生成的项目结构

```
my-project/
├── .ai-spec/
│   ├── rules/           # 规则集 (通用 + 技术栈特化)
│   ├── gates/           # 门禁配置
│   ├── roles/           # 五角色提示词
│   └── templates/       # Spec/PRD/Review 模板
├── packages/
│   └── contracts/       # 契约层 (按技术栈)
├── apps/
│   ├── api/             # 后端 (按技术栈生成)
│   └── web/             # 前端 (按技术栈生成)
├── docs/
│   ├── prd/             # BA 产出
│   ├── spec/            # Tech-Spec
│   ├── review/          # Review 报告
│   └── retro/           # 复盘
├── scripts/
│   ├── check-rules.*    # 规则校验 (按语言)
│   ├── gen-delta.*      # 增量上下文
│   └── gen-snapshot.*   # 全量快照
└── .github/
    └── workflows/
        └── ai-spec-ci.yml  # CI 门禁
```

### 2.4 关键任务清单

- [ ] **P1-1 CLI 框架搭建**：选型（commander / clipanion / 自研），支持交互式 prompt（enquirer / inquirer）+ 非交互模式（`--backend=fastify --db=postgres`）便于 CI
- [ ] **P1-2 技术栈适配器矩阵**：MVP 期覆盖
  - [ ] backend: Fastify + TS（首选，与实验期对齐）+ Express + TS（差异最小）
  - [ ] db: PostgreSQL（生产默认）+ SQLite（开发默认）
  - [ ] frontend: React + Vite（首选）
  - [ ] contract: Zod（TS 栈）/ Pydantic（Python 栈）/ JSON Schema（跨语言）
  - [ ] auth: JWT 自签发（MVP）+ 无认证（开发用）
  - [ ] ci: GitHub Actions（MVP）
- [ ] **P1-3 模板渲染引擎**：基于 Phase 0 的契约/架构模板，按选择渲染出可运行项目
  - [ ] 模板变量解析（路径替换 / import 替换 / 命名空间替换）
  - [ ] 模板冲突检测（同名文件覆盖策略）
- [ ] **P1-4 生成的项目可跑三件套**：`typecheck` + `lint:rules` + `test` 在零业务代码时全绿
- [ ] **P1-5 端到端冒烟**：在生成的项目里跑一轮完整 spec-first 流程（PRD → Tech-Spec → 测试 → 实现 → Review），产出可审计的最小域
- [ ] **P1-6 CI 配置生成**：`.github/workflows/ai-spec-ci.yml` 含 typecheck / lint:rules / test / contract drift 检测
- [ ] **P1-7 文档站**：`docs.ai-spec.dev`（或暂用 README + gitbook），覆盖快速上手 / 适配器开发 / FAQ
- [ ] **P1-8 发包**：npm 包 `create-ai-spec-app`，带 `npx` 一键执行；语义版本；CHANGELOG

### 2.5 退出准则（DoD）

- [ ] `npx create-ai-spec-app my-project` 在 ≥ 2 种技术栈组合下生成可编译可运行项目
- [ ] 生成的项目跑 `npm run spec:gate` 全绿（含 contract drift 检测）
- [ ] 至少 1 个外部用户（非作者）跑通"创建 → 加一个域 → 跑门禁"全流程
- [ ] 文档覆盖：快速上手 / 5 分钟教程 / 适配器开发指南

### 2.6 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 技术栈组合爆炸（4×4×4×4×3 = 768 种） | 高 | MVP 期只支持"黄金组合"（Fastify+PG+React+Zod+JWT+GH Actions），其余标记 `experimental` |
| 模板与目标技术栈版本漂移（如 Fastify 5 破坏性变更） | 高 | 适配器锁定主版本；`ai-spec doctor` 命令检测漂移 |
| 生成项目"能跑但不可用"（缺真实业务逻辑样板） | 中 | 内置一个 `sample-domain` 模板（参考实验期 user 域）作为参考实现 |

---

## 3 · Phase 2：改造型 Skill（8-10 周）

### 3.1 目标

`ai-spec inject` 可对已有项目注入 Spec-First 基础设施，先以 advisory 模式运行，逐步升级为 blocking。

### 3.2 改造流程

```bash
$ cd existing-project
$ ai-spec inject

✔ 扫描项目结构...
  检测到: Spring Boot + MySQL + Vue2

? 项目类型确认:
  ❯ Spring Boot + MySQL + Vue2 (自动检测)
    手动选择

✔ 分析现有架构...
  - 发现 23 个 Controller
  - 发现 15 个 Service
  - 发现 8 个 MyBatis Mapper
  - 发现 12 个 Vue 组件

? 改造范围:
  ❯ 全量注入 (规则 + 契约 + 门禁 + 架构建议)
    仅注入规则 + 门禁 (最小侵入)
    仅注入契约层 (中等侵入)

? 契约层方案:
  ❯ OpenAPI + JSON Schema (Java 生态推荐)
    Protobuf (如需 gRPC)
    自定义

✔ 生成改造计划...
  1. 注入 .ai-spec/ 规则集 (适配 Spring Boot)
  2. 为 8 个核心 API 生成 OpenAPI 契约
  3. 注入 CI 门禁 (check-rules + contract-drift)
  4. 生成架构改进建议 (分层违规检测报告)
  5. 注入增量上下文工具

✔ 执行改造...
✔ 验证...
```

### 3.3 改造型 vs 生成型 关键差异

| 维度 | 生成型 (`init`) | 改造型 (`inject`) |
|---|---|---|
| 起点 | 空目录 | 已有代码仓 |
| 架构 | 从模板生成 | 分析现有 → 生成适配层 |
| 契约 | 新建 | 从代码逆向生成（API 扫描） |
| 规则 | 全量注入 | 渐进式注入（先核心后扩展） |
| 门禁 | 全量启用 | 先 advisory 模式，逐步升级为 blocking |
| 风险 | 无 | 需兼容性分析 + 回滚策略 |
| 回滚 | 删目录即可 | 须 `ai-spec rollback` 记录所有写入点 |

### 3.4 关键任务清单

- [ ] **P2-1 项目探测引擎**：识别技术栈（语言 / 框架 / DB / ORM / 测试框架 / CI），输出 `project-profile.json`
  - [ ] 探测规则：`package.json` / `pom.xml` / `build.gradle` / `requirements.txt` / `go.mod` / `Cargo.toml`
  - [ ] 置信度评分（多信号融合，避免单文件误判）
- [ ] **P2-2 架构分析器**：扫描现有代码，输出分层报告
  - [ ] 识别分层（Controller / Service / Repository / Domain）
  - [ ] 检测分层违规（反向 import / 跨层直连）
  - [ ] 输出可读 markdown 报告 + JSON 结构化数据
- [ ] **P2-3 API 逆向契约生成**：从现有路由 / Controller 逆向生成 OpenAPI / JSON Schema
  - [ ] 路由元数据提取（路径 / 方法 / 参数 / 响应类型）
  - [ ] 类型推导（从 DTO / Entity 反推 schema）
  - [ ] 标记置信度（手写注解 vs 推断），低置信度人工 review
- [ ] **P2-4 渐进式规则注入**：advisory → warning → blocking 三档
  - [ ] 注入时默认 advisory（CI 不阻断，仅报告）
  - [ ] `ai-spec gate-up` 命令逐步升级规则级别
  - [ ] 每条规则记录"已就绪可升级"的判定标准
- [ ] **P2-5 改造计划生成**：`inject-plan.md`，列出所有改动 + 影响范围 + 回滚点
  - [ ] dry-run 模式（`--dry-run`）只生成计划不执行
  - [ ] diff 预览（每条改动 before/after）
- [ ] **P2-6 回滚机制**：记录所有写入点，`ai-spec rollback` 一键回退
  - [ ] 写入清单（路径 + 是否新建 + 备份位置）
  - [ ] 备份策略：改动文件备份到 `.ai-spec/backup/<timestamp>/`
- [ ] **P2-7 兼容性安全网**：注入后跑现有测试套件，对比注入前后通过率
  - [ ] 注入前先跑一次 baseline 测试
  - [ ] 注入后跑一次，diff 失败用例
  - [ ] 失败用例归因（注入导致 vs 原有问题）
- [ ] **P2-8 Spring Boot / FastAPI 适配器实现**：作为首批非 Node.js 适配器，验证 SPI 可扩展性

### 3.5 退出准则（DoD）

- [ ] 至少 3 个真实项目（≥ 1 个非 Node.js）跑通 inject，advisory 模式下不破坏现有测试
- [ ] API 逆向契约对 ≥ 80% 的路由生成有效 OpenAPI（人工抽检通过）
- [ ] 回滚机制可完整撤销注入（git diff 干净）
- [ ] 改造计划 markdown 可读、可执行、可审计

### 3.6 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 注入破坏现有构建（如规则与既有 lint 冲突） | 高 | advisory 默认 + 安全网跑测试 + dry-run 先行 |
| API 逆向契约低质量（缺类型 / 注解不全） | 高 | 置信度标注 + 人工 review 入口 + 与现有 OpenAPI 注解合并 |
| 渐进式升级"卡在 advisory 永不升级" | 中 | 内置"升级就绪检查"，CI 输出建议升级清单 |
| 适配器维护成本（每技术栈一份） | 中 | SPI 收敛差异，公共逻辑下沉；社区贡献指南 |

---

## 4 · Phase 3：Skill 生态与智能化（持续）

### 4.1 目标

Skill 可组合、可共享、可进化，形成跨团队 / 跨组织的方法论生态。

### 4.2 生态愿景

```
│              AI Spec Skill 生态                       │
│  │ 核心 Skills  │  │ 领域 Skills  │  │ 社区 Skills  │ │
│  │ spec-first  │  │ user-mgmt   │  │ i18n-spec   │ │
│  │ contract    │  │ audit-log   │  │ rbac-spec   │ │
│  │ architecture│  │ file-upload │  │ multi-tenant│ │
│  │ rule-engine │  │ notification│  │ ...         │ │
│  │ context     │  │ ...         │                │
│  Skill Registry (发现/安装/版本管理)                  │
│  ai-spec skill add @community/rbac-spec             │
│  ai-spec skill add @huawei/jalor-spec               │
```

### 4.3 关键任务清单

- [ ] **P3-1 Skill 包格式定义**：`skill.toml`（或 `package.json` 扩展字段）
  - [ ] 元信息：`name` / `version` / `description` / `author` / `license`
  - [ ] 依赖：`depends_on`（其他 skill）/ `conflicts_with`
  - [ ] 产物：`rules` / `templates` / `adapters` / `role_prompts`
  - [ ] 兼容性：`requires_kernel_version` / `supported_stacks`
- [ ] **P3-2 Skill Registry 协议**：注册中心（发现 / 安装 / 版本管理）
  - [ ] `ai-spec skill search <keyword>` / `add <pkg>` / `update` / `remove`
  - [ ] 注册中心协议：HTTP GET 包元数据 + tarball 下载
  - [ ] 镜像源（自建 / npm / GitHub Packages 复用）
- [ ] **P3-3 领域 Skill 首批**：从实验期沉淀的领域抽象为可复用 Skill
  - [ ] `user-mgmt`（基于 user / auth / role 域）
  - [ ] `audit-log`（基于 audit 域，含 append-only + before/after 快照）
  - [ ] `rbac-spec`（基于 role-inheritance 域）
  - [ ] `notification`（基于 notification 域）
- [ ] **P3-4 Skill 组合机制**：多 Skill 协同（规则合并 / 模板覆盖优先级 / 契约引用）
  - [ ] 规则 ID 命名空间（`@community/rbac/SEC-001` 避免冲突）
  - [ ] 模板覆盖声明（`overrides` 字段显式声明，禁止隐式覆盖）
- [ ] **P3-5 智能化（可选，长期）**：
  - [ ] 基于现有代码库的"Spec 自动补全"建议
  - [ ] 基于 Review 历史的"常见 blocker 模式"提示
  - [ ] 基于规则集的"Spec 完整性评分"

### 4.4 退出准则（DoD）

- [ ] Skill 包格式稳定（v1.0），向后兼容承诺
- [ ] 至少 5 个领域 Skill 上架 Registry
- [ ] 至少 1 个第三方贡献的 Skill 通过审核

---

## 5 · 横切关注点

### 5.1 Phase 依赖关系

```
Phase 0 (资产提取)
   │
   ├──> Phase 1 (生成型 CLI)  ──┐
   │     [不阻塞]               │
   │                            ├──> Phase 3 (Skill 生态)
   └──> Phase 2 (改造型 Skill) ──┘
         [依赖 Phase 0 的适配器 SPI]
```

- Phase 0 **阻塞** Phase 1 与 Phase 2（共享内核未就绪则两者无法实现）
- Phase 1 与 Phase 2 **可并行**（共享内核，差异在入口流程）
- Phase 3 **依赖** Phase 1 或 Phase 2 至少一个稳定（否则无 Skill 载体）

### 5.2 整体风险矩阵

| 风险 | Phase | 等级 | 缓解 |
|---|---|---|---|
| 通用化后表达能力下降 | 0 | 高 | 声明 + plugin 双轨 |
| 技术栈组合爆炸 | 1 | 高 | 黄金组合优先，余 experimental |
| 注入破坏现有构建 | 2 | 高 | advisory + 安全网 + dry-run |
| API 逆向低质量 | 2 | 高 | 置信度 + 人工 review |
| 适配器维护成本 | 2/3 | 中 | SPI 收敛 + 社区贡献 |
| Skill 包冲突 | 3 | 中 | 命名空间 + 显式 overrides |
| 与 production-transition 重复造轮子 | 0 | 中 | Phase 0 产出反哺 admin CI |

### 5.3 技术栈适配器优先级矩阵

| 适配器类型 | MVP (Phase 1) | Phase 2 | Phase 3 |
|---|---|---|---|
| Fastify + TS | ✅ 首选 | ✅ | ✅ |
| Express + TS | ✅ | ✅ | ✅ |
| Spring Boot (Java) | ⚠️ experimental | ✅ 首批非 Node | ✅ |
| FastAPI (Python) | ⚠️ experimental | ✅ 首批非 Node | ✅ |
| Vue3 + Vite | ✅ | ✅ | ✅ |
| Angular | ❌ | ⚠️ | ⚠️ |
| PostgreSQL | ✅ 首选 | ✅ | ✅ |
| MySQL | ⚠️ | ✅ | ✅ |
| MongoDB | ❌ | ⚠️ | ⚠️ |
| Zod / Pydantic / JSON Schema | ✅ | ✅ | ✅ |
| Protobuf | ❌ | ⚠️ | ⚠️ |
| JWT / OIDC | ✅ | ✅ | ✅ |
| GitHub Actions | ✅ | ✅ | ✅ |
| GitLab CI | ⚠️ | ⚠️ | ✅ |

---

## 6 · 里程碑与优先级

### 6.1 里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M0** | Phase 0 完成，共享内核 + 适配器 SPI 就绪 | — |
| **M1** | Phase 1 MVP，`npx create-ai-spec-app` 黄金组合可用 | M0 |
| **M2** | Phase 2 MVP，`ai-spec inject` 在 1 个非 Node 项目跑通 | M0 |
| **M3** | Phase 3 雏形，Skill 包格式 v0.1 + Registry 协议 | M1 或 M2 |
| **M4** | Phase 3 稳定，Skill 生态 ≥ 5 个领域 Skill | M3 |

### 6.2 优先级（建议执行顺序）

- **P0**（阻塞产品化）：Phase 0 全部 + Phase 1 黄金组合（M0 → M1）
- **P1**（产品差异化）：Phase 2 Spring Boot / FastAPI 适配器（M2）
- **P2**（生态启动）：Phase 3 Skill 包格式 + Registry 协议（M3）
- **P3**（生态繁荣）：领域 Skill 抽取 + 社区贡献（M4）

---

## 7 · 待办追踪汇总（SSOT）

> 本节为所有 Phase 任务的单一来源汇总，便于跨 Phase 追踪进度。状态变更须同步回各 Phase 子清单。

### Phase 0（资产提取与通用化）

- [ ] P0-1 规则集声明式化（13 项 enforcement 迁移为 YAML/JSON）
- [ ] P0-2 契约模板参数化（Zod / Pydantic / JSON Schema / Protobuf renderer）
- [ ] P0-3 架构模板多框架化（Fastify / Express / Spring Boot / FastAPI）
- [ ] P0-4 规则引擎可插拔化（核心 + plugin）
- [ ] P0-5 五角色提示词参数化（技术栈变量注入）
- [ ] P0-6 文档模板抽取（PRD / Tech-Spec / Review / Retro）
- [ ] P0-7 增量上下文工具通用化（gen-delta / gen-snapshot）
- [ ] P0-8 适配器 SPI 定义

### Phase 1（CLI 脚手架 MVP）

- [ ] P1-1 CLI 框架搭建（交互 + 非交互模式）
- [ ] P1-2 技术栈适配器矩阵（黄金组合 + experimental）
- [ ] P1-3 模板渲染引擎
- [ ] P1-4 生成的项目可跑三件套
- [ ] P1-5 端到端冒烟（一轮完整 spec-first 流程）
- [ ] P1-6 CI 配置生成
- [ ] P1-7 文档站
- [ ] P1-8 发包（npm `create-ai-spec-app`）

### Phase 2（改造型 Skill）

- [ ] P2-1 项目探测引擎（project-profile.json）
- [ ] P2-2 架构分析器（分层报告 + 违规检测）
- [ ] P2-3 API 逆向契约生成（OpenAPI / JSON Schema）
- [ ] P2-4 渐进式规则注入（advisory → warning → blocking）
- [ ] P2-5 改造计划生成（dry-run + diff 预览）
- [ ] P2-6 回滚机制
- [ ] P2-7 兼容性安全网（注入前后测试 diff）
- [ ] P2-8 Spring Boot / FastAPI 适配器实现

### Phase 3（Skill 生态与智能化）

- [ ] P3-1 Skill 包格式定义（skill.toml v1.0）
- [ ] P3-2 Skill Registry 协议（search / add / update / remove）
- [ ] P3-3 领域 Skill 首批（user-mgmt / audit-log / rbac-spec / notification）
- [ ] P3-4 Skill 组合机制（命名空间 + 显式 overrides）
- [ ] P3-5 智能化（Spec 自动补全 / blocker 模式提示 / 完整性评分）

---

## 附录 A · 术语表

| 术语 | 含义 |
|---|---|
| Skill | 可复用的工作流资产包（规则 + 模板 + 适配器 + 角色提示词） |
| 共享内核 | 技术栈无关的方法论沉淀（Phase 0 产出） |
| 适配器 | 技术栈特化层，实现 SPI 接口 |
| SPI | Service Provider Interface，适配器须实现的接口契约 |
| 黄金组合 | MVP 期主推的技术栈组合（Fastify + PG + React + Zod + JWT + GH Actions） |
| advisory 模式 | 规则只报告不阻断，便于渐进式接入 |
| blocking 模式 | 规则阻断 CI，强制合规 |
| contract drift | 契约与实现不一致（Spec ↔ 代码 ↔ OpenAPI） |

## 附录 B · 与实验期资产对照

| 实验期资产 | Skill 化产物 | Phase |
|---|---|---|
| `.trae/rules/`（5 类规则） | `rules/`（声明式） | P0-1 |
| `contracts/schemas/*.ts`（Zod） | `templates/contract/`（多 renderer） | P0-2 |
| 四层架构（node:http） | `templates/architecture/`（多框架） | P0-3 |
| `scripts/check-rules.mjs` | `rule-engine/`（核心 + plugin） | P0-4 |
| `spec-first-workflow.md §2` 五角色骨架 | `roles/`（参数化模板） | P0-5 |
| `docs/prd / spec / review` 模板 | `templates/doc/`（参数化） | P0-6 |
| `gen-delta.mjs` / `gen-snapshot.mjs` | `tools/`（通用 CLI） | P0-7 |
| 实验期 8 个业务域 | 领域 Skill（user-mgmt / audit-log 等） | P3-3 |

---

**一句话总结**：

> 把"AI 能否在约束下自律产出可审计代码"这个已验证的内核，从实验载体中提取出来，做成可被任意技术栈复用的 Skill 产品。改造型 (`inject`) 赋能存量，生成型 (`create-ai-spec-app`) 赋能增量，两者共享内核 + 适配器层，最终演进为可组合、可共享、可进化的方法论生态。
