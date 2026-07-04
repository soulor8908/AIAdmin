# AIAdmin

> 一个用 AI agent 编排开发流程的 spec-first 工作流实验，以 admin 系统为载体验证 24 轮迭代。
>
> **"AI Native" 指开发流程由 AI agent 编排**（BA→TechLead→test-writer→impl-writer→Reviewer 五角色 + 7 道门禁），**非产品本身含 AI 能力**。本仓库的真正产物是工作流，admin 系统是流程的运行时证据。

## 这是什么

本项目有两层产物：

1. **工作流层（真正产物）**：spec-first AI 原生开发工作流，经 24 轮迭代验证
   - 五角色 subagent 编排（BA / Tech Lead / test-writer / impl-writer / Reviewer）
   - 7 道门禁（G1 PRD / G3 Spec / G4 测试断言级红 / G5 三件套 / G6 Review / G6.1 修复复验 / G7 合入）
   - 规则机器化校验（[scripts/check-rules.mjs](mvp/scripts/check-rules.mjs)，13 项 enforcement）
   - 复盘反推机制（23 条 S 级教训已固化到规则/Spec/提示词三层）
   - 工作流模板：[docs/workflow/spec-first-workflow.md](mvp/docs/workflow/spec-first-workflow.md)

2. **代码层（流程载体）**：admin 管理系统
   - 后端：`node:http` + `node:sqlite` + Zod，零 Web 框架依赖
   - 前端：React + Vite + react-router-dom，零 UI 框架依赖
   - 测试：Vitest（1272 用例）+ Playwright（66 E2E，chromium + firefox + webkit 三浏览器）
   - 契约层：Zod schema SSOT，类型经 `z.infer` 派生

## 快速上手

### 环境要求

- Node.js ≥ 22（使用 `node:sqlite` 内置模块）
- npm ≥ 10（workspace 支持）

### 安装与运行

```bash
cd mvp
npm install                          # 安装 workspace 依赖
npm start                            # 启动后端，监听 :3000
# 另开终端
npm --workspace @admin/web run dev   # 启动前端，监听 :5173
```

打开 http://localhost:5173，使用 `admin@example.com` / `admin123` 登录。

### 三件套（每次改动必跑）

```bash
npm run typecheck   # tsc --noEmit
npm run lint:rules  # node scripts/check-rules.mjs（13 项规则机器校验）
npm test            # vitest run（1272 用例）
npm run test:e2e    # playwright test（66 E2E，三浏览器）
npm run test:e2e:local  # 仅 chromium，本地快速反馈
```

## 目录结构

```
mvp/
├── .trae/rules/              # 规则集（AI agent 行为约束 + 架构 + 编码 + 安全 + 元约束）
├── apps/
│   ├── api/                  # 后端：四层架构 domain→repository→service→router + server.ts
│   │   ├── src/
│   │   └── test/             # 单测 + embedding 端到端测试
│   ├── web/                  # 前端：api / auth / components / pages 分层
│   │   ├── src/
│   │   └── test/
│   └── e2e/                  # Playwright E2E（三浏览器 × 22 用例 = 66 tests）
├── packages/contracts/       # 契约层 SSOT（Zod schema + z.infer 类型）
├── docs/
│   ├── prd/                  # 业务需求文档（BA 产出）
│   ├── spec/                 # 技术规格（Tech Lead 产出）
│   ├── review/               # Review 报告（Reviewer 产出）
│   ├── retro/                # 24 轮复盘 + lessons-learned.md 教训索引
│   ├── workflow/             # spec-first 工作流模板（可复用 skill 候选）
│   └── context-snapshot.md   # 自动生成的项目上下文快照
└── scripts/
    ├── check-rules.mjs       # 规则机器校验（13 项 enforcement）
    ├── gen-context-snapshot.mjs
    ├── gen-round-delta.mjs   # 增量上下文生成（A1 机制）
    └── gen-retro-index.mjs   # 复盘教训索引生成
```

## 工作流概览

```
PRD(BA) → Tech-Spec+契约(TechLead) → 测试先行(test-writer) → 实现(impl-writer) → Review(Reviewer) → 门禁G7(编排者) → 复盘(编排者)
```

- **核心原则**（AI-001~007）：先读 Spec 再写码 / 测试先行断言级红 / 禁止越界须反向同步 / 每次改动必跑三件套 / 跨域枚举 SSOT 派生 / 受影响测试清单 / 端到端验收 + PRD 逐条核对
- **架构约束**（ARCH-001~003）：四层单向依赖 / 契约层纯净 / 跨层只经契约
- **安全约束**（SEC-001/002/003）：路由默认受保护 / 越权校验在 service 层 / 输出 schema `.strict()` + PII 边界
- **元约束**（META-001~004）：无校验不立规 / 规则 PR 准入 / 声明即实现 / 实现即声明

完整工作流模板与五角色提示词骨架见 [docs/workflow/spec-first-workflow.md](mvp/docs/workflow/spec-first-workflow.md)。

## 关键技术决策

| 决策 | 约定 |
|---|---|
| 乐观锁 | 写路由 `versioned=true`，`If-Match` → `expected_version`，缺失 → `VERSION_REQUIRED(400)`，不匹配 → `VERSION_CONFLICT(409)` + `current_version` |
| ETag | 读路由 `cacheable=true`，`If-None-Match` 匹配 → `304` 空体 |
| 鉴权 | Bearer token 五守卫（G1 缺失 / G2 非 Bearer / G3 验签失败 / G4 过期 / G5 黑名单） |
| 输出 | 响应 schema `.strict()` 拒绝多余字段，存储态与输出态 schema 拆分（`password_hash` 不外泄） |
| PII | 审计日志查询返回 `redactedAuditLogSchema`（脱敏态），邮箱脱敏 `ab***@domain` |
| 错误码 | `errorCodeSchema` 全局 SSOT，`errors.ts` `Record<ErrorCode, number>` 穷举 HTTP 映射，新增码须四处处同步 |

## 生产就绪性警告

⚠️ **本仓库为流程实验载体，未做生产就绪加固**。生产部署前须解决：

- `AUTH_SECRET` 强制环境变量注入（当前有开发默认值 `'dev-auth-secret-do-not-use-in-prod'`）
- `CORS_ORIGIN` 收紧为前端实际域名（当前默认 `'*'`）
- `readBody` 加 body size limit（防 DoS）
- `tokenBlacklistRepo` 改为分布式存储（当前 SQLite 进程内，多实例失效）
- 加速率限制 + 请求日志
- SQLite 单文件 + 同步 API，无法横向扩展，须迁移到 PostgreSQL 等可扩展存储

## 演进脉络

24 轮迭代的关键节点：

- **R1-R6**：MVP 跑通 → META-003/004 双向绑定 → 跨域联动 → 验收对齐门禁
- **R7-R11**：[约束] 偏离处理流程 → 递归继承 + 环检测 → HTTP 条件请求（If-Match / ETag）→ 鉴权域
- **R12-R16**：ARCH-003 闭合 → wire 适配 → 多约束组合副作用预判 → errorMapping 全码映射
- **R17-R19**：6 项遗留 S 级全部固化 → S-21/S-22 提示词层固化
- **R20-R24**：Playwright E2E 引入 → 前端性能加固 → 可访问性深化 → 跨浏览器 E2E 覆盖

完整教训索引见 [docs/retro/lessons-learned.md](mvp/docs/retro/lessons-learned.md)，每轮明细见 `docs/retro/roundN-retro.md`。

## License

私有项目，仅用于工作流实验验证。
