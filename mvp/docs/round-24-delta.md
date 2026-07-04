# 轮次增量上下文（自动生成，勿手改）
> 对比 HEAD~1 (4b7183c) → HEAD (8a6b766) · 改动 7 文件 · 目标 ≤3KB。
> 供 subagent 先读此 delta 把握本轮范围，按需再读全量 docs/context-snapshot.md。

## 本轮范围（按类别）
- **prd** (1): +prd/r24-cross-browser-e2e.md
- **spec** (1): +spec/r24-cross-browser-e2e.tech.md
- **review** (1): +review/r24-cross-browser-e2e-review.md
- **retro** (2): M retro/lessons-learned.md, +retro/round24-retro.md
- **other** (2): M package.json, M playwright.config.ts

## subagent 跳过建议
- 后端契约/实现变更：否（后端冻结，仅前端扩展，BA/Tech Lead 可跳过 contracts/server.ts 全文）
- 前端变更：否
- 规则变更：否（Reviewer 规则合规可信赖既有 exit 0）
- 本轮未触及的域（相关 subagent 可跳过对应 contracts/schemas/<域>.ts、server.ts 路由段、apps/web/src/api/<域>.ts）：user / auth / role / dept / audit / notification / report / transfer / role-inheritance

## 推荐先读路径（按角色）
- BA: 本 delta + docs/context-snapshot.md + docs/prd/<新域>.md（若存在）
- Tech Lead: 本 delta + docs/context-snapshot.md + packages/contracts/src/schemas/<新域>.ts + apps/api/src/server.ts（仅本轮新增段）
- test-writer: 本 delta + docs/spec/<新域>.tech.md + 新增 contracts schema
- impl-writer: 本 delta + docs/spec/<新域>.tech.md + 新增/变更文件
- Reviewer: 本 delta + git diff + 受影响文件（不全量扫描）