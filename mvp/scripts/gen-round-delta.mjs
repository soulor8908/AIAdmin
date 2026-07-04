// scripts/gen-round-delta.mjs —— 轮次增量上下文生成器（A1 优化项）
// 目的：对比上一轮 git ref，仅输出本轮新增/变更的端点 + 契约 + 规则 + 前端文件，
//       供 spec-first 五角色 subagent 作为"增量上下文"先读（<3KB），按需再读全量 context-snapshot.md。
// 用法：
//   node scripts/gen-round-delta.mjs                        # 默认 HEAD~1..HEAD → docs/delta-<sha>-<sha>.md
//   node scripts/gen-round-delta.mjs --round 16             # 输出 docs/round-16-delta.md，from 优先用 round-15 tag，无则回退 HEAD~1
//   node scripts/gen-round-delta.mjs --round 16 --tag       # 同上，并打 round-16 tag（须 --tag 显式开启）
//   node scripts/gen-round-delta.mjs --from <ref> --to <ref>
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MAX_BYTES = 3 * 1024;

// git root 可能不同于 cwd（monorepo 子目录场景），所有 git 调用基于 GIT_ROOT，
// 输出 path 统一 strip 成相对 ROOT 的视角（剥掉 monorepo 子目录前缀）。
const GIT_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const ROOT_PREFIX = ROOT.startsWith(GIT_ROOT) ? ROOT.slice(GIT_ROOT.length + 1) : '';
// 归一化：把 git 输出的路径转成相对 ROOT 的路径（剥掉 mvp/ 之类前缀）。
function norm(p) {
  if (ROOT_PREFIX && p.startsWith(ROOT_PREFIX + '/')) return p.slice(ROOT_PREFIX.length + 1);
  return p;
}

// ============ 参数解析 ============
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { from: null, to: 'HEAD', round: null, tag: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from') opts.from = args[++i];
    else if (a === '--to') opts.to = args[++i];
    else if (a === '--round') opts.round = Number(args[++i]);
    else if (a === '--tag') opts.tag = true;
  }
  // --round N：from 优先用 round-(N-1) tag（若存在），否则回退 HEAD~1
  if (opts.round != null) {
    const prevTag = `round-${opts.round - 1}`;
    if (hasRef(prevTag)) opts.from = opts.from ?? prevTag;
    else opts.from = opts.from ?? 'HEAD~1';
  } else {
    opts.from = opts.from ?? 'HEAD~1';
  }
  return opts;
}

