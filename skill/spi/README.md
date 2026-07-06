# Adapter SPI

> P0-8 产出。所有适配器须实现 [adapter.ts](./adapter.ts) 中的接口契约。

## 能力矩阵

适配器可选择性实现部分能力，通过 `capabilities` 声明：

| 能力 | 方法 | 必须 | 示例 |
|---|---|---|---|
| 项目探测 | `detectProject` | 推荐 | 任何改造型 (`inject`) 适配器 |
| 契约渲染 | `renderContract` | 至少一项 | Zod / Pydantic / JSON Schema |
| 架构渲染 | `renderArchitecture` | 生成型必备 | Fastify / Spring Boot |
| 规则检查 | `rule_check_plugin` | 推荐 | TS / Java / Python plugin |
| CI 配置生成 | `generateCiConfig` | 可选 | GitHub Actions / GitLab CI |
| 角色提示词渲染 | `renderRolePrompts` | 可选 | 默认走内核模板 |

## 实现示例

```typescript
import type { Adapter } from '@ai-spec/spi';

export const fastifyTsAdapter: Adapter = {
  stack_id: 'node:fastify:ts',
  version: '0.1.0',
  capabilities: {
    detectProject: true,
    renderContract: true,
    renderArchitecture: true,
    runRuleChecks: true,
    generateCiConfig: true,
    renderRolePrompts: false, // 走内核默认模板
  },
  detectProject: async (rootDir) => { /* ... */ },
  renderContract: async (input) => { /* ... */ },
  renderArchitecture: async (input) => { /* ... */ },
  rule_check_plugin: { /* ... */ },
  generateCiConfig: async (input) => { /* ... */ },
};
```

## 注册与发现

适配器通过 `registerAdapter(adapter)` 注册到核心 registry。核心引擎按 `stack_id` 查找：

```typescript
import { registerAdapter, getAdapter } from '@ai-spec/engine';
import { fastifyTsAdapter } from '@ai-spec/adapter-fastify-ts';

registerAdapter(fastifyTsAdapter);
const adapter = getAdapter('node:fastify:ts');
```

## SPI 稳定性承诺

- `Adapter` 接口字段只增不减（向后兼容）
- 新增能力时通过 `capabilities` 声明，旧适配器无需实现新方法
- 字段语义变更走 deprecation 期（≥ 1 个 minor 版本）
