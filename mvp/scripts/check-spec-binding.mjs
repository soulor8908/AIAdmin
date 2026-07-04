// scripts/check-spec-binding.mjs —— Spec↔代码双向绑定校验（META-003/004 等价物，针对 Spec 决策编号）
//
// 校验 Spec 文档（docs/spec/*.tech.md）与代码注释（apps/api/src、apps/web/src、packages/contracts/src）
// 之间 TECH-XXX-001 + Dx 决策编号的双向绑定：
//   - 漂移（error，阻断）：代码引用 (TECH, D) 但对应 Spec 未定义该 D 编号
//   - 缺口（warning，不阻断）：Spec 定义了 (TECH, D) 但代码无任何引用（信息性，提示可能漏实现或注释漏标注）
//
// Spec 决策编号 Dx 提取规则（兼容 4 种格式）：
//   1. `### Dx · ...`（heading 行首，分隔符 `·`）
//   2. `### <num> <title>（Dx · ...）`（heading 括号内）
//   3. `### <num> [约束] Dx：...`（heading 行中冒号前）
//   4. `**决策 Dx（...）**`（加粗决策定义）
// 兜底：扫描所有 heading 行 + `**决策 Dx` 行，取第一个 `D\d+` token。
//
// 代码引用提取规则：扫描 // 单行注释中 `(TECH-XXX-001)[^\n]*?\bD(\d+)` 模式。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const errors = [];
const warnings = [];

const rel = (p) => p.replace(ROOT + '/', '');

// ============ 收集 Spec 文件 ============
function walkMd(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMd(p, acc);
    else if (name.endsWith('.tech.md')) acc.push(p);
  }
  return acc;
}

const specFiles = walkMd(join(ROOT, 'docs/spec'));
if (specFiles.length === 0) {
  console.error('[spec-binding] 未找到 docs/spec/*.tech.md，跳过校验。');
  process.exit(0);
}

// ============ 收集代码文件 ============
function walkCode(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkCode(p, acc);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const codeFiles = [
  ...walkCode(join(ROOT, 'packages/contracts/src')),
  ...walkCode(join(ROOT, 'apps/api/src')),
  ...walkCode(join(ROOT, 'apps/web/src')),
];

// ============ 从 Spec 提取 TECH-ID → Set<Dx> ============
// Map<TECH-ID, Set<Dx>>
const specDecisions = new Map();
// Map<TECH-ID, specFilePath>
const specFileOf = new Map();

const TECH_ID_RE = /^id:\s+(TECH-[A-Z][A-Z0-9-]*-001)\s*$/;
const D_TOKEN_RE = /\bD(\d+)\b/g;
const HEADING_RE = /^#{1,6}\s/;
const BOLD_DECISION_RE = /\*\*决策\s*D\d+/;

for (const f of specFiles) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  let techId = null;
  for (const line of lines) {
    // frontmatter id 行
    const m = line.match(TECH_ID_RE);
    if (m) {
      techId = m[1];
      if (!specDecisions.has(techId)) specDecisions.set(techId, new Set());
      specFileOf.set(techId, rel(f));
      continue;
    }
    if (!techId) continue;
    // heading 行或 **决策 Dx** 行
    if (!HEADING_RE.test(line) && !BOLD_DECISION_RE.test(line)) continue;
    // 取该行第一个 D\d+ token（避免一行多 D 编号导致误归类）
    const dm = line.match(D_TOKEN_RE);
    if (!dm) continue;
    const first = dm[0];
    const num = first.replace(/^D/, '');
    specDecisions.get(techId).add(num);
  }
}

// ============ 从代码注释提取 TECH-ID → Set<Dx> 引用 ============
// Map<TECH-ID, Set<Dx>>
const codeRefs = new Map();
// Map<TECH-ID, Set<filePath>>（用于错误消息定位）
const codeRefFiles = new Map();

