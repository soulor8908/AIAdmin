// vitest.workspace.ts —— R20 闭合 S-5：vitest 1.6.1 多 project 配置（§10.6 反向同步）
//
// vitest 1.6.1 不支持 test.projects（vitest 2.x 才引入），改用 workspace 文件机制：
// 导出 default 数组，每元素是一个 project 配置对象，通过 extends 继承 vitest.config.ts
// 共享配置（plugins=externalize-node-sqlite / resolve.alias=@admin/contracts /
// test.globals=true / test.testTimeout=20000 / test.coverage）。
//
// 3 个 project（AC-S5-1/S5-2/S5-3）：
// - api project（node 环境，无 setupFiles，AC-S5-2 后端无 jest-dom 污染）
// - web project（jsdom 环境 + setupFiles=jest-dom，AC-S5-3 前端 jest-dom 在 jsdom 内生效）
// - contracts project（node 环境，contracts 测试纯 schema 解析无 jest-dom 需求）
//
// include 互斥（§3.5 [约束]）：各 project 的 include 收窄到对应 app，避免同一测试被多 project 重复跑。
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    // api project：node 环境，无 setupFiles（AC-S5-2，后端不被 jest-dom 全局副作用污染）。
    extends: './vitest.config.ts',
    test: {
      name: 'api',
      environment: 'node',
      include: ['apps/api/test/**/*.{test,spec}.{ts,tsx}'],
    },
  },
  {
    // web project：jsdom 环境 + setupFiles=jest-dom（AC-S5-3，前端 jest-dom 在 jsdom 内生效）。
    extends: './vitest.config.ts',
    test: {
      name: 'web',
      environment: 'jsdom',
      setupFiles: ['apps/web/test/setup.ts'],
      include: ['apps/web/test/**/*.{test,spec}.{ts,tsx}'],
    },
  },
  {
    // contracts project：node 环境（contracts 测试纯 schema 解析，无 jest-dom 需求）。
    // 当前无 contracts 测试文件（packages/contracts/test/ 不存在），include 匹配 0 文件，
    // 留 project 为 future 扩展（contracts 测试出现即自动归此 project 跑）。
    extends: './vitest.config.ts',
    test: {
      name: 'contracts',
      environment: 'node',
      include: ['packages/*/test/**/*.test.ts'],
    },
  },
]);
