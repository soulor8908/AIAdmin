// scripts/gen-context-snapshot.mjs —— 扫描项目生成 docs/context-snapshot.md（≤8KB）
// 目的：为 spec-first 五角色 subagent 提供统一最小上下文快照，避免每角色重复读 80~150KB。
// 各章节末尾附"完整定义见 <路径>"引导按需读取。生成物勿手改，重跑脚本即可。
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs/context-snapshot.md');
const MAX_BYTES = 8 * 1024;

function walk(dir, acc = [], ext) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc, ext);
    else if (!ext || name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

// ============ 1. 规则速查表 ============
function extractRules() {
  const files = walk(join(ROOT, '.trae/rules'), [], '.md');
  const rows = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const blocks = src.split(/\n##\s+/).slice(1);
    for (const block of blocks) {
      const m = block.match(/^([A-Z]+-\d+[a-z]?)\s*[·•\-]?\s*([^\n]*)/);
      if (!m) continue;
      const id = m[1];
      let title = m[2].trim().replace(/\s*·\s*.*/, '');
      if (title.length > 22) title = title.slice(0, 22) + '…';
      const verify = (block.split(/校验方式/)[1] || '').split('\n')[0];
      let method = 'Reviewer';
      if (/check-rules\.mjs/.test(verify)) method = 'check-rules.mjs';
      else if (/vitest|CI|tsc/.test(verify)) method = 'CI/tsc/vitest';
      rows.push(`| ${id} | ${title} | ${method} |`);
    }
  }
  return rows.sort().join('\n');
}

// ============ 2. Contracts 速查表 ============
function extractContracts() {
  const dir = join(ROOT, 'packages/contracts/src/schemas');
  const files = readdirSync(dir).filter((n) => n.endsWith('.ts')).sort();
  const groups = [];
  const enums = [];
  for (const name of files) {
    const src = readFileSync(join(dir, name), 'utf8');
    const domain = name.replace(/\.ts$/, '');
    const names = [...src.matchAll(/^export const (\w+Schema)\b/gm)].map((m) => m[1]);
    if (names.length) groups.push(`- ${domain}: ${names.join(', ')}`);
    // 枚举值
    for (const em of src.matchAll(/export const (\w+Schema) = z\.enum\(\[([^\]]*)\]\)/g)) {
      const vals = em[2].match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)).join('|') ?? '';
      if (vals) enums.push(`- ${em[1].replace('Schema', '')}: ${vals}`);
    }
  }
  return groups.join('\n') + '\n\n关键枚举：\n' + enums.join('\n');
}

