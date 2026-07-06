# Changelog

本文件记录 `@ai-spec/skill` 包的版本演进。语义版本遵循 [SemVer 2.0](https://semver.org/lang/zh-CN/)。

## [0.1.0-phase1] - 2026-07-06

### Added

- **P1-1 CLI 脚手架**：`create-ai-spec-app` 命令，基于 commander + enquirer，支持交互式 / 非交互式双模式
  - 交互式：`npx create-ai-spec-app my-project`
  - 非交互式：`npx create-ai-spec-app my-project --yes`
  - 黄金组合：Fastify + PostgreSQL + React+Vite + Zod + JWT + GitHub Actions
- **P1-2 适配器矩阵**：13 个适配器 manifest
  - backend: fastify-ts ✅ + express-ts ✅ + spring-boot ⚠️ + fastapi ⚠️
  - db: postgresql ✅ + sqlite ✅ + mysql ⚠️ + mongodb ⚠️
  - frontend: react-vite ✅ + vue3-vite ⚠️ + angular ⚠️
  - contract: zod ✅ + pydantic ✅ + json-schema ✅（Phase 0 产出）
  - auth: jwt ✅ + none ✅ + session ⚠️ + oauth2 ⚠️
  - ci: github-actions ✅ + gitlab-ci ⚠️ + none ✅
- **P1-3 模板渲染引擎**：从适配器目录加载模板 + 冲突检测 + 后写优先去重
- **P1-6 CI 配置生成**：`.github/workflows/ai-spec-ci.yml` + `check-contract-drift.mjs` 占位
- **P1-7 文档**：README 含快速上手 + 5 分钟教程 + 适配器开发指南 + FAQ
- **P1-8 发包准备**：`package.json` 含 `bin` 字段 + 语义版本 + CHANGELOG

### Verified

- fastify-ts + express-ts 两种组合生成的项目三件套全绿（typecheck + spec:check + test）
- commander 选项解析正确（含 `--yes` 与显式传值共存）
- 适配器目录加载正确（fastify-ts/express-ts server.ts 真正差异）

### Known Limitations

- `spec:check` 为占位（待接入 skill engine 真实调用 13 项 enforcement）
- `gen-delta` 为占位
- `check-contract-drift` 为占位
- experimental 适配器仅有 manifest，无 files/ 模板
- 端到端 spec-first 流程冒烟（P1-5）未在生成项目内验证

## [0.1.0-phase0] - 2026-07-06

### Added

- **P0-1 规则集声明式化**：13 项 enforcement 提取为 YAML（ai-behavior / architecture / coding / security / meta）
- **P0-2 契约模板参数化**：3 renderer（Zod / Pydantic / JSON Schema）+ user.meta.yaml 样本
- **P0-3 架构模板多框架化**：layer-mapping.yaml 覆盖 fastify-ts / express-ts / spring-boot / fastapi
- **P0-4 规则引擎可插拔化**：engine 核心 + typescript plugin（plugin 优先调度，可覆盖内置检查）
- **P0-5 五角色提示词参数化**：orchestrator / ba / tech-lead / test-writer / impl-writer / reviewer
- **P0-6 文档模板抽取**：prd / tech-spec / review / retro 的 .hbs 模板
- **P0-7 增量上下文工具通用化**：gen-delta.ts + gen-snapshot.ts（参数化，取代 mvp/scripts/）
- **P0-8 适配器 SPI 定义**：7 接口（Detect / Contract / Arch / Rule / Ci / Role / Adapter）

### DoD Verified

- 共享内核规则集无 Node.js 关键字（18 测试通过）
- ≥ 2 种 renderer 渲染可编译契约（4 测试通过）
- engine 可加载外部 plugin 不改核心（4 测试通过）
- 13 项 enforcement verdict 与既有 check-rules.mjs 等价（3 测试通过）
- 总计 29 测试全绿 + tsc --noEmit 无缺陷

---

后续版本规划见 [roadmap](../mvp/docs/workflow/skill-product-roadmap.md)。
