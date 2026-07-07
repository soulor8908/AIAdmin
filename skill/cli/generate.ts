// cli/generate.ts —— 项目生成主流程
// P1-1 / P1-3 产出：根据选项生成可运行项目骨架。
//
// 当前为最小骨架版（P1-1 完成），后续 P1-3 接入完整模板渲染引擎。

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { GenerateOptions, StackKey } from './options.js';
import { isExperimental, countExperimental } from './options.js';
import { renderProject } from './template-engine.js';
import { logger } from './log.js';

export interface GenerateResult {
  out_dir: string;
  files_written: number;
  deps_installed: boolean;
  git_inited: boolean;
  warnings: string[];
  next_steps: string[];
}

/**
 * 生成项目骨架。
 * 失败时抛异常，调用方负责清理部分生成的目录。
 */
export async function generateProject(opts: GenerateOptions): Promise<GenerateResult> {
  const warnings: string[] = [...(opts.stack ? [] : [])];
  const outDir = opts.out_dir;

  // 1. 校验输出目录
  if (existsSync(outDir)) {
    if (existsSync(join(outDir, 'package.json'))) {
      throw new Error(`目录已存在且含 package.json：${outDir}（拒绝覆盖）`);
    }
    logger.warn(`目录已存在但无 package.json，将合并：${outDir}`);
  } else {
    mkdirSync(outDir, { recursive: true });
  }

  // 1.5 experimental 适配器防护（建议 1）
  // 列出所有 experimental 选择，若未显式 --yes 确认则警告
  const experimentalChoices: string[] = [];
  for (const key of ['backend', 'db', 'frontend', 'auth', 'ci'] as StackKey[]) {
    if (isExperimental(key, opts.stack[key])) {
      experimentalChoices.push(`${key}=${opts.stack[key]}`);
    }
  }
  if (experimentalChoices.length > 0) {
    const msg = `experimental 选型：${experimentalChoices.join(', ')}（可能存在缺陷，建议 1）`;
    if (opts.yes) {
      warnings.push(msg);
    } else {
      logger.warn(msg);
    }
  }

  // 2. 渲染项目文件（P1-3 template-engine 接管）
  logger.startStep('渲染项目骨架');
  const renderResult = await renderProject(opts);
  for (const w of renderResult.warnings) warnings.push(w);
  logger.endStep(`渲染项目骨架 (${renderResult.writes.length} 文件)`, true);

  // 3. 写入文件
  logger.startStep('写入文件');
  for (const op of renderResult.writes) {
    const fullPath = join(outDir, op.path);
    const dir = join(fullPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, op.content);
  }
  logger.endStep(`写入文件 (${renderResult.writes.length})`, true);

  // 4. 安装依赖（除非 no_deps）
  let depsInstalled = false;
  if (!opts.no_deps) {
    logger.startStep('安装依赖');
    try {
      execSync('npm install --no-audit --no-fund --silent', {
        cwd: outDir,
        stdio: opts.verbose ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      });
      depsInstalled = true;
      logger.endStep('安装依赖', true);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      warnings.push(`依赖安装失败（可稍后手动 npm install）：${msg}`);
      logger.endStep('安装依赖', false);
    }
  }

  // 5. git init（除非 no_git）
  let gitInited = false;
  if (!opts.no_git) {
    logger.startStep('初始化 git');
    try {
      execSync('git init --quiet', { cwd: outDir, stdio: 'ignore' });
      execSync('git add -A', { cwd: outDir, stdio: 'ignore' });
      execSync('git -c user.name="ai-spec" -c user.email="ai-spec@local" commit -m "chore: 初始化项目（由 create-ai-spec-app 生成）" --quiet', {
        cwd: outDir,
        stdio: 'ignore',
      });
      gitInited = true;
      logger.endStep('初始化 git', true);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      warnings.push(`git init 失败：${msg}`);
      logger.endStep('初始化 git', false);
    }
  }

  return {
    out_dir: outDir,
    files_written: renderResult.writes.length,
    deps_installed: depsInstalled,
    git_inited: gitInited,
    warnings,
    next_steps: buildNextSteps(opts, depsInstalled),
  };
}

function buildNextSteps(opts: GenerateOptions, depsInstalled: boolean): string[] {
  const steps = [
    `cd ${opts.project_name}`,
    'npm run spec:init    # 初始化第一个业务域',
    'npm run spec:check  # 运行规则校验',
    'npm run spec:gate   # 运行门禁检查',
  ];
  if (!depsInstalled) {
    steps.splice(1, 0, 'npm install         # 安装依赖');
  }
  return steps;
}

/**
 * 回滚：清理部分生成的目录（仅在用户明确选择"清理"时调用）。
 */
export function cleanupPartial(outDir: string): void {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
}
