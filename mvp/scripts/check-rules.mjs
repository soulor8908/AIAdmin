// scripts/check-rules.mjs —— MVP 规则自动校验脚本（第三轮：META-003/004 双向绑定）
// 落实"规则可机器校验"原则 + META-001/003/004 元约束。
// 每个 enforcement 分支以 `// === XXX-NNN ===` 注释标记，META-004 据此与规则文档双向绑定。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const errors = [];
const warnings = []; // suggestion 级，不阻断但记录
const infos = []; // info 级（如 SEC-002 豁免标记审计清单），不阻断

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}
// walkWeb：扩展 .tsx 收集（前端 apps/web 专属），供 allTs 通用扫描器与 ARCH-003 专属分支共用。
// R13 S-4：从 ARCH-003 分支局部函数提升为顶层函数，使 CODE-001/002/003/004 等通用扫描器覆盖前端。
function walkWeb(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkWeb(p, acc);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(p); // 扩展 .tsx（既有 walk 仅 .ts）
  }
  return acc;
}
const rel = (p) => p.replace(ROOT + '/', '');

const allTs = [
  ...walk(join(ROOT, 'packages/contracts/src')),
  ...walk(join(ROOT, 'apps/api/src')),
  ...walk(join(ROOT, 'apps/api/test')),
  // R13 S-4：扩展到 apps/web，使 CODE-001/002/003/004 等通用扫描器覆盖前端（.tsx 经 walkWeb 收集）。
  ...walkWeb(join(ROOT, 'apps/web/src')),
  ...walkWeb(join(ROOT, 'apps/web/test')),
];

// 记录本脚本内所有 enforcement 分支的规则 ID（供 META-004 反向缺口校验）
const SCRIPT_ENFORCEMENT_IDS = new Set();
function markEnforcement(id) {
  SCRIPT_ENFORCEMENT_IDS.add(id);
}

// ============ ARCH-001 扩面：四层反向依赖 ============
markEnforcement('ARCH-001');
const LAYER_RULES = {
  domain: ['service', 'repository', 'router', 'controller'],
  repository: ['service', 'router', 'controller'],
  service: ['router', 'controller'],
  router: [],
};
function layerOf(filePath) {
  const m = filePath.match(/apps\/api\/src\/(domain|repository|service|router)\b/);
  return m ? m[1] : null;
}
for (const f of allTs) {
  const layer = layerOf(f);
  if (!layer) continue;
  const forbidden = LAYER_RULES[layer] || [];
  const src = readFileSync(f, 'utf8');
  for (const upper of forbidden) {
    const re = new RegExp(`from\\s+['"](?:\\.\\./)+${upper}(/|['"])`);
    if (re.test(src)) {
      errors.push(`ARCH-001 违规：${rel(f)}（${layer}）反向 import 了上层 ${upper}`);
    }
  }
}

// ============ ARCH-002：contracts 纯净 ============
markEnforcement('ARCH-002');
for (const f of allTs) {
  if (!rel(f).startsWith('packages/contracts/')) continue;
  const src = readFileSync(f, 'utf8');
  if (/from\s+['"]apps\//.test(src) || /from\s+['"]@admin\/api/.test(src)) {
    errors.push(`ARCH-002 违规：${rel(f)} import 了业务层（contracts 须纯净）`);
  }
}

// ============ CODE-001：禁止 any ============
markEnforcement('CODE-001');
for (const f of allTs) {
  const src = readFileSync(f, 'utf8');
  if (/: any\b/.test(src) || /as any\b/.test(src)) {
    errors.push(`CODE-001 违规：${rel(f)} 使用了 any`);
  }
}

// ============ CODE-002 增强：空 catch + 仅 console catch ============
markEnforcement('CODE-002');
for (const f of allTs) {
  const src = readFileSync(f, 'utf8');
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(src)) {
    errors.push(`CODE-002 违规：${rel(f)} 存在空 catch（吞错）`);
  }
  const consoleCatch = /catch\s*\([^)]*\)\s*\{\s*console\.[^}]*\}/s;
  if (consoleCatch.test(src)) {
    errors.push(`CODE-002 违规：${rel(f)} catch 仅含 console（吞错）`);
  }
}