function git(args) {
  return execSync(`git ${args}`, { cwd: GIT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function hasRef(ref) {
  try { git(`rev-parse --verify ${ref}^{commit}`); return true; } catch { return false; }
}
function sha7(ref) {
  try { return git(`rev-parse --short=7 ${ref}`).trim(); } catch { return ref; }
}

// ============ 取改动文件清单 ============
function changedFiles(from, to) {
  const out = git(`diff --name-status ${from}..${to}`);
  const entries = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0];
    // R100 old new / C100 old new 等重命名/复制
    if (status.startsWith('R') || status.startsWith('C')) {
      entries.push({ status: 'R', path: norm(parts[2]), oldPath: norm(parts[1]) });
    } else {
      entries.push({ status: status[0], path: norm(parts[1]) });
    }
  }
  return entries;
}

// ============ 解析 server.ts 路由表（指定 ref） ============
function parseRoutesAt(ref) {
  let src;
  try { src = git(`show ${ref}:${ROOT_PREFIX ? ROOT_PREFIX + '/' : ''}apps/api/src/server.ts`); } catch { return []; }
  return extractRouteCalls(src);
}
function extractRouteCalls(src) {
  const calls = extractCalls(src, 'defineRoute');
  const routes = [];
  for (const call of calls) {
    const args = splitArgs(call);
    if (args.length < 4) continue;
    const method = args[0].replace(/['"]/g, '');
    const path = args[1].replace(/['"]/g, '');
    const ver = args[4] === 'true' ? '✓' : '-';
    const cache = args[5] === 'true' ? '✓' : '-';
    routes.push({ method, path, ver, cache, key: `${method} ${path}` });
  }
  return routes;
}
function extractCalls(src, fnName) {
  const calls = [];
  let i = 0;
  while (true) {
    const idx = src.indexOf(fnName + '(', i);
    if (idx === -1) break;
    let depth = 1, j = idx + fnName.length + 1;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      j++;
    }
    calls.push(src.slice(idx, j));
    i = j;
  }
  return calls;
}
function splitArgs(call) {
  const open = call.indexOf('(');
  const inner = call.slice(open + 1, call.lastIndexOf(')'));
  const args = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { args.push(inner.slice(start, i).trim()); start = i + 1; }
  }
  args.push(inner.slice(start).trim());
  return args;
}

// ============ 解析 contracts schema 导出（指定 ref） ============
function parseSchemaExportsAt(ref) {
  const dir = `${ROOT_PREFIX ? ROOT_PREFIX + '/' : ''}packages/contracts/src/schemas`;
  let listing;
  try { listing = git(`ls-tree -r --name-only ${ref} ${dir}`); } catch { return new Map(); }
  const result = new Map(); // domain -> Set(schemaName)
  for (const file of listing.split('\n').filter(Boolean)) {
    let src;
    try { src = git(`show ${ref}:${file}`); } catch { continue; }
    const domain = file.split('/').pop().replace(/\.ts$/, '');
    const names = new Set([...src.matchAll(/^export const (\w+Schema)\b/gm)].map((m) => m[1]));
    result.set(domain, names);
  }
  return result;
}

// ============ 文件分类 ============
function classify(path) {
  if (path.startsWith('packages/contracts/src/schemas/')) return 'contracts';
  if (path === 'apps/api/src/server.ts') return 'server';
  if (path.startsWith('apps/api/src/')) return 'api-src';
  if (path.startsWith('apps/api/test/')) return 'api-test';
  if (path.startsWith('apps/web/src/api/')) return 'web-api';
  if (path.startsWith('apps/web/src/pages/')) return 'web-pages';
  if (path.startsWith('apps/web/src/components/')) return 'web-components';
  if (path.startsWith('apps/web/src/')) return 'web-src';
  if (path.startsWith('apps/web/test/')) return 'web-test';
  if (path.startsWith('.trae/rules/')) return 'rules';
  if (path.startsWith('docs/spec/')) return 'spec';
  if (path.startsWith('docs/prd/')) return 'prd';
  if (path.startsWith('docs/review/')) return 'review';
  if (path.startsWith('docs/retro/')) return 'retro';
  if (path.startsWith('scripts/')) return 'scripts';
  return 'other';
}

// ============ 主流程 ============
function main() {
  const opts = parseArgs();

  // 校验 from ref 存在
  if (!hasRef(opts.from)) {
    console.error(`❌ --from ref "${opts.from}" 不存在`);
    process.exit(1);
  }

  const files = changedFiles(opts.from, opts.to);
  if (files.length === 0) {
    console.log('ℹ️ 无改动，跳过 delta 生成');
    return;
  }

  // 按类别分组
  const byCat = new Map();
  for (const f of files) {
    const cat = classify(f.path);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(f);
  }

  // 路由 diff
  const oldRoutes = new Map(parseRoutesAt(opts.from).map((r) => [r.key, r]));
  const newRoutes = new Map(parseRoutesAt(opts.to).map((r) => [r.key, r]));
  const addedRoutes = [...newRoutes.keys()].filter((k) => !oldRoutes.has(k));
  const removedRoutes = [...oldRoutes.keys()].filter((k) => !newRoutes.has(k));

  // 契约 diff
  const oldSchemas = parseSchemaExportsAt(opts.from);
  const newSchemas = parseSchemaExportsAt(opts.to);
  const allDomains = new Set([...oldSchemas.keys(), ...newSchemas.keys()]);
  const addedSchemas = [];
  for (const d of allDomains) {
    const old = oldSchemas.get(d) ?? new Set();
    const now = newSchemas.get(d) ?? new Set();
    for (const s of now) if (!old.has(s)) addedSchemas.push(`${d}: ${s}`);
    for (const s of old) if (!now.has(s)) addedSchemas.push(`${d}: -(删除) ${s}`);
  }

  // 规则 diff（按文件）
  const ruleChanges = (byCat.get('rules') || []).map((f) => `${f.status} ${f.path.replace('.trae/rules/', '')}`);

  // 前端新增（A 状态）
  const webNew = [
    ...(byCat.get('web-api') || []),
    ...(byCat.get('web-pages') || []),
    ...(byCat.get('web-components') || []),
  ].filter((f) => f.status === 'A').map((f) => f.path.replace('apps/web/src/', ''));

  // 受影响域推断：优先用契约/后端文件名（精确），其次用前端文件名前缀（粗略）
  const affectedDomains = new Set();
  const KNOWN_DOMAINS = [
    'user', 'auth', 'role', 'dept', 'audit', 'notification', 'report', 'transfer', 'role-inheritance',
  ];
  // 文件名前缀 → 域 映射（覆盖历史命名约定）
  const PREFIX_TO_DOMAIN = [
    [/^user/i, 'user'],
    [/^auth|^login/i, 'auth'],
    [/^role/i, 'role'],
    [/^dept/i, 'dept'],
    [/^audit/i, 'audit'],
    [/^notification/i, 'notification'],
    [/^report/i, 'report'],
    [/^transfer/i, 'transfer'],
    [/^setParent|^inheritanceChain|^effectivePermissions/i, 'role-inheritance'],
  ];
  function inferDomain(filePath) {
    // 1. 精确路径
    const m = filePath.match(/contracts\/src\/schemas\/([\w-]+)\.ts/);
    if (m) return m[1];
    const m2 = filePath.match(/apps\/api\/src\/(?:domain|repository|service|router)\/([\w-]+)\.ts/);
    if (m2) return m2[1];
    const m3 = filePath.match(/apps\/web\/src\/api\/([\w-]+)\.ts/);
    if (m3) return m3[1];
    // 2. 文件名前缀
    const base = filePath.split('/').pop().replace(/\.(t|j)sx?$/, '');
    for (const [re, dom] of PREFIX_TO_DOMAIN) {
      if (re.test(base)) return dom;
    }
    return null;
  }
  for (const f of files) {
    const d = inferDomain(f.path);
    if (d) affectedDomains.add(d);
  }
  // 后端是否变更（用于跳过建议区分前后端）
  const backendChanged = files.some((f) =>
    f.path.startsWith('packages/contracts/') ||
    f.path.startsWith('apps/api/src/') ||
    f.path.startsWith('apps/api/test/')
  );
  const frontendChanged = files.some((f) =>
    f.path.startsWith('apps/web/src/') || f.path.startsWith('apps/web/test/')
  );
  const rulesChanged = files.some((f) => f.path.startsWith('.trae/rules/'));

  // 跳过建议：未触及的域（前后端均无改动）
  const skippedDomains = KNOWN_DOMAINS.filter((d) => !affectedDomains.has(d));

  // ============ 输出 ============
  const fromSha = sha7(opts.from);
  const toSha = sha7(opts.to);
  const roundTag = opts.round != null ? `round-${opts.round}` : null;

  const lines = [];
  lines.push(`# 轮次增量上下文（自动生成，勿手改）`);
  lines.push(`> 对比 ${opts.from} (${fromSha}) → ${opts.to} (${toSha}) · 改动 ${files.length} 文件 · 目标 ≤3KB。`);
  lines.push(`> 供 subagent 先读此 delta 把握本轮范围，按需再读全量 docs/context-snapshot.md。`);
  lines.push('');

  lines.push('## 本轮范围（按类别）');
  const catOrder = ['prd', 'spec', 'contracts', 'server', 'api-src', 'api-test', 'web-api', 'web-pages', 'web-components', 'web-src', 'web-test', 'rules', 'review', 'retro', 'scripts', 'other'];
  for (const cat of catOrder) {
    const items = byCat.get(cat);
    if (!items || items.length === 0) continue;
    const paths = items.map((f) => {
      const p = f.path.replace(/^(apps\/api\/|apps\/web\/|packages\/contracts\/src\/|docs\/|scripts\/|\.trae\/)/, '');
      return f.status === 'A' ? `+${p}` : f.status === 'D' ? `-${p}` : f.status === 'R' ? `R ${p}` : `M ${p}`;
    });
    lines.push(`- **${cat}** (${items.length}): ${paths.join(', ')}`);
  }
  lines.push('');

  if (addedRoutes.length > 0 || removedRoutes.length > 0) {
    lines.push('## 端点变更');
    if (addedRoutes.length > 0) {
      lines.push('**新增端点**:');
      for (const k of addedRoutes) {
        const r = newRoutes.get(k);
        lines.push(`- ${r.method} ${r.path} (versioned=${r.ver}, cacheable=${r.cache})`);
      }
    }
    if (removedRoutes.length > 0) {
      lines.push('**删除端点**:');
      for (const k of removedRoutes) lines.push(`- ${k}`);
    }
    lines.push('');
  }

  if (addedSchemas.length > 0) {
    lines.push('## 契约变更');
    for (const s of addedSchemas) lines.push(`- ${s}`);
    lines.push('');
  }

  if (ruleChanges.length > 0) {
    lines.push('## 规则变更');
    for (const r of ruleChanges) lines.push(`- ${r}`);
    lines.push('');
  }

  if (webNew.length > 0) {
    lines.push('## 前端新增文件');
    for (const p of webNew) lines.push(`- ${p}`);
    lines.push('');
  }

  lines.push('## subagent 跳过建议');
  lines.push(`- 后端契约/实现变更：${backendChanged ? '是（BA/Tech Lead/test-writer 须读 contracts/server.ts 改动段）' : '否（后端冻结，仅前端扩展，BA/Tech Lead 可跳过 contracts/server.ts 全文）'}`);
  lines.push(`- 前端变更：${frontendChanged ? '是（impl-writer/Reviewer 须读 apps/web/src 改动文件）' : '否'}`);
  lines.push(`- 规则变更：${rulesChanged ? '是（Reviewer 须重读 .trae/rules/ 改动文件）' : '否（Reviewer 规则合规可信赖既有 exit 0）'}`);
  if (affectedDomains.size > 0) {
    lines.push(`- 本轮触及的域：${[...affectedDomains].join(' / ')}`);
  }
  if (skippedDomains.length > 0) {
    lines.push(`- 本轮未触及的域（相关 subagent 可跳过对应 contracts/schemas/<域>.ts、server.ts 路由段、apps/web/src/api/<域>.ts）：${skippedDomains.join(' / ')}`);
  }
  lines.push('');

  // 推荐先读路径
  lines.push('## 推荐先读路径（按角色）');
  lines.push('- BA: 本 delta + docs/context-snapshot.md + docs/prd/<新域>.md（若存在）');
  lines.push('- Tech Lead: 本 delta + docs/context-snapshot.md + packages/contracts/src/schemas/<新域>.ts + apps/api/src/server.ts（仅本轮新增段）');
  lines.push('- test-writer: 本 delta + docs/spec/<新域>.tech.md + 新增 contracts schema');
  lines.push('- impl-writer: 本 delta + docs/spec/<新域>.tech.md + 新增/变更文件');
  lines.push('- Reviewer: 本 delta + git diff + 受影响文件（不全量扫描）');

  const doc = lines.join('\n');
  const bytes = Buffer.byteLength(doc, 'utf8');
  if (bytes > MAX_BYTES) {
    console.error(`❌ delta 文件超限：${bytes} bytes > ${MAX_BYTES} bytes`);
    process.exit(1);
  }

  // 输出文件名
  const outFile = roundTag != null
    ? join(ROOT, 'docs', `round-${opts.round}-delta.md`)
    : join(ROOT, 'docs', `delta-${fromSha}-${toSha}.md`);
  writeFileSync(outFile, doc);
  console.log(`✅ 生成 ${outFile.replace(ROOT + '/', '')} (${bytes} bytes, 上限 ${MAX_BYTES})`);

  // 可选：打 tag（须 --tag 显式开启，且 --round 已指定）
  if (opts.tag && roundTag != null && opts.to === 'HEAD') {
    try {
      git(`tag ${roundTag} ${opts.to}`);
      console.log(`🏷️  已打 tag ${roundTag} → ${toSha}`);
    } catch (e) {
      console.warn(`⚠️  打 tag ${roundTag} 失败（可能已存在）：${e.message}`);
    }
  }
}

main();
