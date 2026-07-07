// skill-pkg/validator.ts —— P3-1 Skill manifest 验证器
// 验证项：
// - 必填字段非空（name / version / description）
// - name 命名空间格式（@<ns>/<name>）
// - version 语义化版本格式
// - artifacts globs 合法
// - depends_on / conflicts_with / overrides 引用一致
//
// 设计原则：
// - 验证不抛错，返回 errors[] + warnings[]
// - errors 阻断加载；warnings 仅提示
// - 跨 skill 引用一致性在 composer（P3-4）层做，本层只验单 skill 内部一致性

import type { SkillManifest } from './types.js';

export interface SkillValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * 验证单个 Skill manifest 的内部一致性。
 * 跨 skill 的依赖/冲突验证在 composer 层做。
 */
export function validateSkillManifest(manifest: SkillManifest): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { pkg, compat, arts, deps, ovr } = destructure(manifest);

  // 1. 必填字段
  if (!pkg.name) errors.push('[package] name 必填');
  if (!pkg.version) errors.push('[package] version 必填');
  if (!pkg.description) warnings.push('[package] description 为空（建议填写以便 search）');
  if (!pkg.author) warnings.push('[package] author 为空');

  // 2. name 格式：简单名（YAGNI，建议 6）或命名空间形式 @<ns>/<name>
  // 建议 6：当前阶段去掉 @core/ 前缀，直接用 user-mgmt / audit-log
  // 命名空间在 skill 数量 > 20 且确实出现 ID 冲突时再引入
  if (pkg.name && !/^[a-z][a-z0-9-]*$/.test(pkg.name) && !/^@[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(pkg.name)) {
    errors.push(
      `[package] name "${pkg.name}" 不合法（须为简单名 user-mgmt 或命名空间 @ns/name，全小写 + 连字符）`,
    );
  }

  // 3. version 语义化
  if (pkg.version && !isValidSemver(pkg.version)) {
    warnings.push(`[package] version "${pkg.version}" 不符合语义化版本格式（建议 X.Y.Z）`);
  }

  // 4. category 取值
  if (!['core', 'domain', 'community'].includes(pkg.category)) {
    errors.push(`[package] category "${pkg.category}" 不合法（须 core|domain|community）`);
  }

  // 5. artifacts globs 合法性
  for (const g of [...arts.rules, ...arts.templates, ...arts.role_prompts]) {
    if (!isValidGlob(g)) {
      warnings.push(`[artifacts] glob "${g}" 格式异常（建议 dir/*.ext）`);
    }
  }

  // 6. depends_on 引用合法（建议 6：允许简单名，不再强制命名空间）
  for (const dep of deps.depends_on) {
    if (!dep.version_range) {
      warnings.push(`[dependencies] depends_on ${dep.name} 缺少 version_range`);
    }
  }

  // 7. conflicts_with 不能引用自身
  if (deps.conflicts_with.some((c) => c === pkg.name)) {
    errors.push(`[dependencies] conflicts_with 不能包含自身：${pkg.name}`);
  }

  // 8. overrides 规则 ID 格式（前缀 + 编号）
  for (const ruleId of Object.keys(ovr.rules)) {
    if (!/^[A-Z]+-\d+$/.test(ruleId) && !ruleId.includes('/')) {
      warnings.push(`[overrides] rules "${ruleId}" 不是标准规则 ID（<CATEGORY>-<NNN>）`);
    }
  }

  // 9. overrides 策略值合法
  for (const [id, strategy] of Object.entries(ovr.rules)) {
    if (!['replace', 'extend', 'disable'].includes(strategy)) {
      errors.push(`[overrides] rules ${id} 策略 "${strategy}" 不合法（须 replace|extend|disable）`);
    }
  }
  for (const [id, strategy] of Object.entries(ovr.templates)) {
    if (!['replace', 'patch'].includes(strategy)) {
      errors.push(`[overrides] templates ${id} 策略 "${strategy}" 不合法（须 replace|patch）`);
    }
  }

  // 10. supported_stacks 留空是合法的（全栈通用），但 warn 提示
  if (compat.supported_stacks.length === 0) {
    warnings.push('[compatibility] supported_stacks 为空（视为全栈通用，建议显式声明）');
  }

  return { errors, warnings };
}

// ============ 辅助函数 ============

function destructure(manifest: SkillManifest): {
  pkg: SkillManifest['package'];
  compat: SkillManifest['compatibility'];
  arts: SkillManifest['artifacts'];
  deps: SkillManifest['dependencies'];
  ovr: SkillManifest['overrides'];
} {
  return {
    pkg: manifest.package,
    compat: manifest.compatibility,
    arts: manifest.artifacts,
    deps: manifest.dependencies,
    ovr: manifest.overrides,
  };
}

/**
 * 简化版语义化版本检查：X.Y.Z[-pre][+build]
 */
function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(v);
}

/**
 * 简化版 glob 合法性检查：仅支持 dir/*.ext 形式。
 */
function isValidGlob(g: string): boolean {
  if (!g.includes('*')) return true; // 字面路径合法
  // 形如 path/*.ext 或 *.ext
  return /^[a-zA-Z0-9_/-]+\/\*\.[a-zA-Z0-9]+$|^\*\.[a-zA-Z0-9]+$/.test(g);
}
