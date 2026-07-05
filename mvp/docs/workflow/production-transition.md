---
doc_type: Workflow-Transition
id: WF-PRODUCTION-TRANSITION-001
title: spec-first 工作流实验 → 生产化 转型路线图
status: draft
derived_from: v0.1.0-experimental 归档后的卡帕西视角评估
purpose: 把实验脚手架拆解为可执行的生产化任务清单，区分"该拆/该留/该补"
---

# spec-first 工作流实验 → 生产化 转型路线图

> 实验归档点：tag `v0.1.0-experimental`（24 轮迭代完成）
> 本文档定义从实验脚手架到生产级产品的演进路径，区分三类资产：
> - **该拆**：实验期为证明可行性而设的人为约束
> - **该留**：方法论内核（已验证有效）
> - **该补**：生产级新增需求（实验未覆盖）

---

## 1 · 该拆：实验脚手架（已废止）

### 1.1 零新依赖原则

- **实验目的**：验证"AI 能否在约束下自律产出可审计代码"
- **生产废止理由**：用爱发电，违背工程常识
- **替代方案**：
  - 后端：fastify（HTTP）+ node-postgres/pg（DB）+ pino（日志）+ ioredis（缓存）
  - 前端：保留 React + Vite，可引入 TanStack Query（数据层）+ shadcn/ui（组件库）
  - 测试：保留 Vitest + Playwright，新增 k6（负载）+ Pact（契约）

### 1.2 node:sqlite + 同步 repository

- **实验目的**：零依赖前提下跑通端到端流程
- **生产废止理由**：单文件 + 同步 API 无法横向扩展
- **替代方案**：
  - 迁移到 PostgreSQL + 连接池（pg Pool）
  - repository 层签名从同步改为 `Promise<T>`（伤筋动骨，需逐域迁移）
  - 引入事务边界（写操作显式 `BEGIN/COMMIT/ROLLBACK`）
  - 数据迁移工具：Prisma Migrate / Atlas / kysely-migrator

### 1.3 五角色严格禁读隔离

