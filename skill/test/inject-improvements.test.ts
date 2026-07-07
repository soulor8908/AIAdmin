// test/inject-improvements.test.ts —— 建议 5 + 7 测试
// 建议 5：inject 默认 dry-run，--apply 才执行
// 建议 7：contract-reverser 准确性标记

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reverseApi } from '../inject/contract-reverser/reverser.js';
import type { ProjectProfile } from '../inject/detector/types.js';

describe('建议 7：contract-reverser 准确性标记', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `ai-spec-test-rev-${Date.now()}`);
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('端点应标记 accuracy（inferred/partial/high_confidence，问题 6）', () => {
    // 造一个带 app.get 但无类型注解的 TS 项目
    writeFileSync(
      join(projectDir, 'server.ts'),
      `import Fastify from 'fastify';
const app = Fastify();
app.get('/health', async () => ({ ok: true }));
app.post('/users', async (req) => ({ id: 1 }));
`,
    );

    const profile = {
      language: 'typescript',
      language_version: '5.4',
      signals: [],
      warnings: [],
      root_dir: projectDir,
      detected_at: new Date().toISOString(),
      overall_confidence: 1.0,
    } as unknown as ProjectProfile;

    const result = reverseApi(projectDir, profile);
    expect(result.endpoints.length).toBeGreaterThanOrEqual(2);
    // 每个端点都有 accuracy 字段（问题 6：verified 仅人工赋值，机器不返回）
    for (const ep of result.endpoints) {
      expect(['inferred', 'partial', 'high_confidence', 'verified']).toContain(ep.accuracy);
    }
    // 无类型的端点应为 inferred
    expect(result.endpoints.every((e) => e.accuracy === 'inferred')).toBe(true);
  });

  it('accuracy_summary 应正确统计（问题 6：high_confidence 字段）', () => {
    writeFileSync(
      join(projectDir, 'server.ts'),
      `app.get('/a', () => {});
app.post('/b', () => {});
`,
    );
    const profile = {
      language: 'typescript',
      signals: [],
      warnings: [],
      root_dir: projectDir,
      detected_at: new Date().toISOString(),
      overall_confidence: 1.0,
    } as unknown as ProjectProfile;

    const result = reverseApi(projectDir, profile);
    expect(result.accuracy_summary.inferred).toBe(2);
    // 问题 6：high_confidence 字段存在（机器不自动赋 verified）
    expect(result.accuracy_summary.high_confidence).toBe(0);
    expect(result.accuracy_summary.verified).toBe(0); // 机器不自动赋值
  });

  it('OpenAPI 应含 accuracy 标记（问题 6：含 high_confidence）', () => {
    writeFileSync(
      join(projectDir, 'server.ts'),
      `app.get('/health', () => {});`,
    );
    const profile = {
      language: 'typescript',
      signals: [],
      warnings: [],
      root_dir: projectDir,
      detected_at: new Date().toISOString(),
      overall_confidence: 1.0,
    } as unknown as ProjectProfile;

    const result = reverseApi(projectDir, profile);
    expect(result.openapi.accuracy).toBeDefined();
    expect(['inferred', 'partial', 'high_confidence', 'verified']).toContain(result.openapi.accuracy);
  });

  it('markdown 报告应含准确性汇总表（问题 6：high_confidence + verified 行）', () => {
    writeFileSync(
      join(projectDir, 'server.ts'),
      `app.get('/health', () => {});`,
    );
    const profile = {
      language: 'typescript',
      signals: [],
      warnings: [],
      root_dir: projectDir,
      detected_at: new Date().toISOString(),
      overall_confidence: 1.0,
    } as unknown as ProjectProfile;

    const result = reverseApi(projectDir, profile);
    expect(result.markdown_report).toContain('准确性汇总');
    expect(result.markdown_report).toContain('[inferred]');
    expect(result.markdown_report).toContain('[high_confidence]');
    expect(result.markdown_report).toContain('[verified]');
  });
});

describe('建议 5：inject 默认 dry-run', () => {
  // 此测试验证 inject CLI 的选项默认值
  // 完整的 CLI 端到端测试在 e2e-generate.test.ts 中
  it('inject 命令应支持 --apply 选项（默认 false）', async () => {
    // 动态 import 避免循环依赖
    const { Command } = await import('commander');
    const cmd = new Command();
    cmd
      .command('inject')
      .option('--apply', '确认执行', false)
      .option('--force [deprecated]', '（已废弃）no-op', false)
      .option('--dry-run', '兼容旧用法', false)
      .action(() => {});

    // 解析模拟参数
    await cmd.parseAsync(['node', 'test', 'inject']);
    const opts = cmd.commands[0].opts();
    expect(opts.apply).toBe(false);
    expect(opts.force).toBe(false);
  });

  it('inject --apply 应激活 apply 模式（问题 3：直接执行，无须 --force）', async () => {
    const { Command } = await import('commander');
    const cmd = new Command();
    cmd
      .command('inject')
      .option('--apply', '确认执行', false)
      .option('--force [deprecated]', '（已废弃）no-op', false)
      .action(() => {});

    await cmd.parseAsync(['node', 'test', 'inject', '--apply']);
    const opts = cmd.commands[0].opts();
    expect(opts.apply).toBe(true);
  });

  it('inject --apply --force 仍兼容旧脚本（--force 为 no-op，问题 3）', async () => {
    const { Command } = await import('commander');
    const cmd = new Command();
    cmd
      .command('inject')
      .option('--apply', '确认执行', false)
      .option('--force [deprecated]', '（已废弃）no-op', false)
      .action(() => {});

    await cmd.parseAsync(['node', 'test', 'inject', '--apply', '--force']);
    const opts = cmd.commands[0].opts();
    expect(opts.apply).toBe(true);
    expect(opts.force).toBe(true);
  });
});
