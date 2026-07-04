import { defineConfig } from 'vitest/config';

// R20 闭合 S-5（PRD AC-S5-1~S5-5）：从单一 environment='node' + 全局 setupFiles 改为
// vitest workspace 模式：api project（node 环境，无 setupFiles）+ web project（jsdom 环境 +
// setupFiles=jest-dom）+ contracts project（node 环境）。environment 与 setupFiles 严格隔离，
// 后端测试不再被 jest-dom 全局副作用污染（AC-S5-2），前端 jest-dom 仍生效（AC-S5-3）。
// 既有 1256 测试须全绿无回归（AC-S5-4）。
//
// [R20 §10.6 反向同步]：spec §3.5 原文写 "vitest.config.ts 改用 test.projects 数组"，
// 但 vitest 1.6.1（当前仓库固定版本）不支持 test.projects（vitest 2.x 才引入）。
// vitest 1.6.1 的多 project 机制是 vitest.workspace.ts 文件（导出 default 数组），
// 各 project 通过 extends 字段继承本文件的共享配置（plugins / resolve.alias / globals /
// testTimeout / coverage）。本文件降级为"共享基座"，projects 声明移到 vitest.workspace.ts。
//   根因：vitest 1.6.1 源码 constants.5J7I254_.js workspacesFiles = ['vitest.workspace', 'vitest.projects']
//   × CONFIG_EXTENSIONS；resolveWorkspace() 读 workspace 文件 → initializeProject() 各 project
//   独立 Vite server。test.projects 字段在 InlineConfig 类型中不存在（vitest 2.x 才加），
//   vitest 1.6.1 静默忽略 test.projects → 所有测试用顶层默认（environment=node, 无 setupFiles）。
//   spec §3.5 视为 Tech Lead 在 vitest 版本核验时未发现的 API 差异，按 §10.6 "impl-writer 须修复
//   （非静默跳过）" 落地（属配置层修复，非断言弱化，AI-002 边界保持）。
export default defineConfig({
  plugins: [
    {
      // node:sqlite 是 Node 22+ 新增内置模块，Vite 5.4 的 builtin 列表未收录，
      // 收集期报 "Failed to load url sqlite"。用虚拟模块（\0 前缀）拦截，
      // 内部用 createRequire 走 Node 原生 require 加载（与 persist.test.ts 同模式）。
      // [约束] D4 / §3.5：plugin 跨 project 共享，留基座（api project 后端测试仍需 node:sqlite 解析）。
      name: 'externalize-node-sqlite',
      enforce: 'pre',
      resolveId(source) {
        if (source === 'node:sqlite') {
          return '\0node:sqlite';
        }
        return null;
      },
      load(id) {
        if (id === '\0node:sqlite') {
          return `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mod = require('node:sqlite');
export const DatabaseSync = mod.DatabaseSync;`;
        }
        return null;
      },
    },
  ],
  test: {
    globals: true,
    // [R15 impl-writer 改] user-event 逐字符输入 4001 字符（content > 4000 safeParse 测试）超过默认 5000ms，
    //   提升 testTimeout 至 20000ms（仅放宽超时上限，不掩盖断言失败）。跨 project 共享留基座。
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/index.ts', '**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@admin/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname,
    },
  },
});
