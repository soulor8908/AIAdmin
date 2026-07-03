// apps/web/vite.config.ts —— Vite 构建配置（TECH-WEB-AUTH-USER-001 §12.2）
// alias @admin/contracts 对齐根 tsconfig paths（运行时解析）；dev proxy /v1 → 后端 3000 避免 CORS。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@admin/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
});