// ============ CODE-003 增强：eval + new Function + 裸 Function( ============
markEnforcement('CODE-003');
for (const f of allTs) {
  const src = readFileSync(f, 'utf8');
  if (/\beval\s*\(/.test(src)) {
    errors.push(`CODE-003 违规：${rel(f)} 使用 eval`);
  }
  if (/new\s+Function\s*\(/.test(src) || /[^.\w]Function\s*\(/.test(src)) {
    errors.push(`CODE-003 违规：${rel(f)} 使用 Function 构造`);
  }
}

// ============ CODE-004：Zod schema 命名后缀 ============
markEnforcement('CODE-004');
const SCHEMA_DECL_RE =
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*z\.(object|enum|array|tuple|union|intersection|record|discriminatedUnion|lazy)\b/g;
for (const f of allTs) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = SCHEMA_DECL_RE.exec(src)) !== null) {
    const name = m[1];
    if (!/Schema$/.test(name)) {
      errors.push(`CODE-004 违规：${rel(f)} 导出的 Zod schema "${name}" 缺少 Schema 后缀`);
    }
  }
}

// ============ SEC-001：procedure 必须声明 auth 元数据 ============
markEnforcement('SEC-001');
for (const f of allTs) {
  if (!rel(f).startsWith('apps/api/src/router/')) continue;
  const src = readFileSync(f, 'utf8');
  const blockRe = /\{[^{}]*input:[^{}]*handler:[^{}]*\}/gs;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const block = m[0];
    if (!/\bauth\s*:/.test(block)) {
      const upto = src.slice(0, m.index);
      const line = upto.split('\n').length;
      errors.push(`SEC-001 违规：${rel(f)}:${line} procedure 对象缺少 auth 元数据`);
    }
  }
}

// ============ SEC-002：service public 方法须调 requireAdmin/requirePermission ============
// 既有 SEC-002 分支内增强（TECH-NOTIFICATION-001 §3.3 D5）：
// 识别方法声明行上方 1~2 行或行尾的 `// SEC-002-exempt: <reason>` 标记，命中则跳过 requireAdmin 检查
// 并 push info 供 Reviewer 审计。非新增 markEnforcement 分支（META-003 合规）。
markEnforcement('SEC-002');
for (const f of allTs) {
  if (!rel(f).startsWith('apps/api/src/service/')) continue;
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'static']);
    const methodRe = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/;
    const m = methodRe.exec(line);
    if (!m) continue;
    const name = m[1];
    if (KW.has(name)) continue;
    if (/private|#/.test(line)) continue;
    // SEC-002-exempt 标记识别（D5）：检查声明行上方 1~2 行（max(0, i-2) ~ i-1）+ 声明行本身尾注释，
    // 命中 `SEC-002-exempt:` 则跳过 requireAdmin 检查并 push info 供 Reviewer 逐条核对豁免合理性。
    const exemptCtx = [];
    for (let k = Math.max(0, i - 2); k <= i; k++) exemptCtx.push(lines[k]);
    const exemptMatch = exemptCtx.join('\n').match(/\/\/\s*SEC-002-exempt:\s*(.+)/);
    if (exemptMatch) {
      const reason = exemptMatch[1].trim();
      infos.push(`SEC-002 豁免：${rel(f)}:${i + 1} ${name}() — ${reason}`);
      continue;
    }
    let body = '';
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      body += lines[j] + '\n';
      // 复盘 RETRO-ROUND5 P2 修复：break 条件须与 methodRe 同步排除控制流关键字
      // （if/for/while/switch/catch/return/function/constructor/static）与 private/#，
      // 否则把 `if(...)` 误判为方法声明而提前截断 body，导致 requireAdmin 落出 body 被误报。
      if (j > i) {
        const bm = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/.exec(lines[j]);
        if (bm && !KW.has(bm[1]) && !/private|#/.test(lines[j])) break;
      }
    }
    if (!/requireAdmin|requirePermission/.test(body)) {
      errors.push(`SEC-002 违规：${rel(f)}:${i + 1} service 方法 ${name}() 未调用 requireAdmin/requirePermission`);
    }
  }
}

// ============ SEC-003a：输出 schema 须 .strict() ============
markEnforcement('SEC-003a');
for (const f of allTs) {
  if (!rel(f).startsWith('packages/contracts/')) continue;
  const src = readFileSync(f, 'utf8');
  const outSchemaRe =
    /export\s+const\s+(\w*(Result|Response)\w*Schema)\s*=\s*z\.object\([^)]*\)(\s*\.\s*\w+)*/gs;
  let m;
  while ((m = outSchemaRe.exec(src)) !== null) {
    const block = m[0];
    if (!/\.strict\(\)/.test(block)) {
      warnings.push(`SEC-003a 建议：${rel(f)} 输出 schema ${m[1]} 未带 .strict()`);
    }
  }
}

