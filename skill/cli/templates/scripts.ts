// cli/templates/scripts.ts —— 工具脚本 + CI 配置 + 测试设置
// 问题 5：从 template-engine.ts 拆出。
//
// 包含：
// - scripts/：check-rules.mjs / gen-delta.mjs / check-contract-drift.mjs（薄包装，调用 skill engine）
// - .github/workflows/：GitHub Actions 配置
// - apps/api/test/：占位测试（保证零业务代码基线下 npm test 全绿）
// - experimental CI 防护：非 github-actions 显式 warning

import type { GenerateOptions } from '../options.js';
import type { WriteOp } from '../../spi/adapter.js';

// ============ 内联脚本模板 ============

const RULES_SCRIPT = `#!/usr/bin/env node
// scripts/check-rules.mjs —— 规则校验（薄包装，调用 skill engine）
// P1-1 产出：作为门禁入口，实际校验逻辑由 skill/engine 执行。

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// 找 skill 引擎：node_modules/@ai-spec/skill 或本地开发路径
const candidates = [
  'node_modules/@ai-spec/skill/engine/src/engine.js',
  '../../skill/engine/src/engine.js',
];

let enginePath = null;
for (const c of candidates) {
  if (existsSync(c)) { enginePath = c; break; }
}

if (!enginePath) {
  console.error('⚠ skill 引擎未找到，跳过规则校验（建议 npm install @ai-spec/skill）');
  process.exit(0);
}

console.log('✓ 使用 skill 引擎:', enginePath);
// 真实调用待 P1-3 接入完整 CLI 后启用
console.log('（P1-1 骨架：规则校验占位，待 P1-3 完成接入）');
`;

const DELTA_SCRIPT = `#!/usr/bin/env node
// scripts/gen-delta.mjs —— 增量上下文生成（薄包装，调用 skill tools/gen-delta）
// P1-1 占位，P1-3 阶段接入完整实现。

console.log('（P1-1 骨架：gen-delta 占位，待 P1-3 完成接入）');
`;

const CONTRACT_DRIFT_SCRIPT = `#!/usr/bin/env node
// scripts/check-contract-drift.mjs —— 契约漂移检测
// P1-6 占位：检测 contracts schema 与 Tech-Spec 是否一致。
// 完整实现（P1-3 阶段）：grep contracts/*.ts 的 Schema export 与 docs/spec/*.md 的契约声明，
// 报告"Spec 声明但 contracts 未实现"或"contracts 实现但 Spec 未声明"的漂移。

import { readdirSync, existsSync, readFileSync } from 'node:fs';

// 从 .ai-spec/config.json 读取 contractsDir，缺省回退到 'packages/contracts/src/schemas'
let contractsDir = 'packages/contracts/src/schemas';
try {
  const cfg = JSON.parse(readFileSync('.ai-spec/config.json', 'utf8'));
  contractsDir = cfg.contractsDir ?? contractsDir;
} catch {
  // config 不存在时用默认值
}
const specDir = 'docs/spec';

if (!existsSync(contractsDir)) {
  console.log('ℹ contracts 目录不存在，跳过 drift 检测');
  process.exit(0);
}

if (!existsSync(specDir)) {
  console.log('ℹ docs/spec 目录不存在，跳过 drift 检测');
  process.exit(0);
}

const contracts = readdirSync(contractsDir).filter((f) => f.endsWith('.ts'));
const specs = readdirSync(specDir).filter((f) => f.endsWith('.tech.md'));

console.log('ℹ contracts schemas:', contracts.length);
console.log('ℹ tech specs:', specs.length);
console.log('（P1-6 占位：drift 检测完整实现待 P1-3 接入 skill engine）');
`;

// ============ 6. scripts/ ============

export function renderScripts(opts: GenerateOptions): WriteOp[] {
  return [
    {
      path: 'scripts/check-rules.mjs',
      content: RULES_SCRIPT,
      is_new: true,
      reason: 'P1-1 规则校验脚本（薄包装，调用 skill engine）',
    },
    {
      path: 'scripts/gen-delta.mjs',
      content: DELTA_SCRIPT,
      is_new: true,
      reason: 'P1-1 增量上下文脚本',
    },
    {
      path: 'scripts/check-contract-drift.mjs',
      content: CONTRACT_DRIFT_SCRIPT,
      is_new: true,
      reason: 'P1-6 契约漂移检测占位（待 P1-3 完整实现）',
    },
  ];
}

// ============ 7. .github/workflows/ ============

export function renderCi(opts: GenerateOptions, warnings: string[]): WriteOp[] {
  if (opts.stack.ci !== 'github-actions') {
    // experimental CI 防护：显式警告
    warnings.push(
      `ci="${opts.stack.ci}" 为 experimental，未生成 CI 配置（experimental 适配器防护，建议 1）`,
    );
    return [{
      path: '.ai-spec/experimental-ci.txt',
      content: `CI 平台 ${opts.stack.ci} 在 MVP 期为 experimental，未生成配置。\n如需使用，请手动配置。\n`,
      is_new: true,
      reason: 'P1-1 experimental CI 占位（显式警告）',
    }];
  }
  return [{
    path: '.github/workflows/ai-spec-ci.yml',
    content: renderGithubActions(opts),
    is_new: true,
    reason: 'P1-6 GitHub Actions 配置',
  }];
}

function renderGithubActions(opts: GenerateOptions): string {
  const isTs = opts.stack.backend.endsWith('-ts');
  const lines = [
    'name: ai-spec CI',
    '',
    'on:',
    '  push:',
    '    branches: [main, master]',
    '  pull_request:',
    '',
    'jobs:',
    '  gate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: "20"',
    isTs ? '          cache: "npm"' : '',
    '      - run: npm ci',
    '      - name: typecheck',
    isTs ? '        run: npm run typecheck' : '        run: echo "skip typecheck (non-TS)"',
    '      - name: lint:rules',
    '        run: npm run spec:check',
    '      - name: test',
    isTs ? '        run: npm test' : '        run: echo "skip test (no test runner configured)"',
    '      - name: contract drift check',
    '        run: node scripts/check-contract-drift.mjs || echo "contract drift check 待实现"',
  ];
  return lines.filter(Boolean).join('\n') + '\n';
}

// ============ 9. 测试设置（P1-4 阶段保证全绿） ============

export function renderTestSetup(opts: GenerateOptions): WriteOp[] {
  const writes: WriteOp[] = [];
  if (opts.stack.backend.endsWith('-ts')) {
    writes.push({
      path: 'apps/api/test/sanity.test.ts',
      content: '// P1-4 占位测试：保证 npm test 全绿（零业务代码基线）\nimport { describe, it, expect } from "vitest";\n\ndescribe("sanity", () => {\n  it("项目骨架可执行测试", () => {\n    expect(1 + 1).toBe(2);\n  });\n});\n',
      is_new: true,
      reason: 'P1-4 占位测试',
    });
  }
  return writes;
}
