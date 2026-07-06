// tools/gen-delta.ts —— 增量上下文生成器（通用版）
// P0-7 产出：从 mvp/scripts/gen-round-delta.mjs 提取，参数化项目路径。
//
// 通用化要点：
// - 路径不再硬编码 mvp/，由 project config（ai-spec.config.json）声明
// - 文件类型不再硬编码 .ts，由 config 声明（如 Java 的 .java + Python 的 .py）
// - 输出仍为 markdown（< 3KB），供五角色 subagent 先读
//
// 用法：
//   tsx tools/gen-delta.ts                          # 默认 HEAD~1..HEAD
//   tsx tools/gen-delta.ts --round 16               # 输出 docs/retro/round-16-delta.md
//   tsx tools/gen-delta.ts --from <ref> --to <ref>
//   tsx tools/gen-delta.ts --config path/to/ai-spec.config.json

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface AiSpecConfig {
  /** 项目根目录（默认 process.cwd()） */
  root_dir?: string;
  /** git 顶层目录（若 monorepo 子目录，需指定） */
  git_root?: string;
  /** 文档根目录（默认 docs） */
  docs_dir?: string;
  /** 复盘目录（默认 docs/retro） */
  retro_dir?: string;
  /** 上下文快照路径（默认 docs/context-snapshot.md） */
  context_snapshot?: string;
  /** 关注的文件类型（默认 ['.ts', '.tsx']） */
  file_types?: string[];
  /** 关注的目录（默认 ['packages/contracts', 'apps/api/src', 'apps/web/src']） */
  watch_dirs?: string[];
  /** 输出文件名模板（默认 'round-{{N}}-delta.md'） */
  output_template?: string;
  /** 最大字节数（默认 3KB） */
  max_bytes?: number;
}

function loadConfig(configPath?: string): AiSpecConfig {
  const path = configPath ?? 'ai-spec.config.json';
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  return {}; // 默认配置由 caller 填充
}

interface DeltaOptions {
  from: string;
  to: string;
  round?: number;
  tag: boolean;
  configPath?: string;
}

function parseArgs(): DeltaOptions {
  const args = process.argv.slice(2);
  const opts: DeltaOptions = { from: '', to: 'HEAD', tag: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from') opts.from = args[++i] ?? '';
    else if (a === '--to') opts.to = args[++i] ?? '';
    else if (a === '--round') opts.round = Number(args[++i]);
    else if (a === '--tag') opts.tag = true;
    else if (a === '--config') opts.configPath = args[++i];
  }
  // --round N：from 优先用 round-(N-1) tag
  if (opts.round != null) {
    const prevTag = `round-${opts.round - 1}`;
    if (!opts.from && hasRef(prevTag)) opts.from = prevTag;
    opts.from = opts.from || 'HEAD~1';
  } else {
    opts.from = opts.from || 'HEAD~1';
  }
  return opts;
}