// ============ 3. 路由表 ============
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
function extractRoutes() {
  const src = readFileSync(join(ROOT, 'apps/api/src/server.ts'), 'utf8');
  const calls = extractCalls(src, 'defineRoute');
  const rows = ['| method | path | ver | cache |', '|---|---|---|---|'];
  for (const call of calls) {
    const args = splitArgs(call);
    if (args.length < 4) continue;
    const method = args[0].replace(/['"]/g, '');
    const path = args[1].replace(/['"]/g, '');
    const ver = args[4] === 'true' ? '✓' : '-';
    const cache = args[5] === 'true' ? '✓' : '-';
    rows.push(`| ${method} | ${path} | ${ver} | ${cache} |`);
  }
  return rows.join('\n');
}

// ============ 4. 前端基础设施摘要 ============
function extractFrontend() {
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(webSrc)) return '（无 apps/web/src）';
  const dirs = readdirSync(webSrc).filter((n) => statSync(join(webSrc, n)).isDirectory());
  const apiFiles = walk(join(webSrc, 'api'), [], '.ts').map((p) => p.split('/').pop());
  return [
    `分层目录：${dirs.join(' / ')}。`,
    `api 模块：${apiFiles.join(', ')}（统一 request<T> 封装 fetch，401 拦截清 token 跳 /login、409 VERSION_CONFLICT 重试 1 次、wire 适配 error→code）。`,
    `auth：AuthContext（login/logout action）+ RouteGuard（白名单 /login）+ tokenStore（localStorage）。`,
    `零新依赖（原生 fetch + react-router-dom + Context，无 axios/Redux/UI 框架）。`,
    `ARCH-003：仅 import @admin/contracts，禁连 apps/api/src/** 与 @admin/api。`,
  ].join('\n');
}

// ============ 5. 关键约定速查（D3~D21 跨域复用决策） ============
function extractConventions() {
  const serverSrc = readFileSync(join(ROOT, 'apps/api/src/server.ts'), 'utf8');
  const contractsDir = join(ROOT, 'packages/contracts/src/schemas');
  const contractsSrc = walk(contractsDir, [], '.ts').map((f) => readFileSync(f, 'utf8')).join('\n');
  const rows = [];
  const add = (decision, conv) => rows.push(`| ${decision} | ${conv} |`);
  if (/versioned|If-Match|VERSION_CONFLICT/.test(serverSrc))
    add('乐观锁', '写路由 versioned=true，safeParse 前解析 If-Match→expected_version；缺失→VERSION_REQUIRED(400)，不匹配→VERSION_CONFLICT(409)+current_version');
  if (/cacheable|If-None-Match|304/.test(serverSrc))
    add('ETag', '读路由 cacheable=true，200+ETag header；If-None-Match 匹配→304(空体)');
  if (/Bearer|TOKEN_INVALID|TOKEN_EXPIRED|TOKEN_REVOKED/.test(serverSrc))
    add('鉴权', 'Bearer token 五守卫：G1 缺 header→UNAUTHORIZED G2 非 Bearer→TOKEN_INVALID G3 验签失败→TOKEN_INVALID G4 过期→TOKEN_EXPIRED G5 黑名单→TOKEN_REVOKED；public 路由跳验签');
  if (/\.strict\(\)/.test(contractsSrc))
    add('输出 schema', '响应输出 schema 须 .strict() 拒绝多余字段（SEC-003a），与响应体 1:1');
  const testSrc = walk(join(ROOT, 'apps/api/test'), [], '.ts').map((f) => readFileSync(f, 'utf8')).join('\n');
  if (/schema\.options/.test(testSrc))
    add('SSOT 派生', '跨域枚举断言用 [...schema.options].toContain()，禁硬编码全集（AI-005），枚举扩展断言自动跟随');
  if (/redactedAuditLog|redactEmail/.test(contractsSrc))
    add('PII 脱敏', '查询返回审计日志用 redactedAuditLogSchema（脱敏态），邮箱脱敏 ab***@domain，禁用存储态 auditLogSchema 输出（SEC-003b）');
  if (/append-only|withAudit/.test(contractsSrc + serverSrc))
    add('审计', 'audit_logs append-only（不可改不可删）；写操作经 withAudit 埋点，before/after 仅含实际变更字段');
  if (/errorCodeSchema/.test(contractsSrc))
    add('错误码', 'errorCodeSchema 全局 SSOT（user.ts 定义一次），errors.ts Record<ErrorCode,number> 穷举 HTTP 映射，新增码须四处处同步');
  return '| 决策 | 约定 |\n|---|---|\n' + rows.join('\n');
}

const generatedAt = new Date().toISOString().slice(0, 10);
const doc = `# 项目上下文快照（自动生成，勿手改）
> 生成时间 ${generatedAt} · 由 \`scripts/gen-context-snapshot.mjs\` 扫描源码生成 · 目标 ≤8KB。
> 供 spec-first 五角色 subagent 作为最小公共上下文，按需循"完整定义见"读取明细。

## 架构概览
后端四层（apps/api/src）：router→service→repository→domain，单向依赖（ARCH-001）。contracts 纯净层（ARCH-002，只导出 Zod schema + z.infer 类型）。前端跨层只经契约（ARCH-003）。HTTP 入口 server.ts 声明式路由表 + Bearer 鉴权 + 乐观锁/ETag 中间件。SQLite 持久化（node:sqlite，PRAGMA foreign_keys=ON）。Ctx 接口 {user:{id,role}}。
完整定义见 apps/api/src/、packages/contracts/src/index.ts、apps/web/src/。

## 规则速查表
| ID | 一句话 | 校验方式 |
|---|---|---|
${extractRules()}
完整定义见 .trae/rules/。

## Contracts 速查表
按域分组（packages/contracts/src/schemas/）：
${extractContracts()}
完整定义见 packages/contracts/src/schemas/。

## 路由表
${extractRoutes()}
完整定义见 apps/api/src/server.ts。

## 前端基础设施摘要
${extractFrontend()}
完整定义见 apps/web/src/。

## 关键约定速查（跨域复用决策）
${extractConventions()}
完整定义见 docs/spec/*.tech.md。
`;

const bytes = Buffer.byteLength(doc, 'utf8');
if (bytes > MAX_BYTES) {
  console.error(`❌ context-snapshot.md 超限：${bytes} bytes > ${MAX_BYTES} bytes`);
  process.exit(1);
}
writeFileSync(OUT, doc);
console.log(`✅ 生成 ${OUT} (${bytes} bytes, 上限 ${MAX_BYTES})`);