// 单行注释中按出现顺序追踪 TECH-ID，将后续 D-numbers 归属到最近一次出现的 TECH-ID。
// 这样可正确处理一行多 TECH-ID 的场景，例如：
//   // ...（TECH-WEB-AUTH-USER-001 §2.1 + TECH-WEB-ROLE-DEPT-AUDIT-001 D24 ...）
//   其中 D24 归属 TECH-WEB-ROLE-DEPT-AUDIT-001 而非 TECH-WEB-AUTH-USER-001。
const TOKEN_RE = /(TECH-[A-Z][A-Z0-9-]*-001)|\bD(\d+)\b/g;

for (const f of codeFiles) {
  const src = readFileSync(f, 'utf8');
  // 仅扫描 // 单行注释（不扫多行 /* */，避免误抓字符串里的 TECH-ID）
  const lines = src.split('\n');
  for (const line of lines) {
    const commentIdx = line.indexOf('//');
    if (commentIdx === -1) continue;
    const comment = line.slice(commentIdx);
    let lastTechId = null;
    let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(comment)) !== null) {
      if (m[1]) {
        lastTechId = m[1];
      } else if (m[2] && lastTechId) {
        if (!codeRefs.has(lastTechId)) {
          codeRefs.set(lastTechId, new Set());
          codeRefFiles.set(lastTechId, new Set());
        }
        codeRefs.get(lastTechId).add(m[2]);
        codeRefFiles.get(lastTechId).add(rel(f));
      }
    }
  }
}

// ============ 漂移校验（error）：代码引用 (TECH, D) 但 Spec 未定义 ============
for (const [techId, dNums] of codeRefs) {
  const specDSet = specDecisions.get(techId);
  if (!specDSet) {
    // 代码引用了 Spec 中不存在的 TECH-ID
    const files = [...codeRefFiles.get(techId)].slice(0, 3).join(', ');
    errors.push(`spec-binding 漂移：代码引用 ${techId} 但 docs/spec/ 下无对应 Spec 文件（来源：${files}）`);
    continue;
  }
  // Spec 有 TECH-ID 但无任何 D 编号（早期 spec 无 D-numbered decisions）→ 跳过 D 级漂移校验
  if (specDSet.size === 0) continue;
  for (const dNum of dNums) {
    if (!specDSet.has(dNum)) {
      const files = [...codeRefFiles.get(techId)].slice(0, 3).join(', ');
      errors.push(`spec-binding 漂移：代码引用 ${techId} D${dNum} 但 Spec 未定义该决策编号（来源：${files}，Spec：${specFileOf.get(techId)}）`);
    }
  }
}

// ============ 缺口校验（warning）：Spec 定义 (TECH, D) 但代码无引用 ============
for (const [techId, specDSet] of specDecisions) {
  if (specDSet.size === 0) continue; // 早期 spec 无 D 编号
  const codeDSet = codeRefs.get(techId) || new Set();
  for (const dNum of specDSet) {
    if (!codeDSet.has(dNum)) {
      warnings.push(`spec-binding 缺口：${techId} D${dNum} 在 Spec 定义但代码无引用（${specFileOf.get(techId)}）`);
    }
  }
}

// ============ 输出 ============
const specTechCount = specDecisions.size;
const specDCount = [...specDecisions.values()].reduce((acc, s) => acc + s.size, 0);
const codeTechCount = codeRefs.size;
const codeDCount = [...codeRefs.values()].reduce((acc, s) => acc + s.size, 0);

console.log(`[spec-binding] Spec: ${specTechCount} TECH-ID / ${specDCount} 决策；代码引用：${codeTechCount} TECH-ID / ${codeDCount} 决策`);
console.log(`[spec-binding] 漂移 ${errors.length} 条（阻断）；缺口 ${warnings.length} 条（不阻断）`);

if (warnings.length > 0) {
  console.log('\n--- 缺口（warning，不阻断）---');
  for (const w of warnings) console.log('  ⚠ ' + w);
}

if (errors.length > 0) {
  console.log('\n--- 漂移（error，阻断）---');
  for (const e of errors) console.log('  ✗ ' + e);
  process.exit(1);
}

console.log('[spec-binding] 通过：代码引用的 (TECH, D) 全部可在 Spec 找到定义。');
