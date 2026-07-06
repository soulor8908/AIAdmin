// engine/src/plugins/typescript.ts —— TypeScript / Node.js 语言特化 plugin
// P0-4 产出：实现实验期 check-rules.mjs 中需要 AST/方法体分析的检查。
//
// 覆盖规则（与实验期 check-rules.mjs 等价）：
//   ARCH-001 import-graph：四层反向 import 检查
//   ARCH-002 import-graph：contracts 纯净
//   ARCH-003 import-graph：前端禁连后端
//   CODE-004 structure：Zod schema 命名后缀
//   SEC-001 structure：procedure 须声明 auth
//   SEC-002 structure：service 方法须调 requireAdmin
//   SEC-003a structure：输出 schema 须 .strict()
//
// 注：CODE-001/002/003 是纯正则，由 engine 核心内置 regex 检查完成（不在此 plugin）。
// 注：AI-005 也是纯正则扫描断言字面量，由 engine 核心内置检查。

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  RuleFinding,
  RuleCheckPlugin,
  RuleCheckInput,
} from '../../../spi/adapter.js';

const LAYER_RULES: Record<string, string[]> = {
  domain: ['service', 'repository', 'router', 'controller'],
  repository: ['service', 'router', 'controller'],
  service: ['router', 'controller'],
  router: [],
};

const KW = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'constructor',
  'static',
]);

const SUPPORTED_RULES = [
  'ARCH-001',
  'ARCH-002',
  'ARCH-003',
  'CODE-004',
  'SEC-001',
  'SEC-002',
  'SEC-003a',
];

export const typescriptPlugin: RuleCheckPlugin = {
  id: 'typescript',
  supported_rules: SUPPORTED_RULES,
  async check(input: RuleCheckInput): Promise<RuleFinding[]> {
    const findings: RuleFinding[] = [];
    const root = input.root_dir;

    // 按 rule_ids 过滤；缺省跑全部 supported_rules
    const ruleIds = input.rule_ids.length ? input.rule_ids : SUPPORTED_RULES;

    // 收集 TS 文件（适配 Node.js 项目布局）
    const allTs = collectTsFiles(root);

    for (const ruleId of ruleIds) {
      if (!SUPPORTED_RULES.includes(ruleId)) continue;
      const ruleFindings = runRule(ruleId, root, allTs);
      findings.push(...ruleFindings);
    }
    return findings;
  },
};

function runRule(ruleId: string, root: string, files: string[]): RuleFinding[] {
  switch (ruleId) {
    case 'ARCH-001':
      return checkArch001(root, files);
    case 'ARCH-002':
      return checkArch002(root, files);
    case 'ARCH-003':
      return checkArch003(root, files);
    case 'CODE-004':
      return checkCode004(root, files);
    case 'SEC-001':
      return checkSec001(root, files);
    case 'SEC-002':
      return checkSec002(root, files);
    case 'SEC-003a':
      return checkSec003a(root, files);
    default:
      return [];
  }
}

// ============ 文件收集 ============

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  const { readdirSync, statSync, existsSync } = require('node:fs');
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, acc);
    else if (exts.some((e) => name.endsWith(e))) acc.push(p);
  }
  return acc;
}

function collectTsFiles(root: string): string[] {
  // 适配多种项目布局：
  //   - mvp/: packages/contracts/src + apps/api/src + apps/api/test + apps/web/src + apps/web/test
  //   - 模板生成项目: packages/contracts/src + apps/api/src + apps/web/src
  const dirs = [
    'packages/contracts/src',
    'apps/api/src',
    'apps/api/test',
    'apps/web/src',
    'apps/web/test',
    'src', // 单包项目
  ];
  const all: string[] = [];
  for (const d of dirs) {
    const files = walk(join(root, d), ['.ts', '.tsx']);
    all.push(...files);
  }
  return dedup(all);
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

function rel(root: string, p: string): string {
  return relative(root, p).replace(/\\/g, '/');
}

// ============ ARCH-001 ============

function layerOf(filePath: string): string | null {
  const m = filePath.match(/apps\/api\/src\/(domain|repository|service|router)\b/);
  return m ? m[1] : null;
}

function checkArch001(root: string, files: string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const f of files) {
    const layer = layerOf(f);
    if (!layer) continue;
    const forbidden = LAYER_RULES[layer] || [];
    const src = readFileSync(f, 'utf8');
    for (const upper of forbidden) {
      const re = new RegExp(`from\\s+['"](?:\\.\\./)+${upper}(/|['"])`);
      if (re.test(src)) {
        findings.push({
          rule_id: 'ARCH-001',
          file: rel(root, f),
          line: 0,
          severity: 'error',
          message: `${layer} 反向 import 了上层 ${upper}`,
          fix_hint: '依赖方向 router → service → repository → domain，禁止反向 import',
        });
      }
    }
  }
  return findings;
}

// ============ ARCH-002 ============

function checkArch002(root: string, files: string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const f of files) {
    const r = rel(root, f);
    if (!r.startsWith('packages/contracts/')) continue;
    const src = readFileSync(f, 'utf8');
    if (/from\s+['"]apps\//.test(src) || /from\s+['"]@admin\/api/.test(src)) {
      findings.push({
        rule_id: 'ARCH-002',
        file: r,
        line: 0,
        severity: 'error',
        message: 'contracts import 了业务层（contracts 须纯净）',
        fix_hint: 'contracts 只导出 Zod schema + z.infer 类型，禁含业务逻辑',
      });
    }
  }
  return findings;
}

// ============ ARCH-003 ============

