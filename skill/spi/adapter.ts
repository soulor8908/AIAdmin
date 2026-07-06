// spi/adapter.ts —— 适配器 SPI 契约
// P0-8 产出：定义所有适配器须实现的接口，使核心引擎与具体技术栈解耦。
//
// 设计原则：
// - 接口最小化：只声明"核心必须知道什么"，不约束"适配器怎么实现"
// - 双向稳定：核心升级不破坏既有适配器；适配器新增能力不强制核心感知
// - 检测优先：所有方法返回带置信度的结果，避免单信号误判

// ============================================================================
// 公共类型
// ============================================================================

/**
 * 技术栈标识符，作为适配器注册键。
 * 命名约定：`<ecosystem>:<framework>:<variant>`，如 `node:fastify:ts` / `jvm:spring-boot:java`。
 */
export type StackId = string;

/**
 * 适配器能力声明。适配器可选择性实现部分能力（如仅做契约渲染不做架构生成）。
 * 核心引擎通过 capabilities 决定是否调用某方法。
 */
export interface AdapterCapabilities {
  detectProject?: boolean;
  renderContract?: boolean;
  renderArchitecture?: boolean;
  runRuleChecks?: boolean;
  generateCiConfig?: boolean;
  renderRolePrompts?: boolean;
}

/**
 * 置信度评分（0-1）。多信号融合时取加权平均。
 * < 0.5 视为弱信号，仅供 advisory；>= 0.7 视为强信号可作 blocking 判据。
 */
export type Confidence = number;

/**
 * 文件写入指令。`is_new` 决定是新建还是覆盖（覆盖前需备份）。
 */
export interface WriteOp {
  path: string;
  content: string;
  is_new: boolean;
  reason: string;
}

// ============================================================================
// P0-8.1 项目探测 SPI
// ============================================================================

export interface ProjectProfile {
  /** 主语言，如 'typescript' / 'java' / 'python' */
  language: string;
  /** 后端框架，如 'fastify' / 'express' / 'spring-boot' / 'fastapi' / null */
  backend_framework: string | null;
  /** 前端框架，如 'react' / 'vue3' / 'angular' / null */
  frontend_framework: string | null;
  /** 数据库，如 'postgresql' / 'mysql' / 'sqlite' / null */
  database: string | null;
  /** ORM / 数据访问层，如 'prisma' / 'mybatis' / 'sqlalchemy' / null */
  orm: string | null;
  /** 契约库，如 'zod' / 'pydantic' / 'json-schema' / null */
  contract_lib: string | null;
  /** 测试框架，如 'vitest' / 'junit' / 'pytest' / null */
  test_runner: string | null;
  /** CI 平台，如 'github-actions' / 'gitlab-ci' / null */
  ci_platform: string | null;
  /** 整体置信度 */
  confidence: Confidence;
  /** 各信号原始证据（路径 + 命中内容），供 Reviewer 审计 */
  signals: Array<{ path: string; matched: string; weight: number }>;
}

export interface DetectProjectSpi {
  /** 探测项目根目录，返回带置信度的画像。无法识别返回 null。 */
  detectProject(rootDir: string): Promise<ProjectProfile | null>;
}

// ============================================================================
// P0-8.2 契约渲染 SPI
// ============================================================================

/**
 * 契约元模型：技术栈无关的字段定义。
 * 适配器据此渲染为具体语言的 schema（Zod / Pydantic / JSON Schema）。
 */
export interface ContractFieldMeta {
  name: string;
  /** 抽象类型，与语言无关：'string' / 'number' / 'boolean' / 'uuid' / 'datetime' / 'email' / 'enum' / 'array' / 'object' / 'nullable' */
  type: string;
  /** enum 类型的可选值 */
  enum_values?: string[];
  /** 数组元素类型 */
  items?: ContractFieldMeta;
  /** 对象字段子集 */
  properties?: ContractFieldMeta[];
  /** 是否可选 */
  optional?: boolean;
  /** 是否可空 */
  nullable?: boolean;
  /** 字符串最小长度 */
  min?: number;
  /** 字符串最大长度 */
  max?: number;
  /** 数字最小值 */
  min_value?: number;
  /** 数字最大值 */
  max_value?: number;
  /** 语义标签：PII / 输出态 / 存储态（password_hash 等） */
  semantic_tags?: Array<'pii' | 'output' | 'storage' | 'immutable'>;
  /** 是否严格模式（拒绝多余字段，对应 Zod .strict() / Pydantic extra='forbid'） */
  strict?: boolean;
  /** 默认值 */
  default?: unknown;
  /** 语言特有标注（如 Pydantic 的 Field(default_factory=...)） */
  language_hints?: Record<string, unknown>;
  /** 文档说明 */
  description?: string;
}

/**
 * 契约元模型：一个 schema 定义。
 */
export interface ContractSchemaMeta {
  /** schema 名称（语言无关），如 'user' / 'createUserInput' / 'errorCode' */
  name: string;
  /** schema 类型：'object' / 'enum' / 'union' / 'array' */
  kind: 'object' | 'enum' | 'union' | 'array';
  /** object 类型的字段 */
  fields?: ContractFieldMeta[];
  /** enum 类型的值 */
  enum_values?: string[];
  /** union 类型的成员 schema 名 */
  union_members?: string[];
  /** 是否输出态 schema（影响 SEC-003a 检查） */
  is_output?: boolean;
  /** 是否存储态 schema（含 password_hash 等敏感字段） */
  is_storage?: boolean;
  /** 派生关系：本 schema 派生自另一 schema */
  extends?: string;
  /** 是否严格模式（拒绝多余字段，对应 Zod .strict() / Pydantic extra='forbid'） */
  strict?: boolean;
  /** 文档说明 */
  description?: string;
  /** 关联的规则 ID（用于反向追溯） */
  related_rules?: string[];
}

