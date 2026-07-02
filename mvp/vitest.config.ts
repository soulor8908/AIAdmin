import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.ts'],
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