// ============ ARCH-003：前端禁止 import 后端模块（跨层只经契约）============
// TECH-WEB-AUTH-USER-001 §8.2：扫描 apps/web/src/**/*.{ts,tsx} 的 import 语句，
// 禁止 import apps/api/src/** 与 @admin/api 包，仅允许 @admin/contracts + 第三方 + apps/web 内部模块。
markEnforcement('ARCH-003');
// walkWeb 已提升为顶层函数（R13 S-4），ARCH-003 仅扫 apps/web/src（不扫 test，保持不变）。
const webSrc = walkWeb(join(ROOT, 'apps/web/src'));
// 提取 import/export ... from 'spec' 与 side-effect import 'spec'
const IMPORT_SPEC_RE = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
// 禁止 specifier（§8.3 三条规则，任一命中即违规）：
//   - ^@admin\/api\b —— import @admin/api 包（跨层直连后端包）
//   - api\/src\/ 子串 —— 覆盖绝对 'apps/api/src/...' 与相对逃逸 '../api/src/...'、'../../apps/api/src/...'
//   - ^apps\/api\b —— 以 apps/api 开头的绝对路径
// contracts 导出 './schemas/*'，第三方包路径不含 'api/src/'，故子串判定无误伤。
const ARCH003_FORBIDDEN_RE = /(?:^@admin\/api\b)|(?:api\/src\/)|(?:^apps\/api\b)/;
for (const f of webSrc) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = IMPORT_SPEC_RE.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (spec && ARCH003_FORBIDDEN_RE.test(spec)) {
      errors.push(`ARCH-003 违规：${rel(f)} import 了后端模块 "${spec}"（前端只能经 @admin/contracts 调用后端，禁止直连 apps/api/src/** 或 @admin/api）`);
    }
  }
}

