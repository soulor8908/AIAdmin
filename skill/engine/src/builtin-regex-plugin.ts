// engine/src/builtin-regex-plugin.ts —— 内置 regex 检查 plugin
// 问题 1 修复：把 runRegexCheck 从 engine 核心抽离为独立 plugin。
//
// 设计：
// - engine 核心只做"调度 + 收集 finding"
// - regex / structure 类检查（非 plugin_required）由本 plugin 执行
// - plugin 在构造时持有 rules 引用（engine 在 registerBuiltinPlugin 时注入）
// - 通过 supported_rules 声明它支持哪些规则（动态计算：所有 regex/structure 类规则）
//
// 与 typescript plugin 的关系：
// - typescript plugin：TS 特化检查（AST 级），处理 plugin_required=true 的规则
// - builtin-regex-plugin：语言无关的正则检查，处理 plugin_required=false 的 regex/structure 规则

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { RuleCheckPlugin, RuleCheckInput, RuleFinding } from '../../spi/adapter.js';
import type { DeclarativeRule } from './loader.js';
import { extractMatches } from './glob.js';

/**
 * 内置 regex 检查 plugin。
 * 处理 check.kind='regex' 且 plugin_required=false 的规则。
 */
export class BuiltinRegexPlugin implements RuleCheckPlugin {
  readonly id = 'builtin-regex';
  private rulesById = new Map<string, DeclarativeRule>();

  constructor(rules: DeclarativeRule[]) {
    for (const r of rules) {
      // 仅接管 regex / structure 类、非 plugin_required 的规则
      if ((r.check.kind === 'regex' || r.check.kind === 'structure') && !r.check.plugin_required) {
        this.rulesById.set(r.id, r);
      }
    }
  }

  get supported_rules(): string[] {
    return [...this.rulesById.keys()];
  }

  async check(input: RuleCheckInput): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    for (const ruleId of input.rule_ids) {
      const rule = this.rulesById.get(ruleId);
      if (!rule) continue;
      if (rule.check.kind === 'regex') {
        findings.push(...this.runRegexCheck(rule, input.files, input.root_dir));
      } else if (rule.check.kind === 'structure') {
        // structure 类核心不实现具体语义（须 plugin），仅记录 advisory
        findings.push({
          rule_id: rule.id,
          file: '',
          line: 0,
          severity: 'info',
          message: `${rule.id} structure 检查须 plugin 实现，核心仅记录意图: ${rule.check.expr}`,
        });
      }
    }
    return findings;
  }

  private runRegexCheck(rule: DeclarativeRule, files: string[], rootDir: string): RuleFinding[] {
    const findings: RuleFinding[] = [];
    const { expr, negative } = rule.check;
    if (!expr) return findings;

    let regex: RegExp;
    try {
      regex = new RegExp(expr, 's');
    } catch (e) {
      return [
        {
          rule_id: rule.id,
          file: '',
          line: 0,
          severity: 'warning',
          message: `${rule.id} 正则无效: ${(e as Error).message}`,
        },
      ];
    }

    for (const file of files) {
      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const matches = extractMatches(regex, src);
      const isViolation = negative ? matches.length > 0 : matches.length === 0;
      if (isViolation) {
        for (const m of matches.slice(0, 10)) {
          findings.push({
            rule_id: rule.id,
            file: relative(rootDir, file),
            line: m.line,
            severity: rule.severity,
            message: `${rule.id} 违规：${rule.title}`,
            fix_hint: rule.fix_hint,
          });
        }
      }
    }
    return findings;
  }
}
