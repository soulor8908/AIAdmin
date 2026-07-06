// inject/safety-net/runner.ts —— P2-7 兼容性安全网
// 注入前跑一次 baseline 测试 → 注入后跑一次 → diff 失败用例 + 归因。

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectProfile } from '../detector/types.js';

export interface TestRunResult {
  /** 运行时间 ISO */
  run_at: string;
  /** 测试命令 */
  command: string;
  /** 退出码 */
  exit_code: number;
  /** stdout 行数 */
  stdout_lines: number;
  /** stderr 行数 */
  stderr_lines: number;
  /** 通过用例数（解析自输出，可能为 undefined） */
  passed?: number;
  /** 失败用例数 */
  failed?: number;
  /** 总用例数 */
  total?: number;
  /** 原始 stdout（截断 5KB） */
  stdout: string;
  /** 原始 stderr（截断 5KB） */
  stderr: string;
}

export interface SafetyNetReport {
  /** 项目根 */
  root_dir: string;
  /** baseline（注入前） */
  baseline: TestRunResult;
  /** after（注入后） */
  after: TestRunResult;
  /** 失败用例 diff（baseline 通过但 after 失败） */
  new_failures: string[];
  /** 失败用例归因 */
  attribution: Attribution[];
  /** markdown 报告 */
  markdown: string;
}

export interface Attribution {
  /** 失败用例标识 */
  test_id: string;
  /** 归因：注入导致 / 原有问题 / 未知 */
  cause: 'injection' | 'pre-existing' | 'unknown';
  /** 推断理由 */
  reason: string;
}

/**
 * 跑测试命令并返回结构化结果。
 */
