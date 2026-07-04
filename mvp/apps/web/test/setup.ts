// apps/web/test/setup.ts —— Testing Library jest-dom matchers 注入（TECH-WEB-AUTH-USER-001 §12.4 D17）
// 经根 vitest.config.ts web project 的 setupFiles 加载，对所有 web .tsx 测试生效。
//
// [R20 闭合 S-5 反向同步 §7.1 / §10.6]：从 `import '@testing-library/jest-dom'` 改为
// `import '@testing-library/jest-dom/vitest'`。
//   根因：jest-dom 6.x 主入口 `index.mjs` 用裸 `expect.extend(...)`（依赖全局 `expect`，
//   jest 语义），在 vitest 单 project 模式下侥幸工作（globals=true 全局 expect 可见）；
//   切换到 vitest projects 模式后，setup 在 project 隔离的 module graph 内执行，裸 `expect`
//   不再绑定到 vitest 的 expect 实例 → matcher 未注册 → "Invalid Chai property: toBeInTheDocument"。
//   `/vitest` 子路径入口显式 `import { expect } from 'vitest'; expect.extend(matchers)`，
//   绑定到 vitest 的 expect 实例，project 模式下 matcher 正确注册。
//   spec §3.5 原文 "apps/web/test/setup.ts 内容不变（仍 import '@testing-library/jest-dom'）"
//   视为 Tech Lead 在 S-5 现状核验时未发现的 jest-dom 6.x + vitest projects 兼容性坑，
//   按 §10.6 "impl-writer 须修复（非静默跳过）" 落地（属配置层修复，非断言弱化，AI-002 边界保持）。
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';

// R23 D8：jest-axe matcher 注入（显式 expect.extend，绑定到 vitest expect 实例，AC-A11y-7）
// [R23 §10.6 S-23 反向同步]：jest-axe 无 /vitest 子路径入口（PRD §2.5 假设错误），
// 须显式 import { expect } from 'vitest' + expect.extend（参照 R20 S-5 jest-dom/vitest 模式适配）。
expect.extend(toHaveNoViolations);
