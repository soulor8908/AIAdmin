// skill-pkg/composer.ts —— P3-4 Skill 组合机制
// 多 skill 协同：规则合并 + 模板覆盖优先级 + 契约引用 + 命名空间隔离。
//
// 设计：
// - 规则 ID 命名空间：@core/user-mgmt 的 SEC-001 → 全局键 @core/user-mgmt/SEC-001
// - 模板覆盖：依据 overrides.templates 声明，未声明则禁止覆盖（隐式覆盖 = error）
// - 规则覆盖：依据 overrides.rules 声明（replace / extend / disable）
// - 依赖解析：depends_on 须全部已安装，否则 error
// - 冲突检测：conflicts_with 中的 skill 不可共存
//
// 用法：
//   const composer = new SkillComposer(registry);
//   const composed = composer.compose(['@core/user-mgmt', '@core/audit-log']);
//   if (composed.errors.length > 0) { /* 阻断 */ }
//   composed.rules       // 合并后的规则清单（含命名空间键）
//   composed.templates   // 合并后的模板清单（含覆盖优先级）
//   composed.contracts   // 合并后的契约元模型

import type { LoadedSkill, SkillManifest } from './types.js';
import type { LocalRegistry } from '../registry/registry.js';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

/**
 * 合并后的规则（命名空间隔离后）。
 */
export interface ComposedRule {
  /** 全局键：@<ns>/<skill-name>/<RULE-ID>，如 '@core/user-mgmt/USER-001' */
  namespaced_id: string;
  /** 原始规则 ID（同 skill 内唯一） */
  rule_id: string;
  /** 来源 skill name */
  source_skill: string;
  /** 规则标题 */
  title: string;
  /** 严重级别 */
  severity: string;
  /** 规则原始内容（YAML 解析后） */
  raw: Record<string, unknown>;
  /** 覆盖策略：'original'（原样）/ 'replaced'（被替换）/ 'extended'（被扩展）/ 'disabled'（被禁用） */
  override_strategy: 'original' | 'replaced' | 'extended' | 'disabled';
  /** 被哪个 skill 覆盖（如有） */
  overridden_by?: string;
}

export interface ComposedTemplate {
  /** 模板文件名 */
  filename: string;
  /** 来源 skill name */
  source_skill: string;
  /** 模板内容 */
  content: string;
  /** 覆盖策略：'original' / 'replaced' / 'patched' */
  override_strategy: 'original' | 'replaced' | 'patched';
  overridden_by?: string;
}

export interface ComposedContract {
  /** schema name（同 skill 内唯一） */
  name: string;
  /** 全局键：@<ns>/<skill-name>/<name> */
  namespaced_name: string;
  source_skill: string;
  raw: Record<string, unknown>;
}

export interface CompositionResult {
  /** 请求组合的 skill 名清单 */
  requested: string[];
  /** 实际加载的 skill（已通过依赖解析） */
  resolved: LoadedSkill[];
  /** 合并后的规则（已应用 overrides + 命名空间） */
  rules: ComposedRule[];
  /** 合并后的模板（已应用覆盖优先级） */
  templates: ComposedTemplate[];
  /** 合并后的契约元模型 */
  contracts: ComposedContract[];
  /** 错误清单（非空 = 阻断） */
  errors: string[];
  /** 警告清单（不阻断） */
  warnings: string[];
}

export class SkillComposer {
  constructor(private readonly registry: LocalRegistry) {}

  /**
   * 组合多个 skill，返回合并后的规则 / 模板 / 契约。
   * @param skillNames 须组合的 skill 名清单（须已安装）
   */
  compose(skillNames: string[]): CompositionResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const resolved: LoadedSkill[] = [];

    // 1. 加载所有 skill
    for (const name of skillNames) {
      const loaded = this.registry.getInstalled(name);
      if (!loaded) {
        errors.push(`skill 未安装：${name}（请先 ai-spec skill add ${name}）`);
        continue;
      }
      resolved.push(loaded);
    }
    if (errors.length > 0) {
      return { requested: skillNames, resolved, rules: [], templates: [], contracts: [], errors, warnings };
    }

    // 2. 依赖检查：depends_on 须全部已安装或为 builtin
    // 注意：核心 skill（@core/spec-first 等）作为 builtin 隐式可用，无须显式安装
    const installedNames = new Set(this.registry.listInstalledLoaded().map((s) => s.manifest.package.name));
    const builtinNames = new Set(this.registry.list().filter((e) => e.source === 'builtin').map((e) => e.name));
    for (const skill of resolved) {
      for (const dep of skill.manifest.dependencies.depends_on) {
        if (!installedNames.has(dep.name) && !builtinNames.has(dep.name)) {
          errors.push(`skill ${skill.manifest.package.name} 依赖 ${dep.name} 未安装`);
        }
      }
    }

    // 3. 冲突检查：conflicts_with 不可共存
    const requestedSet = new Set(skillNames);
    for (const skill of resolved) {
      for (const conflict of skill.manifest.dependencies.conflicts_with) {
        if (requestedSet.has(conflict)) {
          errors.push(`skill ${skill.manifest.package.name} 与 ${conflict} 冲突（不可共存）`);
        }
      }
    }

    if (errors.length > 0) {
      return { requested: skillNames, resolved, rules: [], templates: [], contracts: [], errors, warnings };
    }

    // 4. 合并规则（应用命名空间 + overrides）
    const rules = this.mergeRules(resolved, errors, warnings);

    // 5. 合并模板（应用覆盖优先级）
    const templates = this.mergeTemplates(resolved, errors, warnings);

