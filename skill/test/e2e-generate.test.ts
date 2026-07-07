// test/e2e-generate.test.ts —— E2E 冒烟测试（建议 2 / Phase 1 DoD）
// 生成项目 → npm install → npm run typecheck → npm test 全绿。
//
// 这是 Phase 1 最关键的 DoD：README 声称 "fastify-ts + express-ts 两种组合
// 生成的项目三件套全绿"，本测试自动化验证此声明。
//
// 跑法：
//   npx vitest run test/e2e-generate.test.ts
//
// 注意：本测试会真的 npm install，较慢（~30s）。CI 中可独立 job 跑。
// 本地开发如需跳过：SKIP_E2E=1 npx vitest run

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateProject } from '../cli/generate.js';
import type { GenerateOptions, StackSelection } from '../cli/options.js';
import { GOLDEN_COMBO } from '../cli/options.js';

const SKIP = process.env.SKIP_E2E === '1';
const skillRoot = join(process.cwd());

function makeOpts(stack: StackSelection, projectName: string, outDir: string): GenerateOptions {
  return {
    project_name: projectName,
    out_dir: outDir,
    stack,
    no_deps: true, // 我们手动控制 install 时机
    no_git: true,
    yes: true,
    verbose: false,
  };
}

function run(cmd: string, cwd: string, allowFail = false): { code: number; out: string } {
  try {
    const out = execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120_000 });
    return { code: 0, out };
  } catch (e: unknown) {
    if (allowFail) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      return { code: 1, out: err.stdout ?? err.stderr ?? err.message };
    }
    throw e;
  }
}

describe.skipIf(SKIP)('E2E 冒烟：fastify-ts + express-ts 生成项目三件套全绿', () => {
  const combos: Array<{ name: string; stack: StackSelection }> = [
    { name: 'fastify-ts', stack: { ...GOLDEN_COMBO, backend: 'fastify-ts' } },
    { name: 'express-ts', stack: { ...GOLDEN_COMBO, backend: 'express-ts' } },
  ];

  for (const { name, stack } of combos) {
    describe(`组合：${name}`, () => {
      let projectDir: string;

      beforeAll(async () => {
        projectDir = mkdtempSync(join(tmpdir(), `ai-spec-e2e-${name}-`));
        const opts = makeOpts(stack, `e2e-${name}`, projectDir);
        const result = await generateProject(opts);
        expect(result.files_written).toBeGreaterThan(5);
      }, 60_000);

      it('生成的项目应含 package.json / tsconfig.json / server.ts', () => {
        expect(existsSync(join(projectDir, 'package.json'))).toBe(true);
        expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true);
        expect(existsSync(join(projectDir, 'apps/api/src/server.ts'))).toBe(true);
      });

      it('npm install 应成功（含失败重试 + prefer-offline，问题 2）', () => {
        // 问题 2：CI 中 npm install 可能因网络问题失败，加：
        // - --prefer-offline 减少网络依赖（优先用本地缓存）
        // - 失败重试 1 次（应对瞬时网络抖动）
        const installCmd = 'npm install --no-audit --no-fund --silent --prefer-offline';
        let result = run(installCmd, projectDir, true);
        if (result.code !== 0) {
          // 重试 1 次（不带 --prefer-offline，允许回源）
          console.warn(`[${name}] npm install 首次失败，重试中...`);
          result = run('npm install --no-audit --no-fund --silent', projectDir, true);
        }
        if (result.code !== 0) {
          console.error(`[${name}] npm install 重试仍失败：\n${result.out.slice(0, 2000)}`);
        }
        expect(result.code).toBe(0);
        expect(existsSync(join(projectDir, 'node_modules'))).toBe(true);
      }, 240_000);

      it('npm run typecheck 应全绿', () => {
        const { code, out } = run('npm run typecheck', projectDir, true);
        if (code !== 0) {
          console.error(`[${name}] typecheck 失败：\n${out.slice(0, 2000)}`);
        }
        expect(code).toBe(0);
      }, 60_000);

      it('npm test 应全绿', () => {
        const { code, out } = run('npm test', projectDir, true);
        if (code !== 0) {
          console.error(`[${name}] test 失败：\n${out.slice(0, 2000)}`);
        }
        expect(code).toBe(0);
      }, 60_000);

      // 清理（在所有 it 完成后无法直接挂钩，用 afterEach 风险：每个 it 后都跑）
      // 改用 describe 末尾的副作用清理：tests 顺序执行，最后一个 it 后 projectDir 会被 GC，
      // 但 /tmp 不会被自动清理。这里手动在最后一个 it 后清理。
      it('清理临时目录', () => {
        if (existsSync(projectDir)) {
          rmSync(projectDir, { recursive: true, force: true });
        }
        expect(existsSync(projectDir)).toBe(false);
      });
    });
  }

  describe('experimental 防护验证（建议 1）', () => {
    it('spring-boot 应生成 Java 骨架而非静默不生成', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ai-spec-e2e-spring-'));
      try {
        const opts = makeOpts(
          { ...GOLDEN_COMBO, backend: 'spring-boot', frontend: 'none' },
          'e2e-spring',
          dir,
        );
        const result = await generateProject(opts);
        // Spring Boot 应生成 Application.java / HealthController.java / pom.xml
        expect(existsSync(join(dir, 'pom.xml'))).toBe(true);
        // 由于 spring-boot 在适配器目录已有 server.java.tmpl（P2-8）
        const javaFiles = result.warnings.filter((w) => w.includes('spring-boot'));
        // 不应出现"无对应适配器 files/"警告
        expect(javaFiles.some((w) => w.includes('无对应适配器'))).toBe(false);
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    });

    it('vue3-vite 前端应显式警告而非静默 fallback', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ai-spec-e2e-vue-'));
      try {
        const opts = makeOpts(
          { ...GOLDEN_COMBO, frontend: 'vue3-vite' },
          'e2e-vue',
          dir,
        );
        const result = await generateProject(opts);
        // 应有 experimental 警告
        expect(result.warnings.some((w) => w.includes('vue3-vite') && w.includes('experimental'))).toBe(true);
        // 应写入 experimental-frontend.txt
        expect(existsSync(join(dir, '.ai-spec/experimental-frontend.txt'))).toBe(true);
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('占位符残留检测（建议 4）', () => {
    it('生成的文件不应含未替换 {{...}} 占位符', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ai-spec-e2e-placeholder-'));
      try {
        const opts = makeOpts(GOLDEN_COMBO, 'e2e-placeholder', dir);
        const result = await generateProject(opts);
        // 检查所有 warning 是否含"未替换占位符"
        const placeholderWarnings = result.warnings.filter((w) => w.includes('未替换占位符'));
        expect(placeholderWarnings).toEqual([]);
      } finally {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
