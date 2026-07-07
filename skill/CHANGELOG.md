# Changelog

本文件记录 `@ai-spec/skill` 包的版本演进。语义版本遵循 [SemVer 2.0](https://semver.org/lang/zh-CN/)。

## [0.1.0-phase1.1] - 2026-07-07

### Added

- **P3 Skill 生态与智能化**（Phase 3 完整落地）：
  - **P3-1 Skill 包格式**：`skill.yaml` manifest + rules/templates/role_prompts/contracts/adapters 产物 globs
  - **P3-2 本地 Registry**：`installed.json` SSOT + builtin 目录扫描 + `ai-spec skill search/add/remove` CLI
  - **P3-3 领域 Skill**：`user-mgmt` + `audit-log` 完整 skill 包（rules + contracts + templates + roles）
  - **P3-4 Skill 组合机制**：命名空间隔离 + overrides 显式声明（replace/extend/disable）+ 隐式覆盖检测 + 依赖解析 + 冲突检测
  - **P3-5 Spec 完整性评分器**：9 章节 + 字段填充率 + 改进建议 + 0-100 分 + ABCD 等级
- **建议 1：experimental 适配器防护**：`isExperimental()` 工具 + `loadAdapterFileOrThrow` 替代静默 fallback + 显式 warning
- **建议 2：E2E 冒烟测试**：fastify-ts + express-ts 两种组合生成项目 → npm install → typecheck → test 全流程验证（13 测试，支持 `SKIP_E2E=1`）
- **建议 3：engine 核心瘦身**：文件扫描抽出 `glob.ts`，`collectFiles` 复用
- **建议 4：渲染后占位符验证**：检测生成代码中的 `{{...}}` 残留（跳过 `.ai-spec/` / `.hbs` / `.tmpl`）

### Changed

- **建议 5：inject 默认 dry-run**：`--apply` 才执行写入，`--dry-run` 显式兼容旧用法
- **建议 6：skill 命名空间简化**：`<skill-name>/<RULE-ID>` 全局键，避免跨 skill 同 ID 冲突
- **建议 7：contract-reverser accuracy 标记**：`inferred` / `partial` / `high_confidence` / `verified`（verified 保留给人工确认）

### Fixed

- **问题 1：engine 核心瘦身**：`runRegexCheck` 从 engine 核心抽离为 `BuiltinRegexPlugin`，核心仅做调度 + 收集 finding
- **问题 2：E2E npm install CI 稳定性**：加 `--prefer-offline` 减少网络依赖 + 失败重试 1 次（应对瞬时网络抖动），超时 180s → 240s
- **问题 3：inject 交互流程简化**：`--apply` 直接执行（安全网已保障），`--force` 废弃为 no-op（保留兼容旧脚本），跳过安全网用 `--apply --no-safety-net`
- **问题 5：template-engine.ts 拆分**：从 846 行单文件拆为：
  - `template-engine.ts`（93 行，调度 + 冲突检测 + 占位符校验）
  - `templates/shared.ts`（78 行，共享工具）
  - `templates/root-files.ts`（297 行，根文件 + .ai-spec + contracts + docs）
  - `templates/api-scaffold.ts`（161 行，apps/api）
  - `templates/web-scaffold.ts`（115 行，apps/web）
  - `templates/scripts.ts`（172 行，scripts + CI + test setup）
- **问题 6：contract-reverser accuracy 重命名**：`verified` 拆分为 `high_confidence`（机器高置信）+ `verified`（人工确认，机器不自动赋值）

### Verified

- 81 测试全绿（含 13 E2E 真实 npm install + typecheck + test，支持 `SKIP_E2E=1` 跳过）
- tsc --noEmit 无缺陷
- BuiltinRegexPlugin 与原 engine 核心检查行为等价（parity-13-enforcements 测试通过）
- template-engine.ts 拆分后生成项目结构不变（E2E 测试通过）

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
