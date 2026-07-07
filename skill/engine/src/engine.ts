// engine/src/engine.ts —— 规则引擎核心
// P0-4 产出：可插拔规则引擎核心。
//
// 设计原则：
// - 核心只调度，不实现具体检查（具体检查由 plugin 完成）
// - 声明式规则 + plugin 双轨：声明描述意图，plugin 实现检查
// - 核心 + 内置 plugin 完成所有非 plugin_required 的检查（regex / structure 类）
// - 外部 plugin 通过 registerPlugin 注册，不修改核心代码
//
// 与实验期 check-rules.mjs 的关系：
// - engine 是 check-rules.mjs 的重构版本（核心/plugin 分离）
// - check-rules.mjs 的 13 项 enforcement 在 engine 下由"核心内置 regex 检查 + TS plugin"共同产出等价 verdict

import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  loadRules,
  type DeclarativeRule,
} from './loader.js';
import type {
  RuleFinding,
  RuleCheckPlugin,
  RuleCheckInput,
  ProjectProfile,
} from '../../spi/adapter.js';
import { collectFiles } from './glob.js';
import { BuiltinRegexPlugin } from './builtin-regex-plugin.js';

export interface EngineOptions {
  /** 规则目录（默认 'kernel/rules'） */
  rulesDir?: string;
  /** 项目根目录 */
  rootDir: string;
  /** 项目画像（detectProject 产出，决定 stacks 过滤） */
  profile: ProjectProfile;
  /** 只跑指定规则 ID（缺省跑全部） */
  ruleIds?: string[];
  /** 仅 advisory 模式（不阻断，只输出 finding） */
  advisoryMode?: boolean;
}

export interface EngineResult {
  findings: RuleFinding[];
  /** 已执行的规则 ID 清单 */
  executed_rules: string[];
  /** 已加载的规则总数 */
  loaded_rules: number;
  /** META-003 声明漂移清单 */
  meta003_violations: string[];
  /** META-004 反向缺口清单 */
  meta004_violations: string[];
  /** 退出码：0=全绿 / 1=有 error 级 finding */
  exit_code: number;
}

/**
 * 规则引擎核心。
 *
 * 用法：
 * ```ts
 * const engine = new RuleEngine({ rootDir: '/path/to/project', profile });
 * const result = await engine.run();
 * if (result.exit_code !== 0) process.exit(1);
 * ```
 */
export class RuleEngine {
  private plugins = new Map<string, RuleCheckPlugin>();
  private rules: DeclarativeRule[] = [];
  private loadErrors: string[] = [];
  private loadWarnings: string[] = [];
  private options: Required<EngineOptions>;
  private builtinRegistered = false;

  constructor(options: EngineOptions) {
    this.options = {
      rulesDir: options.rulesDir ?? defaultRulesDir(),
      rootDir: options.rootDir,
      profile: options.profile,
      ruleIds: options.ruleIds ?? [],
      advisoryMode: options.advisoryMode ?? false,
    };
  }

  /**
   * 加载规则后自动注册内置 plugin（builtin-regex）。
   * 问题 1 修复：核心不再直接执行 regex 检查，而是注册 BuiltinRegexPlugin 处理。
   */
  private ensureBuiltinPlugins(): void {
    if (!this.builtinRegistered) {
      // builtin-regex plugin 处理 regex/structure 类、非 plugin_required 的规则
      const regexPlugin = new BuiltinRegexPlugin(this.rules);
      if (!this.plugins.has(regexPlugin.id)) {
        this.plugins.set(regexPlugin.id, regexPlugin);
      }
      this.builtinRegistered = true;
    }
  }

