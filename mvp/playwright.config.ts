// playwright.config.ts —— R20 引入 Playwright E2E 配置（TECH-E2E-INTRODUCTION-001 §3.2 / D1-D8）
//
// 设计要点：
// - config 位置（D1）：根目录，使 `npm run test:e2e`（= `playwright test`）无需 --config 标志。
// - testDir：apps/e2e/tests（与 apps/api / apps/web 平级 apps/e2e/，Q1 BLOCKING 决策）。
// - webServer 双进程（D2）：
//   · 进程 1 api server（npm start = tsx apps/api/src/server.ts），port=3000，env 注入
//     DB_PATH 指向 os.tmpdir() 临时文件（D3 / D8 数据隔离，不污染 ./data/admin.db）。
//   · 进程 2 vite dev（npm --workspace @admin/web run dev），port=5173，前端 dev proxy /v1 → 3000。
// - baseURL（D7）：http://localhost:5173（前端 dev，真实浏览器调真实后端经 dev proxy）。
// - use：chromium headless（D6）+ trace=on-first-retry + screenshot=only-on-failure（§6.3 凭据不入 artifact）。
// - retries=0：本地与 CI 一致快速反馈（task spec 要求；spec §3.2 原文 CI?2:0，本 impl 取 0）。
// - reuseExistingServer=false（D8 [约束]）：始终新起 server 用临时 DB，保证数据隔离（不复用本地 dev server 用 ./data/admin.db）。
// - globalTeardown：清理临时 DB 文件（§3.3 策略 A：teardown 删库，干净）。
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';

// 临时 DB 路径（D3 / §3.3）：os.tmpdir() 下 pid+ts 唯一文件，保证并发 run 不冲突。
// server 启动时 createDb 读 DB_PATH → 建临时库 → applySchema 建表 → seedAdmin + seedDemoData
// （admin@example.com / admin123，与 server.ts 一致非 PRD 字面 Admin@123，§7.2 反向同步）。
const E2E_DB_PATH = `${tmpdir()}/e2e-admin-${process.pid}-${Date.now()}.db`;

// 通过 process.env 共享 DB_PATH 给 webServer env（隐式继承）+ globalTeardown（同进程 require 时可见）。
// globalTeardown 在主进程 require 执行（非子进程），故 process.env 在 config 顶层赋值即可被 teardown 读到。
process.env.E2E_DB_PATH = E2E_DB_PATH;

export default defineConfig({
  // D1 / §3.1：testDir 指向 apps/e2e/tests（与 apps/api / apps/web 平级 apps/e2e/）。
  testDir: './apps/e2e/tests',
  // 与 vitest *.test.ts 区分（runner 互不抓取）。
  testMatch: '**/*.spec.ts',
  // 禁用并行：临时 DB 单文件，并发写竞争可能冲突；改为串行确保状态隔离（每 test 文件顺序跑，文件内 test 也顺序跑）。
  fullyParallel: false,
  workers: 1,
  // retries=0（task spec 要求；spec §3.2 原文 CI?2:0，本 impl 取 0 简化）。
  retries: 0,
  // 单 test 超时 60s（覆盖登录 + 表单 + 路由跳转 + API 往返；CI 慢机器预留余量）。
  timeout: 60000,
  // 失败产物目录（gitignore 追加，§3.8）。
  outputDir: 'apps/e2e/test-results',
  // 报告：list 形式输出每个 test 状态，便于 CI 日志阅读 + html 报告（不入版本库，§3.8）。
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  // webServer 双进程（D2）：api server（3000）+ vite dev（5173），Playwright 自动管理生命周期。
  use: {
    // D7：baseURL 指向前端 dev server（5173），page.goto('/login') 解析为 http://localhost:5173/login。
    baseURL: 'http://localhost:5173',
    // D6：仅 chromium，headless（CI 无显示 + 本地不占桌面）。
    browserName: 'chromium',
    headless: true,
    // §6.3 凭据不入 artifact：trace 仅首次重试时录（retries=0 不录）；screenshot 仅失败时截。
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // 每个 test 接受 page navigation 默认 15s（足够覆盖 dev proxy + 后端响应）。
    navigationTimeout: 15000,
    // 每个 test 的 action（fill/click/expect）默认 10s 超时。
    actionTimeout: 10000,
  },
  // D6：单 chromium project（PRD Q4 仅 chromium）。
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // 进程 1（api server，须先就绪供 vite dev proxy 转发）：
      // command=npm start（= tsx apps/api/src/server.ts），port=3000。
      // env 注入 DB_PATH 指向 os.tmpdir() 临时文件（D3 数据隔离）+ PORT=3000。
      // reuseExistingServer=false（D8 [约束]）：始终新起 server 用临时 DB，不复用本地 dev server。
      command: 'npm start',
      port: 3000,
      timeout: 30000,
      reuseExistingServer: false,
      env: {
        DB_PATH: E2E_DB_PATH,
        PORT: '3000',
      },
    },
    {
      // 进程 2（vite dev，前端 dev server，5173）：
      // command=npm --workspace @admin/web run dev（= 在 apps/web 跑 vite）。
      // 前端 client.ts BASE_URL=http://localhost:3000 直连后端（CORS 已在 server.ts 启用，跨域 fetch OK）。
      // reuseExistingServer=false：与 api server 一致策略，保证数据隔离（不复用本地 dev server）。
      command: 'npm --workspace @admin/web run dev',
      port: 5173,
      timeout: 30000,
      reuseExistingServer: false,
    },
  ],
  // §3.3 策略 A：globalTeardown 删除临时 DB 文件（干净，teardown 在主进程 require 执行，可见 process.env.E2E_DB_PATH）。
  globalTeardown: './apps/e2e/global-teardown.ts',
});
