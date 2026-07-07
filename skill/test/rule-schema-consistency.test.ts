// test/rule-schema-consistency.test.ts —— 规则集 schema 一致性 + ID 唯一性
//
// 精简版校验（替代原 parity-13-enforcements.test.ts）：
// - 验证 kernel/rules/*.yaml 解析后符合 rule.schema.json 的约束
// - 验证规则 ID 唯一（无冲突）
// - 验证 ID 命名模式 ^[A-Z]+-\d+[a-z]?$
//
// 完整 parity 测试（与既有 check-rules.mjs verdict 等价对比）留待 Phase 2 迁移至
// AIAdmin 消费侧（mvp/apps/api/test/skill-parity.test.ts），因为 parity 校验依赖
// mvp/ 仓作为目标项目，属于消费侧关注点，不应耦合在 skill 源仓内。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { loadRules, type DeclarativeRule } from '../engine/src/loader.js';

const RULES_DIR = join(process.cwd(), 'kernel', 'rules');

function walkYaml(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walkYaml(p, acc);
    } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
      acc.push(p);
    }
  }
  return acc;
}

describe('规则集 schema 一致性', () => {
  it('kernel/rules 下所有 YAML 可解析且符合 schema 必填字段', () => {
    const files = walkYaml(RULES_DIR);
    expect(files.length, '应至少有一个规则文件').toBeGreaterThan(0);

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const parsed = parseYaml(content) as { rules?: unknown };
      expect(parsed, `${file}: YAML 解析结果非对象`).toBeTypeOf('object');
      expect(Array.isArray(parsed.rules), `${file}: 顶层缺 rules 数组`).toBe(true);

      for (const rule of parsed.rules as DeclarativeRule[]) {
        // schema required: id / title / severity / applies_to / check / rationale_ref
        expect(rule.id, `${file}: 缺 id`).toBeTypeOf('string');
        expect(rule.id.length, `${file}: id 为空`).toBeGreaterThan(0);
        expect(rule.title, `${file} (${rule.id}): 缺 title`).toBeTypeOf('string');
        expect(['error', 'warning', 'info'], `${file} (${rule.id}): severity 非法`).toContain(rule.severity);
        expect(rule.applies_to, `${file} (${rule.id}): 缺 applies_to`).toBeTypeOf('object');
        expect(Array.isArray(rule.applies_to.file_patterns), `${file} (${rule.id}): file_patterns 非数组`).toBe(true);
        expect(rule.check, `${file} (${rule.id}): 缺 check`).toBeTypeOf('object');
        expect(
          ['regex', 'ast', 'import-graph', 'structure', 'manual'],
          `${file} (${rule.id}): check.kind 非法`,
        ).toContain(rule.check.kind);
        expect(rule.rationale_ref, `${file} (${rule.id}): 缺 rationale_ref`).toBeTypeOf('string');
      }
    }
  });

  it('规则 ID 唯一（无冲突）', () => {
    const result = loadRules(RULES_DIR);
    expect(result.errors, `加载错误:\n${result.errors.join('\n')}`).toEqual([]);

    const ids = result.rules.map((r) => r.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `重复规则 ID: ${dupes.join(', ')}`).toEqual([]);
  });

  it('规则 ID 符合命名模式 ^[A-Z]+-\\d+[a-z]?$', () => {
    const result = loadRules(RULES_DIR);
    expect(result.errors).toEqual([]);

    const idPattern = /^[A-Z]+-\d+[a-z]?$/;
    for (const rule of result.rules) {
      expect(rule.id, `ID "${rule.id}" 不符合命名模式`).toMatch(idPattern);
    }
  });
});