function hasRef(ref: string): boolean {
  try {
    execSync(`git rev-parse --verify ${ref}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function generateDelta(opts: DeltaOptions): string {
  const config = loadConfig(opts.configPath);
  const rootDir = config.root_dir ?? process.cwd();
  const gitRoot = config.git_root ?? execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const rootPrefix = rootDir.startsWith(gitRoot) ? rootDir.slice(gitRoot.length + 1) : '';
  const docsDir = config.docs_dir ?? 'docs';
  const retroDir = config.retro_dir ?? `${docsDir}/retro`;
  const fileTypes = config.file_types ?? ['.ts', '.tsx'];
  const watchDirs = config.watch_dirs ?? ['packages/contracts', 'apps/api/src', 'apps/web/src'];
  const maxBytes = config.max_bytes ?? 3 * 1024;

  function norm(p: string): string {
    if (rootPrefix && p.startsWith(rootPrefix + '/')) return p.slice(rootPrefix.length + 1);
    return p;
  }

  // 1. 取 diff 文件清单
  const diffRaw = git(`diff --name-status ${opts.from}..${opts.to}`, gitRoot);
  const changes = diffRaw
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [status, ...pathParts] = line.split('\t');
      return { status, path: norm(pathParts.join('\t')) };
    });

  // 2. 按类别分组
  const endpoints = changes.filter((c) => watchDirs.some((d) => c.path.startsWith(d)) && fileTypes.some((t) => c.path.endsWith(t)));
  const contracts = changes.filter((c) => c.path.includes('contracts'));
  const rules = changes.filter((c) => c.path.includes('kernel/rules') || c.path.includes('.trae/rules'));
  const specs = changes.filter((c) => c.path.includes(`${docsDir}/spec/`));
  const prds = changes.filter((c) => c.path.includes(`${docsDir}/prd/`));
  const reviews = changes.filter((c) => c.path.includes(`${docsDir}/review/`));
  const tests = changes.filter((c) => c.path.includes('/test/') || c.path.includes('/tests/'));

  // 3. 生成 markdown
  const lines: string[] = [];
  lines.push(`# Round ${opts.round ?? '?'} Delta`);
  lines.push('');
  lines.push(`> 增量上下文（< ${Math.floor(maxBytes / 1024)}KB），供五角色 subagent 先读把握本轮范围。`);
  lines.push(`> from: \`${opts.from}\` → to: \`${opts.to}\``);
  lines.push('');

  if (endpoints.length) {
    lines.push(`## 端点 / 实现改动（${endpoints.length}）`);
    for (const c of endpoints.slice(0, 20)) {
      lines.push(`- [${c.status}] ${c.path}`);
    }
    if (endpoints.length > 20) lines.push(`- ... ${endpoints.length - 20} more`);
    lines.push('');
  }

  if (contracts.length) {
    lines.push(`## 契约变更（${contracts.length}）`);
    for (const c of contracts) lines.push(`- [${c.status}] ${c.path}`);
    lines.push('');
  }

  if (rules.length) {
    lines.push(`## 规则变更（${rules.length}）`);
    for (const c of rules) lines.push(`- [${c.status}] ${c.path}`);
    lines.push('');
  }

  if (specs.length) {
    lines.push(`## Tech-Spec（${specs.length}）`);
    for (const c of specs) lines.push(`- [${c.status}] ${c.path}`);
    lines.push('');
  }

  if (prds.length) {
    lines.push(`## PRD（${prds.length}）`);
    for (const c of prds) lines.push(`- [${c.status}] ${c.path}`);
    lines.push('');
  }

  if (tests.length) {
    lines.push(`## 测试（${tests.length}）`);
    for (const c of tests.slice(0, 20)) lines.push(`- [${c.status}] ${c.path}`);
    if (tests.length > 20) lines.push(`- ... ${tests.length - 20} more`);
    lines.push('');
  }

  if (reviews.length) {
    lines.push(`## Review（${reviews.length}）`);
    for (const c of reviews) lines.push(`- [${c.status}] ${c.path}`);
    lines.push('');
  }

  // 4. 跳过建议（若后端无变更）
  const backendChanged = endpoints.some((c) => c.path.includes('apps/api/src/') || c.path.includes('src/main/java/') || c.path.includes('app/'));
  if (!backendChanged) {
    lines.push(`## 跳过建议`);
    lines.push(`- 本轮无后端改动，BA/Tech Lead/test-writer/impl-writer 可跳过读 entry point 全文`);
    lines.push('');
  }

  let output = lines.join('\n');
  if (output.length > maxBytes) {
    output = output.slice(0, maxBytes) + '\n\n> (truncated)\n';
  }

  // 5. 写文件
  const outputTemplate = config.output_template ?? 'round-{{N}}-delta.md';
  const fileName = opts.round != null ? outputTemplate.replace('{{N}}', String(opts.round)) : `delta-${opts.from}-${opts.to}.md`.replace(/\//g, '-');
  const outPath = join(rootDir, retroDir, fileName);
  writeFileSync(outPath, output);
  console.log(`✅ 增量上下文已生成: ${outPath} (${output.length} bytes)`);

  // 6. 可选打 tag
  if (opts.tag && opts.round != null) {
    try {
      execSync(`git tag round-${opts.round}`, { cwd: gitRoot });
      console.log(`✅ 已打 tag: round-${opts.round}`);
    } catch (e) {
      console.warn(`⚠️  打 tag 失败: ${(e as Error).message}`);
    }
  }

  return outPath;
}

// CLI 入口
const opts = parseArgs();
generateDelta(opts);
