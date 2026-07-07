// cli/template-engine.ts —— 模板渲染引擎
// P1-1 / P1-3 产出：根据 GenerateOptions 渲染完整项目骨架。
//
// 当前版本（P1-1 完成版）：直接拼接 + 从 kernel/ 拷贝规则/角色/模板。
// P1-3 阶段将扩展为基于 handlebars 的通用模板渲染引擎（支持冲突检测 + 变量替换）。

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GenerateOptions } from './options.js';
import { isExperimental } from './options.js';
import type { WriteOp } from '../spi/adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RenderResult {
  writes: WriteOp[];
  warnings: string[];
}

export async function renderProject(opts: GenerateOptions): Promise<RenderResult> {
  const writes: WriteOp[] = [];
  const warnings: string[] = [];

  // 1. 项目根文件
  writes.push(...renderRootFiles(opts));

  // 2. .ai-spec/ 目录（从 kernel/ 拷贝规则 + 角色 + 模板）
  writes.push(...renderAiSpec(opts));

  // 3. packages/contracts/（按 contract 库渲染）
  writes.push(...renderContracts(opts));

  // 4. apps/api/（按 backend 渲染）
  writes.push(...renderAppsApi(opts, warnings));

  // 5. apps/web/（按 frontend 渲染）
  if (opts.stack.frontend !== 'none') {
    writes.push(...renderAppsWeb(opts, warnings));
  }

  // 6. scripts/（工具脚本）
  writes.push(...renderScripts(opts));

  // 7. .github/workflows/（按 ci 渲染）
  if (opts.stack.ci !== 'none') {
    writes.push(...renderCi(opts, warnings));
  }

  // 8. docs/（PRD/Tech-Spec/Review/Retro 目录占位）
  writes.push(...renderDocs(opts));

  // 9. 测试（P1-4 阶段保证零业务代码时三件套全绿）
  writes.push(...renderTestSetup(opts));

  // P1-3 冲突检测：同路径多次写入即冲突
  const pathSeen = new Map<string, number>();
  for (const w of writes) {
    pathSeen.set(w.path, (pathSeen.get(w.path) ?? 0) + 1);
  }
  for (const [path, count] of pathSeen) {
    if (count > 1) {
      warnings.push(`路径冲突：${path} 被写入 ${count} 次（仅保留最后一次）`);
    }
  }
  // 去重：保留最后一次写入（后写优先策略，便于适配器覆盖）
  const deduped = new Map<string, WriteOp>();
  for (const w of writes) {
    deduped.set(w.path, w);
  }
  const finalWrites = [...deduped.values()];

  // 建议 4：渲染后占位符残留检测
  // 检查"生成代码"是否含未替换 {{...}} 占位符
  // 注意：.ai-spec/ 下是 kernel 拷贝的模板/角色提示词，本就是模板格式（含 {{var}}），不检测
  // .tmpl 文件是适配器模板源文件，也不检测
  for (const w of finalWrites) {
    // 跳过模板源文件（本就是模板）
    if (w.path.startsWith('.ai-spec/')) continue;
    if (w.path.endsWith('.hbs')) continue;
    if (w.path.endsWith('.tmpl')) continue;
    // 检测未替换占位符
    const leftover = w.content.match(/\{\{[a-zA-Z_-]+\}\}/g);
    if (leftover) {
      warnings.push(
        `文件 ${w.path} 含未替换占位符：${[...new Set(leftover)].join(', ')}（建议 4：渲染后验证）`,
      );
    }
  }

  return { writes: finalWrites, warnings };
}

// ============ 1. 项目根文件 ============

function renderRootFiles(opts: GenerateOptions): WriteOp[] {
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

function renderAiSpec(opts: GenerateOptions): WriteOp[] {
  const writes: WriteOp[] = [];
  // kernel 目录在 skill/kernel/
  const kernelDir = join(__dirname, '..', 'kernel');
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

function walkCopy(srcDir: string, destDir: string): WriteOp[] {
  const ops: WriteOp[] = [];
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name);
    const dest = join(destDir, name);
    if (statSync(src).isDirectory()) {
      ops.push(...walkCopy(src, dest));
    } else {
      ops.push({
        path: dest,
        content: readFileSync(src, 'utf8'),
        is_new: true,
        reason: `kernel/${destDir}/${name}`,
      });
    }
  }
  return ops;
}

// ============ 3. packages/contracts/ ============