  /**
   * 注册外部 plugin。允许在不修改核心代码的前提下扩展检查能力。
   * 同一 ID 重复注册抛错。
   */
  registerPlugin(plugin: RuleCheckPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`plugin 已注册: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * 执行所有规则检查。
   */
  async run(): Promise<EngineResult> {
    // 1. 加载声明式规则
    if (this.rules.length === 0) {
      const loadResult = loadRules(this.options.rulesDir);
      this.rules = loadResult.rules;
      this.loadErrors = loadResult.errors;
      this.loadWarnings = loadResult.warnings;
    }

    // 1.5 注册内置 plugin（问题 1：核心不直接执行检查）
    this.ensureBuiltinPlugins();

    const findings: RuleFinding[] = [];
    const executed = new Set<string>();

    // 加载错误转化为 finding
    for (const err of this.loadErrors) {
      findings.push({
        rule_id: 'LOADER',
        file: '',
        line: 0,
        severity: 'error',
        message: err,
      });
    }

    // 2. META-003/004 双向绑定校验（声明 ↔ plugin）
    const meta003 = this.checkMeta003();
    const meta004 = this.checkMeta004();
    for (const v of meta003) {
      findings.push({ rule_id: 'META-003', file: '', line: 0, severity: 'error', message: v });
    }
    for (const v of meta004) {
      findings.push({ rule_id: 'META-004', file: '', line: 0, severity: 'error', message: v });
    }

    // 3. 按规则逐条执行
    const targetRules = this.options.ruleIds.length
      ? this.rules.filter((r) => this.options.ruleIds!.includes(r.id))
      : this.rules;

    for (const rule of targetRules) {
      executed.add(rule.id);

      // 跳过 META-001（由 loader 自身校验，避免循环）
      if (rule.id === 'META-001') continue;
      // META-003/004 已在 step 2 处理
      if (rule.id === 'META-003' || rule.id === 'META-004') continue;

      const ruleFindings = await this.executeRule(rule);
      findings.push(...ruleFindings);
    }

    // 4. 计算退出码
    const hasError = findings.some((f) => f.severity === 'error');
    const exit_code = this.options.advisoryMode ? 0 : hasError ? 1 : 0;

    return {
      findings,
      executed_rules: [...executed].sort(),
      loaded_rules: this.rules.length,
      meta003_violations: meta003,
      meta004_violations: meta004,
      exit_code,
    };
  }

  /**
   * 执行单条规则。
   * 问题 1 修复：核心只调度 plugin，不直接执行检查。
   *
   * 分派逻辑：
   * - manual kind：跳过机器检查（由 Reviewer 流程校验）
   * - 其他 kind：全部交给 plugin 处理
   *   - builtin-regex plugin 处理 regex/structure 类（非 plugin_required）
   *   - 外部 plugin（如 typescript）处理 plugin_required 类
   *   - 若无 plugin 注册且 plugin_required=true → 报缺失 warning
   */
  private async executeRule(rule: DeclarativeRule): Promise<RuleFinding[]> {
    if (rule.check.kind === 'manual') {
      return [
        {
          rule_id: rule.id,
          file: '',
          line: 0,
          severity: 'info',
          message: `${rule.id} (${rule.title}) 须 ${rule.check.manual_checker} 人工校验`,
        },
      ];
    }

    // 文件预过滤（按 applies_to.file_patterns）
    const files = collectFiles(this.options.rootDir, rule.applies_to.file_patterns);

    // 调度已注册 plugin（builtin-regex 或外部 plugin）
    const plugin = this.findPluginForRule(rule.id);
    if (plugin) {
      const input: RuleCheckInput = {
        root_dir: this.options.rootDir,
        rule_ids: [rule.id],
        files,
        profile: this.options.profile,
      };
      return plugin.check(input);
    }

    // 无 plugin 注册：plugin_required=true 则报缺失
    if (rule.check.plugin_required) {
      return [
        {
          rule_id: rule.id,
          file: '',
          line: 0,
          severity: 'warning',
          message: `${rule.id} 需要 plugin 但未注册（该规则将被跳过）`,
        },
      ];
    }

    // 无 plugin 注册且非 plugin_required（仅 import-graph / ast 类，builtin-regex 未接管）
    return [
      {
        rule_id: rule.id,
        file: '',
        line: 0,
        severity: 'info',
        message: `${rule.id} kind=${rule.check.kind} 须 plugin 实现，核心仅记录意图: ${rule.check.expr ?? ''}`,
      },
    ];
  }

  /**
   * META-003：声明漂移校验。
   * 声明式规则集里 check.plugin_required=true 的规则，对应 plugin 必须在 supported_rules 注册该 ID。
   * 注意：builtin-regex plugin 自动接管非 plugin_required 的规则，不在本检查范围。
   */
  private checkMeta003(): string[] {
    const violations: string[] = [];
    for (const rule of this.rules) {
      if (!rule.check.plugin_required) continue;
      const plugin = this.findPluginForRule(rule.id);
      if (!plugin) {
        violations.push(
          `META-003 声明漂移：规则 ${rule.id} 声称 plugin_required=true，但无 plugin 注册 supported_rules 含此 ID`,
        );
      }
    }
    return violations;
  }

  /**
   * META-004：反向缺口校验。
   * plugin.supported_rules 中每个 ID 必须在声明式规则集里有对应规则定义。
   */
  private checkMeta004(): string[] {
    const violations: string[] = [];
    const declaredIds = new Set(this.rules.map((r) => r.id));
    for (const plugin of this.plugins.values()) {
      for (const id of plugin.supported_rules) {
        if (!declaredIds.has(id)) {
          violations.push(
            `META-004 反向缺口：plugin ${plugin.id} 注册了 supported_rules="${id}"，但 kernel/rules 无对应规则定义`,
          );
        }
      }
    }
    return violations;
  }

  /**
   * 查找支持某规则 ID 的 plugin。
   */
  private findPluginForRule(ruleId: string): RuleCheckPlugin | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.supported_rules.includes(ruleId)) return plugin;
    }
    return undefined;
  }
}

function defaultRulesDir(): string {
  // 默认相对 process.cwd() 定位 kernel/rules
  return join(process.cwd(), 'kernel', 'rules');
}
