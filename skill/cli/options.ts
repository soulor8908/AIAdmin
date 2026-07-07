// cli/options.ts —— CLI 选项与项目画像
// P1-1 产出：定义交互式 / 非交互式共用选项结构。

/**
 * 技术栈选项枚举（与 Phase 0 适配器 stack_id 对齐）。
 */
export const STACK_OPTIONS = {
  backend: [
    { value: 'fastify-ts', label: 'Fastify + TypeScript', recommended: true },
    { value: 'express-ts', label: 'Express + TypeScript' },
    { value: 'spring-boot', label: 'Spring Boot + Java' },
    { value: 'fastapi', label: 'FastAPI + Python' },
  ],
  db: [
    { value: 'postgresql', label: 'PostgreSQL', recommended: true },
    { value: 'sqlite', label: 'SQLite (开发用)' },
    { value: 'mysql', label: 'MySQL', experimental: true },
    { value: 'mongodb', label: 'MongoDB', experimental: true },
  ],
  frontend: [
    { value: 'react-vite', label: 'React + Vite', recommended: true },
    { value: 'vue3-vite', label: 'Vue3 + Vite', experimental: true },
    { value: 'angular', label: 'Angular', experimental: true },
    { value: 'none', label: '无前端' },
  ],
  contract: [
    { value: 'zod', label: 'Zod (TS 栈默认)', recommended: true },
    { value: 'pydantic', label: 'Pydantic (Python 栈默认)' },
    { value: 'json-schema', label: 'JSON Schema (跨语言)' },
  ],
  auth: [
    { value: 'jwt', label: 'JWT (自签发)', recommended: true },
    { value: 'session', label: 'Session', experimental: true },
    { value: 'oauth2', label: 'OAuth2/OIDC', experimental: true },
    { value: 'none', label: '无认证 (开发用)' },
  ],
  ci: [
    { value: 'github-actions', label: 'GitHub Actions', recommended: true },
    { value: 'gitlab-ci', label: 'GitLab CI', experimental: true },
    { value: 'none', label: '无 (手动)' },
  ],
} as const;

export type StackKey = keyof typeof STACK_OPTIONS;
export type StackSelection = {
  [K in StackKey]: string;
};

/**
 * 黄金组合（M1 里程碑）。
 * 任何偏离此组合的选型在 MVP 期标记为 experimental，会产生 warning 而非 error。
 */
export const GOLDEN_COMBO: StackSelection = {
  backend: 'fastify-ts',
  db: 'postgresql',
  frontend: 'react-vite',
  contract: 'zod',
  auth: 'jwt',
  ci: 'github-actions',
};

/**
 * 判断某个 stack 选项是否为 experimental。
 * experimental 适配器可能缺完整 files/，调用方应据此加显式确认。
 */
export function isExperimental(category: StackKey, value: string): boolean {
  const opts = STACK_OPTIONS[category] as ReadonlyArray<{ value: string; experimental?: boolean }>;
  return opts.find((o) => o.value === value)?.experimental === true;
}

/**
 * 统计 stack 中 experimental 选项数量。
 */
export function countExperimental(stack: StackSelection): number {
  let n = 0;
  for (const key of Object.keys(STACK_OPTIONS) as StackKey[]) {
    if (isExperimental(key, stack[key])) n++;
  }
  return n;
}

/**
 * 完整生成选项（含项目元数据）。
 */
export interface GenerateOptions {
  /** 项目名（用作目录名 + package.json name） */
  project_name: string;
  /** 输出目录（默认 ./<project_name>） */
  out_dir: string;
  /** 技术栈选择 */
  stack: StackSelection;
  /** 是否跳过依赖安装 */
  no_deps: boolean;
  /** 是否跳过 git init */
  no_git: boolean;
  /** 是否使用默认值（非交互模式） */
  yes: boolean;
  /** 是否显示详细日志 */
  verbose: boolean;
}

/**
 * 校验选项合法性 + 推断默认值。
 * 不合法选项返回错误清单，调用方决定如何呈现。
 */
export function validateOptions(opts: Partial<GenerateOptions>): {
  errors: string[];
  warnings: string[];
  inferred: StackSelection;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stack: Partial<StackSelection> = { ...opts.stack };

  // 后端 → 契约库默认值
  if (stack.backend && !stack.contract) {
    if (stack.backend === 'fastify-ts' || stack.backend === 'express-ts') {
      stack.contract = 'zod';
    } else if (stack.backend === 'fastapi') {
      stack.contract = 'pydantic';
    } else if (stack.backend === 'spring-boot') {
      stack.contract = 'json-schema';
    }
  }

  // 后端 → 默认前端
  if (stack.backend && !stack.frontend) {
    stack.frontend = stack.backend.endsWith('-ts') ? 'react-vite' : 'none';
  }

  // 校验值是否在合法集合
  for (const key of Object.keys(STACK_OPTIONS) as StackKey[]) {
    const value = stack[key];
    if (!value) {
      stack[key] = GOLDEN_COMBO[key];
      continue;
    }
    const valid = (STACK_OPTIONS[key] as ReadonlyArray<{ value: string }>).map((o) => o.value);
    if (!valid.includes(value)) {
      errors.push(`stack.${key}="${value}" 不合法，可选：${valid.join(', ')}`);
      continue;
    }
    // experimental 警告
    const opt = (STACK_OPTIONS[key] as ReadonlyArray<{ value: string; experimental?: boolean }>).find(
      (o) => o.value === value,
    );
    if (opt?.experimental) {
      warnings.push(`stack.${key}="${value}" 在 MVP 期为 experimental，可能存在缺陷`);
    }
  }

  return { errors, warnings, inferred: stack as StackSelection };
}