function checkArch003(root: string, files: string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const FORBIDDEN_RE = /(?:^@admin\/api\b)|(?:api\/src\/)|(?:^apps\/api\b)/;
  const IMPORT_SPEC_RE = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  for (const f of files) {
    const r = rel(root, f);
    if (!r.startsWith('apps/web/src/') && !r.startsWith('frontend/src/') && !r.startsWith('web/src/')) continue;
    const src = readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    IMPORT_SPEC_RE.lastIndex = 0;
    while ((m = IMPORT_SPEC_RE.exec(src)) !== null) {
      const spec = m[1] || m[2];
      if (spec && FORBIDDEN_RE.test(spec)) {
        const upto = src.slice(0, m.index);
        const line = upto.split('\n').length;
        findings.push({
          rule_id: 'ARCH-003',
          file: r,
          line,
          severity: 'error',
          message: `前端 import 了后端模块 "${spec}"（前端只能经 @admin/contracts 调用后端）`,
          fix_hint: '前端只能 import @admin/contracts + 第三方依赖 + 自身模块',
        });
      }
    }
  }
  return findings;
}

// ============ CODE-004 ============

function checkCode004(root: string, files: string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const SCHEMA_DECL_RE =
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*z\.(object|enum|array|tuple|union|intersection|record|discriminatedUnion|lazy)\b/g;
  for (const f of files) {
    const r = rel(root, f);
    if (!r.startsWith('packages/contracts/') && !r.startsWith('src/')) continue;
    const src = readFileSync(f, 'utf8');
    SCHEMA_DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SCHEMA_DECL_RE.exec(src)) !== null) {
      const name = m[1];
      if (!/Schema$/.test(name)) {
        const upto = src.slice(0, m.index);
        const line = upto.split('\n').length;
        findings.push({
          rule_id: 'CODE-004',
          file: r,
          line,
          severity: 'error',
          message: `导出的 Zod schema "${name}" 缺少 Schema 后缀`,
          fix_hint: 'Zod schema 命名须带 Schema 后缀；z.infer 派生类型用裸名词',
        });
      }
    }
  }
  return findings;
}

// ============ SEC-001 ============

function checkSec001(root: string, files: string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const blockRe = /\{[^{}]*input:[^{}]*handler:[^{}]*\}/gs;
  for (const f of files) {
    const r = rel(root, f);
    if (!r.startsWith('apps/api/src/router/')) continue;
    const src = readFileSync(f, 'utf8');
    blockRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(src)) !== null) {
      const block = m[0];
      if (!/\bauth\s*:/.test(block)) {
        const upto = src.slice(0, m.index);
        const line = upto.split('\n').length;
        findings.push({
          rule_id: 'SEC-001',
          file: r,
          line,
          severity: 'error',
          message: 'procedure 对象缺少 auth 元数据',
          fix_hint: "Procedure 须含 auth: 'admin' | 'public' 字段；public 须上方注释说明理由",
        });
      }
    }
  }
  return findings;
}

// ============ SEC-002 ============

function checkSec002(root: string, files: string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const f of files) {
    const r = rel(root, f);
    if (!r.startsWith('apps/api/src/service/')) continue;
    const src = readFileSync(f, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const methodRe = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/;
      const m = methodRe.exec(line);
      if (!m) continue;
      const name = m[1];
      if (KW.has(name)) continue;
      if (/private|#/.test(line)) continue;

      // SEC-002-exempt 标记识别
      const exemptCtx = [];
      for (let k = Math.max(0, i - 2); k <= i; k++) exemptCtx.push(lines[k]);
      const exemptMatch = exemptCtx.join('\n').match(/\/\/\s*SEC-002-exempt:\s*(.+)/);
      if (exemptMatch) {
        const reason = exemptMatch[1].trim();
        findings.push({
          rule_id: 'SEC-002',
          file: r,
          line: i + 1,
          severity: 'info',
          message: `${name}() 豁免 — ${reason}`,
        });
        continue;
      }

      // 收集方法体（最多 40 行）
      let body = '';
      for (let j = i; j < Math.min(i + 40, lines.length); j++) {
        body += lines[j] + '\n';
        if (j > i) {
          const bm = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/.exec(lines[j]);
          if (bm && !KW.has(bm[1]) && !/private|#/.test(lines[j])) break;
        }
      }
      if (!/requireAdmin|requirePermission/.test(body)) {
        findings.push({
          rule_id: 'SEC-002',
          file: r,
          line: i + 1,
          severity: 'error',
          message: `service 方法 ${name}() 未调用 requireAdmin/requirePermission`,
          fix_hint: 'service public 方法入口须调 requireAdmin(ctx) 或更细粒度 requirePermission',
        });
      }
    }
  }
  return findings;
}

// ============ SEC-003a ============

function checkSec003a(root: string, files: string[]): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const outSchemaRe =
    /export\s+const\s+(\w*(Result|Response)\w*Schema)\s*=\s*z\.object\([^)]*\)(\s*\.\s*\w+)*/gs;
  for (const f of files) {
    const r = rel(root, f);
    if (!r.startsWith('packages/contracts/')) continue;
    const src = readFileSync(f, 'utf8');
    outSchemaRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = outSchemaRe.exec(src)) !== null) {
      const block = m[0];
      if (!/\.strict\(\)/.test(block)) {
        findings.push({
          rule_id: 'SEC-003a',
          file: r,
          line: 0,
          severity: 'warning',
          message: `输出 schema ${m[1]} 未带 .strict()`,
          fix_hint: '输出 schema 须 .strict() 拒绝多余字段（防 PII 泄漏）',
        });
      }
    }
  }
  return findings;
}
