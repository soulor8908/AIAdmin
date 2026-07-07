// skill-pkg/types.ts —— P3-1 Skill 包格式类型定义
// 一个 Skill 包 = 命名空间(name) + 版本(version) + 产物(rules/templates/role_prompts/adapters) + 依赖/冲突 + 覆盖声明。
//
// 设计原则：
// - 与 adapter manifest 同源（同一 yaml schema 风格），但 skill 是更大的"方法论包"
// - 命名空间避免规则 ID 冲突：user-mgmt 的 SEC-001 → 全局键 user-mgmt/SEC-001（建议 6：当前阶段用简单名）
// - overrides 显式声明覆盖行为，禁止隐式覆盖（P3-4 双向绑定）

/**
 * Skill 包元信息。
 * 对应 skill.yaml 的 [package] 段。
 */
export interface SkillPackageMeta {
  /** 全局唯一名称，简单名（'user-mgmt'）或命名空间形式（'@ns/name'，建议 6：当前阶段用简单名） */
  name: string;
  /** 语义化版本 */
  version: string;
  /** 一句话描述 */
  description: string;
  /** 作者 / 维护者 */
  author: string;
  /** license 标识 */
  license: string;
  /** 主页 / 仓库 URL（可选） */
  homepage?: string;
  /** 关键词，用于 search */
  keywords?: string[];
  /** Skill 类别：'core'（核心）/ 'domain'（领域）/ 'community'（社区） */
  category: 'core' | 'domain' | 'community';
}

/**
 * 兼容性声明。
 * 对应 skill.yaml 的 [compatibility] 段。
 */
export interface SkillCompatibility {
  /** 依赖的 kernel 最低版本（语义化版本范围） */
  requires_kernel_version: string;
  /** 支持的技术栈 ID 清单（空数组 = 全栈通用） */
  supported_stacks: string[];
}

/**
 * 产物路径声明（glob 相对 skill 目录）。
 * 对应 skill.yaml 的 [artifacts] 段。
 */
export interface SkillArtifacts {
  /** 规则文件 globs，如 ['rules/*.yaml'] */
  rules: string[];
  /** 文档模板 globs，如 ['templates/*.hbs'] */
  templates: string[];
  /** 角色提示词补充 globs，如 ['roles/*.md'] */
  role_prompts: string[];
  /** 适配器目录 globs（可选，skill 可携带适配器） */
  adapters: string[];
  /** 契约元模型 globs（可选，如 ['contracts/*.meta.yaml']） */
  contracts: string[];
}

/**
 * 依赖与冲突声明。
 * 对应 skill.yaml 的 [dependencies] 段。
 */
export interface SkillDependencies {
  /** 依赖的其他 skill，含版本范围 */
  depends_on: Array<{ name: string; version_range: string }>;
  /** 冲突的 skill 名清单（同项目中不可共存） */
  conflicts_with: string[];
}

/**
 * 覆盖声明。
 * 对应 skill.yaml 的 [overrides] 段。
 * P3-4：禁止隐式覆盖，所有覆盖必须在此显式声明。
 */
export interface SkillOverrides {
  /**
   * 规则覆盖：键为规则 ID（如 'SEC-001'），值为覆盖策略。
   * - 'replace'：完全替换原规则
   * - 'extend'：在原规则上追加 applies_to / 修改 severity
   * - 'disable'：禁用原规则
   */
  rules: Record<string, 'replace' | 'extend' | 'disable'>;
  /**
   * 模板覆盖：键为模板文件名（如 'prd.md.hbs'），值为覆盖策略。
   * - 'replace'：替换模板内容
   * - 'patch'：仅替换部分段落（需模板支持）
   */
  templates: Record<string, 'replace' | 'patch'>;
}

/**
 * Skill manifest 完整结构。
 */
export interface SkillManifest {
  package: SkillPackageMeta;
  compatibility: SkillCompatibility;
  artifacts: SkillArtifacts;
  dependencies: SkillDependencies;
  overrides: SkillOverrides;
  /** skill.yaml 文件绝对路径 */
  manifest_path: string;
  /** skill 目录绝对路径 */
  skill_dir: string;
}

/**
 * Skill 加载/验证结果。
 */
export interface SkillLoadResult {
  ok: boolean;
  manifest?: SkillManifest;
  errors: string[];
  warnings: string[];
}

/**
 * 已加载的 Skill 包（manifest + 实际展开的文件清单）。
 */
export interface LoadedSkill {
  manifest: SkillManifest;
  /** 实际匹配到的规则文件（绝对路径） */
  rule_files: string[];
  /** 实际匹配到的模板文件 */
  template_files: string[];
  /** 实际匹配到的角色提示词文件 */
  role_prompt_files: string[];
  /** 实际匹配到的适配器目录 */
  adapter_dirs: string[];
  /** 实际匹配到的契约元模型文件 */
  contract_files: string[];
}

/**
 * Skill 安装状态（Registry 用）。
 */
export interface InstalledSkill {
  name: string;
  version: string;
  installed_at: string;
  /** 安装路径（绝对） */
  install_path: string;
  /** 来源：'builtin'（内置）/ 'local'（本地目录）/ 'remote'（远端，未实现） */
  source: 'builtin' | 'local' | 'remote';
}