- **实验目的**：证明 spec-first 可行（impl-writer 仅基于 Spec + 测试就能产出实现）
- **生产废止理由**：生产团队是"人 + AI 副驾"，强制禁读变流程税
- **替代方案**：见 [AGENTS.md 生产化阶段工作指引](../../../AGENTS.md#角色协作实验期严格禁读已废止)

### 1.4 每轮 retro 自动反推规则

- **实验目的**：收敛期把踩坑快速固化为规则
- **生产废止理由**：规则稳定后每周反推变 ceremony
- **替代方案**：**事件驱动反推**——incident / postmortem / blocker 才反推规则

### 1.5 advisory / [约束] 偏离 + 反向同步 Spec 手注

- **实验目的**：强制 Spec 与代码一致
- **生产废止理由**：靠人手维护注释一致性不可持续
- **替代方案**：ADR（Architecture Decision Records）+ 代码 drift 检测脚本

### 1.6 手动编排 7 道门禁

- **实验目的**：编排者实跑三件套验证
- **生产废止理由**：人工跑必然漏检
- **替代方案**：见 [AGENTS.md 门禁演进表](../../../AGENTS.md#门禁实验期手动编排-7-道门禁演进)

### 1.7 best-effort 审计吞异常

- **实验目的**：简化实现
- **生产废止理由**：合规风险（审计失败 = 审计等于没审计）
- **替代方案**：
  - 主操作 + 审计日志同事务写 outbox 表
  - 或发 Kafka 由消费者保证 at-least-once 持久化

### 1.8 模块级 Map 缓存（ETag / token）

- **实验目的**：单进程简化
- **生产废止理由**：多实例失效
- **替代方案**：
  - ETag 缓存：Redis 共享 或 交给 CDN/网关
  - token blacklist：Redis 共享

### 1.9 admin 单角色桩

- **实验目的**：`ctx.user.role === 'admin'` 简化权限校验
- **生产废止理由**：真 RBAC 需求
- **替代方案**：
  - permission 集合从角色继承链解析（实验已实现 inheritance chain，反而是资产）
  - 接 OAuth/OIDC、JWT refresh、session revocation list、MFA

### 1.10 Reviewer 作为 subagent 角色

- **实验目的**：自动化 AC 逐条核对
- **生产废止理由**：生产 code review 是人 + 自动化
- **替代方案**：
  - "AC 逐条核对"沉淀为 PR 模板 checklist
  - 自动 E2E 映射 AC → 测试用例
  - 自动化 linter / SAST / 依赖扫描作为 Reviewer 副驾

---

## 2 · 该留：方法论内核（保留并嵌入真实工程基座）

| 实验 | 生产演进 |
|---|---|
| **Spec-first 契约先行** | 保留。contracts 从手写 Zod → **Zod + OpenAPI 自动生成**，客户端 SDK 由 OpenAPI 生成 |
| **SSOT errorCodeSchema 穷举映射** | 保留。扩展为**错误目录 + i18n**，前端 errorMapping 改为查表 + 语言包 |
| **z.infer 类型派生** | 保留，强模式 |
| **四层单向依赖 router→service→repo→domain** | 保留，生产拓扑加 API gateway / BFF / 消息总线 |
| **乐观锁 version 字段** | 保留，跨服务加分布式锁 |
| **断言级红 vs 导入级红** | 保留为测试纪律 |
| **bug 先复现测试再修** | 保留 |
| **lint:rules 机器化校验** | 保留，合并进 ESLint 规则集 + SAST（Semgrep/Snyk） |
| **G3 Spec↔契约 1:1 校验** | 保留，自动化为 CI 的 contract drift 检测 |
| **ETag 协商缓存协议** | 保留 HTTP 语义，但交给 CDN/网关实现 |
| **审计日志 append-only + before/after 快照** | 保留数据模型，改事务性存储 |

---

## 3 · 该补：生产级新增需求（实验未覆盖）

### 3.1 可观测性（实验最大盲区）

- **结构化日志**：pino 替代 console.warn
- **Metrics**：Prometheus（QPS / latency / error rate / 业务指标）
- **分布式追踪**：OpenTelemetry
- **错误聚合**：Sentry

> 没有可观测性的系统不是生产系统。

### 3.2 CI/CD + 环境分离

- dev / staging / prod 三环境
- secrets 管理（Vault / AWS Secrets Manager）
- GitHub Actions 流水线：
  - typecheck / lint / test
  - contract drift 检测
  - SAST（Semgrep / Snyk）
  - 依赖扫描（Dependabot / Renovate）
  - E2E（Playwright）
  - load test（k6）
- branch protection + required reviews
- 蓝绿 / 金丝雀发布

### 3.3 数据迁移

- 当前裸 `schema.sql` 不可接受
- 引入 Prisma Migrate / Atlas / kysely-migrator
- 迁移脚本版本化 + 回滚策略

### 3.4 API 版本化策略

- /v1 前缀已有，缺**破坏性变更策略**
- 补：deprecation 期、双版本并行、客户端 SDK 版本协商

### 3.5 安全合规

- PII 静态加密（at rest + in transit）
- GDPR 删除权（right to be forgotten）
- 审计日志保留期 + 不可篡改（WORM 存储）
- 密码策略（强度 / 历史密码 / 过期）
- 限流 / 熔断 / WAF
- SBOM（Software Bill of Materials）+ 依赖审计

### 3.6 测试金字塔补全

| 层级 | 实验期 | 生产化补 |
|---|---|---|
| Unit | ✅ Vitest | 保留 + coverage threshold ≥ 80% |
| Integration | ✅ embedding 测试 | 保留 |
| E2E | ✅ Playwright（66 用例） | 保留 + 视觉回归 |
| **契约测试** | ❌ | 新增 Pact（前后端契约） |
| **负载测试** | ❌ | 新增 k6（QPS / latency / 内存） |
| **混沌测试** | ❌ | 新增（服务降级 / 网络分区） |
| **安全扫描** | ❌ | 新增 SAST + DAST + 依赖审计 |

### 3.7 运维 Runbook

- 实验完全没有
- 生产每个服务要有：
  - oncall runbook（故障排查步骤）
  - SLO / SLI 定义
  - 告警阈值 + escalation policy
  - 故障演练（game day）

---

## 4 · 优先级排序（建议执行顺序）

### P0（必须先做，阻塞生产化）

1. **替换 node:sqlite → PostgreSQL**（repository 层异步化）
2. **引入 HTTP 框架**（fastify 替代 node:http）
3. **AUTH_SECRET / CORS_ORIGIN 环境变量强制**（实验已有 WARNING）
4. **token blacklist 改 Redis**（多实例生效）
5. **审计日志改事务性存储**（合规风险）

### P1（生产化必备）

6. **可观测性**（pino + Prometheus + OpenTelemetry + Sentry）
7. **CI/CD 流水线**（GitHub Actions 全套）
8. **数据迁移工具**（Prisma Migrate / Atlas）
9. **真 RBAC**（permission 继承链 + OAuth/OIDC）
10. **限流 / 熔断**（fastify-rate-limit / circuit-breaker）

### P2（生产化增强）

11. **契约测试**（Pact）
12. **负载测试**（k6）
13. **API 版本化策略**（deprecation 流程）
14. **GDPR 合规**（删除权 + 数据导出）
15. **SBOM + 依赖审计**

### P3（持续优化）

16. **OpenAPI 自动生成 + 客户端 SDK**
17. **错误目录 + i18n**
18. **混沌测试 + game day**
19. **视觉回归测试**
20. **运维 Runbook 完善**

---

## 5 · 工作流演进总结

```
实验期（已归档）：
  PRD(BA) → Tech-Spec+契约(TechLead) → 测试先行(test-writer) → 实现(impl-writer) → Review(Reviewer) → 门禁G7(编排者) → 复盘反推(编排者)
  特征：严格禁读 + 每轮反推 + 手动门禁 + 零新依赖

生产化阶段（演进）：
  Spec(人主导,AI草拟) → Tests(AI草拟,人审) → Impl(AI草拟,人审) → Review(人+自动化) → CI/CD(自动门禁) → Incident驱动反推
  特征：人机协作 + 事件驱动反推 + CI 自动门禁 + 真实工程基座
```

**一句话总结**：

> 实验验证了"规则机器化 + 反推闭环能让 AI 稳定产出可审计代码"这个内核；生产要做的不是把实验脚手架搬上生产线，而是把内核（spec-first / SSOT / 类型派生 / 断言级红 / 机器化校验）嵌入真实工程基座（CI/CD / 可观测性 / 事务性审计 / 真 RBAC / 数据迁移），同时拆掉为证明可行性而设的人为约束。
