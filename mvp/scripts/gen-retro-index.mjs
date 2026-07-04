// scripts/gen-retro-index.mjs —— 扫描 docs/retro/*.md 生成 docs/retro/lessons-learned.md（≤8KB）
// 目的：为 subagent 提供 retro 压缩索引，替代全量 retro 阅读（24 轮 retro 累计 >300KB → ≤8KB）。
// 保留原始 retro 不动；如需明细循"来源"读对应 roundN-retro.md。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const RETRO_DIR = join(ROOT, 'docs/retro');
const OUT = join(RETRO_DIR, 'lessons-learned.md');
// R17 调整：从 5KB 提升至 6KB；R25 调整：从 6KB 提升至 10KB（24 轮累计 + 新增量化对比表，预留 ~1KB 余量）。
const MAX_BYTES = 10 * 1024;

function roundOf(filename) {
  if (filename === 'mvp-retro.md') return 0;
  const m = filename.match(/round(\d+)-retro/);
  return m ? Number(m[1]) : -1;
}

const files = readdirSync(RETRO_DIR)
  .filter((n) => n.endsWith('.md') && n !== 'lessons-learned.md')
  .map((n) => ({ name: n, round: roundOf(n) }))
  .filter((f) => f.round >= 0)
  .sort((a, b) => a.round - b.round);

