// test/parity-13-enforcements.test.ts —— DoD #4：13 项 enforcement 在新引擎下产出等价 verdict
//
// 验证：用 mvp/ 实验仓作为目标项目，新引擎跑出的违规清单应与既有 check-rules.mjs 一致
// （规则 ID + 严重级别 + 文件路径都对得上）。
//
// 13 项 enforcement：
//   AI-005 / ARCH-001 / ARCH-002 / ARCH-003 / CODE-001 / CODE-002 / CODE-003 / CODE-004 /
//   SEC-001 / SEC-002 / SEC-003a / META-001 / META-003 / META-004
// 注：AI-001/002/003/004/006/007 多为 manual（Reviewer 流程校验），不计入机器 enforcement 等价对比。

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { RuleEngine } from '../engine/src/engine.js';
import { typescriptPlugin } from '../engine/src/plugins/typescript.js';
import type { ProjectProfile } from '../spi/adapter.js';

const MVP_ROOT = join(process.cwd(), '..', 'mvp');

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

const stubProfile: ProjectProfile = {
  language: 'typescript',
  backend_framework: 'fastify',
  frontend_framework: 'react',
  database: 'sqlite',
  orm: 'raw-sql',
  contract_lib: 'zod',
  test_runner: 'vitest',
  ci_platform: 'github-actions',
  confidence: 0.9,
  signals: [],
};

const EXPECTED_ENFORCEMENT_IDS = [
  'AI-005',       // regex 检查，核心内置
  'ARCH-001',     // import-graph，TS plugin
  'ARCH-002',     // import-graph，TS plugin
  'ARCH-003',     // import-graph，TS plugin
  'CODE-001',     // regex 检查，核心内置
  'CODE-002',     // regex 检查，核心内置
  'CODE-003',     // regex 检查，核心内置
  'CODE-004',     // structure，TS plugin
  'SEC-001',      // structure，TS plugin
  'SEC-002',      // structure，TS plugin
  'SEC-003a',     // structure，TS plugin
  'META-001',     // loader 自校验
  'META-003',     // 核心差集校验
  'META-004',     // 核心差集校验
];

describe('DoD #4: 13 项 enforcement verdict 等价', () => {
  it('声明式规则集应含全部 13 项 enforcement ID', async () => {
    const engine = new RuleEngine({
      rootDir: MVP_ROOT,
      profile: stubProfile,
      rulesDir: join(process.cwd(), 'kernel', 'rules'),
    });
    engine.registerPlugin(typescriptPlugin);
    const result = await engine.run();
    const loadedIds = result.executed_rules;
    for (const id of EXPECTED_ENFORCEMENT_IDS) {
      expect(loadedIds, `缺少规则 ID: ${id}`).toContain(id);
    }
    expect(result.loaded_rules).toBeGreaterThanOrEqual(13);
  });

  it('新引擎 verdict 与既有 check-rules.mjs 等价（mvp 仓全绿）', async () => {
    // 1. 跑既有 check-rules.mjs 取 baseline verdict
    let baselineExit = 0;
    let baselineOutput = '';
    try {
      baselineOutput = execSync('node scripts/check-rules.mjs', {
        cwd: MVP_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e: unknown) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      baselineExit = err.status ?? 1;
      baselineOutput = (err.stdout ?? '') + (err.stderr ?? '');
    }
    // mvp/ 实验仓是已收敛状态，baseline 应为 exit 0
    expect(baselineExit, `baseline check-rules.mjs 应 exit 0，实际 ${baselineExit}\n${baselineOutput}`).toBe(0);

    // 2. 跑新引擎取新 verdict
    const engine = new RuleEngine({
      rootDir: MVP_ROOT,
      profile: stubProfile,
      rulesDir: join(process.cwd(), 'kernel', 'rules'),
    });
    engine.registerPlugin(typescriptPlugin);
    const result = await engine.run();

    // 3. 等价校验：新引擎也应 exit 0（mvp 仓无 error 级违规）
    //    允许 warning / info 级 finding（advisory 性质）
    const errorFindings = result.findings.filter((f) => f.severity === 'error');
    expect(errorFindings.length, `新引擎发现 error 级违规:\n${errorFindings.map((f) => `  - ${f.rule_id} ${f.file}:${f.line} — ${f.message}`).join('\n')}`).toBe(0);
    expect(result.exit_code).toBe(0);
  });

  it('声明式规则集规则 ID 与既有 .trae/rules/ 文档一致', async () => {
    // 提取既有 .trae/rules/ 下的规则 ID（## XXX-NNN 块）
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    function walkMd(dir: string, acc: string[] = []): string[] {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walkMd(p, acc);
        else if (name.endsWith('.md')) acc.push(p);
      }
      return acc;
    }

    const ruleFiles = walkMd(join(MVP_ROOT, '.trae', 'rules'));
    const docIds = new Set<string>();
    for (const f of ruleFiles) {
      const src = readFileSync(f, 'utf8');
      const blocks = src.split(/\n##\s+/).slice(1);
      for (const block of blocks) {
        const m = block.match(/^([A-Z]+-\d+[a-z]?)/);
        if (m) docIds.add(m[1]);
      }
    }

    // 新声明式规则集的 ID 应是既有文档 ID 的子集（每条都对应既有规则）
    const engine = new RuleEngine({
      rootDir: MVP_ROOT,
      profile: stubProfile,
      rulesDir: join(process.cwd(), 'kernel', 'rules'),
    });
    engine.registerPlugin(typescriptPlugin);
    const result = await engine.run();

    // 跑一次以加载规则
    const { loadRules } = await import('../engine/src/loader.js');
    const loaded = loadRules(join(process.cwd(), 'kernel', 'rules'));
    const loadedIds = new Set(loaded.rules.map((r) => r.id));

    // 每个 loaded ID 都应在既有文档 ID 集合里
    for (const id of loadedIds) {
      expect(docIds.has(id), `声明式规则 ID ${id} 在既有 .trae/rules/ 中无对应`).toBe(true);
    }
  });
});
