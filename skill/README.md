# AI Spec Skill —— spec-first 工作流方法论 + CLI 脚手架

> 把 `mvp/` 实验期 24 轮验证的 spec-first 工作流沉淀为：技术栈无关的共享内核 + 可插拔适配器 + 一键脚手架 CLI。
>
> 路线图：[mvp/docs/workflow/skill-product-roadmap.md](../mvp/docs/workflow/skill-product-roadmap.md)

## 快速上手（5 分钟）

### 安装

```bash
# 交互式
npx create-ai-spec-app my-project

# 非交互式（黄金组合）
npx create-ai-spec-app my-project --yes

# 自定义组合
npx create-ai-spec-app my-project --backend express-ts --db sqlite --frontend react-vite --auth jwt --ci github-actions --yes
```

### 生成的项目

```
my-project/
├── .ai-spec/           # 规则 + 角色 + 模板 + 配置（从 kernel 拷贝）
│   ├── rules/*.yaml
│   ├── roles/*.md
│   ├── templates/*.hbs
│   ├── schema/rule.schema.json
│   └── config.json
├── packages/contracts/ # 契约层（按 contract 库渲染：Zod/Pydantic/JSON Schema）
├── apps/api/           # 后端（按 backend 渲染：Fastify/Express/Spring Boot/FastAPI）
├── apps/web/           # 前端（按 frontend 渲染：React+Vite/Vue3+Vite/Angular/无）
├── scripts/            # 工具脚本（check-rules / gen-delta / check-contract-drift）
├── docs/{prd,spec,review,retro}/  # 五角色产出目录
└── .github/workflows/ai-spec-ci.yml  # CI 门禁
```

### 跑门禁三件套

```bash
cd my-project
npm install
npm run typecheck      # tsc --noEmit
npm run spec:check     # 规则校验（含 13 项 enforcement）
npm run spec:gate      # 三件套聚合（typecheck + spec:check + test）
```

## spec-first 工作流

生成的项目按五角色流程开发：

| 角色 | 输入 | 产出 | 文件 |
|---|---|---|---|
| BA | 背景需求 + 规则 | PRD（AC + Q&A） | `docs/prd/<domain>.md` |
| Tech Lead | PRD | Tech-Spec + contracts | `docs/spec/<domain>.tech.md` + `packages/contracts/src/schemas/<domain>.ts` |
| test-writer | Tech-Spec + 契约 | 断言级红测试 | `apps/<api|web>/test/<domain>*.test.ts` |
| impl-writer | Tech-Spec + 测试 | 实现（使测试转绿） | `apps/<api|web>/src/<domain>/*.ts` |
| Reviewer | 全部 | Review 报告 | `docs/review/<domain>-review.md` |

7 道门禁：G1 PRD → G3 Spec → G4 测试 → G5 实现 → G6 Review → G6.1 修复 → G7 合入。

详细规则见 `.ai-spec/rules/`，角色提示词见 `.ai-spec/roles/`。

## 适配器矩阵

### 已支持（MVP）

| 类型 | 适配器 | 状态 |
|---|---|---|
| backend | fastify-ts | ✅ 推荐 |
| backend | express-ts | ✅ |
| db | postgresql | ✅ 推荐 |
| db | sqlite | ✅ 开发用 |
| frontend | react-vite | ✅ 推荐 |
| contract | zod | ✅（TS 栈默认）|
| contract | pydantic | ✅（Python 栈）|
| contract | json-schema | ✅（跨语言）|
| auth | jwt | ✅ 推荐 |
| auth | none | ✅ 开发用 |
| ci | github-actions | ✅ 推荐 |

### Experimental（占位 manifest）

| 类型 | 适配器 | 状态 |
|---|---|---|
| backend | spring-boot | ⚠️ experimental |
| backend | fastapi | ⚠️ experimental |
| db | mysql / mongodb | ⚠️ experimental |
| frontend | vue3-vite / angular | ⚠️ experimental |
| auth | session / oauth2 | ⚠️ experimental |
| ci | gitlab-ci | ⚠️ experimental |

## 适配器开发指南

### 适配器目录结构

```
adapters/<type>/<id>/
├── manifest.yaml     # 声明能力 + 元数据
├── files/            # 模板文件（.tmpl 后缀，可用 {{var}} 占位）
└── adapter.ts        # 可选：实现 SPI 接口（capabilities 中声明的）
```

### manifest.yaml 示例

```yaml
id: fastify-ts
label: Fastify + TypeScript
version: "4.27"
capabilities:
  - detect-project
  - render-architecture
  - render-role-prompts
  - rule-check
language: typescript
ecosystem: nodejs
notes: |
  Fastify 4 原生支持 JSON Schema 校验。
```

### 添加新适配器步骤

1. 在 `adapters/<type>/<id>/` 下创建 `manifest.yaml`（参考已有适配器）
2. 在 `files/` 下放模板文件（如 `server.ts.tmpl`）
3. 更新 `cli/options.ts` 的 `STACK_OPTIONS` 加入新选项
4. 如有特殊渲染逻辑，在 `cli/template-engine.ts` 加分支或调用 `loadAdapterFile`
5. 跑 `npx tsx cli/index.ts test-proj --<type> <id> --yes --no-deps --no-git` 验证生成
6. 在生成的项目里跑 `npm run typecheck && npm test` 验证三件套全绿

### SPI 接口

完整 SPI 定义见 [spi/adapter.ts](spi/adapter.ts)，包含 7 个接口：

