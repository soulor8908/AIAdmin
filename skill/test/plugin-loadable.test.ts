// test/plugin-loadable.test.ts —— DoD #3：规则引擎在不修改核心的前提下能加载外部 plugin
//
// 验证：
// - 内置 TS plugin 可正常注册并执行
// - 外部自定义 plugin（test 内构造）可注册并执行，不修改 engine 核心
// - META-004 反向缺口校验生效（plugin 声明不存在的规则 ID 会被报错）

import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../engine/src/engine.js';
import { typescriptPlugin } from '../engine/src/plugins/typescript.js';
import type { RuleCheckPlugin, RuleFinding, ProjectProfile } from '../spi/adapter.js';

const MVP_ROOT = join(process.cwd(), '..', 'mvp');

function join(...parts: string[]): string {
  // 简化 import（避免与 node:path 冲突）
  return parts.join('/').replace(/\/+/g, '/');
}

const stubProfile: ProjectProfile = {
  language: 'typescript',
  backend_framework: 'fastify',
  frontend_framework: 'react',
  database: 'sqlite',
  orm: 'raw-sql',
  contract_lib: 'zod',
  test_runner: 'vitest',
  ci_platform: 'github-actions',
  confidence: 0.9,
  signals: [],
};

describe('DoD #3: 规则引擎可加载外部 plugin', () => {
  it('内置 TS plugin 注册成功', () => {
    const engine = new RuleEngine({
      rootDir: MVP_ROOT,
      profile: stubProfile,
      rulesDir: join(process.cwd(), 'kernel', 'rules'),
    });
    expect(() => engine.registerPlugin(typescriptPlugin)).not.toThrow();
  });

  it('外部自定义 plugin 可注册并执行（不修改 engine 核心）', async () => {
    // 构造一个 mock plugin，模拟"扫描到 forbidden eval() 调用"
    const mockPlugin: RuleCheckPlugin = {
      id: 'mock-external',
      supported_rules: ['CODE-003'],  // 与既有规则 ID 重叠，由 mock 接管
      async check(input) {
        const findings: RuleFinding[] = [];
        // 简化：返回一个 mock finding
        findings.push({
          rule_id: 'CODE-003',
          file: 'mock-file.ts',
          line: 42,
          severity: 'error',
          message: 'mock plugin: 发现 eval() 调用',
        });
        return findings;
      },
    };

    const engine = new RuleEngine({
      rootDir: MVP_ROOT,
      profile: stubProfile,
      rulesDir: join(process.cwd(), 'kernel', 'rules'),
      ruleIds: ['CODE-003'],  // 只跑这条规则，加速
      advisoryMode: true,  // advisory 模式，不阻断
    });
    engine.registerPlugin(mockPlugin);

    const result = await engine.run();
    // mock plugin 产出的 finding 应在结果中
    const mockFindings = result.findings.filter(
      (f) => f.rule_id === 'CODE-003' && f.message.includes('mock plugin'),
    );
    expect(mockFindings.length).toBeGreaterThan(0);
  });

  it('META-004 反向缺口校验：plugin 声明不存在的规则 ID 会被报错', async () => {
    const invalidPlugin: RuleCheckPlugin = {
      id: 'invalid-plugin',
      supported_rules: ['NONEXISTENT-RULE-999'],  // 规则集里没这条
      async check() {
        return [];
      },
    };

    const engine = new RuleEngine({
      rootDir: MVP_ROOT,
      profile: stubProfile,
      rulesDir: join(process.cwd(), 'kernel', 'rules'),
      advisoryMode: true,
    });
    engine.registerPlugin(invalidPlugin);

    const result = await engine.run();
    // META-004 应报反向缺口
    expect(result.meta004_violations.length).toBeGreaterThan(0);
    expect(result.meta004_violations.some((v) => v.includes('NONEXISTENT-RULE-999'))).toBe(true);
  });

  it('同 ID plugin 重复注册抛错（防误覆盖）', () => {
    const engine = new RuleEngine({
      rootDir: MVP_ROOT,
      profile: stubProfile,
      rulesDir: join(process.cwd(), 'kernel', 'rules'),
    });
    engine.registerPlugin(typescriptPlugin);
    expect(() => engine.registerPlugin(typescriptPlugin)).toThrow(/plugin 已注册/);
  });
});
