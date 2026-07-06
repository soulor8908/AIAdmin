// skill-pkg/loader.ts —— P3-1 Skill 包加载器
// 从目录读取 skill.yaml → 解析 → 验证 → 返回 SkillManifest。
//
// 用法：
//   import { loadSkill, discoverSkills } from './loader.js';
//   const result = loadSkill('/path/to/skill-dir');
//   if (result.ok) { /* result.manifest */ }

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import type {
  SkillManifest,
  SkillLoadResult,
  LoadedSkill,
  SkillPackageMeta,
  SkillCompatibility,
  SkillArtifacts,
  SkillDependencies,
  SkillOverrides,
} from './types.js';
import { validateSkillManifest } from './validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** skill.yaml 文件名（也兼容 manifest.yaml） */
const SKILL_MANIFEST_NAMES = ['skill.yaml', 'skill.yml', 'manifest.yaml'];

/**
 * 从目录加载单个 Skill 包。
 * 目录结构期望：
 *   <skill-dir>/
 *     skill.yaml
 *     rules/*.yaml
 *     templates/*.hbs
 *     roles/*.md
 *     adapters/<type>/<id>/...
 *
 * @param skillDir skill 目录绝对路径
 * @returns 加载结果（ok=false 时 errors 含错误清单）
 */
export function loadSkill(skillDir: string): SkillLoadResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 找 manifest 文件
  let manifestPath: string | undefined;
  for (const name of SKILL_MANIFEST_NAMES) {
    const p = join(skillDir, name);
    if (existsSync(p)) {
      manifestPath = p;
      break;
    }
  }
  if (!manifestPath) {
    return {
      ok: false,
      errors: [`未找到 skill.yaml / manifest.yaml（在 ${skillDir}）`],
      warnings,
    };
  }

  // 2. 解析 YAML
  let raw: Record<string, unknown>;
  try {
    raw = parseYaml(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      errors: [`skill.yaml 解析失败：${(e as Error).message}`],
      warnings,
    };
  }

  // 3. 构造 manifest
  const manifest = buildManifest(raw, manifestPath, skillDir);
  if (!manifest) {
    return {
      ok: false,
      errors: [`skill.yaml 结构不合法（缺少必要段或字段类型错误）`],
      warnings,
    };
  }

  // 4. 验证
  const validation = validateSkillManifest(manifest);
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  // 5. 检查产物 glob 实际匹配到文件（warn 不阻断）
  const expanded = expandArtifacts(manifest);
  if (expanded.rule_files.length === 0 && expanded.template_files.length === 0 && expanded.role_prompt_files.length === 0) {
    warnings.push(`skill ${manifest.package.name} 未匹配到任何产物文件（rules/templates/role_prompts 全空）`);
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, manifest, errors, warnings };
}

/**
 * 完整加载 Skill（manifest + 展开产物文件清单）。
 */
export function loadSkillFull(skillDir: string): { loaded?: LoadedSkill; errors: string[]; warnings: string[] } {
  const result = loadSkill(skillDir);
  if (!result.ok || !result.manifest) {
    return { errors: result.errors, warnings: result.warnings };
  }
  const expanded = expandArtifacts(result.manifest);
  return {
    loaded: {
      manifest: result.manifest,
      ...expanded,
    },
    errors: result.errors,
    warnings: result.warnings,
  };
}

/**
 * 扫描某个根目录下所有 skill 子目录，返回加载成功的清单。
 * 例如 discoverSkills('/workspace/skill/skills') 会扫描所有子目录。
 *
 * @param rootDir 含多个 skill 子目录的根目录
 * @returns LoadedSkill 数组（加载失败的会被跳过，warning 收集到 logs）
 */
