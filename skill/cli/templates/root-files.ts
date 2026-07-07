// cli/templates/root-files.ts —— 项目根文件 + .ai-spec/ + contracts + docs
// 问题 5：从 template-engine.ts 拆出。
//
// 包含：
// - 项目根文件（package.json / README / .gitignore / tsconfig / .ai-spec/config.json）
// - .ai-spec/ 目录（从 kernel/ 拷贝规则 / 角色 / 模板 / schema）
// - packages/contracts/ 子包骨架
// - docs/ 目录占位

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerateOptions } from '../options.js';
import type { WriteOp } from '../../spi/adapter.js';
import { __dirname, normalizePkgName, walkCopy } from './shared.js';

// ============ 1. 项目根文件 ============

export function renderRootFiles(opts: GenerateOptions): WriteOp[] {
  return [
    renderPackageJson(opts),
    renderReadme(opts),
    renderGitignore(opts),
    renderTsconfig(opts),
    renderAiSpecConfig(opts),
  ];
}

function renderPackageJson(opts: GenerateOptions): WriteOp {
  const isTs = opts.stack.backend.endsWith('-ts');
  const scripts: Record<string, string> = {
    'spec:init': 'ai-spec init',
    'spec:check': 'node scripts/check-rules.mjs',
    'spec:gate': 'node scripts/check-rules.mjs && npm run typecheck && npm test',
  };
  if (isTs) {
    scripts.typecheck = 'tsc --noEmit';
    scripts.test = 'vitest run';
  } else if (opts.stack.backend === 'fastapi') {
    scripts.test = 'pytest';
  }

  // workspaces：根据生成的子包动态构建
  const workspaces: string[] = [];
  if (opts.stack.backend.endsWith('-ts')) workspaces.push('packages/contracts', 'apps/api');
  if (opts.stack.frontend === 'react-vite') workspaces.push('apps/web');

  const pkg: Record<string, unknown> = {
    name: normalizePkgName(opts.project_name),
    version: '0.1.0',
    description: '由 create-ai-spec-app 生成的 spec-first AI 原生项目',
  };
  if (isTs) {
    pkg.type = 'module';
    pkg.workspaces = workspaces;
  }
  pkg.scripts = scripts;
  if (isTs) {
    pkg.devDependencies = {
      '@types/node': '^22.0.0',
      typescript: '^5.4.0',
      vitest: '^1.6.0',
      tsx: '^4.16.0',
    };
  }
  pkg.ai_spec = {
    stack: opts.stack,
    generated_by: '@ai-spec/skill',
    generated_at: new Date().toISOString(),
  };

  return {
    path: 'package.json',
    content: JSON.stringify(pkg, null, 2) + '\n',
    is_new: true,
    reason: 'P1-1 项目元数据',
  };
}

function renderReadme(opts: GenerateOptions): WriteOp {
  const s = opts.stack;
  const lines = [
    `# ${opts.project_name}`,
    '',
    '> 由 [create-ai-spec-app](https://github.com/soulor8908/AIAdmin/tree/main/skill) 生成。',
    '',
    '## 技术栈',
    '',
    `- 后端：${s.backend}`,
    `- 数据库：${s.db}`,
    `- 前端：${s.frontend === 'none' ? '无' : s.frontend}`,
    `- 契约库：${s.contract}`,
    `- 认证：${s.auth}`,
    `- CI：${s.ci}`,
    '',
    '## 快速开始',
    '',
    '```bash',
    'npm install',
    'npm run spec:init    # 初始化第一个业务域',
    'npm run spec:check   # 运行规则校验',
    'npm run spec:gate    # 运行门禁检查',
    '```',
    '',
    '## spec-first 工作流',
    '',
    '本项目按 spec-first 工作流开发：',
    '',
    '1. BA 在 `docs/prd/<domain>.md` 写需求（AC + Q&A BLOCKING）',
    '2. Tech Lead 在 `docs/spec/<domain>.tech.md` 写 Tech-Spec + contracts schema',
    '3. test-writer 在 `apps/<api|web>/test/` 写测试（断言级红）',
    '4. impl-writer 在 `apps/<api|web>/src/` 写实现（使测试转绿）',
    '5. Reviewer 在 `docs/review/<domain>-review.md` 写 Review 报告',
    '',
    '详细规则见 `.ai-spec/rules/`，角色提示词见 `.ai-spec/roles/`。',
    '',
  ];
  return {
    path: 'README.md',
    content: lines.join('\n'),
    is_new: true,
    reason: 'P1-1 项目说明',
  };
}