// 解析每个 retro：frontmatter + S 级条目
const retros = files.map(({ name, round }) => {
  const src = readFileSync(join(RETRO_DIR, name), 'utf8');
  const verdict = src.match(/verdict:\s*(.+)/)?.[1]?.trim().replace(/["']/g, '') || '';
  const scope = src.match(/scope:\s*(.+)/)?.[1]?.trim().replace(/["']/g, '') || '';
  // 按 \n### 切片，提取 S-N 条目
  const items = [];
  for (const sec of src.split(/\n###\s+/).slice(1)) {
    const m = sec.match(/^(S-\d+)\s*[·•]?\s*([^\n]+)/);
    if (!m) continue;
    const id = m[1];
    const title = m[2].trim().replace(/\s*·\s*.*/, '');
    // 反推层检测（规则层 / Spec 模板层 / 提示词层）
    let layer = '已固化';
    if (/规则层/.test(sec)) layer = '规则层';
    else if (/Spec\s*模板层/.test(sec)) layer = 'Spec 模板层';
    else if (/提示词层/.test(sec)) layer = '提示词层';
    items.push({ id, title, layer, sec });
  }
  return { name, round, verdict, scope, items, src };
});

// 轮次类型分类（业务轮 / 元改进轮 / 测试基础设施 / 早期 CRUD）
function classifyRound(scope) {
  if (/元改进轮/.test(scope)) return 'meta';
  if (/测试基础设施|E2E|Playwright|跨浏览器/.test(scope)) return 'infra';
  if (/业务轮/.test(scope)) return 'business';
  return 'early';
}

// 从 verdict 提取量化指标：AC 数 / 测试数 / blocker 数
function extractMetrics(verdict, src) {
  // AC 数：优先匹配 "N AC 全对齐" / "N/M AC 对齐" / "N/17 AC"
  const acMatch = verdict.match(/(\d+)\s*\/\s*(\d+)\s*AC/) || verdict.match(/(\d+)\s*AC\s*全?对?齐?/);
  const ac = acMatch ? (acMatch[2] || acMatch[1]) : '';
  // 测试数：匹配 "vitest N files M tests" 或 "M tests"
  const testMatch = verdict.match(/(\d+)\s*tests/) || src.match(/vitest[^;]*?(\d+)\s*tests/);
  const tests = testMatch ? testMatch[1] : '';
  // blocker 数：匹配 "N blocker" 或 "0 blocker"
  const blockerMatch = verdict.match(/(\d+)\s*blocker/i);
  const blocker = blockerMatch ? blockerMatch[1] : (verdict.includes('blocker') ? '?' : '0');
  return { ac, tests, blocker };
}

// 最新 retro 的"剩余改进项"→ 仍在生效集合（按 R{round}-{id} 复合键，因 S-N 每轮重新计数）
// 用粗体 **S-N**（R{round} …）模式扫描全文件：该模式仅出现在 §6 剩余改进项清单（heading 用纯文本，不含粗体+R 标注）。
const latest = retros[retros.length - 1];
const stillActive = new Map(); // key -> status
for (const m of latest.src.matchAll(/\*\*(S-\d+)\*\*[（(]\s*R(\d+)\s*([^)）]*)/g)) {
  const key = `R${m[2]}-${m[1]}`;
  const hint = m[3] || '';
  let status = '待固化';
  if (/遗留|advisory|不强制/.test(hint)) status = '遗留/advisory';
  else if (/未来|可考虑/.test(hint)) status = '未来方向';
  stillActive.set(key, status);
}

// 汇总表
const consolidated = [];
const active = [];
const seen = new Set();
for (const r of retros) {
  for (const it of r.items) {
    const key = `R${r.round}-${it.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = r.round === 0 ? 'MVP' : `R${r.round}`;
    // R17 调整：标题截断从 34 缩至 28 字符，配合 6KB 上限容纳 17 轮固化项。
    const t = it.title.length > 28 ? it.title.slice(0, 28) + '…' : it.title;
    if (stillActive.has(key)) {
      active.push(`| ${it.id} | ${source} | ${t} | ${stillActive.get(key)} |`);
    } else {
      consolidated.push(`| ${it.id} | ${source} | ${t} | ${it.layer} |`);
    }
  }
}

// 关键教训一句话版（每轮 verdict）
const lessons = retros
  .map((r) => {
    const tag = r.round === 0 ? 'MVP' : `R${r.round}`;
    const v = (r.verdict || r.scope || '').slice(0, 56);
    return `- ${tag}: ${v}`;
  })
  .join('\n');

// 量化对比表（轮次 / 类型 / AC / 测试数 / blocker / verdict 摘要）
const TYPE_LABEL = { early: 'CRUD', business: '业务', meta: '元改进', infra: '基础设施' };
const quantRows = retros.map((r) => {
  const tag = r.round === 0 ? 'MVP' : `R${r.round}`;
  const type = TYPE_LABEL[classifyRound(r.scope)] || '?';
  const m = extractMetrics(r.verdict, r.src);
  const v = (r.verdict || '').slice(0, 40).replace(/\|/g, '/');
  return `| ${tag} | ${type} | ${m.ac || '-'} | ${m.tests || '-'} | ${m.blocker} | ${v} |`;
});

const doc = `# 复盘教训索引（自动生成，勿手改）
> 由 \`scripts/gen-retro-index.mjs\` 扫描 docs/retro/*.md 生成 · 目标 ≤10KB · 原始 retro 不动。
> 供 subagent 替代全量 retro 阅读；如需明细循"来源"读对应 roundN-retro.md。

## 量化对比表（轮次演进速览）
| 轮次 | 类型 | AC | 测试 | blocker | verdict 摘要 |
|---|---|---|---|---|---|
${quantRows.join('\n')}
类型：CRUD=早期领域演练 / 业务=业务功能轮 / 元改进=纯元资产轮 / 基础设施=测试或 E2E 基础设施轮。

## 已固化规则表（已反推到规则/Spec/提示词层）
| ID | 来源 | 教训 | 固化方式 |
|---|---|---|---|
${consolidated.join('\n') || '_（无）_'}
完整明细见对应 roundN-retro.md §5 反推优化。

## 仍在生效的 S 级改进项（不阻断，待未来轮次处理）
| ID | 来源 | 内容 | 状态 |
|---|---|---|---|
${active.join('\n') || '_（无）_'}
完整明细见最新 retro §6 剩余改进项。

## 关键教训一句话版
${lessons}
`;

const bytes = Buffer.byteLength(doc, 'utf8');
if (bytes > MAX_BYTES) {
  console.error(`❌ lessons-learned.md 超限：${bytes} > ${MAX_BYTES}`);
  process.exit(1);
}
writeFileSync(OUT, doc);
console.log(`✅ 生成 ${OUT} (${bytes} bytes, 上限 ${MAX_BYTES})`);