export function discoverSkills(rootDir: string): { skills: LoadedSkill[]; logs: string[] } {
  const skills: LoadedSkill[] = [];
  const logs: string[] = [];
  if (!existsSync(rootDir)) return { skills, logs };

  const entries = readdirSync(rootDir);
  for (const name of entries) {
    const subDir = join(rootDir, name);
    if (!statSync(subDir).isDirectory()) continue;
    const result = loadSkillFull(subDir);
    if (result.loaded) {
      skills.push(result.loaded);
    } else {
      logs.push(`[skip] ${name}: ${result.errors.join('; ')}`);
    }
    for (const w of result.warnings) logs.push(`[warn] ${name}: ${w}`);
  }
  return { skills, logs };
}

/**
 * 默认内置 skills 根目录（skill/skills/）。
 */
export function defaultBuiltinSkillsDir(): string {
  // loader.ts → skill-pkg/ → skill/ → skills/
  return resolve(__dirname, '..', 'skills');
}

// ============ 内部辅助 ============

function buildManifest(
  raw: Record<string, unknown>,
  manifestPath: string,
  skillDir: string,
): SkillManifest | null {
  const pkg = raw.package as Partial<SkillPackageMeta> | undefined;
  const compat = raw.compatibility as Partial<SkillCompatibility> | undefined;
  const arts = raw.artifacts as Partial<SkillArtifacts> | undefined;
  const deps = raw.dependencies as Partial<SkillDependencies> | undefined;
  const ovr = raw.overrides as Partial<SkillOverrides> | undefined;

  if (!pkg || !pkg.name || !pkg.version) return null;

  return {
    package: {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? '',
      author: pkg.author ?? '',
      license: pkg.license ?? 'MIT',
      homepage: pkg.homepage,
      keywords: pkg.keywords ?? [],
      category: pkg.category ?? 'domain',
    },
    compatibility: {
      requires_kernel_version: compat?.requires_kernel_version ?? '>=0.1.0',
      supported_stacks: compat?.supported_stacks ?? [],
    },
    artifacts: {
      rules: arts?.rules ?? ['rules/*.yaml'],
      templates: arts?.templates ?? ['templates/*.hbs'],
      role_prompts: arts?.role_prompts ?? ['roles/*.md'],
      adapters: arts?.adapters ?? [],
      contracts: arts?.contracts ?? [],
    },
    dependencies: {
      depends_on: deps?.depends_on ?? [],
      conflicts_with: deps?.conflicts_with ?? [],
    },
    overrides: {
      rules: ovr?.rules ?? {},
      templates: ovr?.templates ?? {},
    },
    manifest_path: manifestPath,
    skill_dir: skillDir,
  };
}

/**
 * 展开 artifacts globs → 实际文件清单。
 * 简化版 glob：仅支持 `dir/*.ext` 形式。
 */
function expandArtifacts(manifest: SkillManifest): {
  rule_files: string[];
  template_files: string[];
  role_prompt_files: string[];
  adapter_dirs: string[];
  contract_files: string[];
} {
  return {
    rule_files: expandGlob(manifest.skill_dir, manifest.artifacts.rules),
    template_files: expandGlob(manifest.skill_dir, manifest.artifacts.templates),
    role_prompt_files: expandGlob(manifest.skill_dir, manifest.artifacts.role_prompts),
    adapter_dirs: expandGlob(manifest.skill_dir, manifest.artifacts.adapters),
    contract_files: expandGlob(manifest.skill_dir, manifest.artifacts.contracts),
  };
}

function expandGlob(baseDir: string, patterns: string[]): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      // 字面路径
      const full = join(baseDir, pattern);
      if (existsSync(full)) results.push(full);
      continue;
    }
    // 支持 dir/*.ext 形式
    const m = pattern.match(/^(.*)\/([^/]*\*[^/]*)$/);
    if (!m) continue;
    const subDir = join(baseDir, m[1]);
    if (!existsSync(subDir)) continue;
    const fileRe = globToRegex(m[2]);
    for (const name of readdirSync(subDir)) {
      if (fileRe.test(name)) results.push(join(subDir, name));
    }
  }
  return results;
}

function globToRegex(glob: string): RegExp {
  // 把 *.ext 转成 ^.*\.ext$，支持 * 通配
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// 重新导出常用类型供外部使用
export type { SkillManifest, LoadedSkill };