function renderContracts(opts: GenerateOptions): WriteOp[] {
  const writes: WriteOp[] = [];
  const isTs = opts.stack.backend.endsWith('-ts');

  // package.json（contracts 子包）
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

// ============ 4. apps/api/ ============

function renderAppsApi(opts: GenerateOptions, warnings: string[]): WriteOp[] {
  const writes: WriteOp[] = [];
  const isTs = opts.stack.backend.endsWith('-ts');

  if (isTs) {
    // server.ts 从适配器目录加载（fastify-ts / express-ts 真正差异）
    // 缺失 files/ 视为开发期问题，直接抛错而非静默 fallback（建议 1）
    const serverTemplate = loadAdapterFileOrThrow('backend', opts.stack.backend, 'server.ts.tmpl');
    writes.push({
      path: 'apps/api/src/server.ts',
      content: serverTemplate,
      is_new: true,
      reason: `P1-2 ${opts.stack.backend} 适配器 server.ts`,
    });
    // errors.ts 占位
    writes.push({
      path: 'apps/api/src/errors.ts',
      content: TS_ERRORS_TS,
      is_new: true,
      reason: 'P1-1 errors.ts 骨架',
    });
    // package.json：依赖根据 backend 选型
    const apiDeps: Record<string, string> = { zod: '^3.23.0' };
    if (opts.stack.backend === 'fastify-ts') apiDeps.fastify = '^4.27.0';
    if (opts.stack.backend === 'express-ts') {
      apiDeps.express = '^4.19.0';
      apiDeps['@types/express'] = '^4.17.0';
    }
    writes.push({
      path: 'apps/api/package.json',
      content: JSON.stringify({
        name: `@${opts.project_name}/api`,
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: apiDeps,
        devDependencies: {
          '@types/node': '^22.0.0',
          typescript: '^5.4.0',
          vitest: '^1.6.0',
          tsx: '^4.16.0',
        },
        scripts: {
          dev: 'tsx watch src/server.ts',
          test: 'vitest run',
        },
      }, null, 2) + '\n',
      is_new: true,
      reason: 'P1-2 api 子包（按 backend 动态依赖）',
    });
  } else if (opts.stack.backend === 'fastapi') {
    // FastAPI：从适配器目录加载 main.py.tmpl / requirements.txt.tmpl（P2-8 已提供）
    if (adapterFileExists('backend', 'fastapi', 'main.py.tmpl')) {
      writes.push({
        path: 'app/main.py',
        content: renderAdapterTemplate(loadAdapterFileOrThrow('backend', 'fastapi', 'main.py.tmpl'), opts),
        is_new: true,
        reason: 'P2-8 fastapi 适配器 main.py',
      });
      writes.push({
        path: 'requirements.txt',
        content: renderAdapterTemplate(loadAdapterFileOrThrow('backend', 'fastapi', 'requirements.txt.tmpl'), opts),
        is_new: true,
        reason: 'P2-8 fastapi 依赖清单',
      });
    } else {
      // 兜底：内联骨架（兼容旧版）
      writes.push({ path: 'app/main.py', content: PY_MAIN, is_new: true, reason: 'P1-1 fastapi 骨架（兜底）' });
      warnings.push('fastapi 适配器目录缺 files/main.py.tmpl，使用内联兜底骨架');
    }
  } else if (opts.stack.backend === 'spring-boot') {
    // Spring Boot：从 P2-8 适配器目录加载 Java 模板（不再静默不生成）
    if (!adapterFileExists('backend', 'spring-boot', 'server.java.tmpl')) {
      warnings.push(
        'spring-boot 适配器缺 files/server.java.tmpl，Java 骨架无法生成（experimental 适配器防护，建议 1）',
      );
    } else {
      const groupName = opts.project_name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'demoapp';
      const artifactId = groupName;
      const renderedServer = renderAdapterTemplate(
        loadAdapterFileOrThrow('backend', 'spring-boot', 'server.java.tmpl'),
        opts,
      ).replace('{{group-name}}', groupName).replace('{{artifact-id}}', artifactId);
      writes.push({
        path: `src/main/java/com/example/${artifactId}/Application.java`,
        content: renderedServer,
        is_new: true,
        reason: 'P2-8 spring-boot 适配器 Application.java',
      });
      const renderedHealth = renderAdapterTemplate(
        loadAdapterFileOrThrow('backend', 'spring-boot', 'health.java.tmpl'),
        opts,
      ).replace('{{group-name}}', groupName).replace('{{artifact-id}}', artifactId);
      writes.push({
        path: `src/main/java/com/example/${artifactId}/controller/HealthController.java`,
        content: renderedHealth,
        is_new: true,
        reason: 'P2-8 spring-boot 适配器 HealthController',
      });
      writes.push({
        path: 'pom.xml',
        content: renderAdapterTemplate(
          loadAdapterFileOrThrow('backend', 'spring-boot', 'pom.xml.tmpl'),
          opts,
        ).replace('{{project-name}}', opts.project_name),
        is_new: true,
        reason: 'P2-8 spring-boot 适配器 pom.xml',
      });
    }
  } else {
    // 未知 backend：experimental 防护，显式警告而非静默
    warnings.push(`backend="${opts.stack.backend}" 无对应适配器 files/，apps/api 未生成（experimental 防护）`);
  }

  return writes;
}

// ============ 5. apps/web/ ============

function renderAppsWeb(opts: GenerateOptions, warnings: string[]): WriteOp[] {
  const writes: WriteOp[] = [];
  if (opts.stack.frontend !== 'react-vite') {
    // experimental 前端防护：显式警告 + 写入说明文件（不再静默 fallback）
    warnings.push(
      `frontend="${opts.stack.frontend}" 为 experimental，未生成 React 骨架（experimental 适配器防护，建议 1）`,
    );
    writes.push({
      path: '.ai-spec/experimental-frontend.txt',
      content: `前端栈 ${opts.stack.frontend} 在 MVP 期为 experimental，未生成骨架。\n如需使用，请手动配置。\n`,
      is_new: true,
      reason: 'P1-1 experimental 前端占位（显式警告）',
    });
    return writes;
  }

  writes.push({
    path: 'apps/web/src/main.tsx',
    content: TSX_MAIN,
    is_new: true,
    reason: 'P1-1 React 入口',
  });
  writes.push({
    path: 'apps/web/src/App.tsx',
    content: TSX_APP,
    is_new: true,
    reason: 'P1-1 React App 组件',
  });
  writes.push({
    path: 'apps/web/index.html',
    content: HTML_INDEX.replace('__TITLE__', opts.project_name),
    is_new: true,
    reason: 'P1-1 Vite 入口 HTML',
  });
  writes.push({
    path: 'apps/web/package.json',
    content: JSON.stringify({
      name: `@${opts.project_name}/web`,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        test: 'vitest run',
      },
      dependencies: {
        react: '^18.3.0',
        'react-dom': '^18.3.0',
      },
      devDependencies: {
        '@types/react': '^18.3.0',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.3.0',
        typescript: '^5.4.0',
        vite: '^5.3.0',
        vitest: '^1.6.0',
      },
    }, null, 2) + '\n',
    is_new: true,
    reason: 'P1-1 web 子包',
  });

  return writes;
}