function renderGitignore(opts: GenerateOptions): WriteOp {
  const lines = [
    'node_modules/',
    'dist/',
    'build/',
    '*.log',
    '.env',
    '.env.local',
    '.DS_Store',
    'coverage/',
    '.vitest-cache/',
    opts.stack.db === 'sqlite' ? 'data/*.db' : '# (no sqlite)',
    opts.stack.db === 'sqlite' ? 'data/*.db-*' : '',
    '__pycache__/',
    '*.pyc',
    '.pytest_cache/',
    'target/',
    '*.class',
  ].filter(Boolean);
  return {
    path: '.gitignore',
    content: lines.join('\n') + '\n',
    is_new: true,
    reason: 'P1-1 git 忽略',
  };
}

function renderTsconfig(opts: GenerateOptions): WriteOp {
  if (!opts.stack.backend.endsWith('-ts')) {
    return {
      path: 'tsconfig.json',
      content: '{\n  "//": "本技术栈非 TypeScript，无需 tsconfig"\n}\n',
      is_new: true,
      reason: 'P1-1 占位',
    };
  }
  const cfg = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'react-jsx',
    },
    include: [
      'packages/contracts/**/*.ts',
      'apps/api/src/**/*.ts',
      'apps/web/src/**/*.ts',
      'apps/web/src/**/*.tsx',
    ],
  };
  return {
    path: 'tsconfig.json',
    content: JSON.stringify(cfg, null, 2) + '\n',
    is_new: true,
    reason: 'P1-1 TS 配置',
  };
}

function renderAiSpecConfig(opts: GenerateOptions): WriteOp {
  const cfg = {
    version: '0.1.0-phase1',
    stack: opts.stack,
    gates: {
      G1_prd: '人工校验 + PR 模板 checklist',
      G3_spec: 'tsc + contract drift 检测',
      G4_test: 'vitest 断言级红',
      G5_impl: 'typecheck + lint:rules + test',
      G6_review: '人 + 自动化 linter',
      G7_merge: 'branch protection',
    },
    kernel_version: '0.1.0-phase0',
  };
  return {
    path: '.ai-spec/config.json',
    content: JSON.stringify(cfg, null, 2) + '\n',
    is_new: true,
    reason: 'P1-1 ai-spec 配置',
  };
}

// ============ 2. .ai-spec/ 目录（从 kernel/ 拷贝） ============

export function renderAiSpec(opts: GenerateOptions): WriteOp[] {
  const writes: WriteOp[] = [];
  // kernel 目录在 skill/kernel/，从 cli/templates/ 向上两层到 skill/
  const kernelDir = join(__dirname, '..', '..', 'kernel');
  if (!existsSync(kernelDir)) return writes;

  // 拷贝 kernel/rules、kernel/roles、kernel/templates、kernel/schema
  for (const sub of ['rules', 'roles', 'templates', 'schema']) {
    const srcDir = join(kernelDir, sub);
    if (!existsSync(srcDir)) continue;
    const ops = walkCopy(srcDir, `.ai-spec/${sub}`);
    writes.push(...ops);
  }

  return writes;
}

// ============ 3. packages/contracts/ ============

export function renderContracts(opts: GenerateOptions): WriteOp[] {
  const writes: WriteOp[] = [];
  const isTs = opts.stack.backend.endsWith('-ts');

  if (isTs) {
    writes.push({
      path: 'packages/contracts/package.json',
      content: JSON.stringify({
        name: `@${opts.project_name}/contracts`,
        version: '0.0.0',
        private: true,
        type: 'module',
        main: './src/index.ts',
        dependencies: { zod: '^3.23.0' },
      }, null, 2) + '\n',
      is_new: true,
      reason: 'P1-1 contracts 子包',
    });
    writes.push({
      path: 'packages/contracts/src/index.ts',
      content: '// 契约层聚合导出。新增域在此追加 export * from "./<domain>";\nexport {};\n',
      is_new: true,
      reason: 'P1-1 contracts 入口',
    });
  }

  return writes;
}

// ============ 8. docs/ 目录占位 ============

export function renderDocs(opts: GenerateOptions): WriteOp[] {
  return [
    {
      path: 'docs/.gitkeep',
      content: '',
      is_new: true,
      reason: 'P1-1 docs 目录占位',
    },
    {
      path: 'docs/prd/.gitkeep',
      content: '',
      is_new: true,
      reason: 'P1-1 PRD 目录占位',
    },
    {
      path: 'docs/spec/.gitkeep',
      content: '',
      is_new: true,
      reason: 'P1-1 Tech-Spec 目录占位',
    },
    {
      path: 'docs/review/.gitkeep',
      content: '',
      is_new: true,
      reason: 'P1-1 Review 目录占位',
    },
    {
      path: 'docs/retro/.gitkeep',
      content: '',
      is_new: true,
      reason: 'P1-1 Retro 目录占位',
    },
  ];
}