export interface RenderContractInput {
  /** 全部 schema 元模型（含依赖引用） */
  schemas: ContractSchemaMeta[];
  /** 目标技术栈 ID */
  stack_id: StackId;
  /** 输出目录 */
  out_dir: string;
  /** 是否生成类型派生（如 TS 的 z.infer / Java 的 record） */
  include_type_derivation?: boolean;
}

export interface RenderContractResult {
  /** 写入操作清单（供 dry-run / 回滚） */
  writes: WriteOp[];
  /** 渲染置信度（类型映射缺失时降低） */
  confidence: Confidence;
  /** 未覆盖的字段类型（需人工补全） */
  unsupported_types: string[];
}

export interface RenderContractSpi {
  renderContract(input: RenderContractInput): Promise<RenderContractResult>;
}

// ============================================================================
// P0-8.3 架构渲染 SPI
// ============================================================================

export interface RenderArchitectureInput {
  stack_id: StackId;
  /** 业务域清单（用于生成示例 router/service/repository） */
  domains: string[];
  out_dir: string;
}

export interface RenderArchitectureSpi {
  renderArchitecture(input: RenderArchitectureInput): Promise<{ writes: WriteOp[] }>;
}

// ============================================================================
// P0-8.4 规则检查 SPI（plugin）
// ============================================================================

/**
 * 单条规则检查结果。
 */
export interface RuleFinding {
  /** 规则 ID，如 'ARCH-001' / 'SEC-002' */
  rule_id: string;
  /** 违规文件相对路径 */
  file: string;
  /** 行号（1-based，0 表示文件级） */
  line: number;
  /** 严重级别：'error' 阻断 / 'warning' 建议 / 'info' 审计 */
  severity: 'error' | 'warning' | 'info';
  /** 人类可读说明 */
  message: string;
  /** 修复提示（可选） */
  fix_hint?: string;
}

/**
 * 规则检查 plugin SPI。语言特化（TS/Java/Python）各实现一份。
 * 核心 engine 加载声明式规则 + 调用对应 plugin 执行检查。
 */
export interface RuleCheckPlugin {
  /** plugin 标识，须与适配器 stack_id 关联 */
  id: string;
  /** 适用的规则 ID 清单（来自声明式规则集） */
  supported_rules: string[];
  /** 执行检查，返回所有 finding */
  check(input: RuleCheckInput): Promise<RuleFinding[]>;
}

export interface RuleCheckInput {
  /** 项目根目录 */
  root_dir: string;
  /** 须检查的规则 ID 清单（已按声明式规则集过滤） */
  rule_ids: string[];
  /** 适用扫描的文件清单（核心已按 applies_to 预过滤） */
  files: string[];
  /** 项目画像（detectProject 产出） */
  profile: ProjectProfile;
}

// ============================================================================
// P0-8.5 CI 配置生成 SPI
// ============================================================================

export interface GenerateCiConfigInput {
  stack_id: StackId;
  ci_platform: 'github-actions' | 'gitlab-ci';
  /** 须包含的 job：'typecheck' / 'lint:rules' / 'test' / 'contract-drift' / 'e2e' */
  jobs: string[];
  out_dir: string;
}

export interface GenerateCiConfigSpi {
  generateCiConfig(input: GenerateCiConfigInput): Promise<{ writes: WriteOp[] }>;
}

// ============================================================================
// P0-8.6 角色提示词渲染 SPI
// ============================================================================

export interface RenderRolePromptsInput {
  /** 须渲染的角色：'orchestrator' / 'ba' / 'tech-lead' / 'test-writer' / 'impl-writer' / 'reviewer' */
  roles: string[];
  /** 技术栈变量（注入到模板占位符） */
  variables: Record<string, string>;
  out_dir: string;
}

export interface RenderRolePromptsSpi {
  renderRolePrompts(input: RenderRolePromptsInput): Promise<{ writes: WriteOp[] }>;
}

// ============================================================================
// P0-8.7 适配器主接口（聚合所有能力）
// ============================================================================

/**
 * 适配器主接口。一个适配器可选择性实现部分能力（通过 capabilities 声明）。
 * 适配器加载器据此构造适配器实例并注入核心引擎。
 */
export interface Adapter {
  /** 技术栈标识 */
  stack_id: StackId;
  /** 适配器版本 */
  version: string;
  /** 能力声明 */
  capabilities: AdapterCapabilities;
  /** 探测（若 capabilities.detectProject = true） */
  detectProject?: DetectProjectSpi['detectProject'];
  /** 契约渲染（若 capabilities.renderContract = true） */
  renderContract?: RenderContractSpi['renderContract'];
  /** 架构渲染（若 capabilities.renderArchitecture = true） */
  renderArchitecture?: RenderArchitectureSpi['renderArchitecture'];
  /** 规则检查 plugin（若 capabilities.runRuleChecks = true） */
  rule_check_plugin?: RuleCheckPlugin;
  /** CI 配置生成（若 capabilities.generateCiConfig = true） */
  generateCiConfig?: GenerateCiConfigSpi['generateCiConfig'];
  /** 角色提示词渲染（若 capabilities.renderRolePrompts = true） */
  renderRolePrompts?: RenderRolePromptsSpi['renderRolePrompts'];
}