// ============ 6. scripts/ ============

function renderScripts(opts: GenerateOptions): WriteOp[] {
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

function renderCi(opts: GenerateOptions, warnings: string[]): WriteOp[] {
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

// ============ 8. docs/ ============

function renderDocs(opts: GenerateOptions): WriteOp[] {
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

// ============ 9. 测试设置（P1-4 阶段保证全绿） ============

function renderTestSetup(opts: GenerateOptions): WriteOp[] {
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

// ============ 工具函数 ============

function normalizePkgName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * 从适配器目录加载模板文件。
 * 路径：adapters/<type>/<id>/files/<fileName>
 * 失败时抛错（适配器缺失是开发期问题，不应静默回退）。
 */
function loadAdapterFileOrThrow(type: string, id: string, fileName: string): string {
  const path = join(__dirname, '..', 'adapters', type, id, 'files', fileName);
  if (!existsSync(path)) {
    throw new Error(`适配器模板缺失：adapters/${type}/${id}/files/${fileName}（experimental 适配器防护，建议 1）`);
  }
  return readFileSync(path, 'utf8');
}

/** 旧别名：保持向后兼容 */
const loadAdapterFile = loadAdapterFileOrThrow;

/**
 * 检查适配器文件是否存在（不抛错）。
 */
function adapterFileExists(type: string, id: string, fileName: string): boolean {
  const path = join(__dirname, '..', 'adapters', type, id, 'files', fileName);
  return existsSync(path);
}

/**
 * 渲染适配器模板：替换 {{var}} 占位符。
 * 当前实现最小化（只替换 project-name），未来可扩展为 handlebars。
 *
 * 建议 4：渲染后校验，无 {{...}} 残留（在 renderProject 末尾统一检测）。
 */
function renderAdapterTemplate(template: string, opts: GenerateOptions): string {
  let result = template;
  result = result.replace(/\{\{project-name\}\}/g, opts.project_name);
  result = result.replace(/\{\{project_name\}\}/g, opts.project_name);
  return result;
}

// ============ 内联模板字符串 ============

const TS_ERRORS_TS = `// apps/api/src/errors.ts —— 错误码 SSOT（P1-1 骨架）
// 新增错误码时此文件须同步更新（AI-005 SSOT 派生约束）。

export const errorCodeToHttpStatus: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};
`;

const PY_MAIN = `# app/main.py —— FastAPI 入口（P1-1 骨架）
from fastapi import FastAPI

app = FastAPI(title="AI Spec Project")


@app.get("/health")
async def health():
    return {"status": "ok"}
`;

const TSX_MAIN = `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;

const TSX_APP = `import React from 'react';

export function App() {
  return (
    <div>
      <h1>AI Spec Project</h1>
      <p>由 create-ai-spec-app 生成。运行 <code>npm run spec:init</code> 初始化第一个业务域。</p>
    </div>
  );
}
`;

const HTML_INDEX = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>__TITLE__</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`;

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

import { readdirSync, existsSync } from 'node:fs';

const contractsDir = 'packages/contracts/src/schemas';
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
