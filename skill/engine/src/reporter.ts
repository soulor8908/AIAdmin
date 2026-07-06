// engine/src/reporter.ts —— 检查结果格式化器
// P0-4 产出：把 RuleFinding 渲染为人类可读 markdown + JSON（供 CI 消费）。

import type { EngineResult } from './engine.js';
import type { RuleFinding } from '../../spi/adapter.js';

export function renderText(result: EngineResult): string {
  const lines: string[] = [];
  const infos = result.findings.filter((f) => f.severity === 'info');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  const errors = result.findings.filter((f) => f.severity === 'error');

  if (infos.length) {
    lines.push('ℹ️  审计清单（不阻断）：');
    for (const i of infos) lines.push(`  - ${formatFinding(i)}`);
  }
  if (warnings.length) {
    lines.push('⚠️  建议（不阻断）：');
    for (const w of warnings) lines.push(`  - ${formatFinding(w)}`);
  }
  if (errors.length) {
    lines.push('');
    lines.push('❌ 规则校验失败：');
    for (const e of errors) lines.push(`  - ${formatFinding(e)}`);
    lines.push('');
    lines.push(`共 ${errors.length} 处违规`);
  } else if (!warnings.length && !infos.length) {
    lines.push('✅ 规则校验通过');
  }
  lines.push('');
  lines.push(`   已执行规则：${result.executed_rules.join(' / ')}`);
  lines.push(`   已加载规则：${result.loaded_rules}`);
  if (result.meta003_violations.length) {
    lines.push(`   META-003 声明漂移：${result.meta003_violations.length} 处`);
  }
  if (result.meta004_violations.length) {
    lines.push(`   META-004 反向缺口：${result.meta004_violations.length} 处`);
  }
  return lines.join('\n');
}

export function renderJson(result: EngineResult): string {
  return JSON.stringify(
    {
      exit_code: result.exit_code,
      loaded_rules: result.loaded_rules,
      executed_rules: result.executed_rules,
      meta003_violations: result.meta003_violations,
      meta004_violations: result.meta004_violations,
      findings: result.findings,
    },
    null,
    2,
  );
}

function formatFinding(f: RuleFinding): string {
  const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file || '(global)';
  const fixHint = f.fix_hint ? ` — 修复提示: ${f.fix_hint}` : '';
  return `${f.rule_id} ${loc} — ${f.message}${fixHint}`;
}
