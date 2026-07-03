import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // node:sqlite 是 Node 22+ 新增内置模块，Vite 5.4 的 builtin 列表未收录，
      // 收集期报 "Failed to load url sqlite"。用虚拟模块（\0 前缀）拦截，
      // 内部用 createRequire 走 Node 原生 require 加载（与 persist.test.ts 同模式）。
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
    environment: 'node',
    // [R15 impl-writer 改] user-event 逐字符输入 4001 字符（content > 4000 safeParse 测试）超过默认 5000ms，
    //   提升 testTimeout 至 20000ms（仅放宽超时上限，不掩盖断言失败）。
    testTimeout: 20000,
    include: ['apps/*/test/**/*.{test,spec}.{ts,tsx}', 'packages/*/test/**/*.test.ts'],
    setupFiles: ['apps/web/test/setup.ts'],
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
