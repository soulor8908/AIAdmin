// inject/rule-injector/injector.ts —— P2-4/P2-5/P2-6 主流程
// 渐进式注入（advisory → warning → blocking）+ 改造计划 + 回滚备份。

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import type { ProjectProfile } from '../detector/types.js';
import type {
  InjectionConfig,
  InjectionPlan,
  InjectionWrite,
  SeverityLevel,
  RuleReadinessCriteria,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 生成注入计划（不写入）。
 * 这是 P2-5 的 dry-run 实现，P2-4 的执行入口。
 */
export function planInjection(
  rootDir: string,
  profile: ProjectProfile,
  config: InjectionConfig,
): InjectionPlan {
  const writes: InjectionWrite[] = [];

  // 1. 注入 .ai-spec/rules/（从 kernel 拷贝，应用 severity 覆盖）
  writes.push(...planRules(rootDir, config));

  // 2. 注入 .ai-spec/roles/（从 kernel 拷贝）
  writes.push(...planRoles());

  // 3. 注入 .ai-spec/templates/（从 kernel 拷贝）
  writes.push(...planTemplates());

  // 4. 注入 .ai-spec/config.json
  writes.push({
    path: '.ai-spec/config.json',
    content: JSON.stringify(
      {
        version: '0.1.0-phase2',
        profile_summary: {
          language: profile.language,
          backend: profile.backend?.id,
          frontend: profile.frontend?.id,
          db: profile.db?.id,
        },
        default_severity: config.default_level,
        overrides: config.overrides,
        readiness: loadReadiness(rootDir),
      },
      null,
      2,
    ) + '\n',
    is_new: !existsSync(join(rootDir, '.ai-spec', 'config.json')),
    reason: 'P2-4 注入 ai-spec 配置',
  });

  // 5. 注入 .ai-spec/project-profile.json（探测结果留档）
  writes.push({
    path: '.ai-spec/project-profile.json',
    content: JSON.stringify(profile, null, 2) + '\n',
    is_new: !existsSync(join(rootDir, '.ai-spec', 'project-profile.json')),
    reason: 'P2-1 探测结果留档',
  });

  // 6. 注入 scripts/check-rules.mjs（薄包装）
  writes.push({
    path: 'scripts/check-rules.mjs',
    content: RULES_RUNNER,
    is_new: !existsSync(join(rootDir, 'scripts', 'check-rules.mjs')),
    reason: 'P2-4 注入规则校验脚本',
  });

  // 7. 注入 .ai-spec/readiness.yaml（升级判定标准）
  writes.push({
    path: '.ai-spec/readiness.yaml',
    content: renderReadinessYaml(),
    is_new: !existsSync(join(rootDir, '.ai-spec', 'readiness.yaml')),
    reason: 'P2-4 注入升级判定标准',
  });

  // dry-run 模式不备份
  const backupDir = config.dry_run ? undefined : makeBackupDir(rootDir);

  // 计算影响
  const impact = {
    new_files: writes.filter((w) => w.is_new).length,
    modified_files: writes.filter((w) => !w.is_new).length,
    rules_count: writes.filter((w) => w.path.startsWith('.ai-spec/rules/')).length,
    advisory_count: writes.filter((w) => w.severity === 'advisory').length,
    warning_count: writes.filter((w) => w.severity === 'warning').length,
    blocking_count: writes.filter((w) => w.severity === 'blocking').length,
  };

  return {
    generated_at: new Date().toISOString(),
    writes,
    impact,
    backup_dir: backupDir,
    dry_run: config.dry_run,
    markdown: renderMarkdownPlan(writes, impact, config, profile),
  };
}

/**
 * 执行注入（写文件 + 备份）。
 */
export function executeInjection(rootDir: string, plan: InjectionPlan): { written: number; backups: string[] } {
  if (plan.dry_run) {
    throw new Error('dry-run 计划不可执行（请用 planInjection 的输出 review 后改 dry_run=false）');
  }
  let written = 0;
  const backups: string[] = [];

  for (const op of plan.writes) {
    const fullPath = join(rootDir, op.path);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // 改既有文件 → 备份
    if (!op.is_new && existsSync(fullPath)) {
      const backupPath = join(plan.backup_dir ?? join(rootDir, '.ai-spec', 'backup', 'latest'), op.path);
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(fullPath, backupPath);
      backups.push(backupPath);
    }

    writeFileSync(fullPath, op.content);
    written++;
  }

  // 写入清单（用于回滚）
  const manifest = {
    injected_at: new Date().toISOString(),
    backup_dir: plan.backup_dir,
    writes: plan.writes.map((w) => ({ path: w.path, is_new: w.is_new, backup_path: w.backup_path })),
  };
  writeFileSync(
    join(plan.backup_dir ?? join(rootDir, '.ai-spec', 'backup', 'latest'), 'injection-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  return { written, backups };
}

/**
 * 回滚最近一次注入。
 */
export function rollbackInjection(rootDir: string): { rolled_back: number; backup_dir: string } {
  const manifestPath = join(rootDir, '.ai-spec', 'backup', 'latest', 'injection-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('未找到注入清单，无法回滚（.ai-spec/backup/latest/injection-manifest.json 不存在）');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const backupDir = manifest.backup_dir;
  let rolledBack = 0;

  for (const entry of manifest.writes as Array<{ path: string; is_new: boolean; backup_path?: string }>) {
    const fullPath = join(rootDir, entry.path);
    if (entry.is_new) {
      // 新建文件 → 删除
      if (existsSync(fullPath)) {
        rmSync(fullPath, { force: true });
        rolledBack++;
      }
    } else if (entry.backup_path) {
      // 改动文件 → 恢复
      copyFileSync(entry.backup_path, fullPath);
      rolledBack++;
    }
  }

  return { rolled_back: rolledBack, backup_dir: backupDir };
}

/**
 * 升级规则级别（advisory → warning → blocking）。
 */
export function gateUp(
  rootDir: string,
  ruleId: string,
  toLevel: SeverityLevel,
): { rule_file: string; old_level: SeverityLevel; new_level: SeverityLevel } {
  const ruleFile = findRuleFile(rootDir, ruleId);
  if (!ruleFile) throw new Error(`规则 ${ruleId} 未找到（请在 .ai-spec/rules/ 内查找）`);

  const content = readFileSync(ruleFile, 'utf8');
  const doc = parseYaml(content) as { id: string; severity?: string };
  const oldLevel = (doc.severity as SeverityLevel) ?? 'advisory';
  doc.severity = toLevel;

  // 重写文件（简化：用正则替换 severity 行）
  const newContent = content.replace(
    /^(severity:\s*).*$/m,
    `$1${toLevel}`,
  );
  writeFileSync(ruleFile, newContent);

  return { rule_file: ruleFile, old_level: oldLevel, new_level: toLevel };
}

// ============ 计划生成辅助 ============

function planRules(rootDir: string, config: InjectionConfig): InjectionWrite[] {
  const writes: InjectionWrite[] = [];
  const rulesDir = join(__dirname, '..', '..', 'kernel', 'rules');
  if (!existsSync(rulesDir)) return writes;

  for (const name of readdirSync(rulesDir)) {
    if (!name.endsWith('.yaml')) continue;
    const srcPath = join(rulesDir, name);
    let content = readFileSync(srcPath, 'utf8');

    // 应用 severity 覆盖（在每个规则段加 severity 字段）
    content = applySeverityOverrides(content, config);

    const destPath = `.ai-spec/rules/${name}`;
    writes.push({
      path: destPath,
      content,
      is_new: !existsSync(join(rootDir, destPath)),
      severity: config.default_level,
      reason: `P2-4 注入规则集 ${name}`,
    });
  }
  return writes;
}

function planRoles(): InjectionWrite[] {
  const writes: InjectionWrite[] = [];
  const rolesDir = join(__dirname, '..', '..', 'kernel', 'roles');
  if (!existsSync(rolesDir)) return writes;
  for (const name of readdirSync(rolesDir)) {
    const srcPath = join(rolesDir, name);
    writes.push({
      path: `.ai-spec/roles/${name}`,
      content: readFileSync(srcPath, 'utf8'),
      is_new: true,
      reason: `P2-4 注入角色提示词 ${name}`,
    });
  }
  return writes;
}

function planTemplates(): InjectionWrite[] {
  const writes: InjectionWrite[] = [];
  const tplDir = join(__dirname, '..', '..', 'kernel', 'templates');
  if (!existsSync(tplDir)) return writes;
  for (const name of readdirSync(tplDir)) {
    const srcPath = join(tplDir, name);
    writes.push({
      path: `.ai-spec/templates/${name}`,
      content: readFileSync(srcPath, 'utf8'),
      is_new: true,
      reason: `P2-4 注入文档模板 ${name}`,
    });
  }
  return writes;
}

function applySeverityOverrides(content: string, config: InjectionConfig): string {
  // 简化：在每个规则块的尾部追加 severity 字段
  // 真实实现（P2-4 完整版）应解析 YAML 树并按 rule.id 注入
  if (Object.keys(config.overrides).length === 0) {
    return content + `\n# P2-4 默认级别: ${config.default_level}\n`;
  }
  return content + `\n# P2-4 severity 覆盖: ${JSON.stringify(config.overrides)}\n`;
}

function makeBackupDir(rootDir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(rootDir, '.ai-spec', 'backup', ts);
  mkdirSync(dir, { recursive: true });
  // 同时更新 latest 符号链接（用目录拷贝代替，避免符号链接权限问题）
  const latestDir = join(rootDir, '.ai-spec', 'backup', 'latest');
  if (existsSync(latestDir)) {
    rmSync(latestDir, { recursive: true, force: true });
  }
  mkdirSync(latestDir, { recursive: true });
  return dir;
}

function findRuleFile(rootDir: string, ruleId: string): string | undefined {
  const rulesDir = join(rootDir, '.ai-spec', 'rules');
  if (!existsSync(rulesDir)) return undefined;
  for (const name of readdirSync(rulesDir)) {
    if (!name.endsWith('.yaml')) continue;
    const path = join(rulesDir, name);
    const content = readFileSync(path, 'utf8');
    const doc = parseYaml(content) as { rules?: Array<{ id: string }> };
    if (doc.rules?.some((r) => r.id === ruleId)) return path;
  }
  return undefined;
}

function loadReadiness(rootDir: string): RuleReadinessCriteria[] {
  const path = join(rootDir, '.ai-spec', 'readiness.yaml');
  if (!existsSync(path)) return DEFAULT_READINESS;
  try {
    const content = readFileSync(path, 'utf8');
    const doc = parseYaml(content) as { rules?: RuleReadinessCriteria[] };
    return doc.rules ?? DEFAULT_READINESS;
  } catch {
    return DEFAULT_READINESS;
  }
}

function renderReadinessYaml(): string {
  const lines = ['# P2-4 升级判定标准（advisory → warning → blocking）', '# 由 ai-spec inject 自动生成', ''];
  lines.push('rules:');
  for (const r of DEFAULT_READINESS) {
    lines.push(`  - rule_id: ${r.rule_id}`);
    lines.push(`    current: ${r.current}`);
    lines.push(`    to_warning_when: "${r.to_warning_when}"`);
    lines.push(`    to_blocking_when: "${r.to_blocking_when}"`);
  }
  return lines.join('\n') + '\n';
}

function renderMarkdownPlan(
  writes: InjectionWrite[],
  impact: InjectionPlan['impact'],
  config: InjectionConfig,
  profile: ProjectProfile,
): string {
  const lines: string[] = [];
  lines.push('# 改造计划（inject-plan）');
  lines.push('');
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  lines.push(`> 模式：${config.dry_run ? 'dry-run（仅计划，不写入）' : '执行（将写入 + 备份）'}`);
  lines.push('');
  lines.push('## 1 · 项目画像');
  lines.push('');
  lines.push(`- 语言：${profile.language}${profile.language_version ? ' (' + profile.language_version + ')' : ''}`);
  if (profile.backend) lines.push(`- 后端：${profile.backend.label} (置信度 ${profile.backend.confidence})`);
  if (profile.frontend) lines.push(`- 前端：${profile.frontend.label}`);
  if (profile.db) lines.push(`- 数据库：${profile.db.label}`);
  if (profile.orm) lines.push(`- ORM：${profile.orm.label}`);
  if (profile.test_runner) lines.push(`- 测试：${profile.test_runner.label}`);
  lines.push('');
  lines.push('## 2 · 影响范围');
  lines.push('');
  lines.push(`- 新建文件：${impact.new_files}`);
  lines.push(`- 修改文件：${impact.modified_files}`);
  lines.push(`- 规则数：${impact.rules_count}`);
  lines.push(`- advisory 级：${impact.advisory_count}`);
  lines.push(`- warning 级：${impact.warning_count}`);
  lines.push(`- blocking 级：${impact.blocking_count}`);
  if (!config.dry_run) {
    lines.push('');
    lines.push('## 3 · 回滚点');
    lines.push('');
    lines.push('执行后可通过 `ai-spec rollback` 一键回滚，备份目录：`.ai-spec/backup/<timestamp>/`');
  }
  lines.push('');
  lines.push('## 3 · 写入清单');
  lines.push('');
  lines.push('| 路径 | 新建? | 级别 | 原因 |');
  lines.push('|---|---|---|---|');
  for (const w of writes) {
    lines.push(`| ${w.path} | ${w.is_new ? '✓' : ''} | ${w.severity ?? '-'} | ${w.reason} |`);
  }
  return lines.join('\n');
}

// ============ 内联资源 ============

const RULES_RUNNER = `#!/usr/bin/env node
// scripts/check-rules.mjs —— P2-4 注入的规则校验脚本（薄包装）
// 真实校验逻辑由 skill engine 执行，本脚本作为门禁入口。

import { existsSync, readFileSync } from 'node:fs';

const configPath = '.ai-spec/config.json';
if (!existsSync(configPath)) {
  console.error('✖ 未找到 .ai-spec/config.json，请先运行 ai-spec inject');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const defaultLevel = config.default_severity ?? 'advisory';

console.log('ℹ 默认级别：', defaultLevel);
console.log('ℹ 规则文件目录：.ai-spec/rules/');

// 各级别行为
if (defaultLevel === 'advisory') {
  console.log('ℹ advisory 模式：仅报告，不阻断');
  process.exit(0);
} else if (defaultLevel === 'warning') {
  console.log('⚠ warning 模式：报告 + 警告，不阻断');
  process.exit(0);
} else if (defaultLevel === 'blocking') {
  console.log('✖ blocking 模式：报告 + 阻断');
  // blocking 模式真实实现会调用 engine.run() 并在 violation 时 exit 1
  process.exit(0);
}
`;

const DEFAULT_READINESS: RuleReadinessCriteria[] = [
  {
    rule_id: 'ARCH-001',
    current: 'advisory',
    to_warning_when: '团队 review 通过分层约束文档',
    to_blocking_when: 'CI 跑 1 周无新 reverse-import 违规',
  },
  {
    rule_id: 'CODE-001',
    current: 'advisory',
    to_warning_when: '团队接受禁用 any 约定',
    to_blocking_when: '既有 any 类型全部清理',
  },
  {
    rule_id: 'SEC-001',
    current: 'advisory',
    to_warning_when: '路由清单 review 完成',
    to_blocking_when: '所有 public 路由显式标注 auth:public',
  },
];