// ============ AI-005：禁止硬编码跨域可变集合断言 ============
markEnforcement('AI-005');
// 扫描测试文件中 .toEqual([字面量, 字面量, ...]) 形式，若字面量匹配跨域枚举模式则 suggestion
// 权限码模式：xxx:xxx ；错误码模式：全大写下划线含下划线且长度≥6
// R17 S-6 固化：continue 条件从 apps/api/test/ 扩展含 apps/web/test/，
//   覆盖前端测试对跨域枚举集合的硬编码断言（如权限码数组、错误码数组）。
//   正则仅匹配 .toEqual([...]) / .toStrictEqual([...]) 数组形式，
//   前端 toEqual 常见的对象形式不受影响，故对前端测试的适用性与后端一致。
const PERMISSION_CODE_LIT = /['"]([a-z]+:[a-z]+)['"]/g;
const ERROR_CODE_LIT = /['"]([A-Z][A-Z_]{4,}_[A-Z]+)['"]/g;
const AI005_TEST_DIRS = /^(apps\/api\/test\/|apps\/web\/test\/)/;
for (const f of allTs) {
  if (!AI005_TEST_DIRS.test(rel(f))) continue;
  const src = readFileSync(f, 'utf8');
  // 找 .toEqual([...]) 或 .toStrictEqual([...]) 块（贪婪到匹配的 ])
  const assertRe = /\.(toEqual|toStrictEqual)\(\s*\[([\s\S]*?)\]\s*\)/g;
  let m;
  while ((m = assertRe.exec(src)) !== null) {
    const arrContent = m[2];
    // 统计匹配的跨域枚举字面量数
    const permMatches = [...arrContent.matchAll(PERMISSION_CODE_LIT)];
    const errMatches = [...arrContent.matchAll(ERROR_CODE_LIT)];
    const total = permMatches.length + errMatches.length;
    if (total >= 3) {
      const upto = src.slice(0, m.index);
      const line = upto.split('\n').length;
      warnings.push(`AI-005 建议：${rel(f)}:${line} 疑似硬编码跨域可变集合（${total} 个枚举字面量），考虑改用 SSOT 派生（如 [...schema.options]）`);
    }
  }
}

// ============ META-001/003/004：规则文档与脚本双向绑定 ============
markEnforcement('META-001');
markEnforcement('META-003');
markEnforcement('META-004');
function walkMd(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMd(p, acc);
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}
const ruleFiles = walkMd(join(ROOT, '.trae/rules'));
const META_KW = /check-rules|tsc|eslint|vitest|ci|pino|git\s+diff|契约测|编排者实跑|扫描|diff|Reviewer subagent|pre-commit/i;

// 收集规则文档中所有规则 ID，以及"声称用 check-rules.mjs 校验"的规则 ID
const ALL_DOC_RULE_IDS = new Set();
const DOC_CLAIMS_CHECKRULES = new Set(); // 校验方式段含 check-rules.mjs 的规则 ID
for (const f of ruleFiles) {
  const src = readFileSync(f, 'utf8');
  const blocks = src.split(/\n##\s+/).slice(1);
  for (const block of blocks) {
    // 规则 ID 支持字母后缀，如 SEC-003a / SEC-003b
    const idMatch = block.match(/^([A-Z]+-\d+[a-z]?)/);
    if (!idMatch) continue;
    const id = idMatch[1];
    ALL_DOC_RULE_IDS.add(id);
    // META-001：校验方式段须含机器校验关键词
    if (id.startsWith('META-')) continue; // META 自身豁免 META-001 关键词检查
    if (!/校验方式/.test(block)) {
      errors.push(`META-001 违规：规则 ${id}（${rel(f)}）缺少"校验方式"段`);
    } else if (!META_KW.test(block)) {
      errors.push(`META-001 违规：规则 ${id}（${rel(f)}）"校验方式"段无机器校验关键词`);
    }
    // META-003：若校验方式段声称由 check-rules.mjs 专属分支校验，记录以供差集。
    // 精确模式：校验方式段含 "`scripts/check-rules.mjs` <RULE-ID> 分支" 或以 `scripts/check-rules.mjs` 为主语扫描。
    // 排除：仅"在 check-rules.mjs 新增分支""由 CI 执行 check-rules.mjs 整体"等非专属分支声明。
    const verifySection = block.split(/校验方式/)[1] || '';
    // 精确模式：校验方式段含 "check-rules.mjs ... <ID> ... 分支"（容忍反引号/空格）。
    // 排除：仅"在 check-rules.mjs 新增分支""由 CI 执行 check-rules.mjs 整体"等非专属分支声明。
    const claimsExclusive = new RegExp(
      `check-rules\\.mjs[^\\n]*?\\b${id}\\b[^\\n]*?分支`
    ).test(verifySection);
    if (claimsExclusive) {
      DOC_CLAIMS_CHECKRULES.add(id);
    }
  }
}

// META-003：声明漂移 —— 规则文档声称用 check-rules.mjs，但脚本无对应 enforcement 分支
for (const id of DOC_CLAIMS_CHECKRULES) {
  if (!SCRIPT_ENFORCEMENT_IDS.has(id)) {
    errors.push(`META-003 声明漂移：规则 ${id} 校验方式声称用 check-rules.mjs，但脚本无 // === ${id} === enforcement 分支`);
  }
}

// META-004：反向缺口 —— 脚本有 enforcement 分支，但规则文档无对应规则 ID
for (const id of SCRIPT_ENFORCEMENT_IDS) {
  if (!ALL_DOC_RULE_IDS.has(id)) {
    errors.push(`META-004 反向缺口：脚本有 // === ${id} === enforcement 分支，但 .trae/rules 无对应规则文档`);
  }
}

// ============ 输出 ============
if (infos.length) {
  console.log('ℹ️  审计清单（不阻断，供 Reviewer 逐条核对）：');
  for (const i of infos) console.log('  - ' + i);
}
if (warnings.length) {
  console.log('⚠️  建议（不阻断）：');
  for (const w of warnings) console.log('  - ' + w);
}
if (errors.length) {
  console.error('\n❌ 规则校验失败：');
  for (const e of errors) console.error('  - ' + e);
  console.error(`\n共 ${errors.length} 处违规\n`);
  process.exit(1);
} else {
  console.log('✅ 规则校验通过');
  console.log('   enforcement 覆盖：' + [...SCRIPT_ENFORCEMENT_IDS].sort().join('/'));
  console.log('   双向绑定：META-003(声明即实现) + META-004(实现即声明) 已校验');
  if (infos.length) console.log(`   另有 ${infos.length} 条 SEC-002 豁免审计清单`);
  if (warnings.length) console.log(`   另有 ${warnings.length} 条建议`);
}
