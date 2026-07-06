// engine/src/loader.ts —— 声明式规则加载器
// P0-4 产出：从 kernel/rules/*.yaml 加载声明式规则，校验 schema，返回规则集。
//
// 设计原则：
// - 加载器只读 + 校验，不执行检查（执行由 engine.ts 调度）
// - YAML 解析依赖 js-yaml（运行时依赖，内核无关）
// - 规则 ID 冲突检测（同一 ID 出现多次报错）

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { load as parseYaml } from 'js-yaml';

export interface DeclarativeRule {
  id: string;
  title: string;
  category?: 'ai-behavior' | 'architecture' | 'coding' | 'security' | 'meta';
  severity: 'error' | 'warning' | 'info';
  applies_to: {
    file_patterns: string[];
    stacks?: string[];
    min_confidence?: number;
  };
  check: {
    kind: 'regex' | 'ast' | 'import-graph' | 'structure' | 'manual';
    expr?: string;
    negative?: boolean;
    plugin_required?: boolean;
    exempt_marker?: string;
    manual_checker?: string;
  };
  fix_hint?: string;
  rationale_ref?: string;
  /** 来源文件路径（用于报错定位） */
  _source_file?: string;
}

export interface LoadResult {
  rules: DeclarativeRule[];
  errors: string[];
  warnings: string[];
}

/**
 * 加载目录下所有声明式规则文件（YAML / JSON）。
 *
 * @param rulesDir 规则目录，如 'skill/kernel/rules'
 * @returns 规则清单 + 加载错误
 */
export function loadRules(rulesDir: string): LoadResult {
  const result: LoadResult = { rules: [], errors: [], warnings: [] };
  if (!existsSync(rulesDir)) {
    result.errors.push(`规则目录不存在: ${rulesDir}`);
    return result;
  }

  const files = walkRuleFiles(rulesDir);
  const seenIds = new Set<string>();

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    let parsed: unknown;
    try {
      const content = readFileSync(file, 'utf8');
      if (ext === '.yaml' || ext === '.yml') {
        parsed = parseYaml(content);
      } else if (ext === '.json') {
        parsed = JSON.parse(content);
      } else {
        continue; // 跳过非规则文件（如 README.md）
      }
    } catch (e) {
      result.errors.push(`解析失败 ${file}: ${(e as Error).message}`);
      continue;
    }

    const fileRules = extractRules(parsed);
    for (const rule of fileRules) {
      // 必填字段校验
      const validation = validateRule(rule, file);
      if (validation.errors.length > 0) {
        result.errors.push(...validation.errors);
        continue;
      }
      result.warnings.push(...validation.warnings);

      // 规则 ID 冲突检测
      if (seenIds.has(rule.id)) {
        result.errors.push(`规则 ID 冲突: ${rule.id} 在 ${file} 重复定义`);
        continue;
      }
      seenIds.add(rule.id);
      rule._source_file = file;
      result.rules.push(rule);
    }
  }

  return result;
}

function walkRuleFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walkRuleFiles(p, acc);
    } else {
      const ext = extname(name).toLowerCase();
      if (ext === '.yaml' || ext === '.yml' || ext === '.json') {
        acc.push(p);
      }
    }
  }
  return acc;
}

function extractRules(parsed: unknown): DeclarativeRule[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const root = parsed as { rules?: unknown };
  if (!Array.isArray(root.rules)) return [];
  return root.rules as DeclarativeRule[];
}

function validateRule(
  rule: DeclarativeRule,
  sourceFile: string,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ctx = `${sourceFile} (${rule.id || '?'})`;

  if (!rule.id) errors.push(`${ctx}: 缺少 id`);
  if (!rule.title) errors.push(`${ctx}: 缺少 title`);
  if (!rule.severity) errors.push(`${ctx}: 缺少 severity`);
  if (!['error', 'warning', 'info'].includes(rule.severity)) {
    errors.push(`${ctx}: severity 须为 error|warning|info`);
  }
  if (!rule.applies_to?.file_patterns?.length) {
    errors.push(`${ctx}: 缺少 applies_to.file_patterns`);
  }
  if (!rule.check?.kind) {
    errors.push(`${ctx}: 缺少 check.kind`);
  }
  if (!['regex', 'ast', 'import-graph', 'structure', 'manual'].includes(rule.check?.kind)) {
    errors.push(`${ctx}: check.kind 须为 regex|ast|import-graph|structure|manual`);
  }

  // META-001 校验：manual kind 须含 manual_checker
  if (rule.check?.kind === 'manual' && !rule.check?.manual_checker) {
    errors.push(`${ctx}: META-001 违规 — manual kind 须含 manual_checker`);
  }

  // META-003 校验：plugin_required=true 须有对应 plugin（由 engine 在执行时校验）
  // META-004 校验：plugin.supported_rules 须有对应规则定义（由 engine 在执行时反向校验）
  // 此处仅作声明校验，不校验 plugin 存在性（loader 不依赖 plugin registry）

  if (!rule.rationale_ref) {
    warnings.push(`${ctx}: 建议填写 rationale_ref 指向 retro/lessons-learned.md`);
  }

  return { errors, warnings };
}