- `DetectProjectSpi`：检测既有项目的技术栈
- `RenderContractSpi`：渲染契约层（Zod/Pydantic/JSON Schema）
- `RenderArchitectureSpi`：渲染架构层（router/service/repository/domain）
- `RuleCheckPlugin`：规则检查插件（13 项 enforcement 的语言特化）
- `GenerateCiConfigSpi`：生成 CI 配置
- `RenderRolePromptsSpi`：渲染五角色提示词
- `Adapter`：主接口，聚合上述能力

## 内核目录结构

```
skill/
├── kernel/              # 共享内核（技术栈无关）
│   ├── rules/           # 声明式规则集 (YAML)
│   ├── schema/           # 规则元模型 JSON Schema
│   ├── roles/            # 五角色提示词 (参数化)
│   └── templates/        # 文档模板 (PRD/Tech-Spec/Review/Retro)
├── adapters/             # 可插拔适配器
│   ├── contract/         # 契约渲染器 (Zod/Pydantic/JSON Schema)
│   ├── backend/          # 后端适配器 (fastify-ts/express-ts)
│   ├── db/               # 数据库适配器 (postgresql/sqlite/mysql/mongodb)
│   ├── frontend/         # 前端适配器 (react-vite/vue3-vite/angular)
│   ├── auth/             # 认证适配器 (jwt/session/oauth2/none)
│   ├── ci/               # CI 适配器 (github-actions/gitlab-ci/none)
│   └── architecture/     # 架构层映射 (layer-mapping.yaml)
├── engine/              # 规则引擎 (核心 + plugin)
├── cli/                 # CLI 脚手架 (commander + enquirer)
├── tools/               # 通用 CLI 工具 (gen-delta/gen-snapshot)
├── spi/                 # 适配器 SPI 定义
└── test/                # DoD 验证套件
```

## 设计原则

1. **内核只描述"做什么 + 为什么"，不绑定"用什么语言写"**
2. **适配器只描述"用 X 技术栈怎么落地"，可被替换**
3. **改造型（ai-spec inject）与生成型（create-ai-spec-app）共享内核与适配器，差异仅在入口流程**

## CLI 选项

```
create-ai-spec-app <project-name> [options]

Options:
  -o, --out <dir>         输出目录（默认 ./<project-name>）
  -b, --backend <stack>   后端 (fastify-ts|express-ts|spring-boot|fastapi)
  -d, --db <db>           数据库 (postgresql|sqlite|mysql|mongodb)
  -f, --frontend <stack>  前端 (react-vite|vue3-vite|angular|none)
  -c, --contract <lib>    契约库 (zod|pydantic|json-schema)
  -a, --auth <scheme>     认证 (jwt|session|oauth2|none)
  --ci <platform>         CI (github-actions|gitlab-ci|none)
  -y, --yes               使用黄金组合默认值（非交互模式，可覆盖缺省字段）
  --no-deps               跳过依赖安装
  --no-git                跳过 git init
  -v, --verbose           详细日志
  -V, --version           显示版本
  -h, --help              显示帮助
```

## 当前状态

### Phase 0（资产提取）✅

- [x] P0-1 规则集声明式化（13 项 enforcement → YAML）
- [x] P0-2 契约模板参数化（3 renderer：Zod/Pydantic/JSON Schema）
- [x] P0-3 架构模板多框架化（4 框架 layer-mapping）
- [x] P0-4 规则引擎可插拔化（核心 + typescript plugin）
- [x] P0-5 五角色提示词参数化
- [x] P0-6 文档模板抽取
- [x] P0-7 增量上下文工具通用化
- [x] P0-8 适配器 SPI 定义
- [x] DoD 验证（29 测试全绿）

### Phase 1（CLI 脚手架 MVP）✅

- [x] P1-1 CLI 框架搭建（commander + enquirer，交互 + 非交互双模式）
- [x] P1-2 技术栈适配器矩阵（13 个 manifest + fastify-ts/express-ts 项目验证）
- [x] P1-3 模板渲染引擎（适配器目录加载 + 冲突检测 + 去重）
- [x] P1-4 生成项目可跑三件套（fastify-ts + express-ts 全绿）
- [x] P1-6 CI 配置生成（ai-spec-ci.yml + contract drift 占位）
- [x] P1-7 文档（README + 快速上手 + 适配器开发指南）
- [x] P1-8 发包准备（package.json bin + CHANGELOG）

### Phase 2 / 3（规划中）

详见 [roadmap](../mvp/docs/workflow/skill-product-roadmap.md)。

## 开发期命令

```bash
cd skill
npm install
npm test                    # 跑 DoD 验证套件
npm run typecheck           # tsc --noEmit
npm run engine:parity       # 对 mvp/ 跑等价性测试
npm run cli:dev -- my-proj --yes --no-deps --no-git  # 本地开发模式跑 CLI
```

## FAQ

**Q: 为什么生成的项目用 npm workspaces 而不是 pnpm/turbo？**
A: MVP 期 npm workspaces 兼容性最广，无需额外安装。生产化阶段可加 pnpm/turbo 适配器。

**Q: 为什么 spec:check 是占位？**
A: 当前 P1-1 阶段未接入 skill engine 的真实调用，待 P1-3 完整模板引擎接入后会调用 engine.run() 跑 13 项 enforcement。

**Q: experimental 适配器什么时候变 stable？**
A: 需要满足：(1) 适配器有完整 files/ 模板；(2) 生成的项目三件套全绿；(3) 至少 1 个外部用户跑通端到端流程。

**Q: 如何贡献新适配器？**
A: 参考"适配器开发指南"章节，提 PR 时附生成的项目三件套全绿截图。
