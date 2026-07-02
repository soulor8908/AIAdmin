// scripts/check-rules.mjs —— MVP 规则自动校验脚本（复盘 P0 补强版）
// 落实"规则可机器校验"原则 + META-001 元约束。
// 覆盖：ARCH-001(扩面)/ARCH-002/CODE-001/CODE-002(增强)/CODE-003(增强)/CODE-004(新增)/SEC-003a/META-001
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const errors = [];
const warnings = []; // suggestion 级，不阻断但记录

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}
const rel = (p) => p.replace(ROOT + '/', '');

const allTs = [
  ...walk(join(ROOT, 'packages/contracts/src')),
  ...walk(join(ROOT, 'apps/api/src')),
  ...walk(join(ROOT, 'apps/api/test')),
];

// ============ ARCH-001 扩面：四层反向依赖 ============
// 层级表：目录 → 禁止 import 的更高层路径片段
const LAYER_RULES = {
  domain: ['service', 'repository', 'router', 'controller'],
  repository: ['service', 'router', 'controller'],
  service: ['router', 'controller'],
  router: [], // router 是最高层
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
    // 匹配相对路径 import 上层，或 @admin/api 包内上层
    const re = new RegExp(`from\\s+['"](?:\\.\\./)+${upper}(/|['"])`);
    if (re.test(src)) {
      errors.push(`ARCH-001 违规：${rel(f)}（${layer}）反向 import 了上层 ${upper}`);
    }
  }
}

// ============ ARCH-002：contracts 纯净 ============
for (const f of allTs) {
  if (!rel(f).startsWith('packages/contracts/')) continue;
  const src = readFileSync(f, 'utf8');
  if (/from\s+['"]apps\//.test(src) || /from\s+['"]@admin\/api/.test(src)) {
    errors.push(`ARCH-002 违规：${rel(f)} import 了业务层（contracts 须纯净）`);
  }
}

// ============ CODE-001：禁止 any ============
for (const f of allTs) {
  const src = readFileSync(f, 'utf8');
  if (/: any\b/.test(src) || /as any\b/.test(src)) {
    errors.push(`CODE-001 违规：${rel(f)} 使用了 any`);
  }
}

// ============ CODE-002 增强：空 catch + 仅 console catch ============
for (const f of allTs) {
  const src = readFileSync(f, 'utf8');
  // 空 catch
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(src)) {
    errors.push(`CODE-002 违规：${rel(f)} 存在空 catch（吞错）`);
  }
  // 仅含 console 的 catch（多行容忍）
  const consoleCatch = /catch\s*\([^)]*\)\s*\{\s*console\.[^}]*\}/s;
  if (consoleCatch.test(src)) {
    errors.push(`CODE-002 违规：${rel(f)} catch 仅含 console（吞错）`);
  }
}

// ============ CODE-003 增强：eval + new Function + 裸 Function( ============
for (const f of allTs) {
  const src = readFileSync(f, 'utf8');
  if (/\beval\s*\(/.test(src)) {
    errors.push(`CODE-003 违规：${rel(f)} 使用 eval`);
  }
  if (/new\s+Function\s*\(/.test(src) || /[^.\w]Function\s*\(/.test(src)) {
    errors.push(`CODE-003 违规：${rel(f)} 使用 Function 构造`);
  }
}

// ============ CODE-004 新增：Zod schema 命名后缀 ============
// 匹配 export const xxx = z.(object|enum|array|tuple|union|intersection|record)...
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

// ============ SEC-003a：输出 schema 须 .strict() ============
// 仅检查 contracts 中名为 xxxResultSchema / xxxResponseSchema 的输出 schema 定义块
for (const f of allTs) {
  if (!rel(f).startsWith('packages/contracts/')) continue;
  const src = readFileSync(f, 'utf8');
  // 找 export const xxxResultSchema = z.object({...}) 然后检查同行/下两行是否有 .strict()
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

// ============ SEC-001：procedure 必须声明 auth 元数据 ============
for (const f of allTs) {
  if (!rel(f).startsWith('apps/api/src/router/')) continue;
  const src = readFileSync(f, 'utf8');
  // 匹配 procedure 对象字面量：{ input: ..., handler: ..., } 形式
  // 简化策略：找 handler: 紧邻的对象块，检查同对象内是否含 auth:
  const procRe = /\{\s*input:\s*[^,]+,\s*handler:\s*[^,}]+,\s*\}/gs;
  // 上面匹配不含 auth 的三键对象；改用反向逻辑：找所有 procedure 对象块，逐块检查 auth
  const blockRe = /\{[^{}]*input:[^{}]*handler:[^{}]*\}/gs;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const block = m[0];
    if (!/\bauth\s*:/.test(block)) {
      // 定位行号
      const upto = src.slice(0, m.index);
      const line = upto.split('\n').length;
      errors.push(`SEC-001 违规：${rel(f)}:${line} procedure 对象缺少 auth 元数据`);
    }
  }
}

// ============ SEC-002：service public 方法须调 requireAdmin/requirePermission ============
for (const f of allTs) {
  if (!rel(f).startsWith('apps/api/src/service/')) continue;
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配 public 方法定义（async methodName(...) 或 methodName(...)），排除关键字与 private/#
    const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'static']);
    const methodRe = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/;
    const m = methodRe.exec(line);
    if (!m) continue;
    const name = m[1];
    if (KW.has(name)) continue;
    // 私有方法豁免：上一行或同行含 private 或方法名以 # 开头
    if (/private|#/.test(line)) continue;
    // 取方法体（到下一个顶层方法定义或类结束），简化为向下扫描 40 行
    let body = '';
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      body += lines[j] + '\n';
      // 遇到下一个方法定义则停
      if (j > i && /^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*[:{]/.test(lines[j])) break;
    }
    if (!/requireAdmin|requirePermission/.test(body)) {
      errors.push(`SEC-002 违规：${rel(f)}:${i + 1} service 方法 ${name}() 未调用 requireAdmin/requirePermission`);
    }
  }
}

// ============ META-001：规则文件必须有可机器校验方式 ============
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
for (const f of ruleFiles) {
  const src = readFileSync(f, 'utf8');
  // 提取每个 ## XXX-NNN 规则块
  const blocks = src.split(/\n##\s+/).slice(1);
  for (const block of blocks) {
    const idMatch = block.match(/^([A-Z]+-\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];
    // META-001/META-002 自身豁免（它们校验的就是自己）
    if (id.startsWith('META-')) continue;
    if (!META_KW.test(block)) {
      errors.push(`META-001 违规：规则 ${id}（${rel(f)}）"校验方式"段无机器校验关键词`);
    }
    if (!/校验方式/.test(block)) {
      errors.push(`META-001 违规：规则 ${id}（${rel(f)}）缺少"校验方式"段`);
    }
  }
}

// ============ 输出 ============
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
  console.log('   覆盖：ARCH-001(四层)/ARCH-002/CODE-001/CODE-002(空+console)/CODE-003(eval+Function)/CODE-004(schema后缀)/SEC-001(auth元数据)/SEC-002(service权限)/SEC-003a(strict)/META-001(元约束)');
  if (warnings.length) console.log(`   另有 ${warnings.length} 条建议`);
}