export function runTests(rootDir: string, profile: ProjectProfile): TestRunResult {
  const command = inferTestCommand(profile);
  const runAt = new Date().toISOString();
  let exitCode = 0;
  let stdout = '';
  let stderr = '';

  try {
    stdout = execSync(command, {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 5 * 60 * 1000, // 5 分钟超时
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    exitCode = err.status ?? 1;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }

  const parsed = parseTestOutput(stdout, profile);

  return {
    run_at: runAt,
    command,
    exit_code: exitCode,
    stdout_lines: stdout.split('\n').length,
    stderr_lines: stderr.split('\n').length,
    passed: parsed.passed,
    failed: parsed.failed,
    total: parsed.total,
    stdout: stdout.slice(0, 5000),
    stderr: stderr.slice(0, 5000),
  };
}

/**
 * 注入前跑 baseline。
 */
export function captureBaseline(rootDir: string, profile: ProjectProfile): TestRunResult {
  const result = runTests(rootDir, profile);
  // 留档
  const outDir = join(rootDir, '.ai-spec', 'safety-net');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'baseline.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

/**
 * 注入后跑测试 + 对比 baseline + 归因。
 */
export function compareAfter(
  rootDir: string,
  profile: ProjectProfile,
  baseline: TestRunResult,
): SafetyNetReport {
  const after = runTests(rootDir, profile);

  // 留档
  const outDir = join(rootDir, '.ai-spec', 'safety-net');
  writeFileSync(join(outDir, 'after.json'), JSON.stringify(after, null, 2) + '\n');

  // diff 失败用例
  const newFailures = diffFailures(baseline, after);

  // 归因
  const attribution = newFailures.map((testId) => attribute(testId, baseline, after));

  const report: SafetyNetReport = {
    root_dir: rootDir,
    baseline,
    after,
    new_failures: newFailures,
    attribution,
    markdown: renderMarkdown(rootDir, baseline, after, newFailures, attribution),
  };
  writeFileSync(join(outDir, 'report.md'), report.markdown);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

/**
 * 加载已留档的 baseline（避免重复跑）。
 */
export function loadBaseline(rootDir: string): TestRunResult | undefined {
  const path = join(rootDir, '.ai-spec', 'safety-net', 'baseline.json');
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ============ 推断测试命令 ============

function inferTestCommand(profile: ProjectProfile): string {
  // 优先看 package.json scripts.test
  if (existsSync('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
      if (pkg.scripts?.test) return `npm test --silent`;
    } catch {}
  }
  if (profile.language === 'python') return 'pytest';
  if (profile.language === 'java') return 'mvn test -q';
  if (profile.language === 'go') return 'go test ./...';
  return 'npm test';
}

// ============ 解析测试输出 ============

function parseTestOutput(stdout: string, profile: ProjectProfile): {
  passed?: number;
  failed?: number;
  total?: number;
} {
  if (profile.test_runner?.id === 'vitest' || profile.test_runner?.id === 'jest') {
    // vitest: "Test Files  4 passed (4)" + "Tests  29 passed (29)"
    const testMatch = stdout.match(/Tests\s+(\d+)\s+passed(?:.*?(\d+)\s+failed)?/);
    if (testMatch) {
      const passed = Number(testMatch[1]);
      const failed = Number(testMatch[2] ?? 0);
      return { passed, failed, total: passed + failed };
    }
  }
  if (profile.test_runner?.id === 'pytest') {
    // "===== 5 passed in 1.23s =====" or "===== 3 passed, 1 failed in 1.23s ====="
    const m = stdout.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?/);
    if (m) {
      const passed = Number(m[1]);
      const failed = Number(m[2] ?? 0);
      return { passed, failed, total: passed + failed };
    }
  }
  return {};
}

function diffFailures(baseline: TestRunResult, after: TestRunResult): string[] {
  // 简化版：如果 after.failed > baseline.failed，标记差异
  const bFailed = baseline.failed ?? 0;
  const aFailed = after.failed ?? 0;
  if (aFailed <= bFailed) return [];
  // 真实实现（P2-7 完整版）应解析具体用例名，此处简化为计数差异
  const diff = aFailed - bFailed;
  return [`${diff} 个用例在注入后新增失败（baseline=${bFailed}, after=${aFailed}）`];
}

function attribute(testId: string, baseline: TestRunResult, after: TestRunResult): Attribution {
  // 简化归因：
  // - 若 baseline 已失败 → pre-existing
  // - 若 baseline 通过但 after 失败 → injection
  // - 否则 unknown
  if ((baseline.failed ?? 0) > 0) {
    return {
      test_id: testId,
      cause: 'pre-existing',
      reason: 'baseline 已存在失败用例，可能为既有问题',
    };
  }
  if ((after.failed ?? 0) > 0 && (baseline.failed ?? 0) === 0) {
    return {
      test_id: testId,
      cause: 'injection',
      reason: 'baseline 全绿，注入后新增失败，归因注入',
    };
  }
  return { test_id: testId, cause: 'unknown', reason: '无法确定归因，需人工 review' };
}

function renderMarkdown(
  rootDir: string,
  baseline: TestRunResult,
  after: TestRunResult,
  newFailures: string[],
  attribution: Attribution[],
): string {
  const lines: string[] = [];
  lines.push('# 兼容性安全网报告');
  lines.push('');
  lines.push(`> 项目：${rootDir}`);
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 1 · 测试结果对比');
  lines.push('');
  lines.push('| 阶段 | 命令 | 退出码 | 通过 | 失败 | 总数 |');
  lines.push('|---|---|---|---|---|---|');
  lines.push(
    `| Baseline | ${baseline.command} | ${baseline.exit_code} | ${baseline.passed ?? '-'} | ${baseline.failed ?? '-'} | ${baseline.total ?? '-'} |`,
  );
  lines.push(
    `| After | ${after.command} | ${after.exit_code} | ${after.passed ?? '-'} | ${after.failed ?? '-'} | ${after.total ?? '-'} |`,
  );
  lines.push('');
  lines.push('## 2 · 新增失败');
  lines.push('');
  if (newFailures.length === 0) {
    lines.push('✅ 注入未引入新失败用例');
  } else {
    for (const f of newFailures) lines.push(`- ${f}`);
  }
  if (attribution.length > 0) {
    lines.push('');
    lines.push('## 3 · 归因');
    lines.push('');
    lines.push('| 用例 | 归因 | 理由 |');
    lines.push('|---|---|---|');
    for (const a of attribution) lines.push(`| ${a.test_id} | ${a.cause} | ${a.reason} |`);
  }
  return lines.join('\n');
}