    // 6. 合并契约
    const contracts = this.mergeContracts(resolved);

    return { requested: skillNames, resolved, rules, templates, contracts, errors, warnings };
  }

  // ============ 规则合并 ============

  private mergeRules(
    skills: LoadedSkill[],
    errors: string[],
    warnings: string[],
  ): ComposedRule[] {
    const composed: ComposedRule[] = [];
    // 全局规则 ID 索引：原始 ID → 已注册的 skill（用于检测 overrides 目标是否存在）
    const rulesByOriginalId = new Map<string, { skill: string; rule: ComposedRule }>();

    // 第一遍：收集所有规则
    for (const skill of skills) {
      for (const ruleFile of skill.rule_files) {
        let doc: { rules?: Array<Record<string, unknown>> };
        try {
          doc = parseYaml(readFileSync(ruleFile, 'utf8')) as { rules?: Array<Record<string, unknown>> };
        } catch (e) {
          errors.push(`规则文件解析失败 ${ruleFile}：${(e as Error).message}`);
          continue;
        }
        for (const rule of doc.rules ?? []) {
          const ruleId = rule.id as string;
          if (!ruleId) {
            warnings.push(`${skill.manifest.package.name} 含无 id 规则，已跳过`);
            continue;
          }
          const namespacedId = `${skill.manifest.package.name}/${ruleId}`;
          const composedRule: ComposedRule = {
            namespaced_id: namespacedId,
            rule_id: ruleId,
            source_skill: skill.manifest.package.name,
            title: (rule.title as string) ?? '',
            severity: (rule.severity as string) ?? 'warning',
            raw: rule,
            override_strategy: 'original',
          };
          composed.push(composedRule);
          // 记录原始 ID 索引（用于 overrides 目标查找）
          if (!rulesByOriginalId.has(ruleId)) {
            rulesByOriginalId.set(ruleId, { skill: skill.manifest.package.name, rule: composedRule });
          }
        }
      }
    }

    // 第二遍：应用 overrides
    for (const skill of skills) {
      for (const [ruleId, strategy] of Object.entries(skill.manifest.overrides.rules)) {
        const target = rulesByOriginalId.get(ruleId);
        if (!target) {
          warnings.push(
            `${skill.manifest.package.name} overrides.rules ${ruleId} 未找到目标规则（无效覆盖声明）`,
          );
          continue;
        }
        switch (strategy) {
          case 'disable':
            target.rule.override_strategy = 'disabled';
            target.rule.overridden_by = skill.manifest.package.name;
            break;
          case 'replace':
            target.rule.override_strategy = 'replaced';
            target.rule.overridden_by = skill.manifest.package.name;
            break;
          case 'extend':
            target.rule.override_strategy = 'extended';
            target.rule.overridden_by = skill.manifest.package.name;
            break;
        }
      }
    }

    // 过滤掉 disabled
    return composed.filter((r) => r.override_strategy !== 'disabled');
  }

  // ============ 模板合并 ============

  private mergeTemplates(
    skills: LoadedSkill[],
    errors: string[],
    warnings: string[],
  ): ComposedTemplate[] {
    const composed: ComposedTemplate[] = [];
    // 文件名 → 当前拥有者（用于检测隐式覆盖）
    const ownerByFilename = new Map<string, ComposedTemplate>();

    for (const skill of skills) {
      for (const tplFile of skill.template_files) {
        const filename = tplFile.split('/').pop() ?? tplFile;
        let content = '';
        try {
          content = readFileSync(tplFile, 'utf8');
        } catch (e) {
          warnings.push(`模板读取失败 ${tplFile}：${(e as Error).message}`);
          continue;
        }

        // 检查是否已有同名模板
        const existing = ownerByFilename.get(filename);
        if (existing) {
          // 检查覆盖声明
          const declared = skills.find(
            (s) => s.manifest.package.name === skill.manifest.package.name,
          )?.manifest.overrides.templates[filename];
          if (!declared) {
            errors.push(
              `隐式模板覆盖：${skill.manifest.package.name} 的 ${filename} 与 ${existing.source_skill} 同名，但未在 overrides.templates 声明`,
            );
            continue;
          }
          // 替换
          existing.override_strategy = declared === 'replace' ? 'replaced' : 'patched';
          existing.overridden_by = skill.manifest.package.name;
          existing.content = content;
          existing.source_skill = skill.manifest.package.name;
        } else {
          const tpl: ComposedTemplate = {
            filename,
            source_skill: skill.manifest.package.name,
            content,
            override_strategy: 'original',
          };
          composed.push(tpl);
          ownerByFilename.set(filename, tpl);
        }
      }
    }

    return composed;
  }

  // ============ 契约合并 ============

  private mergeContracts(skills: LoadedSkill[]): ComposedContract[] {
    const composed: ComposedContract[] = [];
    for (const skill of skills) {
      for (const contractFile of skill.contract_files) {
        let doc: { schemas?: Array<Record<string, unknown>> };
        try {
          doc = parseYaml(readFileSync(contractFile, 'utf8')) as {
            schemas?: Array<Record<string, unknown>>;
          };
        } catch {
          continue;
        }
        for (const schema of doc.schemas ?? []) {
          const name = schema.name as string;
          if (!name) continue;
          composed.push({
            name,
            namespaced_name: `${skill.manifest.package.name}/${name}`,
            source_skill: skill.manifest.package.name,
            raw: schema,
          });
        }
      }
    }
    return composed;
  }
}

// 重新导出常用类型
export type { LoadedSkill, SkillManifest };
